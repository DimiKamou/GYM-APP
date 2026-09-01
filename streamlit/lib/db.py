"""Supabase access for the Streamlit client — one client per browser session.

The client built here carries the ANON key plus the signed-in trainer's JWT, so
every statement it sends is evaluated by the row-level security policies in
`supabase/migrations/001_init.sql`. The `service_role` key belongs to
`lib/admin.py`, touches `auth.users` only, and must never reach this module.

Nothing here is cached with `@st.cache_resource`: that cache holds one object for
the whole server process, and the object would be carrying a trainer's JWT when
the next visitor arrived. Identity lives in `st.session_state`, which is per
browser session, and nowhere else.
"""

from __future__ import annotations

import os
from typing import Any

import streamlit as st
from supabase import Client, create_client

try:  # ClientOptions sits at the package root in supabase 2.x
    from supabase import ClientOptions
except ImportError:  # older layout
    from supabase.lib.client_options import ClientOptions


# st.session_state keys. Public so that lib/auth.py can drop them on sign-out
# without a second function for every one of them.
CLIENT_KEY = "_supabase_client"
ACCESS_KEY = "_auth_access_token"
REFRESH_KEY = "_auth_refresh_token"
USER_ID_KEY = "_auth_user_id"
ME_KEY = "_membership"
# Set when the membership lookup failed rather than returned nothing. The two
# are different screens: "no gym yet" is onboarding, "lookup failed" is a retry.
LOAD_ERROR_KEY = "_membership_error"

_MEMBERSHIP_COLUMNS = "id, gym_id, user_id, display_name, email, role, status"


def config(name: str, default: str | None = None) -> str | None:
    """Read one deployment setting from st.secrets, or the environment.

    `st.secrets` raises when there is no secrets file at all — the membership
    test raises too, not just the lookup — so every touch of it is guarded.
    """
    try:
        if name in st.secrets:
            return str(st.secrets[name])
        section = st.secrets["supabase"] if "supabase" in st.secrets else None
        if section is not None:
            for candidate in (name, name.lower()):
                if candidate in section:
                    return str(section[candidate])
    except Exception:
        pass
    value = os.environ.get(name)
    return value if value else default


def _attach(target: Client) -> None:
    """Put the stored JWT on a client that does not have it yet.

    Both calls are needed. `postgrest` is a separate client that does not read
    the auth session on its own, so without the second line every query leaves
    as anon, `app.my_gym()` is null, and the app looks EMPTY rather than broken.
    """
    access = st.session_state.get(ACCESS_KEY)
    if not access:
        return
    try:
        target.auth.set_session(access, st.session_state.get(REFRESH_KEY) or "")
    except Exception:
        # An access token the auth client refuses to adopt (expired, and the
        # refresh it attempts fails) must not stop the token we do have from
        # reaching PostgREST; lib/auth.py refreshes on its own schedule.
        pass
    target.postgrest.auth(access)


def client() -> Client:
    """The caller's own Supabase client, anon key, with their JWT attached."""
    existing = st.session_state.get(CLIENT_KEY)
    if existing is not None:
        return existing

    url = config("SUPABASE_URL")
    key = config("SUPABASE_ANON_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_ANON_KEY are not configured")

    # persist_session/auto_refresh_token are the library's browser conveniences:
    # they would write this trainer's tokens into process-wide storage and spawn
    # a background refresh thread per visitor. Tokens are held in session_state
    # and refreshed by lib/auth.py instead.
    created = create_client(
        url,
        key,
        ClientOptions(persist_session=False, auto_refresh_token=False),
    )
    st.session_state[CLIENT_KEY] = created
    _attach(created)
    return created


def attach_session(
    access_token: str | None,
    refresh_token: str | None,
    user_id_value: str | None = None,
) -> None:
    """Remember a freshly minted session and put it on the live client."""
    if not access_token:
        return
    st.session_state[ACCESS_KEY] = access_token
    st.session_state[REFRESH_KEY] = refresh_token or ""
    if user_id_value:
        st.session_state[USER_ID_KEY] = str(user_id_value)
    _attach(client())


def forget_session() -> None:
    """Drop the client and everything that identified it."""
    for key in (CLIENT_KEY, ACCESS_KEY, REFRESH_KEY, USER_ID_KEY):
        st.session_state.pop(key, None)
    clear_identity()


def user_id() -> str | None:
    """The signed-in `auth.users` id, or None when nobody is signed in."""
    cached = st.session_state.get(USER_ID_KEY)
    if cached:
        return str(cached)

    access = st.session_state.get(ACCESS_KEY)
    if not access:
        return None

    # Only reached when a session was attached without a user object on it; the
    # sign-in and refresh paths both carry one, so this costs no round trip in
    # the normal case.
    try:
        response = client().auth.get_user(access)
    except Exception:
        return None
    resolved = getattr(getattr(response, "user", None), "id", None)
    if not resolved:
        return None
    st.session_state[USER_ID_KEY] = str(resolved)
    return str(resolved)


def me() -> dict[str, Any]:
    """The caller's own membership row, or {} when they have none yet.

    An empty dict is a legitimate answer, not a failure: an account created by
    hand in the Supabase dashboard has no membership until `bootstrap_gym()`
    runs, and that is the onboarding screen. A lookup that actually failed sets
    LOAD_ERROR_KEY and is not cached, so the caller can tell the two apart and
    the next rerun tries again.
    """
    cached = st.session_state.get(ME_KEY)
    if cached is not None:
        return dict(cached)

    uid = user_id()
    if not uid:
        return {}

    try:
        rows = (
            client()
            .table("memberships")
            .select(_MEMBERSHIP_COLUMNS)
            # RLS narrows this to the caller's gym, but the gym roster is
            # deliberately visible to the whole gym — so the user filter is what
            # makes it *mine*. Same predicate and same order as
            # app.my_membership(), so this row is the one every trigger and
            # policy in the schema will stamp writes with.
            .eq("user_id", uid)
            .eq("status", "active")
            .is_("deleted_at", "null")
            .order("created_at")
            .order("id")
            .limit(1)
            .execute()
            .data
        ) or []
    except Exception as exc:
        st.session_state[LOAD_ERROR_KEY] = str(exc)
        return {}

    st.session_state.pop(LOAD_ERROR_KEY, None)
    row = dict(rows[0]) if rows else {}
    st.session_state[ME_KEY] = row
    return dict(row)


def gym_id() -> str | None:
    value = me().get("gym_id")
    return str(value) if value else None


def is_owner() -> bool:
    return me().get("role") == "owner"


def clear_identity() -> None:
    """Forget the cached membership, after bootstrap or a role change."""
    st.session_state.pop(ME_KEY, None)
    st.session_state.pop(LOAD_ERROR_KEY, None)
