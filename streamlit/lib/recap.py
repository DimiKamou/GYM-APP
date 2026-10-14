"""A workout in the words a coach uses: «Στήθος · Bench Press · Μπάρα · 3×12 · 60 kg».

One module for the two places that summarise past workouts — the log screen's
last three, and Πρόοδος's week or month — so the same workout never reads two
ways on two screens.

"3×12 · 60 kg" is sets × reps, then the load: the owner's own way of saying it.
The set lines inside a workout say "60×12", load × reps, and the explicit "kg"
here is what keeps the two from being read as each other.

Pure: no I/O, no Streamlit. The rows come from whichever screen read them.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from lib import fmt
from lib.exercises import equipment_of

WEEK = "week"
MONTH = "month"

# Between a number and its unit, so a phone never wraps «60» onto one line and
# «kg» onto the next.
_NBSP = "\u00a0"

WEEKDAYS_EL = ("Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο", "Κυριακή")

# Nominative, for a month standing on its own as a heading («Οκτώβριος 2026»);
# fmt.MONTHS_EL is the short form that goes after a day number.
MONTHS_FULL_EL = (
    "Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος", "Ιούνιος",
    "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος",
)


# ---------------------------------------------------------------------------
# Sets
# ---------------------------------------------------------------------------

def performed(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Sets that were done. `done_at is null` is a prescription, never a lift."""
    return [row for row in rows if row.get("done_at")]


