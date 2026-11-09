"""An athlete's past workouts, read once and drawn the same way on every screen.

The log screen, the athlete sheet and Πρόοδος all show past workouts as the same
box: the day and the coach, one line per exercise in the owner's words, and a
«Λεπτομέρειες» fold with every set, who typed it, and every comment. One reader
and one box, so the three screens never disagree about what happened.

Also the month calendar, where a day the athlete trained opens that workout.
"""

from __future__ import annotations

import calendar as _calendar
from datetime import date, datetime
from typing import Any, Callable

import streamlit as st

from lib import blocks as block_columns
from lib import db, fmt, recap
from lib.exercises import columns, equipment_of

WORKOUTS = 3
# Sessions read to find three that had a set done in them: a workout opened and
# left empty is skipped rather than shown as a blank box.
_LOOKBACK = 12
# Ids per `in_(...)` filter; the list travels in the URL.
_CHUNK = 60

_SESSION_COLUMNS = "id, local_date, started_at, status, logged_by, credited_to, title, notes"


def _order(local_date: Any, started_at: Any, session_id: Any) -> tuple[date, datetime, str]:
    """(gym day, instant, id): the total order every "before this one" uses."""
    day = fmt.parse_local_date(local_date) or date.min
    instant = fmt.parse_instant(started_at) or datetime.min.replace(tzinfo=None)
    if instant.tzinfo is not None:
        instant = instant.replace(tzinfo=None)
    return (day, instant, str(session_id or ""))


