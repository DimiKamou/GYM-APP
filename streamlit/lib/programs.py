"""Programmes (ασκησιολόγια): what the owner prescribes, and which day comes next.

A programme is numbered days, each a list of exercises with sets, reps and
kilos. The owner hands one to an athlete with an order — «1-2-3», «1-2-1-3» —
and a new workout for that athlete offers the next step of the order. The
coach takes it or logs something else: a programme fills an empty workout, it
never fences one.

013 made all of this. The app ships before the paste (CLAUDE.md), so every
reader asks `ready()` first and, until the tables exist, the screens that use
them say so or stay quiet.

Reads are cached with gym_id first, as every cache here must be.
"""

from __future__ import annotations

from typing import Any

import streamlit as st

from lib import blocks as block_columns
from lib import db, fmt

_NBSP = " "
MAX_SETS = 20


# ---------------------------------------------------------------------------
# Has 013 run?
# ---------------------------------------------------------------------------

def _missing(exc: Exception) -> bool:
    text = str(exc)
    return (
        getattr(exc, "code", None) in ("42P01", "42703", "PGRST205", "22P02")
        or "does not exist" in text
        or "Could not find the table" in text
        or "schema cache" in text
    )


@st.cache_data(ttl=60, show_spinner=False)
def has_013(gym_id: str) -> bool:
    """Do the programme tables exist yet? gym_id keys the cache."""
    try:
        db.client().table("athlete_programs").select("id").limit(1).execute()
        db.client().table("blocks").select("program_item_id").limit(1).execute()
    except Exception as exc:
        if _missing(exc):
            return False
        raise
    return True


def ready(gym_id: str) -> bool:
    """has_013 for drawing: a probe that failed says "not yet"."""
    try:
        return has_013(gym_id)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

def _ordered(rows: list[dict[str, Any]], key: str = "position") -> list[dict[str, Any]]:
    # (position, id), never position alone: two inserts can mint the same one.
    return sorted(rows, key=lambda r: (fmt.integer(r.get(key)) or 0, str(r.get("id"))))


@st.cache_data(ttl=60, show_spinner=False)
def programs(gym_id: str) -> list[dict[str, Any]]:
    """Every live programme with its days and their items, templates first."""
    client = db.client()
    found = (
        client.table("programs")
        .select("id, name, athlete_id, notes, created_at")
        .eq("gym_id", gym_id)
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )
    if not found:
        return []
    ids = [str(p["id"]) for p in found]
    days = (
        client.table("program_days")
        .select("id, program_id, position, name")
        .eq("gym_id", gym_id)
        .in_("program_id", ids)
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )
    items = []
    if days:
        items = (
            client.table("program_items")
            .select("id, day_id, position, exercise_id, equipment, muscle_group_id, sets, reps, "
                    "load_kg, seconds, note")
            .eq("gym_id", gym_id)
            .in_("day_id", [str(d["id"]) for d in days])
            .is_("deleted_at", "null")
            .execute()
            .data
            or []
        )
    out = []
    for program in found:
        own_days = []
        for day in _ordered([d for d in days if str(d.get("program_id")) == str(program["id"])]):
            own_days.append(dict(day, items=_ordered(
                [i for i in items if str(i.get("day_id")) == str(day["id"])])))
        out.append(dict(program, days=own_days))
    # The gym's templates first, then the copies made for one athlete.
    out.sort(key=lambda p: (p.get("athlete_id") is not None, fmt.fold(str(p.get("name") or ""))))
    return out


def program_by_id(gym_id: str, program_id: str) -> dict[str, Any] | None:
    return next((p for p in programs(gym_id) if str(p["id"]) == str(program_id)), None)


