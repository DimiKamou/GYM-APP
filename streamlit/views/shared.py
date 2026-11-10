"""The page a shared link opens: one athlete's progress, read-only, no sign-in.

Everything on it comes from one call, public.shared_progress(token) (013), so
this page can show nothing the function did not choose to return. It reuses
the same workout box and calendar as the coach's screens, so a parent reads
the workout exactly as the coach wrote it — date and author on every line.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import streamlit as st

from lib import fmt, history, recap, share
from lib.exercises import implement_of

_MONTH_KEY = "shared_month"
_SHOWN = 12


def _workouts(data: dict[str, Any]) -> list[dict[str, Any]]:
    """The function's flat lists, as the workout dicts history.workout_box draws. Newest first."""
    exercises = {str(e["id"]): e for e in data.get("exercises") or []}
    groups = recap.primary_groups(data.get("links") or [], data.get("groups") or [])
    group_names = recap.group_names(data.get("groups") or [])
    blocks = data.get("blocks") or []
    sets = recap.performed(data.get("sets") or [])
    out = []
    for session in data.get("sessions") or []:
        own = [b for b in blocks if str(b.get("session_id")) == str(session["id"])]
        ids = {str(b["id"]) for b in own}
        done = [s for s in sets if str(s.get("block_id")) in ids]
        if not done:
            continue
        out.append({"session": session, "blocks": own, "sets": done, "exercises": exercises,
                    "groups": groups, "group_names": group_names})
    out.sort(key=lambda w: (str(w["session"].get("local_date") or ""), str(w["session"].get("started_at") or "")),
             reverse=True)
    return out


def _progress_chart(workouts: list[dict[str, Any]]) -> None:
    """The heaviest set of each exercise, workout by workout, for the ones done more than once."""
    series: dict[str, dict[str, float]] = {}
    for workout in workouts:
        day = str(workout["session"].get("local_date") or "")
        exercises = workout["exercises"]
        for block in workout["blocks"]:
            rows = [s for s in workout["sets"] if str(s.get("block_id")) == str(block["id"])
                    and s.get("kind") == "weight_reps"]
            loads = [fmt.decimal(r.get("load_kg")) or 0.0 for r in rows]
            if not loads:
                continue
            exercise = exercises.get(str(block.get("exercise_id")))
            target = str((exercise or {}).get("merged_into_id") or "")
            if target in exercises:
                exercise = exercises[target]
            from lib.exercises import EQUIPMENT_LABELS

            gear = EQUIPMENT_LABELS.get(implement_of(exercise, str(block.get("equipment") or "")), "")
            name = fmt.exercise_name(exercise) + (f" · {gear}" if gear else "")
            points = series.setdefault(name, {})
            points[day] = max(points.get(day, 0.0), max(loads))
    shown = {name: points for name, points in series.items() if len(points) >= 2}
    if not shown:
        return
    st.markdown("**Κιλά ανά άσκηση**")
    pick = st.selectbox("Άσκηση", options=sorted(shown, key=fmt.fold), key="shared_exercise")
    points = shown[pick]
    st.line_chart({"κιλά": [points[d] for d in sorted(points)]}, x_label="προπονήσεις", y_label="kg")
    st.caption(" · ".join(f"{fmt.format_day(fmt.parse_local_date(d) or date.today(), date.today())}: "
                          f"{fmt.format_weight(points[d])} kg" for d in sorted(points)[-6:]))


def _flat(data: dict[str, Any]) -> tuple[list, list, list, list, list, list]:
    """The function's lists as Πρόοδος reads them, sessions oldest first, primary links only."""
    sessions = sorted(data.get("sessions") or [],
                      key=lambda x: (str(x.get("local_date") or ""), str(x.get("started_at") or "")))
    blocks = data.get("blocks") or []
    sets = recap.performed(data.get("sets") or [])
    exercises = data.get("exercises") or []
    groups = data.get("groups") or []
    links = [link for link in data.get("links") or [] if link.get("role") == "primary"]
    return sessions, blocks, sets, exercises, groups, links


