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

Everything on this screen can be taken back. A set typed wrong, an exercise
added to the wrong athlete's sheet, a whole workout started by mistake — each is
a stamped `deleted_at` and an «Αναίρεση» button, never a DELETE and never a
"σίγουρα;". The corrections sit behind «Διόρθωση» and «Επεξεργασία προπόνησης»
rather than beside «Καταχώρηση σετ», which is the button the same thumb hits
forty times an hour.

Nothing here sends `logged_by`, `local_date` or `created_by`. Those are stamped
by `sessions_stamp_author()`, `sessions_set_local_date()` and
`stamp_created_by()` from the caller's JWT: a value sent from the client would
be a claim, and the whole product is that every line on the sheet is a fact
about who actually typed it.
"""

from __future__ import annotations

import time
from datetime import date, datetime, timezone
from typing import Any

import streamlit as st

from lib import db, exercises, fmt, gym, ui

# How far back the "last time" lookup reads. It is a window, not the whole
# history, because the session ids go into a PostgREST `in.(…)` filter and a URL
# grows 39 characters per id. Sixty sessions is well over a year for an athlete
# who trains twice a week, and the alternative — no lookup at all — is the bare
# number this app exists to prevent.
_HISTORY_SESSIONS = 60

# How far back «Από τις προηγούμενες προπονήσεις» looks. Short on purpose: it is
# a shortcut to what this athlete is doing now, not a history — an exercise
# dropped from the programme a month ago should stop being the first thing
# offered.
_RECENT_SESSIONS = 3

# numeric(6,2) on sets.load_kg and numeric(9,2) on sets.meters are the hard
# limits; these are the sane-input limits, so a slipped keyboard says so in Greek
# instead of coming back as a Postgres overflow.
_MAX_KG = 999.0
_MAX_METERS = 100_000.0
_MAX_SECONDS = 86_400
# The most identical sets one «Καταχώρηση σετ» may write. Straight sets are why
# the multiplier exists; a slipped digit is why it has a ceiling, because every
# extra row here has to be deleted one at a time.
_MAX_REPEAT = 12

# Exercises filed under no visible muscle group at all. They are still reachable
# here rather than dropped: an exercise nobody can pick is an exercise nobody can
# log, and the coach is standing at the machine looking at it.
_UNFILED_GROUP = "Χωρίς μυϊκή ομάδα"

_NOTICE = "log_notice"
# The last set this screen wrote, and how long an identical one is treated as
# the same tap rather than a new one. A write is followed by a rerun, and on a
# slow connection the coach taps «Καταχώρηση σετ» again during the dead time —
# which replays the submit and logs the set twice. Three seconds is far longer
# than the gap Streamlit needs and far shorter than typing two numbers again.
_LAST_WRITE_KEY = "log_last_set_write"
_DOUBLE_TAP_S = 3.0
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


# ---------------------------------------------------------------------------
# Reads
#
# Every one of these takes gym_id first, even where the body never uses it.
# @st.cache_data is global to the server process, so a cache hit is served
# without ever reaching a policy again — the tenant has to be part of the key or
# the cache is the leak that RLS was there to prevent.
# ---------------------------------------------------------------------------

@st.cache_data(ttl=300, show_spinner=False)
def _catalogue(gym_id: str) -> list[dict[str, Any]]:
    """Every exercise this gym can see — the shared catalogue plus its own.

    Archived, merged and soft-deleted rows come back too. They are filtered out
    of the picker in Python, but a block logged three years ago still points at
    one of them and has to render with its name rather than as a blank line.

    `equipment` is in the column list because the όργανο is half of what the
    coach picks by: this select omitted it, so every "· Μπάρα" this screen
    believed it was rendering came out empty and «Πιέσεις Στήθους» on the
    barbell, on dumbbells and on the Smith were three identical lines.
    """
    return (
        db.client()
        .table("exercises")
        .select("id, name_el, name_en, category, equipment, default_set_kind, is_archived, merged_into_id, deleted_at")
        .order("name_el")
        .execute()
        .data
        or []
    )


@st.cache_data(ttl=15, show_spinner=False)
def _exercise(gym_id: str, exercise_id: str) -> dict[str, Any] | None:
    """One exercise, read past a stale catalogue.

    Short ttl on purpose: this is the read that answers "what is this block
    measured in" when the catalogue cannot, and it is asked while the coach is
    standing in front of the machine.
    """
    if not exercise_id:
        return None
    rows = (
        db.client()
        .table("exercises")
        .select("id, name_el, name_en, category, equipment, default_set_kind, is_archived, merged_into_id, deleted_at")
        .eq("id", exercise_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


@st.cache_data(ttl=300, show_spinner=False)
def _muscle_groups(gym_id: str) -> list[dict[str, Any]]:
    """The taxonomy in DISPLAY order — position first, never the alphabet.

    RLS returns the shared groups (gym_id is null) and this gym_id's own together,
    so a gym's own group at position 20 lands after the sixteen shared ones
    exactly as its position says. (position, id) and not position alone, because
    two inserts can mint the same position and the id is the only tie-break.

    `region` is read for _region_of(): an exercise added from inside a workout
    takes its coarse body region from the group it is being filed under, and
    without the column every one of them was silently filed as 'upper'.
    """
    return (
        db.client()
        .table("muscle_groups")
        .select("id, gym_id, name_el, name_en, region, position")
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


@st.cache_data(ttl=60, show_spinner=False)
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


@st.cache_data(ttl=60, show_spinner=False)
def _sets(gym_id: str, session_id: str) -> list[dict[str, Any]]:
    """Every live set of one workout.

    The block ids used to be a third argument, so that adding a block missed the
    cache. They are looked up here instead, from the cached `_blocks` — because
    an argument in the key is an argument every clear has to reproduce exactly,
    and without it this cache could only ever be emptied for every tenant at
    once. Every local write clears both by (gym_id, session_id) now.
    """
    block_ids = tuple(str(block["id"]) for block in _blocks(gym_id, session_id))
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


_EPOCH = datetime.min.replace(tzinfo=timezone.utc)


def _session_order(local_date: Any, started_at: Any, session_id: Any) -> tuple[date, datetime, str]:
    """The total order compareSessions() uses in src/domain/analytics.ts.

    The gym day leads because it is the fact a coach reasons about; the instant
    and the id are there only to make the order total, so two clients reading the
    same history agree on which session came first.
    """
    return (
        fmt.parse_local_date(local_date) or date.min,
        fmt.parse_instant(started_at) or _EPOCH,
        str(session_id or ""),
    )


@st.cache_data(ttl=120, show_spinner=False)
def _last_performance(
    gym_id: str,
    athlete_id: str,
    exercise_keys: tuple[tuple[str, str], ...],
    current_session: tuple[str, str, str],
) -> dict[str, dict[str, Any]]:
    """canonical exercise id -> the athlete's last top set on it, with day and author.

    Three queries for the whole screen rather than one per block: the athlete's
    recent sessions, the blocks of those sessions that use these exercises, and
    the sets of the winning blocks.

    `exercise_keys` pairs every id a block may carry with the canonical id it
    stands for. A movement whose duplicate has been folded in is logged under two
    ids, and both halves are the same movement's history.

    `current_session` is (local_date, started_at, id), and only sessions strictly
    before it in that order are candidates. Excluding the open workout by id
    alone is not enough: a session left open at 06:00 while a colleague logs and
    finishes a heavier one at 07:15 would otherwise be told the 07:15 numbers
    were "last time".
    """
    if not exercise_keys:
        return {}

    canonical = dict(exercise_keys)

    client = db.client()
    sessions = (
        client.table("sessions")
        .select("id, local_date, started_at, logged_by, credited_to")
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

    current_key = _session_order(*current_session)
    history = [
        row
        for row in sessions
        if str(row.get("id")) != current_session[2]
        and _session_order(row.get("local_date"), row.get("started_at"), row.get("id")) < current_key
    ]
    if not history:
        return {}
    rank_of = {str(row["id"]): rank for rank, row in enumerate(history)}
    session_of = {str(row["id"]): row for row in history}

    blocks = (
        client.table("blocks")
        .select("id, session_id, exercise_id")
        .eq("gym_id", gym_id)
        .in_("session_id", list(rank_of))
        .in_("exercise_id", list(canonical))
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
        # Keyed by the canonical id: a block written before the merge and one
        # written after it are the same movement and must not answer separately.
        exercise_id = canonical.get(str(block.get("exercise_id") or ""), "")
        if not exercise_id:
            continue
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
        # The block's own kind first, then the best set within it. A treadmill
        # set and a bench set are not comparable, and the winner of a comparison
        # across kinds renders in the loser's unit.
        kind = fmt.dominant_kind(rows)
        top = fmt.top_set(rows, kind)
        if top is None:
            continue
        session = session_of[winner["session_id"]]
        result[exercise_id] = {
            "set": top,
            "kind": kind,
            "day": fmt.parse_local_date(session.get("local_date")),
            # sessionAuthorId() in src/domain/analytics.ts: the credit, falling
            # back to who typed it. A session Μαρία typed and re-credited to
            # Νίκος reads as Νίκος everywhere else in the product, and the whole
            # point of credited_to is that this edit is visible.
            "author": session.get("credited_to") or session.get("logged_by"),
        }
    return result


@st.cache_data(ttl=600, show_spinner=False)
def _recent_exercise_ids(gym_id: str, athlete_id: str) -> tuple[str, ...]:
    """The exercises of this athlete's last few workouts, most recent first.

    Two queries, and a LONG ttl, because Streamlit executes the body of a
    collapsed expander anyway — so a short one meant the closed picker quietly
    spent two round trips of the coach's time every time the screen redrew. The
    answer only changes when this athlete's history changes, and the one action
    on this screen that changes it clears the entry itself.

    It is a convenience, not a source of truth: a caller that cannot read it
    falls back to the search, which reaches every exercise anyway.
    """
    client = db.client()
    sessions = (
        client.table("sessions")
        .select("id, local_date, started_at")
        .eq("gym_id", gym_id)
        .eq("athlete_id", athlete_id)
        .is_("deleted_at", "null")
        .order("local_date", desc=True)
        .order("started_at", desc=True)
        .order("id", desc=True)
        .limit(_RECENT_SESSIONS)
        .execute()
        .data
        or []
    )
    if not sessions:
        return ()

    rank_of = {str(row["id"]): rank for rank, row in enumerate(sessions)}
    blocks = (
        client.table("blocks")
        .select("session_id, exercise_id, position")
        .eq("gym_id", gym_id)
        .in_("session_id", list(rank_of))
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )

    ordered = sorted(
        blocks,
        key=lambda block: (
            rank_of.get(str(block.get("session_id")), len(rank_of)),
            fmt.integer(block.get("position")) or 0,
        ),
    )
    # dict.fromkeys keeps the first appearance of each exercise, which is the
    # most recent one — an exercise done in three workouts is offered once.
    return tuple(
        dict.fromkeys(
            str(block.get("exercise_id") or "") for block in ordered if block.get("exercise_id")
        )
    )


@st.cache_data(ttl=20, show_spinner=False)
def _session_row(gym_id: str, session_id: str) -> dict[str, Any] | None:
    """The open workout, and the row the whole screen turns on.

    It was uncached, on the reasoning that its status decides what is drawn —
    which is true, and cost one blocking round trip before a single pixel, on
    every rerun, including the one that follows every tap. Twenty seconds is
    short enough to still notice a colleague finishing this workout from
    another phone, and _clear_workout_caches() drops it after every local
    write, so the coach's own changes are never stale by even one render.
    """
    rows = (
        db.client()
        .table("sessions")
        .select("id, athlete_id, status, title, notes, started_at, finished_at, local_date, logged_by, credited_to")
        .eq("gym_id", gym_id)
        .eq("id", session_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def _clear_workout_caches(gym_id: str = "", session_id: str = "") -> None:
    """Drop what this workout's own write just made stale. Nothing else.

    Two things this deliberately no longer does.

    It no longer clears `_catalogue`. Logging a set does not change the exercise
    catalogue, and clearing it made the next render refetch two hundred rows —
    once per set, per block added, per delete, per undo. The catalogue is still
    cleared where it actually changes: _new_exercise() and the «Δοκίμασε ξανά»
    button. `_exercise` stays, because it is the one-row fallback for a block
    whose exercise the catalogue copy has not heard of yet.

    And it clears by KEY where it can. `.clear()` with no arguments empties the
    entry for every tenant in the process, so one coach logging a set threw away
    another gym's open workout and made them wait for it to be read again.
    """
    if gym_id and session_id:
        _blocks.clear(gym_id, session_id)
        _sets.clear(gym_id, session_id)
        _session_row.clear(gym_id, session_id)
    else:
        _blocks.clear()
        _sets.clear()
        _session_row.clear()
    _exercise.clear()


def _canonical_ids(catalogue: list[dict[str, Any]]) -> dict[str, str]:
    """Every exercise id the gym can see -> the row it is really about.

    A folded duplicate keeps naming the blocks that already point at it —
    001_init.sql: "the block keeps pointing at the dead row, reads follow the
    arrow" — so a read that does not follow it asks for the canonical id, matches
    none of that history and tells the coach it is the athlete's first time. One
    hop is enough: exercises_guard_merge() refuses a merge target that is itself
    merged.
    """
    return {
        str(row["id"]): str(row.get("merged_into_id") or row["id"])
        for row in catalogue
        if row.get("id")
    }


def _resolve_exercise(
    gym_id: str,
    catalogue: dict[str, dict[str, Any]],
    canonical: dict[str, str],
    exercise_id: str,
) -> dict[str, Any] | None:
    """The row a block's name and default_set_kind must come from, or None.

    None is an answer, not a failure to report later: the caller draws a notice
    instead of a set form. Guessing here is what writes twenty treadmill minutes
    as reps at zero kilos, which sets_complete_for_kind cannot see and no reader
    downstream can undo.
    """
    if not exercise_id:
        return None
    row = catalogue.get(canonical.get(exercise_id, exercise_id)) or catalogue.get(exercise_id)
    if row is not None:
        return row
    try:
        return _exercise(gym_id, exercise_id)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# The grouped picker
# ---------------------------------------------------------------------------

def _pickable_rows(gym_id: str) -> list[dict[str, Any]]:
    """Every exercise a coach may put in a workout right now.

    One filter for both ways in — the flat search and the browse by muscle
    group. Two copies would eventually disagree about which archived row is
    still offered, and the coach would find an exercise one way and not the
    other.
    """
    return [
        row
        for row in _catalogue(gym_id)
        if not row.get("deleted_at")
        and not row.get("is_archived")
        # A merged duplicate still names historical blocks, but offering it here
        # would re-open the duplicate the merge tool just closed.
        and not row.get("merged_into_id")
    ]


def _grouped_exercises(gym_id: str) -> list[tuple[str, str | None, list[dict[str, Any]]]]:
    """[(μυϊκή ομάδα, id της ομάδας, [exercise, …]), …] in the order a coach reads a gym.

    Groups come in `muscle_groups.position` order. Within a group the primaries
    come first, then the secondaries: nothing in the shared catalogue is
    traps-primary or adductors-primary, so a picker built on `role = 'primary'`
    alone renders Τραπεζοειδείς and Προσαγωγοί empty and looks broken.

    An exercise that is filed under no visible group at all lands under a final
    "Χωρίς μυϊκή ομάδα" heading. Dropping it would make it unloggable, and the
    coach is standing in front of the machine.
    """
    pickable = _pickable_rows(gym_id)
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
        # By the label the coach reads, όργανο included. Sorting by the name
        # alone leaves the three «Πιέσεις Στήθους» — μπάρα, αλτήρες, Smith — in
        # whatever order their ids happened to land in, which is a different
        # order in every muscle group and no order at all to the eye.
        return sorted(rows, key=lambda row: fmt.fold(_labelled(row)))

    out: list[tuple[str, str | None, list[dict[str, Any]]]] = []
    for group in groups:
        group_id = str(group["id"])
        members = _named(primary.get(group_id, [])) + _named(secondary.get(group_id, []))
        if members:
            label = (group.get("name_el") or group.get("name_en") or fmt.EMPTY).strip()
            # The id travels with the label so a new exercise added from the
            # picker lands in the group the coach is already looking at,
            # instead of matching by name — a gym may add its own «Στήθος»
            # beside the shared one and the two are different rows.
            out.append((label or fmt.EMPTY, group_id, members))

    unfiled = sorted(
        (row for row in pickable if str(row["id"]) not in filed),
        key=lambda row: fmt.fold(fmt.exercise_name(row)),
    )
    if unfiled:
        # No id: «Χωρίς μυϊκή ομάδα» is a bucket this screen invents, not a row
        # in muscle_groups, so nothing can be filed into it.
        out.append((_UNFILED_GROUP, None, unfiled))
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
    times: int = 1,
) -> None:
    """Insert `times` identical performed sets. `done_at` is what makes them performed.

    A row with done_at null is legal and means "prescribed, or the coach is
    halfway through typing" — not "missed". Everything written from this screen
    happened, so it carries the instant and the columns its kind is measured in,
    which is exactly what sets_complete_for_kind demands.

    ONE insert with a list, never a loop of inserts: three straight sets on gym
    wifi would be three round trips, and this screen is already the one the gym
    says hangs. They share a done_at because they share the moment the coach
    wrote them down, which is the only instant this app actually witnessed.
    """
    stamp = datetime.now(timezone.utc).isoformat()
    rows = []
    for offset in range(max(1, int(times))):
        payload: dict[str, Any] = {
            "gym_id": gym_id,
            "block_id": block_id,
            "kind": kind,
            # Consecutive, so the sets read 1..N down the card in the order they
            # were performed rather than sharing one position and sorting by id.
            "position": position + offset,
            "done_at": stamp,
        }
        payload.update(values)
        rows.append(payload)
    db.client().table("sets").insert(rows).execute()


def _soft_delete(gym_id: str, table: str, ids: list[str]) -> int:
    """Stamp deleted_at. There is no DELETE policy in this schema and there will not be.

    Every read on every screen filters `deleted_at is null`, so a stamped row
    leaves the app whole — and comes back whole when the coach presses
    «Αναίρεση», which a real DELETE could not offer. Returns how many rows the
    UPDATE actually reached: an update filtered out by RLS matches nothing and
    still reports success, so the returned representation is the only evidence.
    """
    if not ids:
        return 0
    rows = (
        db.client()
        .table(table)
        .update({"deleted_at": datetime.now(timezone.utc).isoformat()})
        .eq("gym_id", gym_id)
        .in_("id", ids)
        .execute()
        .data
        or []
    )
    return len(rows)


def _restore(gym_id: str, table: str, ids: list[str]) -> int:
    """The other half of a soft delete. Same shape, deleted_at back to null."""
    if not ids:
        return 0
    rows = (
        db.client()
        .table(table)
        .update({"deleted_at": None})
        .eq("gym_id", gym_id)
        .in_("id", ids)
        .execute()
        .data
        or []
    )
    return len(rows)


def _update_session(gym_id: str, session_id: str, values: dict[str, Any]) -> bool:
    """Edit the workout's own row. Returns False when the UPDATE reached nothing.

    Only the columns a coach may correct ever get in here. gym_id, athlete_id
    and logged_by are refused by sessions_guard_immutable() no matter what this
    sends — attribution that can be rewritten is not attribution — and the way
    to say "it was really Μαρία's session" is credited_to, which is visible as a
    change rather than a quiet substitution.
    """
    rows = (
        db.client()
        .table("sessions")
        .update(values)
        .eq("gym_id", gym_id)
        .eq("id", session_id)
        .execute()
        .data
        or []
    )
    return bool(rows)


def _reschedule(session: dict[str, Any], day: date, tz: Any) -> dict[str, Any]:
    """The columns that move a workout to another day, from a date the coach picked.

    started_at and not local_date: local_date is derived by
    sessions_set_local_date() from started_at at the gym's timezone, so writing
    it directly would be overwritten by the trigger on the same statement. The
    time of day is kept, so "Tuesday's 07:00 session" filed on the wrong date
    stays a 07:00 session.

    finished_at moves by the same delta rather than staying put: dragging the
    start past the finish trips sessions_finish_after_start, and a workout that
    lasted an hour still lasted an hour on the day it is being moved to.
    """
    started = fmt.parse_instant(session.get("started_at")) or datetime.now(timezone.utc)
    local = started.astimezone(tz) if tz is not None else started
    moved = local.replace(year=day.year, month=day.month, day=day.day)
    values: dict[str, Any] = {"started_at": moved.astimezone(timezone.utc).isoformat()}

    finished = fmt.parse_instant(session.get("finished_at"))
    if finished:
        values["finished_at"] = (finished + (moved - local)).astimezone(timezone.utc).isoformat()
    return values


def _finish_session(gym_id: str, session: dict[str, Any]) -> bool:
    """status -> finished. Returns False when the UPDATE reached no row.

    An UPDATE filtered out by RLS matches zero rows and reports success, so the
    returned representation is the only evidence that anything happened.
    """
    now = datetime.now(timezone.utc)
    started = fmt.parse_instant(session.get("started_at"))
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

def _go_to(page_key: str) -> None:
    page = (st.session_state.get("pages") or {}).get(page_key)
    if page is None:
        ui.notice(_NOTICE, "error", "Η σελίδα δεν είναι διαθέσιμη.")
        st.rerun()
    st.switch_page(page)


def _kind_of(rows: list[dict[str, Any]], exercise: dict[str, Any] | None) -> str:
    """What this block is measured in.

    The kind of the sets already in the block wins over the exercise's default:
    once a block holds seconds, a second set of reps under the same heading would
    make the block unreadable and its volume meaningless. Which kind that is, is
    the majority of the live sets and not the first one, so one stray row from a
    stale client cannot decide how every other set in the block renders.
    """
    if rows:
        return fmt.dominant_kind(rows)
    return str((exercise or {}).get("default_set_kind") or "weight_reps")


def _next_position(rows: list[dict[str, Any]]) -> int:
    highest = -1
    for row in rows:
        value = fmt.integer(row.get("position"))
        if value is not None and value > highest:
            highest = value
    return highest + 1


# ---------------------------------------------------------------------------
# The set form — one round trip per set
# ---------------------------------------------------------------------------

def _repeat_input(block_id: str) -> int:
    """«× σετ» — how many identical sets this one entry stands for.

    Straight sets are the common case in this gym: 3×80×8 is one number typed
    once, not the same two numbers typed three times with a round trip between
    each. It defaults to 1, so a coach who ignores it keeps exactly the old
    behaviour and can still make the next set heavier.

    Capped at _MAX_REPEAT because this multiplies straight into INSERTs, and a
    slipped digit here would be thirty rows to undo one at a time.
    """
    return int(
        st.number_input(
            "× σετ",
            min_value=1,
            max_value=_MAX_REPEAT,
            step=1,
            value=1,
            key=f"log_times_{block_id}",
            help="Πόσες φορές το ίδιο σετ. Άφησέ το 1 για ένα σετ.",
        )
    )


def _set_form(
    block_id: str, kind: str, previous: dict[str, Any] | None
) -> tuple[dict[str, Any], int] | None:
    """Draw one block's entry form; return (columns to write, how many), or None.

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
            minute_col, second_col, times_col, go_col = st.columns(
                [3, 3, 2, 4], vertical_alignment="bottom"
            )
            seconds_before = fmt.integer(prev.get("seconds")) or 0
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
            with times_col:
                times = _repeat_input(block_id)
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
            return {"seconds": total}, times

        if kind == "distance":
            meters_col, times_col, go_col = st.columns([4, 2, 4], vertical_alignment="bottom")
            with meters_col:
                meters_text = st.text_input(
                    "μέτρα",
                    value=fmt.weight_input_default(prev.get("meters")),
                    placeholder="2000",
                    key=f"log_m_{block_id}",
                )
            with times_col:
                times = _repeat_input(block_id)
            with go_col:
                submitted = st.form_submit_button("Καταχώρηση σετ", type="primary")
            if not submitted:
                return None
            meters = fmt.decimal(meters_text)
            if meters is None or meters <= 0:
                st.error("Γράψε την απόσταση σε μέτρα — π.χ. 2000.")
                return None
            if meters > _MAX_METERS:
                st.error("Η απόσταση είναι πολύ μεγάλη.")
                return None
            return {"meters": round(meters, 2)}, times

        if kind == "bodyweight":
            reps_col, extra_col, times_col, go_col = st.columns(
                [3, 3, 2, 4], vertical_alignment="bottom"
            )
            with reps_col:
                reps = st.number_input(
                    "επαναλήψεις",
                    min_value=0,
                    max_value=1000,
                    step=1,
                    value=fmt.integer(prev.get("reps")) or 0,
                    key=f"log_bwreps_{block_id}",
                )
            with extra_col:
                extra_text = st.text_input(
                    "επιπλέον κιλά",
                    value=fmt.weight_input_default(prev.get("load_kg")),
                    placeholder="0",
                    key=f"log_bwkg_{block_id}",
                )
            with times_col:
                times = _repeat_input(block_id)
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
                extra = fmt.decimal(typed)
                if extra is None or extra < 0 or extra > _MAX_KG:
                    st.error("Τα επιπλέον κιλά δεν διαβάζονται — π.χ. 12,5.")
                    return None
                values["load_kg"] = round(extra, 2)
            return values, times

        # weight_reps, and anything unknown falls back to it: it is the only kind
        # whose two columns are legible for every exercise in the catalogue.
        kg_col, reps_col, times_col, go_col = st.columns(
            [3, 3, 2, 4], vertical_alignment="bottom"
        )
        with kg_col:
            load_text = st.text_input(
                "κιλά",
                value=fmt.weight_input_default(prev.get("load_kg")),
                placeholder="72,5",
                key=f"log_kg_{block_id}",
            )
        with reps_col:
            reps = st.number_input(
                "επαναλήψεις",
                min_value=0,
                max_value=1000,
                step=1,
                value=fmt.integer(prev.get("reps")) or 0,
                key=f"log_reps_{block_id}",
            )
        with times_col:
            times = _repeat_input(block_id)
        with go_col:
            submitted = st.form_submit_button("Καταχώρηση σετ", type="primary")
        if not submitted:
            return None
        load = fmt.decimal(load_text)
        if load is None:
            st.error("Γράψε τα κιλά — π.χ. 72,5.")
            return None
        if load < 0 or load > _MAX_KG:
            st.error("Τα κιλά δεν διαβάζονται — π.χ. 72,5.")
            return None
        if int(reps) < 1:
            st.error("Γράψε τουλάχιστον μία επανάληψη.")
            return None
        return {"load_kg": round(load, 2), "reps": int(reps)}, times


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
    performed = fmt.format_set(entry["set"], entry["kind"])
    when = fmt.format_day(entry["day"], today) if entry.get("day") else fmt.EMPTY
    who = fmt.author_of(names, entry.get("author"))
    return f"Τελευταία φορά: {performed} · {when} · {who}"


