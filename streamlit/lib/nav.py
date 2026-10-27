"""The hand-over between screens: which athlete, which workout, and nothing stale.

Four screens write the same three session_state keys to send a coach to the
Προπόνηση screen, and each of them remembered a different subset of what has to
be cleared on the way. The stop-state the log screen sets after «Τέλος
προπόνησης» was the one they all forgot: a coach who finished a workout, left by
the tab bar, and later opened the same athlete from Αθλητές or Πρόγραμμα was
shown last week's «ολοκληρώθηκε» page instead of the session they had just been
handed — and «Νέα προπόνηση» on that page minted a third session, leaving the
appointment pointing at an empty one forever.

So the hand-over is one function, and so is the sign-out.
"""

from __future__ import annotations

from typing import Any

import streamlit as st

from lib import ui

ATHLETE_KEY = "athlete"
SESSION_KEY = "session_id"
# Owned by views/log.py; named here so the screens that hand an athlete over
# can clear it without importing the whole log screen.
FINISHED_KEY = "log_finished"
LOG_NOTICE_KEY = "log_notice"


def open_workout(session_id: str | None, athlete: dict[str, Any] | None = None) -> None:
    """Point the log screen at `session_id` (None: start a fresh one) for `athlete`.

    `athlete` None keeps whoever is already on the sheet — the Αθλητές screen
    reopens a past workout of the athlete it is showing.
    """
    if athlete is not None:
        st.session_state[ATHLETE_KEY] = athlete
    if session_id:
        st.session_state[SESSION_KEY] = str(session_id)
    else:
        # Whatever workout was open belonged to whoever was on the screen
        # before; inheriting it would append this athlete's sets to another
        # athlete's session.
        st.session_state.pop(SESSION_KEY, None)
    _forget_stop_state()


def leave_workouts() -> None:
    """Sign-out: the next trainer on this tablet inherits nothing."""
    for key in (ATHLETE_KEY, SESSION_KEY):
        st.session_state.pop(key, None)
    _forget_stop_state()


def _forget_stop_state() -> None:
    # The «ολοκληρώθηκε» / «διαγράφηκε» page belongs to the workout it was
    # written for, and so does a pending «Αναίρεση»: an undo offered on athlete
    # A's sheet must not be accepted on athlete B's.
    st.session_state.pop(FINISHED_KEY, None)
    ui.clear_undo(LOG_NOTICE_KEY)


# ---------------------------------------------------------------------------
# Surviving the phone locking
# ---------------------------------------------------------------------------
#
# A locked phone drops the websocket, and a long enough lock starts a NEW
# browser session when it comes back: the sign-in survives (lib/auth.py keeps
# it in a cookie), but st.session_state does not, so the athlete and the open
# workout were gone and the coach landed on «Διάλεξε πρώτα αθλητή» in the
# middle of a set. The page address survives everything, so the athlete and the
# workout ride in it: ?a=<athlete>&w=<workout>.

URL_ATHLETE = "a"
URL_WORKOUT = "w"


def remember(athlete_id: str | None, session_id: str | None = None) -> None:
    """Write what is open into the address — only when it changed."""
    params = st.query_params
    for name, value in ((URL_ATHLETE, athlete_id), (URL_WORKOUT, session_id)):
        if value:
            if params.get(name) != str(value):
                params[name] = str(value)
        elif name in params:
            del params[name]


def recall(gym_id: str) -> None:
    """After a fresh browser session, put back the athlete and workout the address names.

    Read by id under the caller's own policies, so an address from another gym
    names nothing here. Never overrides what this session already has open.
    """
    if isinstance(st.session_state.get(ATHLETE_KEY), dict):
        return
    athlete_id = st.query_params.get(URL_ATHLETE)
    if not athlete_id:
        return
    from lib import db

    try:
        rows = (
            db.client()
            .table("athletes")
            .select("id, full_name, plan_phase, plan_focus, coach_membership_id")
            .eq("gym_id", gym_id)
            .eq("id", str(athlete_id))
            .is_("deleted_at", "null")
            .limit(1)
            .execute()
            .data
            or []
        )
    except Exception:
        return
    if not rows:
        return
    st.session_state[ATHLETE_KEY] = rows[0]
    workout = st.query_params.get(URL_WORKOUT)
    if workout and not st.session_state.get(SESSION_KEY):
        st.session_state[SESSION_KEY] = str(workout)
