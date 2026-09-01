"""The one screen convention three view modules each invented for themselves.

A write on this app ends in `st.rerun()`, which throws the current script away —
so a message about what just happened cannot be drawn where it happened. It is
queued under a per-screen key and drawn at the top of the next run, by which time
the roster or the set list already shows the change it is describing.

The same key carries the other half of that convention: undo. Nothing here is
deleted for real (there is no DELETE policy in the schema), so a delete is a
timestamp and taking it back is clearing one — which is why this app asks
"σίγουρα;" almost nowhere and offers «Αναίρεση» instead. A confirm dialog costs
a tap on every correct deletion to protect against the rare wrong one; undo
costs nothing until something goes wrong.
"""

from __future__ import annotations

from typing import Any, Callable

import streamlit as st

_UNDO = "_undo"


def notice(key: str, kind: str, message: str) -> None:
    """Queue a message for the top of the next run. kind is "ok" or "error"."""
    st.session_state[key] = (kind, message)
    # A new action supersedes the offer to undo the previous one. Without this
    # the «Αναίρεση» button outlives the screen it made sense on and eventually
    # restores something the coach deleted five actions ago.
    st.session_state.pop(key + _UNDO, None)


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


def undoable(key: str, message: str, payload: dict[str, Any]) -> None:
    """Queue "X διαγράφηκε" plus what it would take to bring X back.

    `payload` is plain data — a table name and some ids — and never a closure.
    Streamlit throws the script away on every rerun, so a function captured here
    would be a function from a dead run; the data survives, and the screen
    rebuilds the undo from it.
    """
    st.session_state[key + _UNDO] = (message, dict(payload))
    st.session_state.pop(key, None)


def flush_undo(key: str, restore: Callable[[dict[str, Any]], None]) -> None:
    """Draw the pending delete with the button that takes it back.

    Unlike a notice this is NOT consumed by being drawn: the click that presses
    «Αναίρεση» is itself a rerun, and an offer that erased itself the moment it
    appeared could never be accepted. It goes away when it is used, or when the
    next action replaces it.
    """
    entry = st.session_state.get(key + _UNDO)
    if not entry:
        return
    message, payload = entry
    body, button = st.columns([3, 1])
    body.info(message)
    if button.button("Αναίρεση", key=f"{key}_undo_button"):
        st.session_state.pop(key + _UNDO, None)
        restore(dict(payload))


def clear_undo(key: str) -> None:
    st.session_state.pop(key + _UNDO, None)