def _is_double_tap(signature: tuple[Any, ...]) -> bool:
    """Has this exact set just been written from this exact form?

    Stamps the signature either way, so the caller can go ahead when it returns
    False. The window is short enough that logging 80×8 twice on purpose — which
    means typing it again, or using «× σετ» — is never mistaken for a stutter.
    """
    now = time.monotonic()
    last = st.session_state.get(_LAST_WRITE_KEY)
    st.session_state[_LAST_WRITE_KEY] = (signature, now)
    if not last:
        return False
    try:
        previous, when = last
    except (TypeError, ValueError):
        return False
    return previous == signature and (now - when) < _DOUBLE_TAP_S


def _set_line(
    row: dict[str, Any],
    kind: str,
    names: dict[str, str],
    session_author: Any,
) -> str:
    """One logged set, as a sentence. Never the bare number."""
    line = fmt.format_set(row, kind)
    # The 07:00 coach finishing what the 06:00 coach started is the product, not
    # an edge case — so a set typed by someone other than the session's author
    # says whose hand it was.
    author = row.get("created_by")
    if author and str(author) != str(session_author or ""):
        line = f"{line} · {fmt.md(fmt.author_of(names, author))}"
    note = (row.get("note") or "").strip()
    if note:
        line = f"{line} — {fmt.md(note)}"
    return line


