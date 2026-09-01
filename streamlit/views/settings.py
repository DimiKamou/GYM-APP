"""Ρυθμίσεις — whose name goes on the sheet, the password, the way out, and one
honest line about what this pilot is.

Deliberately four things and no more. Gym name, weight unit, theme, language and
export belong to the PWA's settings screen; this one answers the questions a
trainer actually asks of a pilot: who am I signed in as, how do I change the
password I was handed in the gym, how do I get off a shared phone, and can I
trust this thing in the basement where there is no signal.
"""

from __future__ import annotations

import re
from typing import Any

import streamlit as st

from lib import auth, db

_ROLE_LABELS = {"owner": "Ιδιοκτήτης", "trainer": "Προπονητής"}

_EMPTY = "—"

# CommonMark syntax. Display names, gym names and a hand-made first account's
# address are typed by people, and Streamlit renders every string as markdown —
# an underscore in a name silently becomes italics, and the name is the one
# thing on this screen that has to be exact.
_MD_SPECIALS = re.compile(r"([\\`*_{}\[\]()<>#+\-.!|$~])")


def _md(text: str) -> str:
    return _MD_SPECIALS.sub(r"\\\1", text or "")


@st.cache_data(ttl=300, show_spinner=False)
def _gym(gym_id: str) -> dict[str, Any]:
    """The gym row behind the membership.

    gym_id leads the signature even though RLS already scopes the query: this
    cache is one dictionary for the whole server process, and a hit is answered
    from memory without a policy ever being evaluated. Without the tenant in the
    key, the cache is the leak.
    """
    rows = (
        db.client()
        .table("gyms")
        .select("id, name, timezone")
        .eq("id", gym_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
    ) or []
    return dict(rows[0]) if rows else {}


def _sign_in_name(member: dict[str, Any]) -> str:
    """What this person types into the username box.

    Only the synthetic addresses this app mints are usernames; `username_of()`
    hands back a real address whole. The very first owner was created by hand in
    the Supabase dashboard and may well have one, and showing its local part as
    his "username" would be a lie he would then fail to sign in with.
    """
    email = str(member.get("email") or "").strip()
    if email:
        return auth.username_of(email)
    return auth.current_username() or _EMPTY


def _identity(member: dict[str, Any], gym_row: dict[str, Any]) -> None:
    name = str(member.get("display_name") or "").strip() or _EMPTY
    role = str(member.get("role") or "")
    gym_name = str(gym_row.get("name") or "").strip()
    timezone = str(gym_row.get("timezone") or "").strip()

    st.markdown(f"#### {_md(name)}")
    st.caption(
        f"Χρήστης: {_md(_sign_in_name(member))} · {_ROLE_LABELS.get(role, role or _EMPTY)}"
    )
    st.caption(f"Γυμναστήριο: {_md(gym_name) if gym_name else _EMPTY}")
    if timezone:
        # Not decoration: the gym's zone, not the phone's, decides which day a
        # session is filed under, so a workout logged at 23:50 lands where the
        # coach expects it and a coach abroad does not file on the wrong day.
        st.caption(f"Ζώνη ώρας: {_md(timezone)}")

    st.caption(
        "Αυτό το όνομα μπαίνει δίπλα σε κάθε σετ και σε κάθε σημείωση που γράφεις. "
        "Αν είναι λάθος, το διορθώνει ο ιδιοκτήτης."
    )


def _password_form() -> None:
    st.subheader("Αλλαγή κωδικού")
    st.caption(
        "Τουλάχιστον 8 χαρακτήρες. Δεν στέλνεται email — ο κωδικός αλλάζει εδώ και "
        "ισχύει αμέσως."
    )

    # One round trip for both boxes, and the boxes empty themselves afterwards:
    # a password left sitting in a field on a shared gym phone is the next
    # person's password.
    with st.form("settings_password", clear_on_submit=True):
        new_password = st.text_input(
            "Νέος κωδικός", type="password", autocomplete="new-password"
        )
        repeated = st.text_input(
            "Επανάληψη κωδικού", type="password", autocomplete="new-password"
        )
        submitted = st.form_submit_button("Αλλαγή κωδικού", type="primary")

    if not submitted:
        return

    if not new_password or not repeated:
        st.error("Συμπλήρωσε και τα δύο πεδία.")
        return

    if new_password != repeated:
        # The second box earns its place here: nothing on screen shows what was
        # typed, and a typo is a password only the owner can undo.
        st.error("Οι δύο κωδικοί δεν είναι ίδιοι.")
        return

    try:
        auth.change_password(new_password)
    except (ValueError, RuntimeError) as exc:
        st.error(str(exc))
        return
    except Exception as exc:  # an API error nobody anticipated is still news
        st.error(f"Ο κωδικός δεν άλλαξε: {exc}")
        return

    st.success("Ο κωδικός άλλαξε.")
    st.caption(
        "Σε αυτή τη συσκευή μένεις συνδεδεμένος. Σε όποια άλλη συσκευή είσαι "
        "συνδεδεμένος, μπορεί να ζητηθεί νέα σύνδεση με τον καινούριο κωδικό."
    )


def _offline_notice() -> None:
    st.subheader("Χωρίς δίκτυο")
    st.warning(
        "Αυτή η δοκιμαστική έκδοση δεν λειτουργεί εκτός δικτύου: χωρίς σήμα δεν "
        "ανοίγει καθόλου — δεν είναι απλώς αργή, η οθόνη μένει άδεια. Ό,τι έχεις "
        "καταγράψει βρίσκεται στον διακομιστή, όχι στο κινητό."
    )


def _sign_out() -> None:
    st.subheader("Αποσύνδεση")
    st.caption(
        "Η σύνδεση κρατάει και αφού κλείσει ο browser, ώστε να μη ζητάει κωδικό στη "
        "μέση της προπόνησης. Σε κοινό κινητό ή tablet, αποσυνδέσου όταν τελειώσεις."
    )
    if st.button("Αποσύνδεση", key="settings_sign_out"):
        auth.sign_out()
        st.rerun()


def render() -> None:
    st.header("Ρυθμίσεις")

    member = db.me()
    gym = db.gym_id()

    if not member or not gym:
        # gate() does not let this page draw in that state, so reaching it means
        # something went wrong after sign-in. A dead end with no way out of the
        # account would be the worse screen.
        st.info("Ο λογαριασμός σου δεν ανήκει ακόμη σε γυμναστήριο.")
        st.divider()
        _sign_out()
        return

    try:
        gym_row = _gym(gym)
    except Exception as exc:
        # The name of the gym is the least important line here; the identity and
        # the password must not disappear with it.
        gym_row = {}
        st.caption(f"Τα στοιχεία του γυμναστηρίου δεν φορτώθηκαν: {exc}")

    _identity(member, gym_row)

    st.divider()
    _password_form()

    st.divider()
    _offline_notice()

    st.divider()
    _sign_out()
