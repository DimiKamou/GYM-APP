"""Ομάδα — the roster, and the owner's door for putting people on it.

Every number in this app is rendered with the name of whoever wrote it, so the
roster is not an administrative screen: it is the legend for every other one.
"""

from __future__ import annotations

from typing import Any

import streamlit as st

from lib import admin, auth, db, ui

_ROLE_LABELS = {"owner": "Ιδιοκτήτης", "trainer": "Προπονητής"}
_STATUS_LABELS = {"active": "Ενεργός", "invited": "Εκκρεμεί", "removed": "Αφαιρέθηκε"}

# Label -> the enum value 001_init.sql actually stores.
_ROLE_CHOICES = {"Προπονητής": "trainer", "Ιδιοκτήτης": "owner"}

_NOTICE = "team_notice"


@st.cache_data(ttl=30, show_spinner=False)
def _roster(gym_id: str) -> list[dict[str, Any]]:
    """The gym's members, newest role first.

    gym_id is the first argument even though RLS already scopes the query: the
    cache is global to the server process, so a hit returns whatever the first
    caller saw and never reaches a policy again. The tenant has to be part of
    the key or the cache becomes the leak.
    """
    return (
        db.client()
        .table("memberships")
        .select("id, user_id, display_name, email, role, status, created_at")
        .eq("gym_id", gym_id)
        .is_("deleted_at", "null")
        .order("role")
        .order("display_name")
        .execute()
        .data
        or []
    )


def _row(member: dict[str, Any]) -> dict[str, str]:
    return {
        "Όνομα": member.get("display_name") or "—",
        "Χρήστης": auth.sign_in_name(member.get("email")),
        "Ρόλος": _ROLE_LABELS.get(member.get("role") or "", member.get("role") or "—"),
        "Κατάσταση": _STATUS_LABELS.get(member.get("status") or "", member.get("status") or "—"),
    }


def _count_label(n: int) -> str:
    return "1 μέλος" if n == 1 else f"{n} μέλη"


def _new_member_form() -> None:
    st.subheader("Νέος χρήστης")
    st.caption(
        "Ο χρήστης συνδέεται με όνομα χρήστη και κωδικό. Δεν φεύγει κανένα email — "
        "τα στοιχεία τα δίνεις εσύ, από κοντά."
    )

    # One round trip for the whole form: everything here is typed, and widgets
    # outside a form re-run the script on every keystroke.
    with st.form("team_new_member"):
        full_name = st.text_input("Ονοματεπώνυμο", max_chars=120, placeholder="Μαρία Παπαδοπούλου")
        username = st.text_input(
            "Όνομα χρήστη",
            max_chars=32,
            placeholder="maria",
            help="Λατινικά γράμματα, ψηφία, τελεία, κάτω παύλα ή παύλα. Με αυτό συνδέεται.",
        )
        role_label = st.radio("Ρόλος", list(_ROLE_CHOICES), horizontal=True)
        password = st.text_input(
            "Κωδικός",
            type="password",
            help="Τουλάχιστον 8 χαρακτήρες. Δεν αποθηκεύεται πουθενά αλλού — γράψ' τον κάπου πριν τον δώσεις.",
        )
        submitted = st.form_submit_button("Δημιουργία χρήστη", type="primary")

    if not submitted:
        return

    try:
        member = admin.create_member(
            username=username,
            full_name=full_name,
            role=_ROLE_CHOICES[role_label],
            password=password,
        )
    except PermissionError as exc:
        st.error(str(exc))
        return
    except (ValueError, RuntimeError) as exc:
        st.error(str(exc))
        return
    except Exception as exc:  # an API error nobody anticipated is still news
        st.error(f"Ο χρήστης δεν δημιουργήθηκε: {exc}")
        return

    # The row exists now, so the cached roster is a lie until it is dropped.
    _roster.clear()
    ui.notice(
        _NOTICE,
        "ok",
        f"Ο/Η {member.get('display_name')} μπήκε στην ομάδα ως "
        f"{_ROLE_LABELS.get(member.get('role') or '', member.get('role') or '')}. "
        f"Συνδέεται με όνομα χρήστη «{member.get('username')}» και τον κωδικό που "
        "μόλις έδωσες. Δώσ' του τα ο ίδιος — κανένα email δεν στάλθηκε.",
    )
    st.rerun()