def _block_edit(
    gym_id: str,
    session_id: str,
    block_id: str,
    exercise: dict[str, Any] | None,
    rows: list[dict[str, Any]],
    kind: str,
    names: dict[str, str],
    session_author: Any,
) -> None:
    """Take a set back, or take the whole exercise out.

    Behind a closed expander and not beside «Καταχώρηση σετ», which is the
    button the same thumb is aiming at forty times an hour. Nothing here asks
    "σίγουρα;" — every one of these is a stamped deleted_at with «Αναίρεση»
    waiting at the top of the screen.
    """
    with st.expander("Διόρθωση"):
        for number, row in enumerate(rows, 1):
            set_id = str(row["id"])
            body, button = st.columns([3, 1])
            body.markdown(f"{number}. {_set_line(row, kind, names, session_author)}")
            if button.button("Διαγραφή", key=f"log_del_set_{set_id}"):
                try:
                    removed = _soft_delete(gym_id, "sets", [set_id])
                except Exception as exc:
                    ui.notice(_NOTICE, "error", f"Το σετ δεν διαγράφηκε: {exc}")
                    st.rerun()
                if not removed:
                    ui.notice(_NOTICE, "error", "Το σετ δεν διαγράφηκε. Δοκίμασε ξανά.")
                    st.rerun()
                _clear_workout_caches(gym_id, session_id)
                ui.undoable(
                    _NOTICE,
                    f"Διαγράφηκε: {fmt.format_set(row, kind)}",
                    {"table": "sets", "ids": [set_id]},
                )
                st.rerun()

        if rows:
            st.divider()
        st.caption(
            "Η αφαίρεση της άσκησης παίρνει μαζί και τα σετ της."
            if rows
            else "Η άσκηση δεν έχει σετ ακόμα."
        )
        if st.button("Αφαίρεση άσκησης", key=f"log_del_block_{block_id}"):
            set_ids = [str(row["id"]) for row in rows]
            try:
                # The sets first: a block hidden with its sets still live would
                # leave rows that no screen can reach and no coach can undo,
                # because every path to a set goes through its block.
                _soft_delete(gym_id, "sets", set_ids)
                removed = _soft_delete(gym_id, "blocks", [block_id])
            except Exception as exc:
                ui.notice(_NOTICE, "error", f"Η άσκηση δεν αφαιρέθηκε: {exc}")
                st.rerun()
            if not removed:
                ui.notice(_NOTICE, "error", "Η άσκηση δεν αφαιρέθηκε. Δοκίμασε ξανά.")
                st.rerun()
            _clear_workout_caches(gym_id, session_id)
            ui.undoable(
                _NOTICE,
                f"Αφαιρέθηκε: {_labelled(exercise)}",
                # Both halves travel together, so «Αναίρεση» puts the exercise
                # back with the sets it had rather than as an empty heading.
                {"table": "blocks", "ids": [block_id], "sets": set_ids},
            )
            st.rerun()


