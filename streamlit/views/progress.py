"""Πρόοδος — what actually changed, for one athlete.

Three rules shape this screen more than any chart library does.

The four set kinds are not one number. Twenty minutes on the treadmill and ten
pull-ups were stored identically by the prototype and both counted as zero
volume; here kilos, repetitions, time and distance are totalled apart and never
added together, because there is no unit in which they are comparable.

A set with `done_at is null` was prescribed, not performed. It is not a missed
set and it is not a done one, so it counts towards nothing.

And a number without its date and its author is worse than no number, because
the coach loads a bar with it. Every figure on this screen that a coach could
act on carries both.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

import streamlit as st

from lib import db, fmt, gym
from lib.exercises import EQUIPMENT_LABELS

_MAX_POINTS = 40
# Ids per `in_(...)` filter. PostgREST takes the list in the URL, and the
# gateway refuses a URL past roughly 16 KB — about 400 uuids — so an athlete
# with a year of history was exactly the athlete whose screen could not load.
_IN_CHUNK = 100


def _in_chunks(ids: list[Any]) -> list[list[Any]]:
    return [ids[i:i + _IN_CHUNK] for i in range(0, len(ids), _IN_CHUNK)]


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

@st.cache_data(ttl=60, show_spinner=False)
def _athletes(gym_id: str) -> list[dict[str, Any]]:
    return (
        db.client()
        .table("athletes")
        .select("id, full_name")
        .eq("gym_id", gym_id)
        .is_("deleted_at", "null")
        .order("full_name")
        .execute()
        .data
        or []
    )


@st.cache_data(ttl=60, show_spinner=False)
def _history(gym_id: str, athlete_id: str) -> dict[str, list[dict[str, Any]]]:
    """Every live session, block and set for one athlete, plus what names them.

    Read in four round trips rather than one nested select: PostgREST can embed,
    but the embedded rows come back without a way to filter their own
    deleted_at, and a tombstone counted into a total is the defect this whole
    screen exists to avoid.
    """
    client = db.client()

    sessions = (
        client.table("sessions")
        .select("id, local_date, started_at, logged_by, credited_to, title")
        .eq("gym_id", gym_id)
        .eq("athlete_id", athlete_id)
        .is_("deleted_at", "null")
        .order("local_date")
        .order("started_at")
        .order("id")
        .execute()
        .data
        or []
    )
    if not sessions:
        return {"sessions": [], "blocks": [], "sets": [], "exercises": [], "groups": [], "links": []}

    session_ids = [s["id"] for s in sessions]
    blocks: list[dict[str, Any]] = []
    for chunk in _in_chunks(session_ids):
        blocks += (
            client.table("blocks")
            .select("id, session_id, exercise_id, position, equipment")
            .eq("gym_id", gym_id)
            .in_("session_id", chunk)
            .is_("deleted_at", "null")
            .execute()
            .data
            or []
        )
    # (position, id), never position alone — and sorted here rather than per
    # request, since the chunks come back one at a time.
    blocks.sort(key=lambda b: (fmt.integer(b.get("position")) or 0, str(b.get("id"))))
    sets: list[dict[str, Any]] = []
    for chunk in _in_chunks([b["id"] for b in blocks]):
        sets += (
            client.table("sets")
            .select("id, block_id, position, kind, load_kg, reps, seconds, meters, done_at")
            .eq("gym_id", gym_id)
            .in_("block_id", chunk)
            .is_("deleted_at", "null")
            .execute()
            .data
            or []
        )
    sets.sort(key=lambda r: (fmt.integer(r.get("position")) or 0, str(r.get("id"))))

    exercise_ids = sorted({b["exercise_id"] for b in blocks if b.get("exercise_id")})
    rows_of_catalogue: list[dict[str, Any]] = []
    for chunk in _in_chunks(exercise_ids):
        rows_of_catalogue += (
            client.table("exercises")
            .select("id, name_el, name_en, merged_into_id, equipment")
            .in_("id", chunk)
            .execute()
            .data
            or []
        )
    # A block written before a duplicate was folded in still points at the dead
    # row, and the grouping below follows the arrow — but the target itself was
    # never read when no block named it directly, so the movement was titled
    # «—» in Επιδόσεις and fell out of Κατανομή. One hop is enough:
    # exercises_guard_merge() refuses a target that is itself merged.
    known = {row["id"] for row in rows_of_catalogue}
    targets = sorted(
        {
            row["merged_into_id"]
            for row in rows_of_catalogue
            if row.get("merged_into_id") and row["merged_into_id"] not in known
        }
    )
    for chunk in _in_chunks(targets):
        rows_of_catalogue += (
            client.table("exercises")
            .select("id, name_el, name_en, merged_into_id, equipment")
            .in_("id", chunk)
            .execute()
            .data
            or []
        )
    links: list[dict[str, Any]] = []
    for chunk in _in_chunks(sorted(exercise_ids + targets)):
        links += (
            client.table("exercise_muscles")
            .select("exercise_id, muscle_group_id, role")
            .in_("exercise_id", chunk)
            .is_("deleted_at", "null")
            .eq("role", "primary")
            .execute()
            .data
            or []
        )
    exercises = rows_of_catalogue

    groups = (
        client.table("muscle_groups")
        .select("id, name_el, position")
        .is_("deleted_at", "null")
        .order("position")
        .execute()
        .data
        or []
    )

    return {
        "sessions": sessions,
        "blocks": blocks,
        "sets": sets,
        "exercises": exercises,
        "groups": groups,
        "links": links,
    }


# ---------------------------------------------------------------------------
# Maths. Pure — no I/O, no Streamlit.
# ---------------------------------------------------------------------------

def _performed(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Only sets that were actually done. `done_at is null` is a plan."""
    return [r for r in rows if r.get("done_at")]