def _in(client: Any, table: str, select: str, gym_id: str, column: str, ids: list[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for start in range(0, len(ids), _CHUNK):
        query = client.table(table).select(select).in_(column, ids[start : start + _CHUNK])
        if gym_id:
            query = query.eq("gym_id", gym_id)
        rows += query.is_("deleted_at", "null").execute().data or []
    return rows


def _read(
    gym_id: str,
    athlete_id: str,
    before: tuple[str, str, str] | None,
) -> list[dict[str, Any]]:
    client = db.client()
    query = (
        client.table("sessions")
        .select(_SESSION_COLUMNS)
        .eq("gym_id", gym_id)
        .eq("athlete_id", athlete_id)
        .is_("deleted_at", "null")
    )
    # Bounded at the open workout's day BEFORE the limit: a workout reopened
    # from a month ago otherwise spent the whole window on the sessions after it.
    if before and before[0]:
        query = query.lte("local_date", before[0])
    sessions = (
        query.order("local_date", desc=True)
        .order("started_at", desc=True)
        .order("id", desc=True)
        .limit(_LOOKBACK + 1)
        .execute()
        .data
        or []
    )
    if before:
        limit = _order(*before)
        sessions = [
            row for row in sessions
            if str(row.get("id")) != before[2]
            and _order(row.get("local_date"), row.get("started_at"), row.get("id")) < limit
        ]
    return _assemble(client, gym_id, sessions[:_LOOKBACK], WORKOUTS)


def _assemble(
    client: Any, gym_id: str, sessions: list[dict[str, Any]], limit: int | None
) -> list[dict[str, Any]]:
    """Sessions -> workouts with their blocks, sets, names and groups, in the order given.

    A session with no set done is skipped: an opened-and-abandoned workout is
    not a workout. `limit` stops after that many; None keeps them all.
    """
    if not sessions:
        return []

    blocks = _in(
        client, "blocks",
        block_columns.columns(gym_id, "id, session_id, exercise_id, position, equipment, note"),
        gym_id, "session_id", [str(row["id"]) for row in sessions],
    )
    if not blocks:
        return []
    sets = recap.performed(_in(
        client, "sets",
        "id, block_id, position, kind, load_kg, reps, seconds, meters, note, done_at, created_by",
        gym_id, "block_id", [str(block["id"]) for block in blocks],
    ))
    session_of_block = {str(b["id"]): str(b.get("session_id")) for b in blocks}

    picked: list[dict[str, Any]] = []
    for row in sessions:
        session_id = str(row["id"])
        own_sets = [s for s in sets if session_of_block.get(str(s.get("block_id"))) == session_id]
        if not own_sets:
            continue
        picked.append({
            "session": row,
            "blocks": [b for b in blocks if str(b.get("session_id")) == session_id],
            "sets": own_sets,
        })
        if limit is not None and len(picked) == limit:
            break
    if not picked:
        return []

    # Names and groups for exactly these blocks, deleted rows included: a block
    # logged before the catalogue changed still has to read with its name.
    ids = sorted({str(b.get("exercise_id")) for w in picked for b in w["blocks"] if b.get("exercise_id")})
    found: list[dict[str, Any]] = []
    for chunk in range(0, len(ids), _CHUNK):
        found += (
            client.table("exercises")
            .select(columns(gym_id, "id, name_el, name_en, merged_into_id, equipment"))
            .in_("id", ids[chunk : chunk + _CHUNK])
            .execute()
            .data
            or []
        )
    targets = sorted({
        str(r["merged_into_id"]) for r in found
        if r.get("merged_into_id") and str(r["merged_into_id"]) not in {str(x["id"]) for x in found}
    })
    for start in range(0, len(targets), _CHUNK):
        found += (
            client.table("exercises")
            .select(columns(gym_id, "id, name_el, name_en, merged_into_id, equipment"))
            .in_("id", targets[start : start + _CHUNK])
            .execute()
            .data
            or []
        )
    exercises = {str(r["id"]): r for r in found}

    groups: dict[str, str] = {}
    names_of_groups: dict[str, str] = {}
    try:
        links = _in(client, "exercise_muscles", "exercise_id, muscle_group_id, role, deleted_at",
                    "", "exercise_id", sorted(exercises))
        named = (
            client.table("muscle_groups")
            .select("id, name_el, name_en")
            .is_("deleted_at", "null")
            .execute()
            .data
            or []
        )
        groups = recap.primary_groups(links, named)
        names_of_groups = recap.group_names(named)
    except Exception:
        # The group only prefixes each line; the workouts are already read.
        groups = {}

    for workout in picked:
        workout["exercises"] = exercises
        workout["groups"] = groups
        workout["group_names"] = names_of_groups
    return picked


@st.cache_data(ttl=1800, show_spinner=False)
def _before(gym_id: str, athlete_id: str, before: tuple[str, str, str]) -> list[dict[str, Any]]:
    # Long: nothing typed into the open workout changes the ones before it.
    return _read(gym_id, athlete_id, before)


@st.cache_data(ttl=60, show_spinner=False)
def _latest(gym_id: str, athlete_id: str) -> list[dict[str, Any]]:
    # Short: the athlete sheet must show the workout that was just logged.
    return _read(gym_id, athlete_id, None)


def last_workouts(
    gym_id: str, athlete_id: str, before: tuple[str, str, str] | None = None
) -> list[dict[str, Any]]:
    """The athlete's last three workouts that had a set done, newest first.

    `before` is (local_date, started_at, id) of an open workout: only workouts
    strictly before it count, so a workout reopened from last week does not
    summarise the ones after it. None: the latest three, whatever they are.
    """
    if before:
        return _before(gym_id, athlete_id, before)
    return _latest(gym_id, athlete_id)


@st.cache_data(ttl=120, show_spinner=False)
def workouts_between(gym_id: str, athlete_id: str, first: date, last: date) -> list[dict[str, Any]]:
    """Every workout with a set done between two gym days, inclusive, newest first.

    For the calendar: a month is at most a few dozen sessions, so unlike the
    last three there is no lookback to bound.
    """
    client = db.client()
    sessions = (
        client.table("sessions")
        .select(_SESSION_COLUMNS)
        .eq("gym_id", gym_id)
        .eq("athlete_id", athlete_id)
        .is_("deleted_at", "null")
        .gte("local_date", first.isoformat())
        .lte("local_date", last.isoformat())
        .order("local_date", desc=True)
        .order("started_at", desc=True)
        .order("id", desc=True)
        .execute()
        .data
        or []
    )
    return _assemble(client, gym_id, sessions, None)


def forget(gym_id: str, athlete_id: str) -> None:
    """A workout of this athlete changed: the sheet's latest three are stale."""
    _latest.clear(gym_id, athlete_id)
    # Every month of this athlete: which one the workout fell in is not known here.
    workouts_between.clear()


# ---------------------------------------------------------------------------
# The box
# ---------------------------------------------------------------------------

def _set_detail(row: dict[str, Any], names: dict[str, str], session_author: Any) -> str:
    kind = str(row.get("kind") or "weight_reps")
    line = fmt.format_set(row, kind)
    author = row.get("created_by")
    if author and str(author) != str(session_author or ""):
        line = f"{line} · {fmt.author_of(names, author)}"
    note = (row.get("note") or "").strip()
    if note:
        line = f"{line} — {note}"
    return line


def workout_box(
    workout: dict[str, Any],
    names: dict[str, str],
    today: date,
    key: str,
    action: tuple[str, Callable[[], None]] | None = None,
    folded_details: bool = True,
) -> None:
    """One past workout: always its summary, and a fold with everything else.

    The summary is the day, the coach and a line per exercise — the five-second
    read. «Λεπτομέρειες» opens every set, who typed it, and every comment on the
    sets, the exercises and the workout. `action` is a (label, callback) button
    inside the fold, e.g. reopening the workout to correct it.
    """
    session = workout["session"]
    exercises = workout.get("exercises") or {}
    groups = workout.get("groups") or {}
    blocks = workout["blocks"]
    sets = workout["sets"]
    with st.container(border=True):
        heading = recap.workout_heading(session, names, today)
        if str(session.get("status") or "") == "active":
            heading += " · σε εξέλιξη"
        st.markdown("**" + fmt.md(heading) + "**")
        lines = recap.workout_lines(blocks, sets, exercises, groups, workout.get("group_names"))
        st.markdown("\n".join(f"- {fmt.md(line)}" for line in lines))

        with (st.expander("Λεπτομέρειες") if folded_details else st.container()):
            by_block: dict[str, list[dict[str, Any]]] = {}
            for row in sets:
                by_block.setdefault(str(row.get("block_id")), []).append(row)
            author = session.get("logged_by")
            for block in sorted(blocks, key=lambda b: (fmt.integer(b.get("position")) or 0, str(b.get("id")))):
                rows = recap._ordered(by_block.get(str(block.get("id")), []))
                note = (block.get("note") or "").strip()
                if not rows and not note:
                    continue
                exercise = exercises.get(str(block.get("exercise_id") or ""))
                target = str((exercise or {}).get("merged_into_id") or "")
                if target in exercises:
                    exercise = exercises[target]
                gear = equipment_of(exercise, str(block.get("equipment") or ""))
                title = fmt.exercise_name(exercise) + (f" · {gear}" if gear else "")
                details = [f"**{fmt.md(title)}**"]
                details += [
                    f"{n}\\. {fmt.md(_set_detail(row, names, author))}" for n, row in enumerate(rows, 1)
                ]
                st.markdown("  \n".join(details))
                if note:
                    st.caption("💬 " + fmt.md(note))
            session_notes = (session.get("notes") or "").strip()
            if session_notes:
                st.info(fmt.md(session_notes))
            logged = fmt.author_of(names, session.get("logged_by"))
            credited = session.get("credited_to")
            if credited and credited != session.get("logged_by"):
                st.caption(f"Γράφτηκε από {fmt.md(logged)}.")
            if action is not None:
                label, callback = action
                if st.button(label, key=f"{key}_action"):
                    callback()


def boxes(
    workouts: list[dict[str, Any]],
    names: dict[str, str],
    today: date,
    key: str,
    action: Callable[[dict[str, Any]], tuple[str, Callable[[], None]] | None] | None = None,
) -> None:
    """The workouts as small boxes on one row, each popping up with everything in it.

    Three stacked boxes pushed the set forms a screen down on a phone; three
    small ones side by side cost one row, and the one the coach wants opens.
    """
    row = st.container(horizontal=True, wrap=True, gap="small")
    for n, workout in enumerate(workouts):
        session = workout["session"]
        day = fmt.parse_local_date(session.get("local_date"))
        # Only the day fits three to a phone's row; who and what are one tap away.
        label = fmt.format_day(day, today) if day else fmt.EMPTY
        with row.popover(label, key=f"{key}_{n}_pop", width="stretch"):
            workout_box(workout, names, today, f"{key}_{n}", action(workout) if action else None,
                        folded_details=False)


# ---------------------------------------------------------------------------
# The calendar
# ---------------------------------------------------------------------------

_DAY_HEADS = ("Δ", "Τ", "Τ", "Π", "Π", "Σ", "Κ")


def month_grid(
    workouts: list[dict[str, Any]],
    year: int,
    month: int,
    names: dict[str, str],
    today: date,
    key: str,
) -> None:
    """The month as rows of seven; a day with a workout opens it as a pop-up.

    Widgets rather than an HTML table, because a day has to answer a tap.
    One horizontal container per week keeps the seven side by side on a
    phone, where st.columns would stack them into one column of 31.
    """
    by_day: dict[date, list[dict[str, Any]]] = {}
    for workout in workouts:
        day = fmt.parse_local_date(workout["session"].get("local_date"))
        if day:
            by_day.setdefault(day, []).append(workout)

    with st.container(key=f"{key}_cal", gap="xxsmall"):
        head = st.container(horizontal=True, wrap=False, gap="xxsmall")
        for name in _DAY_HEADS:
            head.markdown(f"<div class='th-cal-head'>{name}</div>", width="stretch",
                          unsafe_allow_html=True)
        for n, week in enumerate(_calendar.Calendar(firstweekday=0).monthdatescalendar(year, month)):
            row = st.container(horizontal=True, wrap=False, gap="xxsmall", vertical_alignment="center")
            for day in week:
                done = by_day.get(day) if day.month == month else None
                if done:
                    with row.popover(str(day.day), width="stretch", type="primary",
                                     key=f"{key}_{day.isoformat()}"):
                        for i, workout in enumerate(done):
                            workout_box(workout, names, today, f"{key}_{day.isoformat()}_{i}",
                                        folded_details=False)
                    continue
                classes = "th-cal-day" + (" out" if day.month != month else "") + (
                    " today" if day == today else "")
                row.markdown(f"<div class='{classes}'>{day.day}</div>", width="stretch",
                             unsafe_allow_html=True)
    st.markdown(
        "<style>"
        f".st-key-{key}_cal .th-cal-head{{text-align:center;font-size:.75rem;font-weight:600;opacity:.6;"
        "line-height:1.5rem;min-height:1.5rem}"
        f".st-key-{key}_cal .th-cal-day{{text-align:center;line-height:2.75rem;min-height:2.75rem}}"
        f".st-key-{key}_cal .th-cal-day.out{{opacity:.3}}"
        f".st-key-{key}_cal .th-cal-day.today{{outline:2px solid #5b7553;outline-offset:-4px;border-radius:.5rem}}"
        # Streamlit pulls a markdown block up by a paragraph margin, which in a
        # row that scrolls its overflow cut the weekday letters down to a dash.
        f".st-key-{key}_cal div:has(> .th-cal-head),.st-key-{key}_cal div:has(> .th-cal-day)"
        "{margin-bottom:0 !important}"
        # The chevron eats half of a seventh of a phone; the day number is the label.
        f".st-key-{key}_cal [data-testid='stPopoverButton'] [data-testid='stIconMaterial']{{display:none}}"
        f".st-key-{key}_cal [data-testid='stPopoverButton']{{padding-left:0;padding-right:0;min-width:0}}"
        "</style>",
        unsafe_allow_html=True,
    )