def _block_card(
    gym_id: str,
    session_id: str,
    block: dict[str, Any],
    exercise: dict[str, Any] | None,
    rows: list[dict[str, Any]],
    last: dict[str, Any] | None,
    names: dict[str, str],
    session_author: Any,
    today: date,
) -> None:
    block_id = str(block["id"])

    if exercise is None and not rows:
        # Nothing on this screen may guess a kind. An unresolved exercise
        # defaulted to weight_reps writes twenty treadmill minutes as reps at
        # zero kilos; sets_complete_for_kind is satisfied by that row and no
        # later reader can tell it apart from a real one.
        with st.container(border=True):
            st.warning("Η άσκηση δεν φορτώθηκε.")
            st.caption(
                "Δεν ξέρουμε σε τι μετριέται, οπότε δεν μπορεί να καταχωρηθεί σετ ακόμα."
            )
            if st.button("Δοκίμασε ξανά", key=f"log_reload_{block_id}"):
                _catalogue.clear()
                _exercise.clear()
                st.rerun()
        return

    kind = _kind_of(rows, exercise)

    with st.container(border=True):
        # With the όργανο, exactly as the picker offered it. Reading back
        # «Πιέσεις Στήθους · 40×10» without knowing it was dumbbells is how a
        # coach loads 40 kg on a barbell for an athlete who pressed two 20s.
        st.markdown(f"**{fmt.md(_labelled(exercise))}**")
        st.caption(fmt.md(_last_time_line(last, names, today)))

        if rows:
            lines = []
            for number, row in enumerate(rows, 1):
                lines.append(f"{number}. {_set_line(row, kind, names, session_author)}")
            st.markdown("\n".join(lines))
        else:
            st.caption(f"Κανένα σετ ακόμα · {_KIND_LABELS.get(kind, kind)}")

        _block_edit(gym_id, session_id, block_id, exercise, rows, kind, names, session_author)

        entry = _set_form(block_id, kind, rows[-1] if rows else None)
        if entry is None:
            return
        values, times = entry

        signature = (block_id, kind, times, tuple(sorted(values.items())))
        if _is_double_tap(signature):
            ui.notice(_NOTICE, "ok", "Το σετ είχε ήδη καταχωρηθεί.")
            st.rerun()

        try:
            with st.spinner("Καταχώρηση…"):
                _add_set(gym_id, block_id, kind, _next_position(rows), values, times)
        except Exception as exc:
            st.session_state.pop(_LAST_WRITE_KEY, None)
            st.error("Το σετ δεν καταχωρήθηκε.")
            st.caption(str(exc))
            return

        _clear_workout_caches(gym_id, session_id)
        written = fmt.format_set(values, kind)
        ui.notice(
            _NOTICE,
            "ok",
            f"{fmt.exercise_name(exercise)} · {written}"
            + (f" × {times} σετ" if times > 1 else ""),
        )
        st.rerun()