def _volume(rows: list[dict[str, Any]]) -> float:
    """Kilos moved: load × reps, weight_reps only.

    Bodyweight work is deliberately absent. Its load column is the ADDED weight,
    so a set of ten pull-ups at +0 kg would contribute zero and a set at +20 kg
    would contribute 200 — the same movement scoring twenty times more for a
    belt. Counting it would make the line say something untrue.
    """
    total = 0.0
    for row in rows:
        if row.get("kind") != "weight_reps":
            continue
        load = fmt.decimal(row.get("load_kg")) or 0.0
        reps = fmt.integer(row.get("reps")) or 0
        total += load * reps
    return total


def _totals(rows: list[dict[str, Any]]) -> dict[str, float]:
    out = {"sets": float(len(rows)), "kg": _volume(rows), "reps": 0.0, "seconds": 0.0, "meters": 0.0}
    for row in rows:
        kind = row.get("kind")
        if kind in ("weight_reps", "bodyweight"):
            out["reps"] += fmt.integer(row.get("reps")) or 0
        elif kind == "duration":
            out["seconds"] += fmt.integer(row.get("seconds")) or 0
        elif kind == "distance":
            out["meters"] += fmt.decimal(row.get("meters")) or 0.0
    return out


def _canonical(exercises: list[dict[str, Any]]) -> dict[str, str]:
    """Exercise id -> the row its history belongs to.

    A merged duplicate keeps its own id on every historical block; reads follow
    the arrow, or one movement shows up twice under two names.
    """
    return {e["id"]: (e.get("merged_into_id") or e["id"]) for e in exercises}


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def _summary(sessions: list[dict[str, Any]], sets: list[dict[str, Any]], names: dict[str, str]) -> None:
    done = _performed(sets)
    totals = _totals(done)

    first = fmt.parse_local_date(sessions[0].get("local_date"))
    last = fmt.parse_local_date(sessions[-1].get("local_date"))
    span = ""
    if first and last:
        span = f"{fmt.format_day(first, last)} – {fmt.format_day(last, last)}" if first != last else fmt.format_day(last, last)

    one, two, three = st.columns(3)
    one.metric("Προπονήσεις", len(sessions))
    two.metric("Σετ", int(totals["sets"]))
    three.metric("Κιλά", f"{totals['kg']:,.0f}".replace(",", "."))
    if span:
        st.caption(f"Από {span}.")

    extras = []
    if totals["reps"]:
        extras.append(f"{int(totals['reps'])} επαναλήψεις")
    if totals["seconds"]:
        extras.append(fmt.format_duration(int(totals["seconds"])))
    if totals["meters"]:
        extras.append(fmt.format_distance(totals["meters"]))
    if extras:
        st.caption(" · ".join(extras))

    # Who has actually been coaching this athlete — the reporting dimension the
    # two author columns exist for.
    coaches: dict[str, int] = {}
    for session in sessions:
        who = fmt.author_of(names, session.get("credited_to") or session.get("logged_by"))
        if who:
            coaches[who] = coaches.get(who, 0) + 1
    if coaches:
        ordered = sorted(coaches.items(), key=lambda kv: (-kv[1], kv[0]))
        st.caption("Προπονητές: " + " · ".join(f"{who} ({n})" for who, n in ordered))


