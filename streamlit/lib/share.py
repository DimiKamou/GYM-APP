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
from datetime import date, datetime, timezone
from typing import Any
from urllib.parse import quote, urlsplit

import streamlit as st

from lib import db

PARAM = "share"

# What a link may cover (014). Rolling periods count back from the day the
# link is opened; «Από–έως» is a fixed range.
PERIODS: dict[str, int | None] = {
    "1m": 30, "3m": 91, "6m": 182, "1y": 365, "custom": None,
}
PERIOD_LABELS = {
    "1m": "Μήνας", "3m": "3 μήνες", "6m": "6 μήνες", "1y": "Χρόνος", "custom": "Από–έως",
}
_PERIOD_COLUMNS = "period_days, from_date, to_date"


@st.cache_data(ttl=60, show_spinner=False)
def has_014(gym_id: str) -> bool:
    """Can a link carry a period yet? gym_id keys the cache."""
    try:
        db.client().table("athlete_shares").select(_PERIOD_COLUMNS).limit(1).execute()
    except Exception as exc:
        text = str(exc)
        if getattr(exc, "code", None) in ("42703", "42P01", "PGRST205") or "does not exist" in text \
                or "schema cache" in text:
            return False
        raise
    return True


def periods_ready(gym_id: str) -> bool:
    try:
        return has_014(gym_id)
    except Exception:
        return False


def period_values(kind: str, first: date | None = None, last: date | None = None) -> dict[str, Any]:
    """The columns a period is stored as. Raises ValueError for a range that is not one."""
    if kind == "custom":
        if not first or not last:
            raise ValueError("Διάλεξε από ποια μέρα έως ποια.")
        if first > last:
            raise ValueError("Η αρχή είναι μετά το τέλος.")
        return {"period_days": None, "from_date": first.isoformat(), "to_date": last.isoformat()}
    return {"period_days": PERIODS[kind], "from_date": None, "to_date": None}


def period_kind(row: dict[str, Any]) -> str:
    if row.get("from_date"):
        return "custom"
    days = row.get("period_days")
    return next((k for k, v in PERIODS.items() if v == days), "1y") if days else "1y"


def period_text(row: dict[str, Any], today: date) -> str:
    """«3 μήνες» or «12 Αυγ – 10 Νοε», for the coach's sheet and the shared page."""
    from lib import fmt

    if row.get("from_date") or row.get("to_date"):
        first = fmt.parse_local_date(row.get("from_date") or row.get("from"))
        last = fmt.parse_local_date(row.get("to_date") or row.get("to"))
        if first and last:
            return f"{fmt.format_day(first, today)} – {fmt.format_day(last, today)}"
    days = row.get("period_days")
    if days:
        return next((PERIOD_LABELS[k] for k, v in PERIODS.items() if v == days), f"{days} μέρες")
    return "Τελευταίος χρόνος"


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
    columns = "token, created_at" + (f", {_PERIOD_COLUMNS}" if periods_ready(gym_id) else "")
    rows = (
        db.client()
        .table("athlete_shares")
        .select(columns)
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


def create(gym_id: str, athlete_id: str, period: dict[str, Any] | None = None) -> str:
    payload: dict[str, Any] = {"gym_id": gym_id, "athlete_id": athlete_id}
    if period and periods_ready(gym_id):
        payload.update(period)
    rows = db.client().table("athlete_shares").insert(payload).execute().data or []
    if not rows or not rows[0].get("token"):
        raise RuntimeError("Ο σύνδεσμος δεν φτιάχτηκε.")
    return str(rows[0]["token"])


def set_period(gym_id: str, token: str, period: dict[str, Any]) -> None:
    """Change what an existing link covers. The link itself stays the same."""
    db.client().table("athlete_shares").update(period).eq("gym_id", gym_id).eq("token", token).execute()
    fetch.clear()


def revoke(gym_id: str, token: str) -> None:
    db.client().table("athlete_shares").update(
        {"revoked_at": datetime.now(timezone.utc).isoformat()}
    ).eq("gym_id", gym_id).eq("token", token).execute()
    fetch.clear()


@st.cache_data(ttl=60, show_spinner=False)
def fetch(token: str) -> dict[str, Any] | None:
    """What the shared page shows. Keyed by the token, which is the whole tenant here."""
    response = db.client().rpc("shared_progress", {"p_token": token}).execute()
    data = getattr(response, "data", None)
    if isinstance(data, list):
        data = data[0] if data else None
    return data or None