def _picker(
    gym_id: str,
    session_id: str,
    athlete_id: str,
    next_position: int,
    on_screen: set[str],
) -> None:
    """Three lists, in the order a coach describes a movement: ομάδα, άσκηση, τρόπος.

    The gym asked for exactly this shape, and it is also the shape the data has:
    the same movement on two implements is two rows of `exercises` sharing a
    name_el, so «Πιέσεις Στήθους» belongs in the second list once and its
    barbell/dumbbell/Smith variants belong in a third.

    Two rules the third list follows, and they are not the same rule:

      * one variant — it is selected, and shown anyway. The coach spends no
        thought on it and still reads which όργανο is going on the sheet.
      * more than one — NOTHING is selected, and «Προσθήκη» refuses until the
        coach picks. Preselecting the first would put 40 kg of dumbbells on the
        sheet as 80 kg of barbell the first time somebody moved fast, and the
        whole reason equipment lives on the exercise is that those two numbers
        must never be read as each other's.

    Above them all, the exercises of this athlete's last workouts stay one tap
    each: the lists are for finding something new, not for repeating a
    programme.
    """
    with st.expander("Προσθήκη άσκησης"):
        try:
            grouped = _grouped_exercises(gym_id)
            rows = _pickable_rows(gym_id)
        except Exception as exc:
            st.error("Ο κατάλογος ασκήσεων δεν φορτώθηκε.")
            st.caption(str(exc))
            return

        if not rows:
            st.info("Δεν υπάρχουν διαθέσιμες ασκήσεις.")
            return

        by_id = {str(row["id"]): row for row in rows}
        _repeat_buttons(gym_id, session_id, athlete_id, next_position, by_id, on_screen)

        # --- 1. μυϊκή ομάδα ------------------------------------------------
        # «Όλες» first and selected by default, because the second list is
        # typeable: a coach who knows the name should not have to answer where
        # it is filed before they can search for it.
        group_index = int(
            st.selectbox(
                "Μυϊκή ομάδα",
                [-1] + list(range(len(grouped))),
                format_func=lambda index: (
                    "Όλες οι ασκήσεις"
                    if index < 0
                    else f"{grouped[index][0]} ({len(grouped[index][2])})"
                ),
                key="log_group",
            )
        )
        if group_index < 0:
            group_label, group_id, members = "", None, rows
        else:
            group_label, group_id, members = grouped[group_index]

        # --- 2. άσκηση, by name, each name once -----------------------------
        by_name: dict[str, list[dict[str, Any]]] = {}
        for row in sorted(members, key=lambda row: fmt.fold(fmt.exercise_name(row))):
            by_name.setdefault(fmt.exercise_name(row), []).append(row)

        # The group index is IN the key, so changing the group builds a new
        # widget with nothing selected instead of leaving a name from the
        # previous group on screen under a heading it does not belong to.
        name = st.selectbox(
            "Άσκηση",
            options=list(by_name),
            index=None,
            placeholder="Γράψε ή διάλεξε — π.χ. έλξεις",
            key=f"log_name_{group_index}",
            help="Γράφοντας φιλτράρει: «ελξ» φέρνει τις Έλξεις χωρίς να ψάξεις ομάδα.",
        )

        if name:
            _ways_and_add(
                gym_id, session_id, next_position, by_id, group_index, name, by_name[name]
            )

        if group_id:
            _new_exercise(gym_id, session_id, next_position, group_id, group_label)
        else:
            st.divider()
            st.caption("Δεν τη βρίσκεις; Διάλεξε μυϊκή ομάδα από πάνω για να την προσθέσεις.")


