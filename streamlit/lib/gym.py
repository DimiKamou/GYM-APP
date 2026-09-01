"""The two per-gym facts every screen needs: what day it is here, and who wrote that.

Both lookups were written twice, once in `views/athletes.py` and once in
`views/log.py`, and each copy carried its own `@st.cache_data`. That is not
merely wasteful: two caches over the same query expire on different clocks, so a
trainer renamed on the Ομάδα screen could appear under the new name beside a set
and the old one beside a note, on the same phone, at the same moment.

gym_id leads every signature even where the body would not need it. `st.cache_data`
is global to the SERVER PROCESS, so a cache hit is served without a row-level
security policy ever being evaluated again — the tenant has to be part of the key
or the cache is the leak that RLS was there to prevent.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

import streamlit as st

from lib import db, fmt


@st.cache_data(ttl=300, show_spinner=False)
def timezone_of(gym_id: str) -> str:
    """The zone the gym files its days in. Athens when the row says nothing."""
    row = (
        db.client()
        .table("gyms")
        .select("timezone")
        .eq("id", gym_id)
        .limit(1)
        .execute()
        .data
    )
    return (row[0].get("timezone") if row else None) or fmt.DEFAULT_TZ


def zone(gym_id: str) -> Any:
    """The gym's tz object, or None when the platform has no tz database."""
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(timezone_of(gym_id))
    except Exception:
        return None


def today(gym_id: str) -> date:
    """Today in the GYM's zone, not the server's.

    The server runs in Frankfurt or Iowa and the athlete trains in Athens, so a
    set logged at 00:30 would otherwise be dated to yesterday on the very screen
    the coach is standing in front of.
    """
    here = zone(gym_id)
    return datetime.now(here).date() if here is not None else datetime.now(timezone.utc).date()


@st.cache_data(ttl=300, show_spinner=False)
def member_names(gym_id: str) -> dict[str, str]:
    """membership id -> display name, for the whole gym.

    One lookup, cached, rather than a join per note: `memberships_select` makes
    the roster readable to the whole gym precisely so that every id on every
    screen can be rendered as a name. Removed and soft-deleted members are
    included — they wrote history that still has to be attributed to them.
    """
    rows = (
        db.client()
        .table("memberships")
        .select("id, display_name")
        .eq("gym_id", gym_id)
        .execute()
        .data
        or []
    )
    return {row["id"]: (row.get("display_name") or fmt.UNKNOWN_AUTHOR) for row in rows}


def names_or_empty(gym_id: str) -> dict[str, str]:
    """`member_names`, but an unreachable roster is a blank legend, not a blank screen.

    Every caller renders numbers underneath this. `fmt.author_of` falls back to a
    named "unknown member", so losing the lookup costs the names and nothing else.
    """
    try:
        return member_names(gym_id)
    except Exception:
        return {}
