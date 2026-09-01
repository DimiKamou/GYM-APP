"""Πρόγραμμα — one week of appointments, and the button that turns one into a log.

A PT gym's week is the product: who is coming, when, and with whom. The screen
is a week rather than a month because a month of empty cells is a wall chart,
and the question a trainer actually asks at 06:50 is "who is next".

The slot and the workout are separate rows on purpose. An appointment is an
intention and a session is what happened, and the two disagree often enough —
somebody cancels, somebody walks in — that collapsing them would make the
history a record of the schedule instead of a record of the training. «Ξεκίνα
προπόνηση» is what links them: it opens a session and writes its id back onto
the slot, so the slot can say what became of it.
"""

from __future__ import annotations

from datetime import date, time, timedelta
from typing import Any

import streamlit as st

from lib import db, fmt, gym, ui

_NOTICE = "calendar_notice"
_WEEK_KEY = "calendar_week_start"

_TYPE_LABELS = {
    "personal": "Προσωπική",
    "assessment": "Αξιολόγηση",
    "group": "Ομαδική",
    "program": "Πρόγραμμα",
}
_TYPE_CHOICES = {label: value for value, label in _TYPE_LABELS.items()}

_STATUS_LABELS = {"scheduled": "Προγραμματισμένη", "done": "Έγινε"}

_DAY_NAMES = ("Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο", "Κυριακή")

# The hours a gym is actually open. A free-text time box invites "8" and "8μμ";
# a fixed grid cannot be typed wrong and is faster on a phone.
_SLOT_TIMES = tuple(f"{hour:02d}:{minute:02d}" for hour in range(6, 23) for minute in (0, 30))
_DURATIONS = (30, 45, 60, 75, 90, 120)


# ---------------------------------------------------------------------------
# Reads. gym_id first everywhere: st.cache_data is global to the server process,
# so a hit is served without ever reaching a policy.
# ---------------------------------------------------------------------------

@st.cache_data(ttl=30, show_spinner=False)
def _appointments(gym_id: str, first: date, last: date) -> list[dict[str, Any]]:
    return (
        db.client()
        .table("appointments")
        .select("id, athlete_id, membership_id, date, time, duration_min, type, notes, status, session_id")
        .eq("gym_id", gym_id)
        .gte("date", first.isoformat())
        .lte("date", last.isoformat())
        .is_("deleted_at", "null")
        .order("date")
        .order("time")
        .order("id")
        .execute()
        .data
        or []
    )


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


def _clear() -> None:
    _appointments.clear()


# ---------------------------------------------------------------------------
# Week arithmetic
# ---------------------------------------------------------------------------

