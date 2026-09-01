"""The one screen convention three view modules each invented for themselves.

A write on this app ends in `st.rerun()`, which throws the current script away —
so a message about what just happened cannot be drawn where it happened. It is
queued under a per-screen key and drawn at the top of the next run, by which time
the roster or the set list already shows the change it is describing.
"""

from __future__ import annotations

import streamlit as st


def notice(key: str, kind: str, message: str) -> None:
    """Queue a message for the top of the next run. kind is "ok" or "error"."""
    st.session_state[key] = (kind, message)


def flush_notice(key: str) -> None:
    """Draw and consume whatever the previous run queued. Once, then gone."""
    queued = st.session_state.pop(key, None)
    if not queued:
        return
    kind, message = queued
    if kind == "ok":
        st.success(message)
    else:
        st.error(message)
