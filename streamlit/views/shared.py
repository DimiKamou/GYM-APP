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
    st.subheader("Πρόοδος κιλών")
    pick = st.selectbox("Άσκηση", options=sorted(shown, key=fmt.fold), key="shared_exercise")
    points = shown[pick]
    st.line_chart({"κιλά": [points[d] for d in sorted(points)]}, x_label="προπονήσεις", y_label="kg")
    st.caption(" · ".join(f"{fmt.format_day(fmt.parse_local_date(d) or date.today(), date.today())}: "
                          f"{fmt.format_weight(points[d])} kg" for d in sorted(points)[-6:]))


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

    month_ago = today - timedelta(days=30)
    recent = [w for w in workouts if (fmt.parse_local_date(w["session"].get("local_date")) or date.min) >= month_ago]
    st.markdown(f"**{len(recent)}** προπονήσεις τις τελευταίες 30 μέρες · **{len(workouts)}** συνολικά")

    stored = st.session_state.get(_MONTH_KEY) or (today.year, today.month)
    year, month = stored
    row = st.container(horizontal=True, vertical_alignment="center", wrap=False)
    if row.button("‹", key="shared_back", width=48):
        st.session_state[_MONTH_KEY] = (year - (month == 1), 12 if month == 1 else month - 1)
        st.rerun()
    row.markdown(f"**{recap.MONTHS_FULL_EL[month - 1]} {year}**", width="stretch", text_alignment="center")
    if row.button("›", key="shared_forward", width=48, disabled=(year, month) >= (today.year, today.month)):
        st.session_state[_MONTH_KEY] = (year + (month == 12), 1 if month == 12 else month + 1)
        st.rerun()
    in_month = [w for w in workouts if (fmt.parse_local_date(w["session"].get("local_date")) or date.min)
                .replace(day=1) == date(year, month, 1)]
    history.month_grid(in_month, year, month, names, today, "shared_month")

    _progress_chart(workouts)

    st.subheader("Τελευταίες προπονήσεις")
    if not workouts:
        st.info("Καμία προπόνηση ακόμα.")
    for n, workout in enumerate(workouts[:_SHOWN]):
        history.workout_box(workout, names, today, f"shared_box_{n}")