def _volume_chart(
    sessions: list[dict[str, Any]],
    blocks: list[dict[str, Any]],
    sets: list[dict[str, Any]],
) -> None:
    by_block = {b["id"]: b for b in blocks}
    per_session: dict[str, list[dict[str, Any]]] = {}
    for row in _performed(sets):
        block = by_block.get(row.get("block_id") or "")
        if block:
            per_session.setdefault(block["session_id"], []).append(row)

    points = []
    for session in sessions:
        rows = per_session.get(session["id"]) or []
        volume = _volume(rows)
        if volume <= 0:
            # A session of nothing but cardio has no kilos in it. Plotting a
            # zero would read as a bad day rather than a different kind of day.
            continue
        # A real instant on the axis, not the Greek day label: a text axis is
        # sorted alphabetically, so «1 Σεπ, 12 Σεπ, 2 Οκτ, 28 Αυγ» was the order
        # the line was drawn in, and the trend the coach read was scrambled.
        # The instant rather than the day also keeps two workouts on one day
        # as two points.
        when = fmt.parse_instant(session.get("started_at"))
        if when is None:
            day = fmt.parse_local_date(session.get("local_date"))
            if day is None:
                continue
            when = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
        points.append({"Ημέρα": when, "Κιλά": round(volume)})

    if len(points) < 2:
        st.caption("Χρειάζονται τουλάχιστον δύο προπονήσεις με κιλά για γραμμή.")
        return

    st.line_chart(points[-_MAX_POINTS:], x="Ημέρα", y="Κιλά", height=240)
    st.caption("Κιλά ανά προπόνηση: φορτίο × επαναλήψεις, μόνο για ασκήσεις με βάρος.")


def _muscle_share(
    blocks: list[dict[str, Any]],
    sets: list[dict[str, Any]],
    exercises: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    links: list[dict[str, Any]],
) -> None:
    canonical = _canonical(exercises)
    primary: dict[str, str] = {}
    for link in links:
        primary.setdefault(link["exercise_id"], link["muscle_group_id"])
    group_names = {g["id"]: g["name_el"] for g in groups}
    order = {g["id"]: g.get("position") or 0 for g in groups}

    by_block = {b["id"]: b for b in blocks}
    counts: dict[str, int] = {}
    for row in _performed(sets):
        block = by_block.get(row.get("block_id") or "")
        if not block:
            continue
        exercise_id = canonical.get(block.get("exercise_id") or "", block.get("exercise_id") or "")
        group_id = primary.get(exercise_id)
        if not group_id:
            continue
        counts[group_id] = counts.get(group_id, 0) + 1

    if not counts:
        st.caption("Καμία άσκηση δεν είναι ακόμη κατηγοριοποιημένη σε μυϊκή ομάδα.")
        return

    rows = [
        {"Ομάδα": group_names.get(gid, "—"), "Σετ": n}
        for gid, n in sorted(counts.items(), key=lambda kv: order.get(kv[0], 0))
    ]
    st.bar_chart(rows, x="Ομάδα", y="Σετ", height=260)
    st.caption("Σετ ανά κύρια μυϊκή ομάδα — τι δουλεύεται και τι μένει πίσω.")


