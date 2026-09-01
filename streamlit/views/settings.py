"""Ρυθμίσεις — whose name goes on the sheet, the password, the way out, and one
honest line about what this pilot is.

Deliberately four things and no more. Gym name, weight unit, theme, language and
export belong to the PWA's settings screen; this one answers the questions a
trainer actually asks of a pilot: who am I signed in as, how do I change the
password I was handed in the gym, how do I get off a shared phone, and can I
trust this thing in the basement where there is no signal.
"""

from __future__ import annotations

from typing import Any

import streamlit as st

from lib import auth, db, fmt, gym

_ROLE_LABELS = {"owner": "Ιδιοκτήτης", "trainer": "Προπονητής"}


def _who(member: dict[str, Any]) -> str:
    """The name in the Χρήστης box, for a membership row that may predate one.

    The address on the row is the authority. Falling back to the signed-in
    session covers the very first owner, created by hand in the dashboard before
    any membership existed to record it.
    """
    return auth.sign_in_name(member.get("email")) or auth.current_username() or fmt.EMPTY


def _identity(member: dict[str, Any], gym_row: dict[str, Any]) -> None:
    name = str(member.get("display_name") or "").strip() or fmt.EMPTY
    role = str(member.get("role") or "")
    gym_name = str(gym_row.get("name") or "").strip()
    timezone = str(gym_row.get("timezone") or "").strip()

    st.markdown(f"#### {fmt.md(name)}")
    st.caption(
        f"Χρήστης: {fmt.md(_who(member))} · {_ROLE_LABELS.get(role, role or fmt.EMPTY)}"
    )
    st.caption(f"Γυμναστήριο: {fmt.md(gym_name) if gym_name else fmt.EMPTY}")
    if timezone:
        # Not decoration: the gym's zone, not the phone's, decides which day a
        # session is filed under, so a workout logged at 23:50 lands where the
        # coach expects it and a coach abroad does not file on the wrong day.
        st.caption(f"Ζώνη ώρας: {fmt.md(timezone)}")

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
    gym_id = db.gym_id()

    if not member or not gym_id:
        # gate() does not let this page draw in that state, so reaching it means
        # something went wrong after sign-in. A dead end with no way out of the
        # account would be the worse screen.
        st.info("Ο λογαριασμός σου δεν ανήκει ακόμη σε γυμναστήριο.")
        st.divider()
        _sign_out()
        return

    try:
        gym_row = gym.row(gym_id)
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
