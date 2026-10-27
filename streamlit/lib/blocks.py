"""What a block can say on this database: before 012, or after it.

012 gave a block a superset (`superset_id`) and the muscle group it counted
toward (`muscle_group_id`). The app deploys the moment a change merges and the
gym pastes the SQL later; in between, a select naming either column is refused
outright (42703) and the workout screen goes down with it. So the columns are
asked about once a minute, and until they exist every block is an ordinary one
counted toward its exercise's primary group — exactly as before.
"""

from __future__ import annotations

from typing import Any

import streamlit as st

from lib import db

NEW_COLUMNS = "superset_id, muscle_group_id"


@st.cache_data(ttl=60, show_spinner=False)
def has_012(gym_id: str) -> bool:
    """Do `blocks.superset_id` and `blocks.muscle_group_id` exist? gym_id keys the cache."""
    try:
        db.client().table("blocks").select(NEW_COLUMNS).limit(1).execute()
    except Exception as exc:
        text = str(exc)
        if getattr(exc, "code", None) == "42703" or "does not exist" in text:
            return False
        raise
    return True


def ready(gym_id: str) -> bool:
    """has_012 for code that draws widgets: a probe that failed says "not yet".

    Not "yes", unlike the tool-list probe: a select naming a column that is not
    there is the very failure this module exists to prevent, and an ordinary
    block is always a correct answer.
    """
    try:
        return has_012(gym_id)
    except Exception:
        return False


def columns(gym_id: str, base: str) -> str:
    """`base`, plus the superset and group columns once the database has them."""
    return f"{base}, {NEW_COLUMNS}" if ready(gym_id) else base


def pairs(blocks: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """superset_id -> its blocks, for the supersets that are actually pairs.

    A superset whose partner was removed is an ordinary exercise again: it is
    left out, and drawn on its own.
    """
    grouped: dict[str, list[dict[str, Any]]] = {}
    for block in blocks:
        key = str(block.get("superset_id") or "")
        if key:
            grouped.setdefault(key, []).append(block)
    return {key: rows for key, rows in grouped.items() if len(rows) >= 2}
