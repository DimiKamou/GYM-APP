"""An in-memory stand-in for PostgREST, faithful enough to catch real mistakes.

It exists because of two bugs that shipped. `st.navigation(position="top")` is
accepted by the signature and ignored by the renderer, so six of seven screens
had no way in; and `_catalogue()` never selected `equipment`, so every "· Μπάρα"
the log screen believed it was drawing came out empty. Neither is visible in the
source, both are obvious the moment the screen is actually run.

What it models, because the screens depend on it:

  * `.eq` / `.in_` / `.is_("deleted_at", "null")` / `.order` / `.limit`
  * UPDATE writing THROUGH to the store and returning the rows it touched —
    which is the whole soft-delete/undo mechanism, and what a fake that filtered
    a private copy would silently make untestable
  * `select("a, b, c")` returning ONLY those columns, so a screen that reads a
    column it forgot to ask for fails here exactly as it fails against the real
    database instead of quietly working

What it does NOT model: row-level security, triggers, constraints. Those are
tested where they live, against a real Postgres, in `supabase/tests/run.sh`.
This file answers a different question — does the screen work — and answering it
does not require pretending to be Postgres.
"""

from __future__ import annotations

import itertools
from typing import Any

_counter = itertools.count(1)

# Every execute() against the fake, counted. The gym's complaint was that the
# screen hangs, and on a free-tier database over gym wifi a "hang" is a count:
# each round trip is hundreds of milliseconds, and they are sequential. A test
# that asserts a number here is the only kind that can stop that regressing.
ROUND_TRIPS: list[str] = []


def reset_round_trips() -> None:
    ROUND_TRIPS.clear()


class _Response:
    def __init__(self, data: list[dict[str, Any]]) -> None:
        self.data = data


class _Query:
    def __init__(
        self,
        store: dict[str, list[dict[str, Any]]],
        table: str,
        stamp: Any = None,
    ) -> None:
        self._store = store
        self._table = table
        self._stamp = stamp
        # References into the store, never copies: an UPDATE here has to be
        # visible to the next read, the way it is for a real client.
        self._rows: list[dict[str, Any]] = list(store.setdefault(table, []))
        self._columns: list[str] | None = None
        self._mode = "select"
        self._written: list[dict[str, Any]] = []

    # --- verbs ---------------------------------------------------------
    def select(self, columns: str = "*", **_: Any) -> "_Query":
        if columns and columns != "*":
            self._columns = [c.strip() for c in columns.split(",") if c.strip()]
        return self

    def insert(self, payload: Any, **_: Any) -> "_Query":
        rows = payload if isinstance(payload, list) else [payload]
        self._mode = "insert"
        for item in rows:
            row = dict(item)
            row.setdefault("id", f"{self._table}-{next(_counter)}")
            row.setdefault("deleted_at", None)
            if self._stamp is not None:
                # The BEFORE INSERT triggers the screens are written around.
                # Without them a new workout comes back with no author and no
                # gym day, and the header reads "άγνωστο μέλος · —" — which is
                # a fake artefact that would send someone hunting a real bug.
                self._stamp(self._table, row)
            self._store.setdefault(self._table, []).append(row)
            self._written.append(row)
        return self

    def update(self, payload: dict[str, Any], **_: Any) -> "_Query":
        self._mode = "update"
        self._patch = dict(payload)
        return self

    def rpc(self, *_: Any, **__: Any) -> "_Query":
        return self

    # --- filters -------------------------------------------------------
    def eq(self, column: str, value: Any) -> "_Query":
        self._rows = [r for r in self._rows if str(r.get(column)) == str(value)]
        return self

    def neq(self, column: str, value: Any) -> "_Query":
        self._rows = [r for r in self._rows if str(r.get(column)) != str(value)]
        return self

    def in_(self, column: str, values: list[Any]) -> "_Query":
        wanted = {str(v) for v in values}
        self._rows = [r for r in self._rows if str(r.get(column)) in wanted]
        return self

    def is_(self, column: str, value: Any) -> "_Query":
        if value == "null" or value is None:
            self._rows = [r for r in self._rows if r.get(column) is None]
        else:
            self._rows = [r for r in self._rows if r.get(column) is not None]
        return self

    def not_(self, *_: Any, **__: Any) -> "_Query":
        return self

    def order(self, column: str, desc: bool = False, **_: Any) -> "_Query":
        self._rows = sorted(
            self._rows,
            key=lambda r: (r.get(column) is None, str(r.get(column))),
            reverse=desc,
        )
        return self

    def limit(self, count: int) -> "_Query":
        self._rows = self._rows[:count]
        return self

    # --- execution -----------------------------------------------------
    def execute(self) -> _Response:
        ROUND_TRIPS.append(f"{self._mode}:{self._table}")
        if self._mode == "insert":
            return _Response([self._project(r) for r in self._written])
        if self._mode == "update":
            for row in self._rows:
                row.update(self._patch)
            # Only the rows the filters actually reached, which is how a client
            # learns that a policy refused it: the update reports success and
            # returns nothing.
            return _Response([self._project(r) for r in self._rows])
        return _Response([self._project(r) for r in self._rows])

    def _project(self, row: dict[str, Any]) -> dict[str, Any]:
        if self._columns is None:
            return dict(row)
        return {c: row.get(c) for c in self._columns}


class _Auth:
    def __init__(self, user_id: str) -> None:
        self._user_id = user_id

    def set_session(self, *_: Any, **__: Any) -> None:
        return None

    def get_user(self, *_: Any, **__: Any) -> Any:
        class _U:
            id = self._user_id

        return type("R", (), {"user": _U()})()

    def sign_out(self, *_: Any, **__: Any) -> None:
        return None

    def update_user(self, *_: Any, **__: Any) -> None:
        return None


class FakeClient:
    """One process-wide store, handed to every `db.client()` call in a test run."""

    def __init__(
        self,
        store: dict[str, list[dict[str, Any]]],
        user_id: str,
        stamp: Any = None,
    ) -> None:
        self.store = store
        self._stamp = stamp
        self.auth = _Auth(user_id)
        self.postgrest = type("P", (), {"auth": lambda self, *a, **k: None})()

    def table(self, name: str) -> _Query:
        return _Query(self.store, name, self._stamp)

    def rpc(self, *_: Any, **__: Any) -> _Query:
        return _Query(self.store, "gyms", self._stamp)
