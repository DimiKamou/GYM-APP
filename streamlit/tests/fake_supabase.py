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


# Writes to make fail, in order: the head of the list is compared with each
# execute()'s "mode:table" and, when it matches, popped and raised as a
# transport error. A screen's second round trip dying is the case every
# two-step write has to survive, and there is no other way to make it happen.
FAIL_ONCE: list[str] = []

# Columns the "database" does not have yet, per table. A select naming one is
# refused the way PostgREST refuses it (42703), and so is a write that sends
# one. It models the hours between a deploy and the gym pasting the SQL, when
# the app is ahead of the schema.
MISSING_COLUMNS: dict[str, set[str]] = {}


# Whole tables the "database" does not have yet: a read or write on one is
# refused as PostgREST refuses an unknown table. Models a deploy ahead of 013.
MISSING_TABLES: set[str] = set()


class _MissingColumn(Exception):
    code = "42703"


class _MissingTable(Exception):
    code = "PGRST205"


def _shared_progress(store: dict[str, list[dict[str, Any]]], params: dict[str, Any]) -> Any:
    """public.shared_progress(), on the fake store: the same keys, the same filters."""
    token = str(params.get("p_token") or "")
    share = next((r for r in store.get("athlete_shares", [])
                  if str(r.get("token")) == token and not r.get("revoked_at")), None)
    if not share:
        return None
    athlete = next((a for a in store.get("athletes", []) if a.get("id") == share["athlete_id"]
                    and not a.get("deleted_at")), None)
    if not athlete:
        return None
    live = lambda rows: [r for r in rows if not r.get("deleted_at")]  # noqa: E731
    sessions = [r for r in live(store.get("sessions", [])) if r.get("athlete_id") == share["athlete_id"]
                and r.get("gym_id") == share["gym_id"]]
    sids = {r["id"] for r in sessions}
    blocks = [r for r in live(store.get("blocks", [])) if r.get("session_id") in sids]
    bids = {r["id"] for r in blocks}
    sets = [r for r in live(store.get("sets", [])) if r.get("block_id") in bids and r.get("done_at")]
    eids = {r.get("exercise_id") for r in blocks}
    exercises = [r for r in store.get("exercises", []) if r.get("id") in eids]
    eids |= {r.get("merged_into_id") for r in exercises if r.get("merged_into_id")}
    exercises = [dict(r) for r in store.get("exercises", []) if r.get("id") in eids]
    return {
        "athlete": athlete.get("full_name"),
        "gym": next((g.get("name") for g in store.get("gyms", []) if g.get("id") == share["gym_id"]), ""),
        "sessions": [dict(r) for r in sessions],
        "blocks": [dict(r) for r in blocks],
        "sets": [dict(r) for r in sets],
        "exercises": exercises,
        "links": [dict(r) for r in live(store.get("exercise_muscles", [])) if r.get("exercise_id") in eids],
        "groups": [dict(r) for r in live(store.get("muscle_groups", []))],
        "members": [{"id": m["id"], "display_name": m.get("display_name")}
                    for m in store.get("memberships", []) if m.get("gym_id") == share["gym_id"]],
    }


RPC_HANDLERS: dict[str, Any] = {"shared_progress": _shared_progress}


class _RpcCall:
    def __init__(self, store: dict[str, list[dict[str, Any]]], name: str, params: dict[str, Any]) -> None:
        self._store, self._name, self._params = store, name, params

    def execute(self) -> Any:
        ROUND_TRIPS.append(f"rpc:{self._name}")
        if self._name == "shared_progress" and "athlete_shares" in MISSING_TABLES:
            raise _MissingTable("Could not find the function public.shared_progress in the schema cache")
        return _Response(RPC_HANDLERS[self._name](self._store, self._params))


class _Response:
    def __init__(self, data: list[dict[str, Any]]) -> None:
        self.data = data