def _weekly_volume(sessions: list, blocks: list, sets: list) -> None:
    """Kilos moved per calendar week: the line a parent can read at a glance."""
    from views import progress

    week_of = {}
    for session in sessions:
        day = fmt.parse_local_date(session.get("local_date"))
        if day:
            week_of[session["id"]] = day - timedelta(days=day.weekday())
    by_block = {b["id"]: b for b in blocks}
    weeks: dict[date, list] = {}
    for row in sets:
        block = by_block.get(row.get("block_id"))
        week = week_of.get((block or {}).get("session_id"))
        if week:
            weeks.setdefault(week, []).append(row)
    points = [{"Εβδομάδα": week, "Κιλά": round(progress._volume(rows))}
              for week, rows in sorted(weeks.items()) if progress._volume(rows) > 0]
    if len(points) < 2:
        return
    st.bar_chart(points, x="Εβδομάδα", y="Κιλά", height=220)
    st.caption("Όγκος ανά εβδομάδα: κιλά × επαναλήψεις, μόνο ασκήσεις με βάρος.")


def _first_and_last(sessions: list, blocks: list, sets: list, exercises: list, today: date) -> None:
    """Per exercise and tool: the heaviest set of the first and of the latest workout, and the change."""
    from views import progress

    canonical = progress._canonical(exercises) if exercises else {}
    by_id = {e["id"]: e for e in exercises}
    order = {s["id"]: n for n, s in enumerate(sessions)}
    day_of = {s["id"]: fmt.parse_local_date(s.get("local_date")) for s in sessions}
    by_block = {b["id"]: b for b in blocks}
    grouped: dict[tuple[str, str], dict[str, list]] = {}
    for row in sets:
        block = by_block.get(row.get("block_id"))
        if not block or block.get("session_id") not in order:
            continue
        raw = block.get("exercise_id") or ""
        exercise_id = canonical.get(raw, raw)
        gear = implement_of(by_id.get(raw), str(block.get("equipment") or ""))
        grouped.setdefault((exercise_id, gear), {}).setdefault(block["session_id"], []).append(row)

    from lib.exercises import EQUIPMENT_LABELS

    lines = []
    for (exercise_id, gear), per_session in grouped.items():
        ordered = sorted(per_session, key=lambda sid: order[sid])
        rows = [r for sid in ordered for r in per_session[sid]]
        kind = fmt.dominant_kind(rows)
        first = fmt.top_set([r for r in per_session[ordered[0]] if r.get("kind") == kind], kind)
        last = fmt.top_set([r for r in per_session[ordered[-1]] if r.get("kind") == kind], kind)
        if not first or not last:
            continue
        change = "—"
        if kind in ("weight_reps", "bodyweight") and len(ordered) > 1:
            delta = (fmt.decimal(last.get("load_kg")) or 0) - (fmt.decimal(first.get("load_kg")) or 0)
            change = f"{'+' if delta > 0 else ''}{fmt.format_weight(delta)} kg" if delta else "ίδια κιλά"
        elif kind == "duration" and len(ordered) > 1:
            delta = (fmt.integer(last.get("seconds")) or 0) - (fmt.integer(first.get("seconds")) or 0)
            change = f"{'+' if delta > 0 else ''}{delta} δευτ." if delta else "ίδιος χρόνος"
        name = fmt.exercise_name(by_id.get(exercise_id))
        label = EQUIPMENT_LABELS.get(gear, "")
        first_day, last_day = day_of.get(ordered[0]), day_of.get(ordered[-1])
        lines.append({
            "Άσκηση": f"{name} · {label}" if label else name,
            "Πρώτη": f"{fmt.format_set(first, kind)} · {fmt.format_day(first_day, today) if first_day else '—'}",
            "Τελευταία": f"{fmt.format_set(last, kind)} · {fmt.format_day(last_day, today) if last_day else '—'}",
            "Αλλαγή": change,
            "Όγκος (kg)": round(progress._volume(rows)),
            "Φορές": len(ordered),
        })
    if not lines:
        return
    lines.sort(key=lambda r: (-r["Φορές"], r["Άσκηση"]))
    st.dataframe(lines, hide_index=True)
    st.caption("Το βαρύτερο σετ της πρώτης και της τελευταίας φοράς στην περίοδο, ανά άσκηση και όργανο.")


