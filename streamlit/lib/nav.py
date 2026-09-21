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