def _sort_key(value: Any) -> tuple[int, Any]:
    """Numbers as numbers, everything else as text — never numbers as text.

    `str()` put position 10 before position 2 and "sets-10" before "sets-2",
    which no Postgres column does; ISO dates and uuids compare correctly as the
    strings they are.
    """
    if isinstance(value, bool):
        return (1, str(value))
    if isinstance(value, (int, float)):
        return (0, float(value))
    return (1, str(value))


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
        self._orders: list[tuple[str, bool]] = []

    # --- verbs ---------------------------------------------------------
    def select(self, columns: str = "*", **_: Any) -> "_Query":
        if columns and columns != "*":
            self._columns = [c.strip() for c in columns.split(",") if c.strip()]
        return self

    # (table, columns) that Postgres has a unique index on. The fake enforced
    # nothing, and that let a whole design through: the three-list picker was
    # built on «Πιέσεις Στήθους» existing once per implement, which
    # exercises_gym_el_uniq forbids. The tests passed and the live app could
    # only ever show one option. An index the fake ignores is an index the
    # tests cannot defend.
    #
    # Each index is partial on its last column being NOT NULL, as in 001: since
    # the catalogue went English-only, name_el is NULL on most rows, and NULLs
    # must not collide with each other. Both name columns are indexed, because
    # the database indexes both — the fake knowing only name_el let a duplicate
    # English name through every test.
    _UNIQUE = {
        "exercises": (("gym_id", "name_el"), ("gym_id", "name_en")),
        "athletes": (("gym_id", "full_name"),),
    }

    def _check_unique(self, row: dict[str, Any], ignore_id: Any = None) -> None:
        for columns in self._UNIQUE.get(self._table, ()):
            if row.get(columns[-1]) is None:
                continue

            def key(candidate: dict[str, Any], columns: tuple[str, ...] = columns) -> tuple[Any, ...]:
                return tuple(
                    str(candidate.get(c) or "").lower() if isinstance(candidate.get(c), str)
                    else candidate.get(c)
                    for c in columns
                )

            wanted = key(row)
            for existing in self._store.get(self._table, []):
                if ignore_id is not None and existing.get("id") == ignore_id:
                    continue
                if existing.get(columns[-1]) is None:
                    continue
                if existing.get("deleted_at") is None and key(existing) == wanted:
                    raise ValueError(
                        f"duplicate key value violates unique constraint "
                        f"\"{self._table}_{'_'.join(columns)}_uniq\": {wanted}"
                    )

    def insert(self, payload: Any, **_: Any) -> "_Query":
        rows = payload if isinstance(payload, list) else [payload]
        self._mode = "insert"
        for item in rows:
            row = dict(item)
            row.setdefault("id", f"{self._table}-{next(_counter)}")
            row.setdefault("deleted_at", None)
            self._check_unique(row)
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

    def gt(self, column: str, value: Any) -> "_Query":
        return self._compare(column, value, lambda a, b: a > b)

    def gte(self, column: str, value: Any) -> "_Query":
        return self._compare(column, value, lambda a, b: a >= b)

    def lt(self, column: str, value: Any) -> "_Query":
        return self._compare(column, value, lambda a, b: a < b)

    def lte(self, column: str, value: Any) -> "_Query":
        return self._compare(column, value, lambda a, b: a <= b)

    def _compare(self, column: str, value: Any, keep: Any) -> "_Query":
        wanted = _sort_key(value)
        self._rows = [
            r for r in self._rows
            if r.get(column) is not None and keep(_sort_key(r.get(column)), wanted)
        ]
        return self

    def order(self, column: str, desc: bool = False, **_: Any) -> "_Query":
        # Chained .order() calls are ONE multi-key sort, as PostgREST reads
        # them. The first version re-sorted the whole list on every call, so
        # the LAST key won outright and `.order("position").order("id")` — the
        # (position, id) rule CLAUDE.md insists on — was silently id-only
        # here: a regression to position alone passed every test.
        self._orders.append((column, bool(desc)))
        for key_column, key_desc in reversed(self._orders):
            # Stable sorts applied from the least significant key up give the
            # composite order without building a mixed-direction tuple key.
            self._rows.sort(
                key=lambda r, c=key_column: (r.get(c) is None, _sort_key(r.get(c))),
                reverse=key_desc,
            )
        return self

    def limit(self, count: int) -> "_Query":
        self._rows = self._rows[:count]
        return self

    # --- execution -----------------------------------------------------
    def execute(self) -> _Response:
        ROUND_TRIPS.append(f"{self._mode}:{self._table}")
        if self._table in MISSING_TABLES:
            raise _MissingTable(f"Could not find the table 'public.{self._table}' in the schema cache")
        missing = MISSING_COLUMNS.get(self._table, set())
        named = set(self._columns or [])
        named |= {key for row in self._written for key in row}
        named |= set(getattr(self, "_patch", {}) or {})
        for column in sorted(missing & named):
            if self._mode == "insert":
                # Nothing was written: the INSERT is one statement.
                store = self._store.get(self._table, [])
                for row in self._written:
                    if row in store:
                        store.remove(row)
            raise _MissingColumn(f"column {self._table}.{column} does not exist")
        if FAIL_ONCE and FAIL_ONCE[0] == f"{self._mode}:{self._table}":
            FAIL_ONCE.pop(0)
            raise _NetworkDown("connection reset by peer")
        if self._mode == "insert":
            return _Response([self._project(r) for r in self._written])
        if self._mode == "update":
            # The index is checked BEFORE anything is mutated, so a refused
            # rename leaves every row as it was — the way one statement does.
            for row in self._rows:
                self._check_unique(dict(row, **self._patch), ignore_id=row.get("id"))
            for row in self._rows:
                row.update(self._patch)
                if self._stamp is not None:
                    # The BEFORE UPDATE half of the triggers: a workout moved
                    # to another day gets its local_date recomputed here as
                    # sessions_set_local_date() does, or the fake holds a row
                    # Postgres could not — started_at on one day, local_date
                    # on another.
                    self._stamp(self._table, row, "update")
            # Only the rows the filters actually reached, which is how a client
            # learns that a policy refused it: the update reports success and
            # returns nothing.
            return _Response([self._project(r) for r in self._rows])
        return _Response([self._project(r) for r in self._rows])

    def _project(self, row: dict[str, Any]) -> dict[str, Any]:
        if self._columns is None:
            return dict(row)
        return {c: row.get(c) for c in self._columns}