def _records(
    sessions: list[dict[str, Any]],
    blocks: list[dict[str, Any]],
    sets: list[dict[str, Any]],
    exercises: list[dict[str, Any]],
    names: dict[str, str],
    today: date,
) -> None:
    canonical = _canonical(exercises)
    titles = {e["id"]: fmt.exercise_name(e) for e in exercises}
    default_gear = {e["id"]: str(e.get("equipment") or "") for e in exercises}
    by_session = {s["id"]: s for s in sessions}
    by_block = {b["id"]: b for b in blocks}

    # (exercise, όργανο) -> every performed set, remembered with the session it
    # came from so the number can never be shown without its date and author.
    # The implement is part of the key: one row per movement merged barbell
    # and dumbbell presses into one «Καλύτερο», and a coach at the dumbbell
    # rack read 80 kg as the athlete's dumbbell best — the misread 008 moved
    # equipment onto the block to prevent. NULL on the block means "as the
    # exercise says", the same resolution the log screen makes.
    grouped: dict[tuple[str, str], list[tuple[dict[str, Any], dict[str, Any]]]] = {}
    for row in _performed(sets):
        block = by_block.get(row.get("block_id") or "")
        if not block:
            continue
        session = by_session.get(block.get("session_id") or "")
        if not session:
            continue
        raw_id = block.get("exercise_id") or ""
        key = (
            canonical.get(raw_id, raw_id),
            str(block.get("equipment") or default_gear.get(raw_id, "")),
        )
        grouped.setdefault(key, []).append((row, session))

    if not grouped:
        st.caption("Καμία καταγεγραμμένη επίδοση ακόμη.")
        return

    lines = []
    for (exercise_id, gear), pairs in grouped.items():
        rows = [r for r, _ in pairs]
        kind = fmt.dominant_kind(rows)
        best = fmt.top_set([r for r in rows if r.get("kind") == kind], kind)
        if best is None:
            continue
        session = next(s for r, s in pairs if r["id"] == best["id"])
        day = fmt.parse_local_date(session.get("local_date"))
        who = fmt.author_of(names, session.get("credited_to") or session.get("logged_by"))
        title = titles.get(exercise_id, "—")
        gear_label = EQUIPMENT_LABELS.get(gear, "")
        lines.append(
            {
                "Άσκηση": f"{title} · {gear_label}" if gear_label else title,
                "Καλύτερο": fmt.format_set(best, kind),
                "Πότε": fmt.format_day(day, today) if day else "—",
                "Ποιος": who or "—",
                "Σετ": len(rows),
            }
        )

    lines.sort(key=lambda r: (-r["Σετ"], r["Άσκηση"]))
    st.dataframe(lines, hide_index=True)
    st.caption("Κάθε επίδοση με την ημερομηνία και τον προπονητή που την έγραψε.")


def render() -> None:
    st.header("Πρόοδος")

    gym_id = db.gym_id()
    if not gym_id:
        st.info("Ο λογαριασμός σου δεν ανήκει ακόμη σε γυμναστήριο.")
        return

    try:
        athletes = _athletes(gym_id)
    except Exception as exc:
        st.error("Οι αθλητές δεν φορτώθηκαν.")
        st.caption(str(exc))
        return

    if not athletes:
        st.info("Πρόσθεσε πρώτα έναν αθλητή από την οθόνη Αθλητές.")
        return

    by_id = {a["id"]: a for a in athletes}
    # Whoever is open on the other screens is who this one opens on, so moving
    # between them is not a re-selection every time.
    opened = (st.session_state.get("athlete") or {}).get("id")
    default = list(by_id).index(opened) if opened in by_id else 0
    athlete_id = st.selectbox(
        "Αθλητής", options=list(by_id), format_func=lambda i: by_id[i]["full_name"], index=default
    )

    try:
        data = _history(gym_id, athlete_id)
    except Exception as exc:
        st.error("Το ιστορικό δεν φορτώθηκε.")
        st.caption(str(exc))
        return

    sessions = data["sessions"]
    if not sessions:
        st.info("Καμία προπόνηση ακόμη για αυτόν τον αθλητή.")
        return

    names = gym.names_or_empty(gym_id)
    today = gym.today(gym_id)

    _summary(sessions, data["sets"], names)
    st.divider()

    st.subheader("Όγκος")
    _volume_chart(sessions, data["blocks"], data["sets"])

    st.subheader("Κατανομή")
    _muscle_share(data["blocks"], data["sets"], data["exercises"], data["groups"], data["links"])

    st.subheader("Επιδόσεις")
    _records(sessions, data["blocks"], data["sets"], data["exercises"], names, today)
