"""Προπόνηση — the open workout, written one set at a time.

This is the screen a coach uses standing at a rack with a phone in one hand, and
that single fact decides the layout: every widget a trainer touches mid-set sits
inside an `st.form`, so a whole set costs ONE server round trip instead of one
per keystroke.

What each block shows, in this order and not another:

    1. the exercise
    2. what this athlete last did on it — the top set, WITH the day and the
       coach who logged it. A bare "80×8" is worse than nothing here, because
       the next coach loads a bar with it.
    3. the sets already logged into this workout
    4. the form for the next set

The four set kinds are not interchangeable. Twenty treadmill minutes stored as
`reps` is zero volume in every total downstream, so the form is built from the
exercise's `default_set_kind` and writes the column that kind is measured in —
load_kg/reps, reps, seconds or meters.

Nothing here sends `logged_by`, `local_date` or `created_by`. Those are stamped
by `sessions_stamp_author()`, `sessions_set_local_date()` and
`stamp_created_by()` from the caller's JWT: a value sent from the client would
be a claim, and the whole product is that every line on the sheet is a fact
about who actually typed it.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime, timezone
from typing import Any

import streamlit as st

from lib import db

# Greek short month names, spelled the way Intl 'el-GR' spells them in the PWA
# (src/domain/format.ts). Hard-coded rather than taken from strftime, because the
# server process boots with whatever locale Streamlit Cloud gives it and an app
# that prints "Aug" on Tuesday and "Αυγ" on Wednesday is worse than one that is
# consistently wrong.
_MONTHS_EL = (
    "Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαΐ", "Ιουν",
    "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ",
)

_DEFAULT_TZ = "Europe/Athens"

# Rendered where a membership id does not resolve to a name. Never an empty
# string: a number whose author silently vanished reads as if nobody wrote it.
_UNKNOWN_AUTHOR = "άγνωστο μέλος"

_EMPTY = "—"

# How far back the "last time" lookup reads. It is a window, not the whole
# history, because the session ids go into a PostgREST `in.(…)` filter and a URL
# grows 39 characters per id. Sixty sessions is well over a year for an athlete
# who trains twice a week, and the alternative — no lookup at all — is the bare
# number this app exists to prevent.
_HISTORY_SESSIONS = 60

# numeric(6,2) on sets.load_kg and numeric(9,2) on sets.meters are the hard
# limits; these are the sane-input limits, so a slipped keyboard says so in Greek
# instead of coming back as a Postgres overflow.
_MAX_KG = 999.0
_MAX_METERS = 100_000.0
_MAX_SECONDS = 86_400

# Exercises filed under no visible muscle group at all. They are still reachable
# here rather than dropped: an exercise nobody can pick is an exercise nobody can
# log, and the coach is standing at the machine looking at it.
_UNFILED_GROUP = "Χωρίς μυϊκή ομάδα"

_NOTICE = "log_notice"
# Set by the finish button. render() consults it BEFORE opening a workout,
# because clearing session_id on its own would make the very next rerun insert a
# fresh empty session and the coach could never leave the screen.
_FINISHED = "log_finished"

_KIND_LABELS = {
    "weight_reps": "κιλά × επαναλήψεις",
    "bodyweight": "επαναλήψεις με το βάρος σώματος",
    "duration": "χρόνος",
    "distance": "απόσταση",
}

# Combining diacritical marks, i.e. everything NFD peels off an accented vowel.
_COMBINING = re.compile("[\u0300-\u036f]")

# CommonMark treats all of these as syntax. Exercise names and set notes can be
# typed by a trainer, and Streamlit renders them as markdown, so an underscore in
# a gym's own exercise name would silently restyle the line around it.
_MD_SPECIALS = re.compile(r"([\\`*_{}\[\]()<>#+\-.!|$~])")


# ---------------------------------------------------------------------------
# Text
# ---------------------------------------------------------------------------

def _md(text: str) -> str:
    """Escape trainer-typed text for a markdown renderer, keeping line breaks."""
    return _MD_SPECIALS.sub(r"\\\1", text or "").replace("\n", "  \n")


def _sort_key(text: str) -> str:
    """Accent- and sigma-insensitive sort key, so Άρσεις sits beside Ασκήσεις.

    Only ever used WITHIN one muscle group. The groups themselves are ordered by
    `muscle_groups.position` — in Greek alphabetical order Τρικέφαλοι sorts above
    Στήθος, which is nobody's mental model of a gym.
    """
    stripped = _COMBINING.sub("", unicodedata.normalize("NFD", text or ""))
    return unicodedata.normalize("NFC", stripped).lower().replace("ς", "σ")


def _exercise_name(exercise: dict[str, Any] | None) -> str:
    """Greek first, English as the fallback — a catalogue row may carry only one."""
    if not exercise:
        return _EMPTY
    return (exercise.get("name_el") or exercise.get("name_en") or _EMPTY).strip() or _EMPTY


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------

def _format_day(value: date, today: date) -> str:
    """"12 Αυγ", and "12 Αυγ 2025" once the year stops being obvious.

    The year is not decoration on an old number: "12 Αυγ" against a two-year-old
    top set reads as last month, and the coach loads the bar accordingly.
    """
    head = f"{value.day} {_MONTHS_EL[value.month - 1]}"
    return head if value.year == today.year else f"{head} {value.year}"


def _parse_instant(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    text = str(value or "").strip()
    if not text:
        return None
    # PostgREST hands back "+00:00" on some columns and a bare "Z" on others.
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _parse_local_date(value: Any) -> date | None:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    try:
        return date.fromisoformat(str(value or "")[:10])
    except ValueError:
        return None


def _zone(gym_id: str) -> Any:
    """The gym's tz object, or None when the platform has no tz database."""
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(_gym_timezone(gym_id))
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Numbers
# ---------------------------------------------------------------------------

