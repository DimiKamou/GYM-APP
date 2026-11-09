"""A read-only link to one athlete's progress, for the athlete or a parent.

The link is the app's address with `?share=<token>`. Opening it needs no
sign-in: the page calls public.shared_progress(token) (013), a SECURITY
DEFINER function that returns that athlete's last 400 days and nothing else.
No table is opened to anon, and a revoked token returns nothing.

The token is a v4 UUID minted by the database: unguessable, and one row to
revoke. The coach hands it over as a QR code on their phone screen or by mail.
"""

from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote, urlsplit

import streamlit as st

from lib import db

PARAM = "share"


def base_url() -> str:
    """This app's address, as the browser sees it: where the link has to point."""
    try:
        parts = urlsplit(str(st.context.url or ""))
        if parts.scheme and parts.netloc:
            return f"{parts.scheme}://{parts.netloc}"
    except Exception:
        pass
    return (db.config("APP_URL") or "https://powerhousegym.streamlit.app").rstrip("/")


def link(token: str) -> str:
    return f"{base_url()}/?{PARAM}={token}"


def mail_link(url: str, athlete_name: str) -> str:
    subject = quote(f"Η πρόοδος του/της {athlete_name}")
    body = quote(f"Η πρόοδος στο γυμναστήριο, όλες οι προπονήσεις:\n{url}\n")
    return f"mailto:?subject={subject}&body={body}"


def qr_png(url: str) -> bytes:
    import segno

    out = io.BytesIO()
    segno.make(url, error="m").save(out, kind="png", scale=8, border=2)
    return out.getvalue()


def active(gym_id: str, athlete_id: str) -> dict[str, Any] | None:
    """The athlete's live link, or None. Not cached: it is read only when asked."""
    rows = (
        db.client()
        .table("athlete_shares")
        .select("token, created_at")
        .eq("gym_id", gym_id)
        .eq("athlete_id", athlete_id)
        .is_("revoked_at", "null")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


def create(gym_id: str, athlete_id: str) -> str:
    rows = (
        db.client().table("athlete_shares").insert({"gym_id": gym_id, "athlete_id": athlete_id}).execute().data
        or []
    )
    if not rows or not rows[0].get("token"):
        raise RuntimeError("Ο σύνδεσμος δεν φτιάχτηκε.")
    return str(rows[0]["token"])


def revoke(gym_id: str, token: str) -> None:
    db.client().table("athlete_shares").update(
        {"revoked_at": datetime.now(timezone.utc).isoformat()}
    ).eq("gym_id", gym_id).eq("token", token).execute()


@st.cache_data(ttl=60, show_spinner=False)
def fetch(token: str) -> dict[str, Any] | None:
    """What the shared page shows. Keyed by the token, which is the whole tenant here."""
    response = db.client().rpc("shared_progress", {"p_token": token}).execute()
    data = getattr(response, "data", None)
    if isinstance(data, list):
        data = data[0] if data else None
    return data or None