def _monday_of(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _week_start(gym_id: str) -> date:
    """The Monday on screen. Anchored to the gym's day, never the server's."""
    stored = st.session_state.get(_WEEK_KEY)
    if isinstance(stored, date):
        return stored
    start = _monday_of(gym.today(gym_id))
    st.session_state[_WEEK_KEY] = start
    return start


def _shift_week(days: int) -> None:
    current = st.session_state.get(_WEEK_KEY)
    if isinstance(current, date):
        st.session_state[_WEEK_KEY] = current + timedelta(days=days)


def _week_label(first: date, last: date) -> str:
    if first.month == last.month:
        return f"{first.day}–{last.day} {fmt.format_day(last, last).split(' ', 1)[-1]}"
    return f"{fmt.format_day(first, first)} – {fmt.format_day(last, last)}"


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------

def _start_session(appointment: dict[str, Any], athlete: dict[str, Any]) -> None:
    """Open a workout from the slot and hand the Log screen the athlete.

    Only gym_id and athlete_id are sent: logged_by and local_date are stamped by
    triggers from the JWT and the gym's timezone, and sending them from here
    would be a claim rather than a fact.
    """
    client = db.client()
    gym_id = db.gym_id()
    session = (
        client.table("sessions")
        .insert({"gym_id": gym_id, "athlete_id": appointment["athlete_id"]})
        .execute()
        .data[0]
    )
    # The slot now knows what became of it. Marked done in the same breath,
    # because a trainer who has started the workout will not come back here.
    client.table("appointments").update(
        {"session_id": session["id"], "status": "done"}
    ).eq("id", appointment["id"]).execute()

    _clear()
    st.session_state["athlete"] = athlete
    st.session_state["session_id"] = session["id"]
    pages = st.session_state.get("pages") or {}
    if "log" in pages:
        st.switch_page(pages["log"])


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def _slot_card(
    appointment: dict[str, Any],
    athletes: dict[str, dict[str, Any]],
    names: dict[str, str],
) -> None:
    athlete = athletes.get(appointment.get("athlete_id") or "")
    who = (athlete or {}).get("full_name") or "—"
    clock = str(appointment.get("time") or "")[:5]
    kind = _TYPE_LABELS.get(appointment.get("type") or "", appointment.get("type") or "")
    coach = fmt.author_of(names, appointment.get("membership_id"))
    done = (appointment.get("status") or "") == "done"

    with st.container(border=True):
        head = f"**{clock}** · {fmt.md(who)}"
        if done:
            head += " · ✅"
        st.markdown(head)
        line = kind
        if coach:
            line += f" · {coach}"
        if appointment.get("duration_min"):
            line += f" · {appointment['duration_min']}′"
        st.caption(line)
        if appointment.get("notes"):
            st.caption(fmt.md(appointment["notes"]))

        if done and appointment.get("session_id"):
            st.caption("Η προπόνηση καταγράφηκε.")
            return
        if athlete is None:
            st.caption("Ο αθλητής δεν βρέθηκε.")
            return

        left, right = st.columns(2)
        if left.button("Ξεκίνα προπόνηση", key=f"go-{appointment['id']}", type="primary"):
            _start_session(appointment, athlete)
        if right.button("Ακύρωση", key=f"del-{appointment['id']}"):
            # Soft delete: nothing in this schema is ever removed, and a
            # cancelled slot is part of the week's history.
            db.client().table("appointments").update({"deleted_at": "now()"}).eq(
                "id", appointment["id"]
            ).execute()
            _clear()
            ui.notice(_NOTICE, "ok", f"Το ραντεβού των {clock} ακυρώθηκε.")
            st.rerun()


def _new_appointment_form(gym_id: str, athletes: list[dict[str, Any]], default_day: date) -> None:
    if not athletes:
        st.info("Πρόσθεσε πρώτα έναν αθλητή από την οθόνη Αθλητές.")
        return

    with st.expander("Νέο ραντεβού"):
        # One form, one round trip: every widget here is typed or picked, and
        # widgets outside a form re-run the whole script on each interaction.
        with st.form("calendar_new", clear_on_submit=True):
            by_id = {a["id"]: a for a in athletes}
            athlete_id = st.selectbox(
                "Αθλητής",
                options=list(by_id),
                format_func=lambda i: by_id[i]["full_name"],
                index=None,
                placeholder="Διάλεξε αθλητή",
            )
            day = st.date_input("Ημέρα", value=default_day, format="DD/MM/YYYY")
            clock = st.selectbox("Ώρα", options=_SLOT_TIMES, index=_SLOT_TIMES.index("18:00"))
            duration = st.selectbox("Διάρκεια", options=_DURATIONS, index=_DURATIONS.index(60))
            kind_label = st.selectbox("Είδος", options=list(_TYPE_CHOICES))
            notes = st.text_input("Σημείωση", max_chars=200, placeholder="Προαιρετικά")
            submitted = st.form_submit_button("Καταχώρηση", type="primary")

        if not submitted:
            return
        if not athlete_id:
            st.error("Διάλεξε αθλητή.")
            return

        payload = {
            "gym_id": gym_id,
            "athlete_id": athlete_id,
            # The slot belongs to whoever books it until somebody says otherwise.
            "membership_id": (db.me() or {}).get("id"),
            "date": day.isoformat() if isinstance(day, date) else str(day),
            "time": clock,
            "duration_min": int(duration),
            "type": _TYPE_CHOICES[kind_label],
        }
        if notes.strip():
            payload["notes"] = notes.strip()

        try:
            db.client().table("appointments").insert(payload).execute()
        except Exception as exc:
            st.error(f"Το ραντεβού δεν καταχωρήθηκε: {exc}")
            return

        _clear()
        ui.notice(
            _NOTICE,
            "ok",
            f"{by_id[athlete_id]['full_name']} · {fmt.format_day(day, day)} στις {clock}.",
        )
        st.rerun()


def render() -> None:
    st.header("Πρόγραμμα")

    gym_id = db.gym_id()
    if not gym_id:
        st.info("Ο λογαριασμός σου δεν ανήκει ακόμη σε γυμναστήριο.")
        return

    ui.flush_notice(_NOTICE)

    first = _week_start(gym_id)
    last = first + timedelta(days=6)
    today = gym.today(gym_id)

    back, label, forward = st.columns([1, 3, 1])
    if back.button("‹", key="week_back", help="Προηγούμενη εβδομάδα"):
        _shift_week(-7)
        st.rerun()
    label.markdown(f"### {_week_label(first, last)}")
    if forward.button("›", key="week_forward", help="Επόμενη εβδομάδα"):
        _shift_week(7)
        st.rerun()

    if first != _monday_of(today) and st.button("Αυτή την εβδομάδα"):
        st.session_state[_WEEK_KEY] = _monday_of(today)
        st.rerun()

    try:
        slots = _appointments(gym_id, first, last)
        athletes = _athletes(gym_id)
    except Exception as exc:
        st.error("Το πρόγραμμα δεν φορτώθηκε.")
        st.caption(str(exc))
        return

    by_athlete = {a["id"]: a for a in athletes}
    names = gym.names_or_empty(gym_id)

    by_day: dict[str, list[dict[str, Any]]] = {}
    for slot in slots:
        by_day.setdefault(str(slot.get("date") or ""), []).append(slot)

    for offset in range(7):
        day = first + timedelta(days=offset)
        rows = by_day.get(day.isoformat(), [])
        heading = f"{_DAY_NAMES[offset]} {day.day}/{day.month}"
        if day == today:
            heading += " · σήμερα"
        st.subheader(heading)
        if not rows:
            st.caption("Κενή μέρα.")
            continue
        for slot in rows:
            _slot_card(slot, by_athlete, names)

    st.divider()
    _new_appointment_form(gym_id, athletes, today if today >= first else first)