def _decimal(value: Any) -> float | None:
    """Tolerant decimal parse. Returns None, never NaN.

    A Greek trainer types "72,5". `float("72,5")` raises and `Number("72,5")`
    would produce a NaN that propagates silently into every volume total and
    chart in the product — the likeliest silent data loss in the whole app. This
    is also the read path: PostgREST hands numeric columns back as strings.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        parsed = float(value)
    else:
        text = str(value).strip().replace(",", ".")
        if not text:
            return None
        try:
            parsed = float(text)
        except ValueError:
            return None
    if parsed != parsed or parsed in (float("inf"), float("-inf")):
        return None
    return parsed


def _integer(value: Any) -> int | None:
    parsed = _decimal(value)
    return None if parsed is None else int(round(parsed))


def _format_weight(kg: float) -> str:
    """"72,5" — Greek decimal comma, trailing zeros dropped, plates to 1,25 kg."""
    text = f"{kg:.2f}".rstrip("0").rstrip(".")
    return (text or "0").replace(".", ",")


def _weight_input_default(value: Any) -> str:
    """What the κιλά box starts with — the same comma form the coach types."""
    parsed = _decimal(value)
    return "" if parsed is None else _format_weight(parsed)


def _format_duration(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds} δευτ."
    minutes, rest = divmod(seconds, 60)
    # A ragged duration reads as a stopwatch. "1,5 λεπτά" is not how anyone
    # reports a plank.
    if rest:
        return f"{minutes}:{rest:02d}"
    return "1 λεπτό" if minutes == 1 else f"{minutes} λεπτά"


def _format_distance(meters: float) -> str:
    if meters >= 1000:
        return f"{meters / 1000:.1f}".replace(".", ",") + " χλμ"
    return f"{round(meters)} μ."


def _format_set(row: dict[str, Any], kind: str) -> str:
    """The one-line rendering of a set, per kind: "80×8", "10 επαναλήψεις", "20 λεπτά"."""
    load = _decimal(row.get("load_kg"))
    reps = _integer(row.get("reps"))

    if kind == "weight_reps":
        if load is not None and reps is not None:
            return f"{_format_weight(load)}×{reps}"
        if load is not None:
            return f"{_format_weight(load)} kg"
        if reps is not None:
            return f"{reps} επαναλήψεις"
        return _EMPTY

    if kind == "bodyweight":
        if reps is None:
            return _EMPTY
        if load is not None and load > 0:
            return f"+{_format_weight(load)}×{reps}"
        return f"{reps} επαναλήψεις"

    if kind == "duration":
        seconds = _integer(row.get("seconds"))
        return _EMPTY if seconds is None or seconds < 0 else _format_duration(seconds)

    if kind == "distance":
        meters = _decimal(row.get("meters"))
        return _EMPTY if meters is None or meters < 0 else _format_distance(meters)

    return _EMPTY


def _score(row: dict[str, Any]) -> float:
    """One comparable magnitude per set, so "the top one" means something for every kind."""
    for column in ("load_kg", "meters", "seconds", "reps"):
        value = _decimal(row.get(column))
        if value is not None:
            return value
    return 0.0


# ---------------------------------------------------------------------------
# Reads
#
# Every one of these takes gym_id first, even where the body never uses it.
# @st.cache_data is global to the server process, so a cache hit is served
# without ever reaching a policy again — the tenant has to be part of the key or
# the cache is the leak that RLS was there to prevent.
# ---------------------------------------------------------------------------

@st.cache_data(ttl=300, show_spinner=False)
def _gym_timezone(gym_id: str) -> str:
    row = (
        db.client()
        .table("gyms")
        .select("timezone")
        .eq("id", gym_id)
        .limit(1)
        .execute()
        .data
    )
    return (row[0].get("timezone") if row else None) or _DEFAULT_TZ


@st.cache_data(ttl=300, show_spinner=False)
def _member_names(gym_id: str) -> dict[str, str]:
    """membership id -> display name, for the whole gym.

    Soft-deleted and removed members are included on purpose: they wrote history
    that still has to be attributed to them.
    """
    rows = (
        db.client()
        .table("memberships")
        .select("id, display_name")
        .eq("gym_id", gym_id)
        .execute()
        .data
        or []
    )
    return {row["id"]: (row.get("display_name") or _UNKNOWN_AUTHOR) for row in rows}


@st.cache_data(ttl=300, show_spinner=False)
def _catalogue(gym_id: str) -> list[dict[str, Any]]:
    """Every exercise this gym can see — the shared catalogue plus its own.

    Archived, merged and soft-deleted rows come back too. They are filtered out
    of the picker in Python, but a block logged three years ago still points at
    one of them and has to render with its name rather than as a blank line.
    """
    return (
        db.client()
        .table("exercises")
        .select("id, name_el, name_en, category, default_set_kind, is_archived, merged_into_id, deleted_at")
        .order("name_el")
        .execute()
        .data
        or []
    )


@st.cache_data(ttl=300, show_spinner=False)
def _muscle_groups(gym_id: str) -> list[dict[str, Any]]:
    """The taxonomy in DISPLAY order — position first, never the alphabet.

    RLS returns the shared groups (gym_id is null) and this gym's own together,
    so a gym's own group at position 20 lands after the sixteen shared ones
    exactly as its position says. (position, id) and not position alone, because
    two inserts can mint the same position and the id is the only tie-break.
    """
    return (
        db.client()
        .table("muscle_groups")
        .select("id, gym_id, name_el, name_en, position")
        .is_("deleted_at", "null")
        .order("position")
        .order("id")
        .execute()
        .data
        or []
    )


@st.cache_data(ttl=300, show_spinner=False)
def _exercise_muscles(gym_id: str) -> list[dict[str, Any]]:
    return (
        db.client()
        .table("exercise_muscles")
        .select("exercise_id, muscle_group_id, role")
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )


@st.cache_data(ttl=15, show_spinner=False)
def _blocks(gym_id: str, session_id: str) -> list[dict[str, Any]]:
    return (
        db.client()
        .table("blocks")
        .select("id, exercise_id, position")
        .eq("gym_id", gym_id)
        .eq("session_id", session_id)
        .is_("deleted_at", "null")
        # (position, id), never position alone: two offline inserts can mint the
        # same position and the id is the only tie-break both devices agree on.
        .order("position")
        .order("id")
        .execute()
        .data
        or []
    )


@st.cache_data(ttl=15, show_spinner=False)
def _sets(gym_id: str, session_id: str, block_ids: tuple[str, ...]) -> list[dict[str, Any]]:
    """Every live set of one workout. block_ids is in the key so adding a block misses."""
    if not block_ids:
        return []
    return (
        db.client()
        .table("sets")
        .select("id, block_id, position, kind, load_kg, reps, seconds, meters, note, done_at, created_by")
        .eq("gym_id", gym_id)
        .in_("block_id", list(block_ids))
        .is_("deleted_at", "null")
        .order("position")
        .order("id")
        .execute()
        .data
        or []
    )


@st.cache_data(ttl=120, show_spinner=False)
def _last_performance(
    gym_id: str,
    athlete_id: str,
    exercise_ids: tuple[str, ...],
    exclude_session_id: str,
) -> dict[str, dict[str, Any]]:
    """exercise id -> the athlete's last top set on it, with its day and author.

    Three queries for the whole screen rather than one per block: the athlete's
    recent sessions, the blocks of those sessions that use these exercises, and
    the sets of the winning blocks. The current workout is excluded — "last time"
    means the last time before today's, otherwise the target moves as the coach
    types it.
    """
    if not exercise_ids:
        return {}

    client = db.client()
    sessions = (
        client.table("sessions")
        .select("id, local_date, started_at, logged_by")
        .eq("gym_id", gym_id)
        .eq("athlete_id", athlete_id)
        .is_("deleted_at", "null")
        # local_date before started_at: the gym day is the fact a coach reasons
        # about, and the instant and the id only make the order total.
        .order("local_date", desc=True)
        .order("started_at", desc=True)
        .order("id", desc=True)
        .limit(_HISTORY_SESSIONS)
        .execute()
        .data
        or []
    )

    history = [row for row in sessions if str(row.get("id")) != exclude_session_id]
    if not history:
        return {}
    rank_of = {str(row["id"]): rank for rank, row in enumerate(history)}
    session_of = {str(row["id"]): row for row in history}

    blocks = (
        client.table("blocks")
        .select("id, session_id, exercise_id")
        .eq("gym_id", gym_id)
        .in_("session_id", list(rank_of))
        .in_("exercise_id", list(exercise_ids))
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )
    if not blocks:
        return {}

    # The most recent session that used each exercise. A session that used it
    # twice (straight sets, then a drop-set block) contributes both blocks, and
    # the top set is taken across them.
    winners: dict[str, dict[str, Any]] = {}
    for block in blocks:
        rank = rank_of.get(str(block.get("session_id")))
        if rank is None:
            continue
        exercise_id = str(block.get("exercise_id") or "")
        current = winners.get(exercise_id)
        if current is None or rank < current["rank"]:
            winners[exercise_id] = {
                "rank": rank,
                "session_id": str(block["session_id"]),
                "block_ids": [str(block["id"])],
            }
        elif rank == current["rank"]:
            current["block_ids"].append(str(block["id"]))

    wanted = [bid for winner in winners.values() for bid in winner["block_ids"]]
    if not wanted:
        return {}

    performed = (
        client.table("sets")
        .select("block_id, kind, load_kg, reps, seconds, meters")
        .eq("gym_id", gym_id)
        .in_("block_id", wanted)
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )
    by_block: dict[str, list[dict[str, Any]]] = {}
    for row in performed:
        by_block.setdefault(str(row.get("block_id")), []).append(row)

    result: dict[str, dict[str, Any]] = {}
    for exercise_id, winner in winners.items():
        rows = [row for bid in winner["block_ids"] for row in by_block.get(bid, [])]
        if not rows:
            continue
        top = max(rows, key=_score)
        session = session_of[winner["session_id"]]
        result[exercise_id] = {
            "set": top,
            # Each set carries its own kind; a treadmill block and a bench block
            # are not comparable and must not be rendered alike.
            "kind": top.get("kind") or "weight_reps",
            "day": _parse_local_date(session.get("local_date")),
            "logged_by": session.get("logged_by"),
        }
    return result


def _session_row(gym_id: str, session_id: str) -> dict[str, Any] | None:
    """The open workout. Deliberately uncached — its status is what the screen turns on."""
    rows = (
        db.client()
        .table("sessions")
        .select("id, athlete_id, status, title, started_at, finished_at, local_date, logged_by")
        .eq("gym_id", gym_id)
        .eq("id", session_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def _clear_workout_caches() -> None:
    _blocks.clear()
    _sets.clear()


# ---------------------------------------------------------------------------
# The grouped picker
# ---------------------------------------------------------------------------

def _grouped_exercises(gym_id: str) -> list[tuple[str, list[dict[str, Any]]]]:
    """[(μυϊκή ομάδα, [exercise, …]), …] in the order a coach reads a gym.

    Groups come in `muscle_groups.position` order. Within a group the primaries
    come first, then the secondaries: nothing in the shared catalogue is
    traps-primary or adductors-primary, so a picker built on `role = 'primary'`
    alone renders Τραπεζοειδείς and Προσαγωγοί empty and looks broken.

    An exercise that is filed under no visible group at all lands under a final
    "Χωρίς μυϊκή ομάδα" heading. Dropping it would make it unloggable, and the
    coach is standing in front of the machine.
    """
    pickable = [
        row
        for row in _catalogue(gym_id)
        if not row.get("deleted_at")
        and not row.get("is_archived")
        # A merged duplicate still names historical blocks, but offering it here
        # would re-open the duplicate the merge tool just closed.
        and not row.get("merged_into_id")
    ]
    by_id = {str(row["id"]): row for row in pickable}
    if not by_id:
        return []

    groups = _muscle_groups(gym_id)
    visible_groups = {str(row["id"]) for row in groups}

    primary: dict[str, list[str]] = {}
    secondary: dict[str, list[str]] = {}
    filed: set[str] = set()
    for mapping in _exercise_muscles(gym_id):
        exercise_id = str(mapping.get("exercise_id") or "")
        group_id = str(mapping.get("muscle_group_id") or "")
        if exercise_id not in by_id or group_id not in visible_groups:
            continue
        bucket = primary if mapping.get("role") == "primary" else secondary
        bucket.setdefault(group_id, []).append(exercise_id)
        filed.add(exercise_id)

    def _named(ids: list[str]) -> list[dict[str, Any]]:
        rows = [by_id[i] for i in dict.fromkeys(ids) if i in by_id]
        return sorted(rows, key=lambda row: _sort_key(_exercise_name(row)))

    out: list[tuple[str, list[dict[str, Any]]]] = []
    for group in groups:
        group_id = str(group["id"])
        members = _named(primary.get(group_id, [])) + _named(secondary.get(group_id, []))
        if members:
            label = (group.get("name_el") or group.get("name_en") or _EMPTY).strip()
            out.append((label or _EMPTY, members))

    unfiled = sorted(
        (row for row in pickable if str(row["id"]) not in filed),
        key=lambda row: _sort_key(_exercise_name(row)),
    )
    if unfiled:
        out.append((_UNFILED_GROUP, unfiled))
    return out


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------

def _open_session(gym_id: str, athlete_id: str) -> dict[str, Any] | None:
    """Start the workout. gym_id and athlete_id and nothing else.

    logged_by is stamped by sessions_stamp_author() from app.my_membership() and
    local_date is derived by sessions_set_local_date() from the gym's timezone —
    a client that sent either would be stating an opinion where the server holds
    the fact, and sessions_insert_self would reject a forged author anyway.
    """
    rows = (
        db.client()
        .table("sessions")
        .insert({"gym_id": gym_id, "athlete_id": athlete_id})
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def _add_block(gym_id: str, session_id: str, exercise_id: str, position: int) -> None:
    db.client().table("blocks").insert(
        {
            "gym_id": gym_id,
            "session_id": session_id,
            "exercise_id": exercise_id,
            "position": position,
        }
    ).execute()


def _add_set(
    gym_id: str,
    block_id: str,
    kind: str,
    position: int,
    values: dict[str, Any],
) -> None:
    """Insert one performed set. `done_at` is what makes it performed.

    A row with done_at null is legal and means "prescribed, or the coach is
    halfway through typing" — not "missed". Everything written from this screen
    happened, so it carries the instant and the columns its kind is measured in,
    which is exactly what sets_complete_for_kind demands.
    """
    payload: dict[str, Any] = {
        "gym_id": gym_id,
        "block_id": block_id,
        "kind": kind,
        "position": position,
        "done_at": datetime.now(timezone.utc).isoformat(),
    }
    payload.update(values)
    db.client().table("sets").insert(payload).execute()


def _finish_session(gym_id: str, session: dict[str, Any]) -> bool:
    """status -> finished. Returns False when the UPDATE reached no row.

    An UPDATE filtered out by RLS matches zero rows and reports success, so the
    returned representation is the only evidence that anything happened.
    """
    now = datetime.now(timezone.utc)
    started = _parse_instant(session.get("started_at"))
    # sessions_finish_after_start refuses finished_at < started_at, and the two
    # clocks are not the same one.
    finished_at = max(now, started) if started else now
    rows = (
        db.client()
        .table("sessions")
        .update({"status": "finished", "finished_at": finished_at.isoformat()})
        .eq("gym_id", gym_id)
        .eq("id", session["id"])
        .execute()
        .data
        or []
    )
    return bool(rows)


# ---------------------------------------------------------------------------
# Small view helpers
# ---------------------------------------------------------------------------

def _flush_notice() -> None:
    notice = st.session_state.pop(_NOTICE, None)
    if not notice:
        return
    kind, message = notice
    if kind == "ok":
        st.success(message)
    else:
        st.error(message)


def _author_of(names: dict[str, str], membership_id: Any) -> str:
    return names.get(str(membership_id or ""), _UNKNOWN_AUTHOR)


def _go_to(page_key: str) -> None:
    page = (st.session_state.get("pages") or {}).get(page_key)
    if page is None:
        st.session_state[_NOTICE] = ("error", "Η σελίδα δεν είναι διαθέσιμη.")
        st.rerun()
    st.switch_page(page)


def _kind_of(rows: list[dict[str, Any]], exercise: dict[str, Any] | None) -> str:
    """What this block is measured in.

    The kind of the sets already in the block wins over the exercise's default:
    once a block holds seconds, a second set of reps under the same heading would
    make the block unreadable and its volume meaningless.
    """
    if rows:
        return str(rows[0].get("kind") or "weight_reps")
    return str((exercise or {}).get("default_set_kind") or "weight_reps")


def _next_position(rows: list[dict[str, Any]]) -> int:
    highest = -1
    for row in rows:
        value = _integer(row.get("position"))
        if value is not None and value > highest:
            highest = value
    return highest + 1


# ---------------------------------------------------------------------------
# The set form — one round trip per set
# ---------------------------------------------------------------------------

def _set_form(block_id: str, kind: str, previous: dict[str, Any] | None) -> dict[str, Any] | None:
    """Draw one block's entry form; return the columns to write, or None.

    Everything a trainer touches between sets is inside this form, so typing
    weight and reps and pressing the button is ONE round trip. The boxes start
    on the previous set's numbers, because the set after a set is usually the
    same set — and `clear_on_submit` puts them back to the freshly logged values
    rather than to blank.

    κιλά and μέτρα are text boxes, not number boxes, for one reason: a Greek
    trainer types "72,5".
    """
    prev = previous or {}

    with st.form(f"log_set_{block_id}", clear_on_submit=True):
        if kind == "duration":
            minute_col, second_col, go_col = st.columns([3, 3, 4], vertical_alignment="bottom")
            seconds_before = _integer(prev.get("seconds")) or 0
            with minute_col:
                minutes = st.number_input(
                    "λεπτά",
                    min_value=0,
                    max_value=1440,
                    step=1,
                    value=seconds_before // 60,
                    key=f"log_min_{block_id}",
                )
            with second_col:
                seconds = st.number_input(
                    "δευτερόλεπτα",
                    min_value=0,
                    max_value=59,
                    step=5,
                    value=seconds_before % 60,
                    key=f"log_sec_{block_id}",
                )
            with go_col:
                submitted = st.form_submit_button("Καταχώρηση σετ", type="primary")
            if not submitted:
                return None
            total = int(minutes) * 60 + int(seconds)
            if total < 1:
                st.error("Γράψε πόση ώρα κράτησε.")
                return None
            if total > _MAX_SECONDS:
                st.error("Ο χρόνος είναι πολύ μεγάλος.")
                return None
            return {"seconds": total}

        if kind == "distance":
            meters_col, go_col = st.columns([6, 4], vertical_alignment="bottom")
            with meters_col:
                meters_text = st.text_input(
                    "μέτρα",
                    value=_weight_input_default(prev.get("meters")),
                    placeholder="2000",
                    key=f"log_m_{block_id}",
                )
            with go_col:
                submitted = st.form_submit_button("Καταχώρηση σετ", type="primary")
            if not submitted:
                return None
            meters = _decimal(meters_text)
            if meters is None or meters <= 0:
                st.error("Γράψε την απόσταση σε μέτρα — π.χ. 2000.")
                return None
            if meters > _MAX_METERS:
                st.error("Η απόσταση είναι πολύ μεγάλη.")
                return None
            return {"meters": round(meters, 2)}

        if kind == "bodyweight":
            reps_col, extra_col, go_col = st.columns([3, 3, 4], vertical_alignment="bottom")
            with reps_col:
                reps = st.number_input(
                    "επαναλήψεις",
                    min_value=0,
                    max_value=1000,
                    step=1,
                    value=_integer(prev.get("reps")) or 0,
                    key=f"log_bwreps_{block_id}",
                )
            with extra_col:
                extra_text = st.text_input(
                    "επιπλέον κιλά",
                    value=_weight_input_default(prev.get("load_kg")),
                    placeholder="0",
                    key=f"log_bwkg_{block_id}",
                )
            with go_col:
                submitted = st.form_submit_button("Καταχώρηση σετ", type="primary")
            if not submitted:
                return None
            if int(reps) < 1:
                st.error("Γράψε τουλάχιστον μία επανάληψη.")
                return None
            values: dict[str, Any] = {"reps": int(reps)}
            typed = (extra_text or "").strip()
            if typed:
                extra = _decimal(typed)
                if extra is None or extra < 0 or extra > _MAX_KG:
                    st.error("Τα επιπλέον κιλά δεν διαβάζονται — π.χ. 12,5.")
                    return None
                values["load_kg"] = round(extra, 2)
            return values

        # weight_reps, and anything unknown falls back to it: it is the only kind
        # whose two columns are legible for every exercise in the catalogue.
        kg_col, reps_col, go_col = st.columns([3, 3, 4], vertical_alignment="bottom")
        with kg_col:
            load_text = st.text_input(
                "κιλά",
                value=_weight_input_default(prev.get("load_kg")),
                placeholder="72,5",
                key=f"log_kg_{block_id}",
            )
        with reps_col:
            reps = st.number_input(
                "επαναλήψεις",
                min_value=0,
                max_value=1000,
                step=1,
                value=_integer(prev.get("reps")) or 0,
                key=f"log_reps_{block_id}",
            )
        with go_col:
            submitted = st.form_submit_button("Καταχώρηση σετ", type="primary")
        if not submitted:
            return None
        load = _decimal(load_text)
        if load is None:
            st.error("Γράψε τα κιλά — π.χ. 72,5.")
            return None
        if load < 0 or load > _MAX_KG:
            st.error("Τα κιλά δεν διαβάζονται — π.χ. 72,5.")
            return None
        if int(reps) < 1:
            st.error("Γράψε τουλάχιστον μία επανάληψη.")
            return None
        return {"load_kg": round(load, 2), "reps": int(reps)}


# ---------------------------------------------------------------------------
# The blocks
# ---------------------------------------------------------------------------

def _last_time_line(
    entry: dict[str, Any] | None,
    names: dict[str, str],
    today: date,
) -> str:
    """"Τελευταία φορά: 80×8 · 12 Αυγ · Μαρία".

    Never the bare number. "80×8" on its own is worse than nothing here, because
    the coach loads a bar with it without knowing whether it was last month or
    last year, or who was standing there when it happened.
    """
    if not entry:
        return "Πρώτη φορά σε αυτή την άσκηση."
    performed = _format_set(entry["set"], entry["kind"])
    when = _format_day(entry["day"], today) if entry.get("day") else _EMPTY
    who = _author_of(names, entry.get("logged_by"))
    return f"Τελευταία φορά: {performed} · {when} · {who}"


def _block_card(
    gym_id: str,
    block: dict[str, Any],
    exercise: dict[str, Any] | None,
    rows: list[dict[str, Any]],
    last: dict[str, Any] | None,
    names: dict[str, str],
    session_author: Any,
    today: date,
) -> None:
    block_id = str(block["id"])
    kind = _kind_of(rows, exercise)

    with st.container(border=True):
        st.markdown(f"**{_md(_exercise_name(exercise))}**")
        st.caption(_md(_last_time_line(last, names, today)))

        if rows:
            lines = []
            for number, row in enumerate(rows, 1):
                line = f"{number}. {_format_set(row, kind)}"
                # The 07:00 coach finishing what the 06:00 coach started is the
                # product, not an edge case — so a set typed by someone other
                # than the session's author says whose hand it was.
                author = row.get("created_by")
                if author and str(author) != str(session_author or ""):
                    line = f"{line} · {_md(_author_of(names, author))}"
                note = (row.get("note") or "").strip()
                if note:
                    line = f"{line} — {_md(note)}"
                lines.append(line)
            st.markdown("\n".join(lines))
        else:
            st.caption(f"Κανένα σετ ακόμα · {_KIND_LABELS.get(kind, kind)}")

        values = _set_form(block_id, kind, rows[-1] if rows else None)
        if values is None:
            return

        try:
            _add_set(gym_id, block_id, kind, _next_position(rows), values)
        except Exception as exc:
            st.error("Το σετ δεν καταχωρήθηκε.")
            st.caption(str(exc))
            return

        _clear_workout_caches()
        st.session_state[_NOTICE] = (
            "ok",
            f"{_exercise_name(exercise)} · {_format_set(values, kind)}",
        )
        st.rerun()


def _picker(gym_id: str, session_id: str, next_position: int) -> None:
    """Add a block, chosen by μυϊκή ομάδα first."""
    with st.expander("Προσθήκη άσκησης"):
        try:
            grouped = _grouped_exercises(gym_id)
        except Exception as exc:
            st.error("Ο κατάλογος ασκήσεων δεν φορτώθηκε.")
            st.caption(str(exc))
            return

        if not grouped:
            st.info("Δεν υπάρχουν διαθέσιμες ασκήσεις.")
            return

        # Outside the form on purpose, and it is the one widget here that is:
        # a form batches its widgets into a single submit, so a group chosen
        # inside one would never reach the exercise list before the coach
        # pressed the button. Indexes rather than labels, because a gym may add
        # its own "Στήθος" beside the shared one.
        group_index = st.selectbox(
            "Μυϊκή ομάδα",
            range(len(grouped)),
            format_func=lambda index: f"{grouped[index][0]} ({len(grouped[index][1])})",
            key="log_group",
        )
        label, members = grouped[int(group_index)]

        with st.form(f"log_add_block_{group_index}"):
            member_index = st.selectbox(
                "Άσκηση",
                range(len(members)),
                format_func=lambda index: _exercise_name(members[index]),
                key=f"log_exercise_{group_index}",
            )
            submitted = st.form_submit_button("Προσθήκη άσκησης", type="primary")

        if not submitted:
            return

        exercise = members[int(member_index)]
        try:
            _add_block(gym_id, session_id, str(exercise["id"]), next_position)
        except Exception as exc:
            st.error("Η άσκηση δεν προστέθηκε.")
            st.caption(str(exc))
            return

        _clear_workout_caches()
        st.session_state[_NOTICE] = ("ok", f"{_exercise_name(exercise)} — {label}")
        st.rerun()


# ---------------------------------------------------------------------------
# Screens
# ---------------------------------------------------------------------------

def _finished_screen(gym_id: str, athlete: dict[str, Any], finished: dict[str, Any]) -> None:
    """After Τέλος προπόνησης. It exists so the screen does not reopen a workout.

    session_id has been cleared, and render() opens a workout whenever it is
    empty — without this stop the very next rerun would insert a fresh empty
    session and the coach could never leave.
    """
    st.header(_md(str(athlete.get("full_name") or _EMPTY)))
    st.success("Η προπόνηση ολοκληρώθηκε.")

    session_id = str(finished.get("session_id") or "")
    if session_id:
        try:
            blocks = _blocks(gym_id, session_id)
            rows = _sets(gym_id, session_id, tuple(str(block["id"]) for block in blocks))
        except Exception:
            blocks, rows = [], []

        by_block: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            by_block.setdefault(str(row.get("block_id")), []).append(row)
        try:
            catalogue = {str(row["id"]): row for row in _catalogue(gym_id)}
        except Exception:
            catalogue = {}

        summary = []
        for block in blocks:
            performed = by_block.get(str(block["id"]), [])
            if not performed:
                continue
            exercise = catalogue.get(str(block.get("exercise_id") or ""))
            kind = _kind_of(performed, exercise)
            top = max(performed, key=_score)
            summary.append(
                f"- {_md(_exercise_name(exercise))} · {_format_set(top, kind)} "
                f"({len(performed)} σετ)"
            )
        if summary:
            st.markdown("\n".join(summary))
        else:
            st.caption("Δεν καταγράφηκε κανένα σετ.")

    back_col, again_col = st.columns(2)
    with back_col:
        if st.button("Στον αθλητή", key="log_finished_back"):
            st.session_state.pop(_FINISHED, None)
            _go_to("athletes")
    with again_col:
        if st.button("Νέα προπόνηση", key="log_finished_again", type="primary"):
            st.session_state.pop(_FINISHED, None)
            st.session_state.pop("session_id", None)
            st.rerun()


def _open_or_reuse(gym_id: str, athlete_id: str) -> dict[str, Any] | None:
    """The workout this screen writes into. Reuse what is open, else start one."""
    stored = str(st.session_state.get("session_id") or "")
    if stored:
        try:
            row = _session_row(gym_id, stored)
        except Exception as exc:
            st.error("Η προπόνηση δεν φορτώθηκε.")
            st.caption(str(exc))
            return None
        # A stored id can outlive its athlete: the coach switched sheets, or a
        # colleague finished this session from another phone. Appending to it
        # would file one athlete's sets under another's name.
        if (
            row
            and str(row.get("athlete_id")) == athlete_id
            and str(row.get("status")) == "active"
        ):
            return row
        st.session_state.pop("session_id", None)

    try:
        row = _open_session(gym_id, athlete_id)
    except Exception as exc:
        st.error("Η προπόνηση δεν ξεκίνησε.")
        st.caption(str(exc))
        return None
    if not row:
        st.error("Η προπόνηση δεν ξεκίνησε.")
        return None

    st.session_state["session_id"] = str(row["id"])
    _clear_workout_caches()
    return row


def _workout(gym_id: str, athlete: dict[str, Any], session: dict[str, Any]) -> None:
    athlete_id = str(athlete["id"])
    session_id = str(session["id"])

    tz = _zone(gym_id)
    today = datetime.now(tz).date() if tz is not None else datetime.now(timezone.utc).date()

    try:
        names = _member_names(gym_id)
    except Exception:
        # An unreachable roster must not blank the numbers: _author_of falls back
        # to a named "unknown member" rather than to silence.
        names = {}

    if st.button("← Στον αθλητή", key="log_back"):
        _go_to("athletes")

    st.header(_md(str(athlete.get("full_name") or _EMPTY)))
    day = _parse_local_date(session.get("local_date"))
    st.markdown(
        "**"
        + _md(
            "Σε εξέλιξη · "
            + _author_of(names, session.get("logged_by"))
            + " · "
            + (_format_day(day, today) if day else _EMPTY)
        )
        + "**"
    )

    try:
        blocks = _blocks(gym_id, session_id)
    except Exception as exc:
        st.error("Οι ασκήσεις της προπόνησης δεν φορτώθηκαν.")
        st.caption(str(exc))
        return

    block_ids = tuple(str(block["id"]) for block in blocks)
    try:
        rows = _sets(gym_id, session_id, block_ids)
    except Exception as exc:
        st.error("Τα σετ δεν φορτώθηκαν.")
        st.caption(str(exc))
        rows = []

    by_block: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_block.setdefault(str(row.get("block_id")), []).append(row)

    try:
        catalogue = {str(row["id"]): row for row in _catalogue(gym_id)}
    except Exception as exc:
        st.error("Ο κατάλογος ασκήσεων δεν φορτώθηκε.")
        st.caption(str(exc))
        catalogue = {}

    exercise_ids = tuple(sorted({str(block.get("exercise_id") or "") for block in blocks} - {""}))
    try:
        last = _last_performance(gym_id, athlete_id, exercise_ids, session_id)
    except Exception:
        # The history is the nicest thing on this screen and the least essential:
        # losing it must not stop the coach logging the set in front of them.
        last = {}

    if not blocks:
        st.info("Καμία άσκηση ακόμα. Πρόσθεσε την πρώτη από το «Προσθήκη άσκησης».")

    for block in blocks:
        _block_card(
            gym_id,
            block,
            catalogue.get(str(block.get("exercise_id") or "")),
            by_block.get(str(block["id"]), []),
            last.get(str(block.get("exercise_id") or "")),
            names,
            session.get("logged_by"),
            today,
        )

    _picker(gym_id, session_id, _next_position(blocks))

    st.divider()
    logged = sum(len(value) for value in by_block.values())
    st.caption(
        f"{len(blocks)} ασκήσεις · {logged} σετ"
        if len(blocks) != 1
        else f"1 άσκηση · {logged} σετ"
    )

    # Below the picker and a divider, and never beside a set form: this is the
    # one button on the screen a coach must not hit with the thumb that was
    # aiming at «Καταχώρηση σετ».
    if st.button("Τέλος προπόνησης", key="log_finish"):
        try:
            ok = _finish_session(gym_id, session)
        except Exception as exc:
            st.error("Η προπόνηση δεν έκλεισε.")
            st.caption(str(exc))
            return
        if not ok:
            # An UPDATE that no policy let through matches zero rows and reports
            # success, so silence here would be a workout the coach believes is
            # closed and the database still calls active.
            st.error("Η προπόνηση δεν έκλεισε. Δοκίμασε ξανά.")
            return
        st.session_state.pop("session_id", None)
        st.session_state[_FINISHED] = {"session_id": session_id, "athlete_id": athlete_id}
        _clear_workout_caches()
        st.rerun()


# ---------------------------------------------------------------------------

def render() -> None:
    gym = db.gym_id()
    if not gym:
        st.header("Προπόνηση")
        st.info("Ο λογαριασμός σου δεν ανήκει ακόμη σε γυμναστήριο.")
        return

    athlete = st.session_state.get("athlete")
    if not isinstance(athlete, dict) or not athlete.get("id"):
        # Navigation state is written by four different screens, so a malformed
        # value is dropped rather than carried into a query.
        st.session_state.pop("athlete", None)
        st.header("Προπόνηση")
        st.info("Διάλεξε πρώτα αθλητή από τους «Αθλητές».")
        if st.button("Στους αθλητές", key="log_pick_athlete", type="primary"):
            _go_to("athletes")
        return

    _flush_notice()

    athlete_id = str(athlete["id"])
    finished = st.session_state.get(_FINISHED)
    if isinstance(finished, dict) and str(finished.get("athlete_id")) == athlete_id:
        _finished_screen(gym, athlete, finished)
        return
    # Someone else's finished workout: the coach has moved on to another athlete.
    st.session_state.pop(_FINISHED, None)

    session = _open_or_reuse(gym, athlete_id)
    if session is None:
        return

    _workout(gym, athlete, session)