# Set to "network" to make refresh_session raise the way a phone waking from
# lock does — a transport error with no HTTP status — to "gateway" for a 503
# from a restarting Supabase, or to "rejected" for a token the server actually
# refused. They must not be handled alike: two are blips, one is a spent token.
REFRESH_FAILURE: str | None = None
# Every refresh token handed to the server, and every sign-out's options.
REFRESH_CALLS: list[str] = []
SIGN_OUT_CALLS: list[Any] = []


class _NetworkDown(Exception):
    """No status attribute, exactly like an httpx transport error."""


class _Rejected(Exception):
    def __init__(self) -> None:
        super().__init__("invalid refresh token")
        self.status = 400


class _Gateway(Exception):
    """What supabase_auth raises for a 502/503/504: AuthRetryableError with a status."""

    def __init__(self, status: int = 503) -> None:
        super().__init__("upstream unavailable")
        self.status = status


class _Auth:
    def __init__(self, user_id: str) -> None:
        self._user_id = user_id

    def refresh_session(self, token: str) -> Any:
        REFRESH_CALLS.append(token)
        if REFRESH_FAILURE == "network":
            raise _NetworkDown("connection reset")
        if REFRESH_FAILURE == "gateway":
            raise _Gateway()
        if REFRESH_FAILURE == "rejected":
            raise _Rejected()

        class _S:
            access_token = "fresh-access"
            refresh_token = "fresh-refresh"
            expires_at = 4102444800.0
            user = type("U", (), {"id": self._user_id, "email": "dimitris@powerhouse.gr"})()

        return type("R", (), {"session": _S()})()

    def set_session(self, *_: Any, **__: Any) -> None:
        return None

    def get_user(self, *_: Any, **__: Any) -> Any:
        class _U:
            id = self._user_id

        return type("R", (), {"user": _U()})()

    def sign_out(self, options: Any = None, **__: Any) -> None:
        SIGN_OUT_CALLS.append(options)
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

    def rpc(self, name: str = "", params: Any = None, *_: Any, **__: Any) -> Any:
        if name in RPC_HANDLERS:
            return _RpcCall(self.store, name, dict(params or {}))
        return _Query(self.store, "gyms", self._stamp)
