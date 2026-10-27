"""An athlete's past workouts, read once and drawn the same way on every screen.

The log screen, the athlete sheet and Πρόοδος all show past workouts as the same
box: the day and the coach, one line per exercise in the owner's words, and a
«Λεπτομέρειες» fold with every set, who typed it, and every comment. One reader
and one box, so the three screens never disagree about what happened.

Also the month calendar with the days the athlete trained marked.
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
    sessions = sessions[:_LOOKBACK]
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
        if len(picked) == WORKOUTS:
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


def forget(gym_id: str, athlete_id: str) -> None:
    """A workout of this athlete changed: the sheet's latest three are stale."""
    _latest.clear(gym_id, athlete_id)


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


def month_calendar(year: int, month: int, trained: set[date], today: date) -> str:
    """A month as an HTML table, the days with a workout marked. Monday first.

    HTML rather than widgets: seven columns of buttons stack on a phone, and a
    calendar that is one column of 31 rows is not a calendar.
    """
    weeks = _calendar.Calendar(firstweekday=0).monthdatescalendar(year, month)
    head = "".join(f"<th>{d}</th>" for d in _DAY_HEADS)
    rows = []
    for week in weeks:
        cells = []
        for day in week:
            classes = []
            if day.month != month:
                classes.append("out")
            if day in trained:
                classes.append("done")
            if day == today:
                classes.append("today")
            cells.append(f'<td class="{" ".join(classes)}"><span>{day.day}</span></td>')
        rows.append("<tr>" + "".join(cells) + "</tr>")
    return (
        "<style>"
        ".th-cal{width:100%;max-width:360px;border-collapse:collapse;table-layout:fixed;margin:4px 0 8px}"
        ".th-cal th{font-size:.75rem;font-weight:600;opacity:.6;padding:2px 0;text-align:center}"
        ".th-cal td{text-align:center;padding:3px 0}"
        ".th-cal td span{display:inline-block;width:2.1em;height:2.1em;line-height:2.1em;border-radius:50%}"
        ".th-cal td.out span{opacity:.3}"
        ".th-cal td.done span{background:#5b7553;color:#fff;font-weight:700}"
        ".th-cal td.today span{outline:2px solid #5b7553;outline-offset:-2px}"
        "</style>"
        f'<table class="th-cal"><thead><tr>{head}</tr></thead><tbody>{"".join(rows)}</tbody></table>'
    )


def trained_days(data: dict[str, list[dict[str, Any]]]) -> set[date]:
    """Days with at least one set done, from Πρόοδος's history read."""
    session_of_block = {b["id"]: b.get("session_id") for b in data.get("blocks", [])}
    done = {session_of_block.get(row.get("block_id")) for row in recap.performed(data.get("sets", []))}
    out: set[date] = set()
    for session in data.get("sessions", []):
        if session.get("id") in done:
            day = fmt.parse_local_date(session.get("local_date"))
            if day:
                out.add(day)
    return out