def _ways_and_add(
    gym_id: str,
    session_id: str,
    next_position: int,
    by_id: dict[str, dict[str, Any]],
    group_index: int,
    name: str,
    variants: list[dict[str, Any]],
) -> None:
    """The third list — «Τρόπος άσκησης» — and the button that commits all three."""
    ways = {
        str(variant["id"]): (exercises.equipment_of(variant) or "Χωρίς όργανο")
        for variant in sorted(variants, key=lambda row: fmt.fold(exercises.equipment_of(row)))
    }
    only_one = len(ways) == 1

    # The name is in the key with the group, so choosing a different exercise
    # cannot leave the previous one's όργανο selected underneath it.
    chosen = st.selectbox(
        "Τρόπος άσκησης",
        options=list(ways),
        format_func=lambda key: ways[key],
        index=0 if only_one else None,
        placeholder="Διάλεξε όργανο",
        key=f"log_way_{group_index}_{fmt.fold(name)}",
        disabled=only_one,
        help=(
            "Η μόνη καταχωρημένη εκτέλεση αυτής της άσκησης."
            if only_one
            else "40 κιλά με αλτήρες δεν είναι 80 με μπάρα — γι' αυτό χωρίζονται."
        ),
    )

    if st.button("Προσθήκη άσκησης", key=f"log_add_{group_index}", type="primary"):
        if not chosen:
            st.error("Διάλεξε τρόπο εκτέλεσης — με τι γίνεται η άσκηση.")
            return
        _put_in_workout(gym_id, session_id, str(chosen), next_position, by_id)


def _put_in_workout(
    gym_id: str,
    session_id: str,
    exercise_id: str,
    next_position: int,
    by_id: dict[str, dict[str, Any]],
) -> None:
    """One exercise into the open workout, from whichever way in was used."""
    try:
        _add_block(gym_id, session_id, exercise_id, next_position)
    except Exception as exc:
        ui.notice(_NOTICE, "error", f"Η άσκηση δεν προστέθηκε: {exc}")
        st.rerun()

    _clear_workout_caches(gym_id, session_id)
    # This athlete's recent exercises just changed, and this is the only action
    # on the screen that changes them.
    _recent_exercise_ids.clear()
    ui.notice(_NOTICE, "ok", f"Μπήκε: {_labelled(by_id.get(exercise_id) or {})}")
    st.rerun()


def _repeat_buttons(
    gym_id: str,
    session_id: str,
    athlete_id: str,
    next_position: int,
    by_id: dict[str, dict[str, Any]],
    on_screen: set[str],
) -> None:
    """What this athlete did last time, one tap each.

    A coach repeats an athlete's programme far more often than they invent one,
    so the exercises of the last few workouts are the answer to «Προσθήκη
    άσκησης» most of the time. Anything already in today's workout is left out:
    it would add a second empty heading for a movement that is on the screen.
    """
    try:
        recent = _recent_exercise_ids(gym_id, athlete_id)
    except Exception:
        # The fast path is the nicest thing here and the least essential. The
        # search below reaches every exercise either way.
        return

    offered = [key for key in recent if key in by_id and key not in on_screen][:4]
    if not offered:
        return

    st.caption("Από τις προηγούμενες προπονήσεις")
    for key in offered:
        if st.button(f"+ {_labelled(by_id[key])}", key=f"log_again_{key}"):
            _put_in_workout(gym_id, session_id, key, next_position, by_id)
    st.divider()


def _labelled(exercise: dict[str, Any]) -> str:
    """«Πιέσεις Στήθους · Μπάρα» — the name is not enough to pick by."""
    gear = exercises.equipment_of(exercise)
    name = fmt.exercise_name(exercise)
    return f"{name} · {gear}" if gear else name


def _new_exercise(gym_id: str, session_id: str, next_position: int,
                  group_id: str | None, group_label: str) -> None:
    """Add an exercise the catalogue does not have, without leaving the workout.

    This is the whole reason the gym asked for a catalogue it can extend: the
    coach is at the machine, the athlete is waiting, and the movement is not in
    the list. Sending them to the Ασκήσεις screen means losing the workout they
    are in, so the exercise is created AND put into the session in one submit.

    Any active member may do this, not only the owner: `exercises_insert`
    permits the whole gym, and the original ask was that trainers add what is
    missing — they are the ones who find it missing.
    """
    st.divider()
    st.caption(f"Δεν τη βρίσκεις; Πρόσθεσέ την στο «{group_label}».")

    with st.form(f"log_new_exercise_{group_id}", clear_on_submit=True):
        name_el = st.text_input(
            "Όνομα άσκησης",
            max_chars=120,
            placeholder="π.χ. Πιέσεις στήθους σε Smith",
        )
        gear_label = st.selectbox("Όργανο", options=list(exercises.EQUIPMENT_CHOICES))
        gear = exercises.EQUIPMENT_CHOICES[gear_label]
        kinds = list(exercises.KIND_CHOICES)
        kind_label = st.selectbox(
            "Τι μετράει",
            options=kinds,
            # Preselected from the όργανο: a coach picking «Cardio» almost
            # always means time, and the wrong answer here stores twenty
            # treadmill minutes as twenty repetitions of nothing.
            index=kinds.index(
                exercises.KIND_LABELS[exercises.KIND_FOR_EQUIPMENT.get(gear, "weight_reps")]
            ),
        )
        submitted = st.form_submit_button("Πρόσθεσε και βάλ' την στην προπόνηση")

    if not submitted:
        return
    if not name_el.strip():
        st.error("Γράψε το όνομα της άσκησης.")
        return
    if not group_id:
        st.error("Διάλεξε πρώτα μυϊκή ομάδα από πάνω.")
        return

    try:
        exercise_id = exercises.create(
            gym_id,
            name_el=name_el,
            # The group's own coarse region, so the new exercise sorts with the
            # ones beside it instead of needing the coach to answer twice.
            category=_region_of(gym_id, group_id),
            equipment=gear,
            kind=exercises.KIND_CHOICES[kind_label],
            primary_group=group_id,
        )
        _add_block(gym_id, session_id, exercise_id, next_position)
    except Exception as exc:
        st.error("Η άσκηση δεν προστέθηκε.")
        st.caption(str(exc))
        return

    _clear_workout_caches(gym_id, session_id)
    _catalogue.clear()
    _muscle_groups.clear()
    _exercise_muscles.clear()
    ui.notice(_NOTICE, "ok", f"{name_el.strip()} · {gear_label} — μπήκε στην προπόνηση.")
    st.rerun()