@st.cache_data(ttl=60, show_spinner=False)
def assignment(gym_id: str, athlete_id: str) -> dict[str, Any] | None:
    """The athlete's live programme assignment, or None."""
    rows = (
        db.client()
        .table("athlete_programs")
        .select("id, athlete_id, program_id, sequence, created_at")
        .eq("gym_id", gym_id)
        .eq("athlete_id", athlete_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def sequence_of(row: dict[str, Any] | None) -> list[int]:
    raw = (row or {}).get("sequence") or []
    if isinstance(raw, str):
        raw = [part for part in raw.strip("{}").split(",") if part.strip()]
    out = []
    for value in raw:
        number = fmt.integer(value)
        if number is not None:
            out.append(number)
    return out


@st.cache_data(ttl=60, show_spinner=False)
def last_step(gym_id: str, athlete_id: str, assignment_id: str) -> int | None:
    """The step of the order the athlete's latest programme workout was."""
    rows = (
        db.client()
        .table("sessions")
        .select("id, local_date, started_at, program_step")
        .eq("gym_id", gym_id)
        .eq("athlete_id", athlete_id)
        .eq("athlete_program_id", assignment_id)
        .is_("deleted_at", "null")
        .order("local_date", desc=True)
        .order("started_at", desc=True)
        .order("id", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    return fmt.integer(rows[0].get("program_step")) if rows else None


def next_step(gym_id: str, athlete_id: str, row: dict[str, Any]) -> int:
    """Where the order goes next: the step after the latest one, wrapping round."""
    order = sequence_of(row)
    if not order:
        return 0
    last = last_step(gym_id, athlete_id, str(row["id"]))
    return 0 if last is None else (last + 1) % len(order)


def day_at(program: dict[str, Any] | None, position: int) -> dict[str, Any] | None:
    return next((d for d in (program or {}).get("days", []) if fmt.integer(d.get("position")) == position), None)


def day_label(day: dict[str, Any] | None, position: int | None = None) -> str:
    """«Ημέρα 2 · Πόδια»."""
    number = position if position is not None else fmt.integer((day or {}).get("position"))
    name = str((day or {}).get("name") or "").strip()
    return f"Ημέρα {number}" + (f" · {name}" if name else "")


def parse_sequence(text: str, positions: list[int]) -> list[int]:
    """«1-2-3», «1 2 1 3», «1,2,3» → [1, 2, 3]; ValueError naming what is wrong."""
    cleaned = (text or "").replace(",", " ").replace("-", " ").replace("·", " ").split()
    if not cleaned:
        raise ValueError("Γράψε τη σειρά των ημερών, π.χ. 1-2-3.")
    order = []
    for part in cleaned:
        number = fmt.integer(part) if part.isdigit() else None
        if number is None:
            raise ValueError(f"Το «{part}» δεν είναι αριθμός ημέρας.")
        if number not in positions:
            raise ValueError(f"Το πρόγραμμα δεν έχει Ημέρα {number}.")
        order.append(number)
    if len(order) > 60:
        raise ValueError("Η σειρά είναι πολύ μεγάλη.")
    return order


def target_text(item: dict[str, Any]) -> str:
    """What is prescribed, the way the owner says it: «3×12 · 60 kg», «3×45 δευτ.»."""
    sets = fmt.integer(item.get("sets")) or 1
    reps = fmt.integer(item.get("reps"))
    seconds = fmt.integer(item.get("seconds"))
    load = fmt.decimal(item.get("load_kg"))
    if seconds:
        head = f"{sets}×{fmt.format_duration(seconds)}".replace(" ", _NBSP)
    elif reps:
        head = f"{sets}×{reps}"
    else:
        head = f"{sets} σετ"
    if load:
        head += f" · {fmt.format_weight(load)}{_NBSP}kg"
    note = str(item.get("note") or "").strip()
    return f"{head} — {note}" if note else head


def forget(gym_id: str = "", athlete_id: str = "") -> None:
    programs.clear()
    assignment.clear()
    last_step.clear()
    items_by_id.clear()


# ---------------------------------------------------------------------------
# Writes (the owner's; RLS refuses anyone else)
# ---------------------------------------------------------------------------

def create_program(gym_id: str, name: str, athlete_id: str | None = None) -> str:
    payload: dict[str, Any] = {"gym_id": gym_id, "name": name.strip()}
    if athlete_id:
        payload["athlete_id"] = athlete_id
    rows = db.client().table("programs").insert(payload).execute().data or []
    forget()
    if not rows:
        raise RuntimeError("Το πρόγραμμα δεν γράφτηκε — μόνο ο ιδιοκτήτης φτιάχνει προγράμματα.")
    return str(rows[0]["id"])


def rename_program(gym_id: str, program_id: str, name: str) -> None:
    db.client().table("programs").update({"name": name.strip()}).eq("gym_id", gym_id).eq("id", program_id).execute()
    forget()


def add_day(gym_id: str, program: dict[str, Any], name: str = "") -> str:
    position = max([fmt.integer(d.get("position")) or 0 for d in program.get("days", [])] or [0]) + 1
    payload: dict[str, Any] = {"gym_id": gym_id, "program_id": program["id"], "position": position}
    if name.strip():
        payload["name"] = name.strip()
    rows = db.client().table("program_days").insert(payload).execute().data or []
    forget()
    return str(rows[0]["id"]) if rows else ""


def add_item(gym_id: str, day: dict[str, Any], values: dict[str, Any]) -> None:
    position = max([fmt.integer(i.get("position")) or 0 for i in day.get("items", [])] or [-1]) + 1
    payload = {"gym_id": gym_id, "day_id": day["id"], "position": position}
    payload.update({k: v for k, v in values.items() if v not in (None, "")})
    db.client().table("program_items").insert(payload).execute()
    forget()


def update_item(gym_id: str, item_id: str, values: dict[str, Any]) -> None:
    db.client().table("program_items").update(values).eq("gym_id", gym_id).eq("id", item_id).execute()
    forget()


def soft_delete(gym_id: str, table: str, row_id: str) -> None:
    from datetime import datetime, timezone

    db.client().table(table).update({"deleted_at": datetime.now(timezone.utc).isoformat()}).eq(
        "gym_id", gym_id).eq("id", row_id).execute()
    forget()


def restore(gym_id: str, table: str, row_id: str) -> None:
    db.client().table(table).update({"deleted_at": None}).eq("gym_id", gym_id).eq("id", row_id).execute()
    forget()


def copy_for_athlete(gym_id: str, program: dict[str, Any], athlete_id: str, athlete_name: str) -> str:
    """A copy of a template for one athlete, so their kilos change and the template does not."""
    new_id = create_program(gym_id, f"{program['name']} · {athlete_name}"[:120], athlete_id)
    client = db.client()
    for day in program.get("days", []):
        payload: dict[str, Any] = {"gym_id": gym_id, "program_id": new_id, "position": day["position"]}
        if day.get("name"):
            payload["name"] = day["name"]
        rows = client.table("program_days").insert(payload).execute().data or []
        if not rows or not day.get("items"):
            continue
        copied = []
        for item in day["items"]:
            row = {k: item.get(k) for k in ("position", "exercise_id", "equipment", "muscle_group_id",
                                             "sets", "reps", "load_kg", "seconds", "note")}
            row = {k: v for k, v in row.items() if v is not None}
            copied.append(dict(row, gym_id=gym_id, day_id=rows[0]["id"]))
        client.table("program_items").insert(copied).execute()
    forget()
    return new_id


def assign(gym_id: str, athlete_id: str, program_id: str, order: list[int]) -> None:
    """Hand a programme to an athlete. The previous one, if any, ends first."""
    from datetime import datetime, timezone

    client = db.client()
    current = assignment(gym_id, athlete_id)
    if current:
        client.table("athlete_programs").update(
            {"deleted_at": datetime.now(timezone.utc).isoformat()}
        ).eq("gym_id", gym_id).eq("id", current["id"]).execute()
    rows = client.table("athlete_programs").insert({
        "gym_id": gym_id, "athlete_id": athlete_id, "program_id": program_id, "sequence": order,
    }).execute().data or []
    forget()
    if not rows:
        raise RuntimeError("Η ανάθεση δεν γράφτηκε — μόνο ο ιδιοκτήτης αναθέτει προγράμματα.")


def unassign(gym_id: str, assignment_id: str) -> None:
    soft_delete(gym_id, "athlete_programs", assignment_id)


def start_day(
    gym_id: str,
    session_id: str,
    row: dict[str, Any],
    step: int,
    day: dict[str, Any],
    first_position: int = 0,
    title: str = "",
) -> int:
    """Fill an open workout with a day's exercises; return how many went in.

    Each block remembers the item it came from, so the card can show the
    target and the set form can start on it. The session remembers the step,
    so the next workout offers the one after.
    """
    client = db.client()
    payload = []
    for offset, item in enumerate(day.get("items", [])):
        block: dict[str, Any] = {
            "gym_id": gym_id,
            "session_id": session_id,
            "exercise_id": item["exercise_id"],
            "position": first_position + offset,
            "program_item_id": item["id"],
        }
        if item.get("equipment"):
            block["equipment"] = item["equipment"]
        if item.get("muscle_group_id") and block_columns.ready(gym_id):
            block["muscle_group_id"] = item["muscle_group_id"]
        payload.append(block)
    if payload:
        client.table("blocks").insert(payload).execute()
    values: dict[str, Any] = {"athlete_program_id": row["id"], "program_step": step}
    if title:
        values["title"] = title[:120]
    client.table("sessions").update(values).eq("gym_id", gym_id).eq("id", session_id).execute()
    last_step.clear()
    return len(payload)


@st.cache_data(ttl=300, show_spinner=False)
def items_by_id(gym_id: str, ids: tuple[str, ...]) -> dict[str, dict[str, Any]]:
    """The prescriptions some blocks came from, deleted ones included."""
    if not ids:
        return {}
    rows = (
        db.client()
        .table("program_items")
        .select("id, sets, reps, load_kg, seconds, note")
        .eq("gym_id", gym_id)
        .in_("id", list(ids))
        .execute()
        .data
        or []
    )
    return {str(r["id"]): r for r in rows}