def _ordered(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # (position, id), never position alone: two offline inserts can mint the
    # same position.
    return sorted(rows, key=lambda r: (fmt.integer(r.get("position")) or 0, str(r.get("id"))))


def _identity(row: dict[str, Any]) -> tuple[Any, ...]:
    load = fmt.decimal(row.get("load_kg"))
    meters = fmt.decimal(row.get("meters"))
    return (
        row.get("kind"),
        None if load is None else round(load, 2),
        fmt.integer(row.get("reps")),
        fmt.integer(row.get("seconds")),
        None if meters is None else round(meters, 2),
    )


def _kg(load: float) -> str:
    return f"{fmt.format_weight(load)}{_NBSP}kg"


def _run(count: int, row: dict[str, Any]) -> str:
    """`count` identical sets: «3×12 · 60 kg», «3×10 · +10 kg», «2×45 δευτ.»."""
    kind = row.get("kind")
    load = fmt.decimal(row.get("load_kg"))
    reps = fmt.integer(row.get("reps"))

    if kind == "weight_reps":
        if reps is not None and load is not None:
            return f"{count}×{reps} · {_kg(load)}"
        if reps is not None:
            return f"{count}×{reps}"
        if load is not None:
            return f"{count} σετ · {_kg(load)}"
        return f"{count} σετ"

    if kind == "bodyweight":
        if reps is None:
            return f"{count} σετ"
        if load is not None and load > 0:
            return f"{count}×{reps} · +{_kg(load)}"
        return f"{count}×{reps}"

    if kind == "duration":
        seconds = fmt.integer(row.get("seconds"))
        if seconds is None or seconds < 0:
            return f"{count} σετ"
        return f"{count}×{fmt.format_duration(seconds)}".replace(" ", _NBSP)

    if kind == "distance":
        meters = fmt.decimal(row.get("meters"))
        if meters is None or meters < 0:
            return f"{count} σετ"
        return f"{count}×{fmt.format_distance(meters)}".replace(" ", _NBSP)

    return f"{count} σετ"


def sets_summary(rows: list[dict[str, Any]]) -> str:
    """Performed sets as runs of identical ones, in the order they were done.

    «3×12 · 60 kg» for straight sets, «2×12 · 60 kg, 1×8 · 70 kg» when the bar
    went up. Runs, not totals: a pyramid summed into "3 σετ · 60–70 kg" loses
    which weight went with which reps, and that is the number the coach loads.
    """
    done = _ordered(performed(rows))
    if not done:
        return ""
    parts: list[str] = []
    count, current = 0, done[0]
    for row in done:
        if _identity(row) == _identity(current):
            count += 1
            continue
        parts.append(_run(count, current))
        count, current = 1, row
    parts.append(_run(count, current))
    return ", ".join(parts)


# ---------------------------------------------------------------------------
# Workouts
# ---------------------------------------------------------------------------

def primary_groups(
    links: list[dict[str, Any]], groups: list[dict[str, Any]]
) -> dict[str, str]:
    """Exercise id -> the name of its primary muscle group («Στήθος»)."""
    names = {str(g["id"]): str(g.get("name_el") or g.get("name_en") or "") for g in groups if g.get("id")}
    out: dict[str, str] = {}
    for link in links:
        if link.get("role") != "primary" or link.get("deleted_at"):
            continue
        name = names.get(str(link.get("muscle_group_id") or ""))
        if name:
            out.setdefault(str(link.get("exercise_id") or ""), name)
    return out


def block_line(
    exercise: dict[str, Any] | None,
    block: dict[str, Any],
    rows: list[dict[str, Any]],
    group: str = "",
) -> str:
    """«Στήθος · Bench Press · Μπάρα · 3×12 · 60 kg», or "" for a block with nothing done.

    The όργανο is the block's own, else what the exercise fixes; for an
    exercise that offers a choice and a block that never said, nothing — a
    guessed «Μπάρα» on 40 kg of dumbbells is the misread the column prevents.
    """
    sets = sets_summary(rows)
    if not sets:
        return ""
    parts = [group] if group else []
    parts.append(fmt.exercise_name(exercise))
    gear = equipment_of(exercise, str(block.get("equipment") or "")) if exercise else ""
    if gear:
        parts.append(gear)
    parts.append(sets)
    return " · ".join(parts)


def workout_lines(
    blocks: list[dict[str, Any]],
    sets: list[dict[str, Any]],
    exercises_by_id: dict[str, dict[str, Any]],
    groups_by_exercise: dict[str, str],
) -> list[str]:
    """One line per exercise of one workout that had a set done, in workout order.

    A block still naming a folded duplicate is named after the row it was folded
    into: reads follow the merge arrow, one hop (exercises_guard_merge() refuses
    a chain).
    """
    by_block: dict[str, list[dict[str, Any]]] = {}
    for row in sets:
        by_block.setdefault(str(row.get("block_id") or ""), []).append(row)

    lines: list[str] = []
    for block in _ordered(blocks):
        raw_id = str(block.get("exercise_id") or "")
        exercise = exercises_by_id.get(raw_id)
        target = str((exercise or {}).get("merged_into_id") or "")
        if target and target in exercises_by_id:
            exercise = exercises_by_id[target]
        exercise_id = str((exercise or {}).get("id") or raw_id)
        group = groups_by_exercise.get(exercise_id) or groups_by_exercise.get(raw_id, "")
        line = block_line(exercise, block, by_block.get(str(block.get("id") or ""), []), group)
        if line:
            lines.append(line)
    return lines


def workout_heading(session: dict[str, Any], names: dict[str, str], today: date) -> str:
    """«Τρίτη 13 Οκτ · Μαρία · Πόδια»: the day and who it is credited to, always both.

    credited_to before logged_by, as everywhere else that names a workout's
    coach: a session Μαρία typed and re-credited to Νίκος is Νίκος's.
    """
    day = fmt.parse_local_date(session.get("local_date"))
    when = f"{WEEKDAYS_EL[day.weekday()]} {fmt.format_day(day, today)}" if day else fmt.EMPTY
    who = fmt.author_of(names, session.get("credited_to") or session.get("logged_by"))
    heading = f"{when} · {who}"
    title = str(session.get("title") or "").strip()
    return f"{heading} · {title}" if title else heading


# ---------------------------------------------------------------------------
# Periods
# ---------------------------------------------------------------------------

def period(kind: str, anchor: date) -> tuple[date, date]:
    """The calendar week (Monday to Sunday) or month that contains `anchor`."""
    if kind == MONTH:
        first = anchor.replace(day=1)
        following = (first + timedelta(days=32)).replace(day=1)
        return first, following - timedelta(days=1)
    first = anchor - timedelta(days=anchor.weekday())
    return first, first + timedelta(days=6)


def period_label(kind: str, first: date, last: date, today: date) -> str:
    """«12–18 Οκτ», «29 Σεπ – 5 Οκτ», «Οκτώβριος 2026» — with the year once it is not this one."""
    if kind == MONTH:
        return f"{MONTHS_FULL_EL[first.month - 1]} {first.year}"
    year = "" if last.year == today.year and first.year == today.year else f" {last.year}"
    if first.month == last.month:
        return f"{first.day}–{last.day} {fmt.MONTHS_EL[last.month - 1]}{year}"
    head = f"{first.day} {fmt.MONTHS_EL[first.month - 1]}"
    if first.year != last.year:
        head += f" {first.year}"
    return f"{head} – {last.day} {fmt.MONTHS_EL[last.month - 1]}{year}"


def in_period(session: dict[str, Any], first: date, last: date) -> bool:
    day = fmt.parse_local_date(session.get("local_date"))
    return day is not None and first <= day <= last