def _reset_password_form(members: list[dict[str, Any]]) -> None:
    """The owner's half of "Ξέχασες τον κωδικό;".

    The sign-in screen tells a locked-out trainer that the owner changes their
    password here, and README section 4 says the same. Neither was true: the
    call existed in lib/admin.py and no screen reached it, so the one recovery
    path this app has ended at a sentence pointing nowhere. There is no
    self-service reset because these accounts have no reachable mailbox — this
    form IS the reset.
    """
    st.subheader("Αλλαγή κωδικού μέλους")
    st.caption(
        "Για μέλος που ξέχασε τον κωδικό του. Δώσ' του τον νέο από κοντά — δεν "
        "φεύγει κανένα email, και ο νέος κωδικός δεν αποθηκεύεται πουθενά αλλού."
    )

    # A member with no auth account behind it has no password to change, and a
    # removed one has nothing to sign in to.
    resettable = [
        member
        for member in members
        if member.get("id")
        and member.get("user_id")
        and (member.get("status") or "") != "removed"
    ]
    if not resettable:
        st.info("Κανένα μέλος με λογαριασμό σύνδεσης.")
        return

    # The choice travels as a membership id, never as a position in this list.
    # The roster behind it is a 30-second cache, so the run that draws the form
    # and the run that submits it can be looking at different lists: keyed by
    # position, a rename or a removal-plus-addition in between moved the reset
    # onto whoever now sat at that index, and the owner walked away with a
    # password they believed belonged to the person on the label.
    by_id = {str(member["id"]): member for member in resettable}

    def _label(member_id: str) -> str:
        # Streamlit carries a selectbox choice between runs as the label it
        # rendered, so two members sharing a name and a role would be one
        # indistinguishable option. The sign-in name is unique per gym — it is
        # what makes the label an identity — and the owner is about to hand it
        # over with the password anyway.
        member = by_id.get(member_id, {})
        return " · ".join(
            part
            for part in (
                member.get("display_name") or "—",
                auth.sign_in_name(member.get("email")),
                _ROLE_LABELS.get(member.get("role") or "", member.get("role") or ""),
            )
            if part
        )

    with st.form("team_reset_password", clear_on_submit=True):
        # index=None: with a preselected first option, a choice this run can no
        # longer honour silently becomes that first member instead of surfacing.
        # Nothing preselected means the fallback is "no member", which the check
        # below can refuse.
        chosen = st.selectbox(
            "Μέλος",
            list(by_id),
            format_func=_label,
            index=None,
            placeholder="Διάλεξε μέλος",
            key="team_reset_member",
        )
        password = st.text_input(
            "Νέος κωδικός",
            type="password",
            autocomplete="new-password",
            help="Τουλάχιστον 8 χαρακτήρες. Γράψ' τον κάπου πριν τον δώσεις.",
        )
        submitted = st.form_submit_button("Αλλαγή κωδικού")

    if not submitted:
        return

    # Resolved against the roster THIS run read, so the id either still names a
    # member of this gym or nothing happens at all.
    member = by_id.get(str(chosen)) if chosen is not None else None
    if member is None:
        st.error(
            "Διάλεξε μέλος από τη λίστα. Αν είχες ήδη διαλέξει, η ομάδα άλλαξε "
            "στο μεταξύ: κανένας κωδικός δεν άλλαξε, διάλεξέ το ξανά."
        )
        return

    try:
        admin.reset_password(str(member.get("user_id") or ""), password)
    except PermissionError as exc:
        st.error(str(exc))
        return
    except (ValueError, RuntimeError) as exc:
        st.error(str(exc))
        return
    except Exception as exc:  # an API error nobody anticipated is still news
        st.error(f"Ο κωδικός δεν άλλαξε: {exc}")
        return

    ui.notice(
        _NOTICE,
        "ok",
        f"Ο κωδικός του/της {member.get('display_name') or '—'} άλλαξε. Δώσ' του τον "
        "νέο κωδικό ο ίδιος — κανένα email δεν στάλθηκε.",
    )
    st.rerun()


def render() -> None:
    st.header("Ομάδα")
    st.caption("Ποιος γράφει στο φύλλο του γυμναστηρίου.")

    gym_id = db.gym_id()
    if not gym_id:
        st.info("Ο λογαριασμός σου δεν ανήκει ακόμη σε γυμναστήριο.")
        return

    ui.flush_notice(_NOTICE)

    try:
        members = _roster(gym_id)
    except Exception as exc:
        st.error("Η ομάδα δεν φορτώθηκε.")
        st.caption(str(exc))
        return

    if members:
        st.dataframe([_row(m) for m in members], hide_index=True)
        st.caption(_count_label(len(members)))
    else:
        st.info("Κανένα μέλος ακόμη.")

    st.divider()

    if not db.is_owner():
        st.info(
            "Μόνο ο ιδιοκτήτης προσθέτει χρήστες. Μπορείς να καταγράφεις προπονήσεις "
            "για κάθε αθλητή του γυμναστηρίου."
        )
        return

    if not admin.ADMIN_AVAILABLE:
        st.subheader("Νέος χρήστης")
        st.warning(admin.ADMIN_UNAVAILABLE_REASON)
        return

    _new_member_form()

    st.divider()
    _reset_password_form(members)