def _region_of(gym_id: str, group_id: str) -> str:
    """The muscle group's coarse body region, for the new exercise's category."""
    for group in _muscle_groups(gym_id):
        if str(group.get("id")) == str(group_id):
            return str(group.get("region") or "upper")
    return "upper"


# ---------------------------------------------------------------------------
# Screens
# ---------------------------------------------------------------------------

def _edit_session(
    gym_id: str,
    session: dict[str, Any],
    names: dict[str, str],
    today: date,
) -> None:
    """Fix the workout itself: what it was called, when it was, whose it was.

    Not who typed it. logged_by is stamped from the JWT and refused on UPDATE by
    sessions_guard_immutable(), and that refusal is the product: «Μαρία» beside
    a number means Μαρία typed it. Crediting the session to a colleague is the
    supported way to say it was their session, and it shows as a change.
    """
    session_id = str(session["id"])

    with st.expander("Επεξεργασία προπόνησης"):
        with st.form("log_edit_session"):
            title = st.text_input(
                "Τίτλος",
                value=str(session.get("title") or ""),
                max_chars=160,
                placeholder="π.χ. Στήθος / πλάτη",
            )
            day = st.date_input(
                "Ημερομηνία",
                value=fmt.parse_local_date(session.get("local_date")) or today,
                format="DD/MM/YYYY",
            )

            author = str(session.get("logged_by") or "")
            options: list[str | None] = [None] + sorted(
                names, key=lambda member_id: fmt.fold(names.get(member_id, ""))
            )
            credited = str(session.get("credited_to") or "")
            index = options.index(credited) if credited in options else 0
            credited_to = st.selectbox(
                "Χρεώνεται σε",
                options=options,
                index=index,
                format_func=lambda member_id: (
                    f"{fmt.author_of(names, author)} — όπως καταχωρήθηκε"
                    if member_id is None
                    else names.get(member_id, fmt.UNKNOWN_AUTHOR)
                ),
                help="Ποιανού προπόνηση ήταν. Ποιος την πληκτρολόγησε δεν αλλάζει.",
            )
            notes = st.text_area(
                "Σημειώσεις",
                value=str(session.get("notes") or ""),
                max_chars=2000,
                placeholder="Ό,τι πρέπει να ξέρει ο επόμενος προπονητής.",
            )
            saved = st.form_submit_button("Αποθήκευση", type="primary")

        if saved:
            values: dict[str, Any] = {
                "title": title.strip() or None,
                "notes": notes.strip() or None,
                "credited_to": credited_to,
            }
            current_day = fmt.parse_local_date(session.get("local_date"))
            if isinstance(day, date) and day != current_day:
                values.update(_reschedule(session, day, gym.zone(gym_id)))
            try:
                ok = _update_session(gym_id, session_id, values)
            except Exception as exc:
                st.error("Η προπόνηση δεν αποθηκεύτηκε.")
                st.caption(str(exc))
                return
            if not ok:
                st.error("Η προπόνηση δεν αποθηκεύτηκε. Δοκίμασε ξανά.")
                return
            _clear_workout_caches(gym_id, session_id)
            ui.notice(_NOTICE, "ok", "Η προπόνηση ενημερώθηκε.")
            st.rerun()

        st.divider()
        st.caption("Η διαγραφή είναι αναστρέψιμη — η προπόνηση φεύγει από τις οθόνες, δεν σβήνεται.")
        if st.button("Διαγραφή προπόνησης", key="log_delete_session"):
            try:
                removed = _soft_delete(gym_id, "sessions", [session_id])
            except Exception as exc:
                st.error("Η προπόνηση δεν διαγράφηκε.")
                st.caption(str(exc))
                return
            if not removed:
                st.error("Η προπόνηση δεν διαγράφηκε. Δοκίμασε ξανά.")
                return
            # The blocks and the sets are left alone on purpose. Every screen
            # reaches them THROUGH a session it has already filtered on
            # deleted_at, so one stamped row hides the whole workout — and undo
            # is then one row too, instead of a restore that has to remember
            # exactly which sets were already deleted before this.
            _clear_workout_caches(gym_id, session_id)
            st.session_state.pop("session_id", None)
            # Same stop-state as finishing, for the same reason: render() opens a
            # fresh workout whenever session_id is empty, so without this the
            # very next rerun would start a new one on the athlete just cleared.
            st.session_state[_FINISHED] = {
                "session_id": session_id,
                "athlete_id": str(session.get("athlete_id") or ""),
                "deleted": True,
            }
            st.rerun()


def _deleted_screen(gym_id: str, athlete: dict[str, Any], deleted: dict[str, Any]) -> None:
    """After «Διαγραφή προπόνησης». The undo lives here rather than in a dialog.

    A confirm before the delete would cost a tap every time the coach is right;
    this costs nothing unless they were wrong.
    """
    session_id = str(deleted.get("session_id") or "")

    st.header(fmt.md(str(athlete.get("full_name") or fmt.EMPTY)))
    st.warning("Η προπόνηση διαγράφηκε.")
    st.caption("Δεν χάθηκε τίποτα. Μέχρι να φύγεις από αυτή την οθόνη μπορείς να την επαναφέρεις.")

    undo_col, back_col = st.columns(2)
    with undo_col:
        if st.button("Αναίρεση", key="log_deleted_undo", type="primary") and session_id:
            try:
                restored = _restore(gym_id, "sessions", [session_id])
            except Exception as exc:
                st.error("Η επαναφορά δεν έγινε.")
                st.caption(str(exc))
                return
            if not restored:
                st.error("Η επαναφορά δεν έγινε. Δοκίμασε ξανά.")
                return
            st.session_state.pop(_FINISHED, None)
            st.session_state["session_id"] = session_id
            _clear_workout_caches(gym_id, session_id)
            ui.notice(_NOTICE, "ok", "Η προπόνηση επανήλθε.")
            st.rerun()
    with back_col:
        if st.button("Στον αθλητή", key="log_deleted_back"):
            st.session_state.pop(_FINISHED, None)
            _go_to("athletes")