def _progress_section(data: dict[str, Any], names: dict[str, str], today: date) -> None:
    """The same numbers the coach's Πρόοδος shows, for the period of the link."""
    from views import progress

    sessions, blocks, sets, exercises, groups, links = _flat(data)
    trained = [s for s in sessions if any(
        b.get("session_id") == s["id"] and any(r.get("block_id") == b["id"] for r in sets) for b in blocks)]
    if not trained:
        return
    st.subheader("Πρόοδος")
    progress._summary(trained, sets, names)
    st.markdown("**Όγκος ανά προπόνηση**")
    progress._volume_chart(trained, blocks, sets)
    _weekly_volume(trained, blocks, sets)
    st.markdown("**Ανά μυϊκή ομάδα**")
    progress._muscle_share(blocks, sets, exercises, groups, links)
    st.markdown("**Ανά άσκηση: από την πρώτη στην τελευταία φορά**")
    _first_and_last(trained, blocks, sets, exercises, today)
    st.markdown("**Καλύτερα σετ**")
    progress._records(trained, blocks, sets, exercises, names, today)


def render(token: str) -> None:
    try:
        data = share.fetch(token)
    except Exception as exc:
        st.title("TrainHub")
        st.error("Η πρόοδος δεν φορτώθηκε. Δοκίμασε ξανά σε λίγο.")
        st.caption(str(exc)[:200])
        return
    if not data:
        st.title("TrainHub")
        st.info("Ο σύνδεσμος δεν ισχύει πια. Ζήτα καινούργιο από τον προπονητή σου.")
        return

    names = {str(m["id"]): str(m.get("display_name") or "") for m in data.get("members") or []}
    workouts = _workouts(data)
    today = date.today()

    st.title(str(data.get("athlete") or ""))
    st.caption(f"{data.get('gym') or ''} · μόνο για ανάγνωση")

    # The period is the database's answer (014): the page only says it.
    first = fmt.parse_local_date(data.get("from"))
    last = fmt.parse_local_date(data.get("to")) or today
    if first:
        span = share.period_text(data, today) if data.get("period_days") else (
            f"{fmt.format_day(first, today)} – {fmt.format_day(last, today)}")
        st.markdown(f"Περίοδος: **{fmt.md(span)}** · **{len(workouts)}** προπονήσεις")
    else:
        month_ago = today - timedelta(days=30)
        recent = [w for w in workouts
                  if (fmt.parse_local_date(w["session"].get("local_date")) or date.min) >= month_ago]
        st.markdown(f"**{len(recent)}** προπονήσεις τις τελευταίες 30 μέρες · **{len(workouts)}** συνολικά")

    # Opens on the period's last month and never leaves the period.
    stored = st.session_state.get(_MONTH_KEY) or (last.year, last.month)
    year, month = stored
    earliest = (first.year, first.month) if first else (1900, 1)
    latest = (last.year, last.month)
    row = st.container(horizontal=True, vertical_alignment="center", wrap=False)
    if row.button("‹", key="shared_back", width=48, disabled=(year, month) <= earliest):
        st.session_state[_MONTH_KEY] = (year - (month == 1), 12 if month == 1 else month - 1)
        st.rerun()
    row.markdown(f"**{recap.MONTHS_FULL_EL[month - 1]} {year}**", width="stretch", text_alignment="center")
    if row.button("›", key="shared_forward", width=48, disabled=(year, month) >= latest):
        st.session_state[_MONTH_KEY] = (year + (month == 12), 1 if month == 12 else month + 1)
        st.rerun()
    in_month = [w for w in workouts if (fmt.parse_local_date(w["session"].get("local_date")) or date.min)
                .replace(day=1) == date(year, month, 1)]
    history.month_grid(in_month, year, month, names, today, "shared_month")

    _progress_section(data, names, today)
    _progress_chart(workouts)

    st.subheader("Τελευταίες προπονήσεις")
    if not workouts:
        st.info("Καμία προπόνηση ακόμα.")
    for n, workout in enumerate(workouts[:_SHOWN]):
        history.workout_box(workout, names, today, f"shared_box_{n}")