def _undo_restore(gym_id: str, payload: dict[str, Any]) -> None:
    """Put back whatever the last delete on this screen took away."""
    # The undo bar is drawn before a workout is opened, so the scope for the
    # cache clear comes from the same place the screen itself gets it.
    session_id = str(st.session_state.get("session_id") or "")
    table = str(payload.get("table") or "")
    ids = [str(value) for value in (payload.get("ids") or []) if value]
    if not table or not ids:
        return
    try:
        _restore(gym_id, table, ids)
        # A removed exercise carries its sets, so undo returns both or the
        # exercise comes back as an empty heading.
        _restore(gym_id, "sets", [str(value) for value in (payload.get("sets") or []) if value])
    except Exception as exc:
        ui.notice(_NOTICE, "error", f"Η επαναφορά δεν έγινε: {exc}")
        st.rerun()
    _clear_workout_caches(gym_id, session_id)
    ui.notice(_NOTICE, "ok", "Επανήλθε.")
    st.rerun()


def _finished_screen(gym_id: str, athlete: dict[str, Any], finished: dict[str, Any]) -> None:
    """After Τέλος προπόνησης. It exists so the screen does not reopen a workout.

    session_id has been cleared, and render() opens a workout whenever it is
    empty — without this stop the very next rerun would insert a fresh empty
    session and the coach could never leave.
    """
    st.header(fmt.md(str(athlete.get("full_name") or fmt.EMPTY)))
    st.success("Η προπόνηση ολοκληρώθηκε.")

    session_id = str(finished.get("session_id") or "")
    if session_id:
        try:
            blocks = _blocks(gym_id, session_id)
            rows = _sets(gym_id, session_id)
        except Exception:
            blocks, rows = [], []

        by_block: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            by_block.setdefault(str(row.get("block_id")), []).append(row)
        try:
            rows_of_catalogue = _catalogue(gym_id)
        except Exception:
            rows_of_catalogue = []
        catalogue = {str(row["id"]): row for row in rows_of_catalogue}
        canonical = _canonical_ids(rows_of_catalogue)

        summary = []
        for block in blocks:
            performed = by_block.get(str(block["id"]), [])
            if not performed:
                continue
            exercise = _resolve_exercise(
                gym_id, catalogue, canonical, str(block.get("exercise_id") or "")
            )
            kind = fmt.dominant_kind(performed)
            top = fmt.top_set(performed, kind)
            if top is None:
                continue
            summary.append(
                f"- {fmt.md(_labelled(exercise))} · {fmt.format_set(top, kind)} "
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
    # The workout that was just created, not the one that was stored: `stored`
    # is empty or stale by the time this line runs, which is why the row's own
    # id is the only scope this clear can be given.
    _clear_workout_caches(gym_id, str(row["id"]))
    return row


def _workout(gym_id: str, athlete: dict[str, Any], session: dict[str, Any]) -> None:
    athlete_id = str(athlete["id"])
    session_id = str(session["id"])

    today = gym.today(gym_id)

    names = gym.names_or_empty(gym_id)

    if st.button("← Στον αθλητή", key="log_back"):
        _go_to("athletes")

    st.header(fmt.md(str(athlete.get("full_name") or fmt.EMPTY)))
    day = fmt.parse_local_date(session.get("local_date"))
    st.markdown(
        "**"
        + fmt.md(
            "Σε εξέλιξη · "
            + fmt.author_of(names, session.get("logged_by"))
            + " · "
            + (fmt.format_day(day, today) if day else fmt.EMPTY)
        )
        + "**"
    )

    try:
        blocks = _blocks(gym_id, session_id)
    except Exception as exc:
        st.error("Οι ασκήσεις της προπόνησης δεν φορτώθηκαν.")
        st.caption(str(exc))
        return

    try:
        rows = _sets(gym_id, session_id)
    except Exception as exc:
        st.error("Τα σετ δεν φορτώθηκαν.")
        st.caption(str(exc))
        rows = []

    by_block: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_block.setdefault(str(row.get("block_id")), []).append(row)

    try:
        rows_of_catalogue = _catalogue(gym_id)
    except Exception as exc:
        st.error("Ο κατάλογος ασκήσεων δεν φορτώθηκε.")
        st.caption(str(exc))
        rows_of_catalogue = []
    catalogue = {str(row["id"]): row for row in rows_of_catalogue}
    canonical = _canonical_ids(rows_of_catalogue)

    raw_ids = {str(block.get("exercise_id") or "") for block in blocks} - {""}
    on_screen = {canonical.get(raw, raw) for raw in raw_ids}
    # Both halves of a merged movement's history, keyed by the canonical id it
    # all belongs to. An id the catalogue has never heard of stands for itself.
    exercise_keys = tuple(
        sorted(
            {(raw, canon) for raw, canon in canonical.items() if canon in on_screen}
            | {(exercise_id, exercise_id) for exercise_id in on_screen}
        )
    )
    current_session = (
        str(session.get("local_date") or ""),
        str(session.get("started_at") or ""),
        session_id,
    )
    try:
        last = _last_performance(gym_id, athlete_id, exercise_keys, current_session)
    except Exception:
        # The history is the nicest thing on this screen and the least essential:
        # losing it must not stop the coach logging the set in front of them.
        last = {}

    if not blocks:
        st.info("Καμία άσκηση ακόμα. Πρόσθεσε την πρώτη από το «Προσθήκη άσκησης».")

    for block in blocks:
        exercise_id = str(block.get("exercise_id") or "")
        _block_card(
            gym_id,
            session_id,
            block,
            _resolve_exercise(gym_id, catalogue, canonical, exercise_id),
            by_block.get(str(block["id"]), []),
            last.get(canonical.get(exercise_id, exercise_id)),
            names,
            session.get("logged_by"),
            today,
        )

    _picker(
        gym_id,
        session_id,
        athlete_id,
        _next_position(blocks),
        # Canonical ids: a movement already on the screen under the id it was
        # merged into must not be offered again under the old one.
        {canonical.get(raw, raw) for raw in raw_ids},
    )
    _edit_session(gym_id, session, names, today)

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
        _clear_workout_caches(gym_id, session_id)
        st.rerun()


# ---------------------------------------------------------------------------

def render() -> None:
    gym_id = db.gym_id()
    if not gym_id:
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

    ui.flush_notice(_NOTICE)
    ui.flush_undo(_NOTICE, lambda payload: _undo_restore(gym_id, payload))

    athlete_id = str(athlete["id"])
    finished = st.session_state.get(_FINISHED)
    if isinstance(finished, dict) and str(finished.get("athlete_id")) == athlete_id:
        if finished.get("deleted"):
            _deleted_screen(gym_id, athlete, finished)
        else:
            _finished_screen(gym_id, athlete, finished)
        return
    # Someone else's finished workout: the coach has moved on to another athlete.
    st.session_state.pop(_FINISHED, None)

    session = _open_or_reuse(gym_id, athlete_id)
    if session is None:
        return

    _workout(gym_id, athlete, session)
