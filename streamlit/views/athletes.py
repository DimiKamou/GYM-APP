"""Αθλητές — the roster, and the five-second briefing behind each name.

Two screens in one `render()`, switched on `st.session_state["athlete"]`, because
they are one thought: the coach scans the roster for the person walking towards
them and opens the sheet. A separate page would put a navigation click between
08:29 and the warning that says not to load that shoulder.

The opened athlete is the whole reason this app exists, so its order is fixed and
not a layout preference:

    1. pinned warnings          — what must NOT happen, before anything else
    2. the last session         — what was actually done, and by whose hand
    3. the note history         — what the previous coaches said
    4. a new note               — append-only; a correction is a new note

Every line here that carries a number or a claim carries its date and its author
with it. `notes.author` and `sessions.logged_by` are membership ids, so they are
resolved through one per-gym lookup: an unresolvable id renders as an explicit
"unknown member" rather than silently dropping the attribution, because a
coaching number with no one to ask about it is the failure this app replaces.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

import streamlit as st

from lib import db, exercises, fmt, gym, history, nav, ui

# Same count as the PWA's briefing card. Three lines is what a coach reads
# standing up; the fourth is already scrolling.

_NOTICE = "athletes_notice"
_QUERY = "athletes_query"


# ---------------------------------------------------------------------------
# Reads
#
# Every one of these takes gym_id first, even where the body does not need it.
# @st.cache_data is global to the server process, so a cache hit is served
# without ever reaching a policy — the tenant has to be part of the key or the
# cache is the leak that RLS was there to prevent.
# ---------------------------------------------------------------------------

@st.cache_data(ttl=30, show_spinner=False)
def _athletes(gym_id: str) -> list[dict[str, Any]]:
    return (
        db.client()
        .table("athletes")
        .select("id, full_name, plan_phase, plan_focus, coach_membership_id")
        .eq("gym_id", gym_id)
        .is_("deleted_at", "null")
        .order("full_name")
        .execute()
        .data
        or []
    )


@st.cache_data(ttl=30, show_spinner=False)
def _notes(gym_id: str, athlete_id: str) -> list[dict[str, Any]]:
    """Every live note for one athlete, newest first.

    Pinned and dismissed notes come back too and are separated in the view: a
    dismissed warning that vanished from both the top of the screen and the
    history would be a deletion, and nothing in this schema deletes.
    """
    return (
        db.client()
        .table("notes")
        .select("id, body, pinned, author, dismissed_at, created_at, session_id")
        .eq("gym_id", gym_id)
        .eq("athlete_id", athlete_id)
        .is_("deleted_at", "null")
        .order("created_at", desc=True)
        .order("id", desc=True)
        .execute()
        .data
        or []
    )


@st.cache_data(ttl=30, show_spinner=False)
def _last_session(gym_id: str, athlete_id: str) -> dict[str, Any] | None:
    """The most recent session. Ordered by the gym day first, then the instant.

    local_date before started_at because the gym day is the fact a coach reasons
    about; the instant and the id are there only to make the order total.
    """
    rows = (
        db.client()
        .table("sessions")
        .select("id, title, notes, status, local_date, started_at, logged_by, credited_to")
        .eq("gym_id", gym_id)
        .eq("athlete_id", athlete_id)
        .is_("deleted_at", "null")
        .order("local_date", desc=True)
        .order("started_at", desc=True)
        .order("id", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    return rows[0] if rows else None


# ---------------------------------------------------------------------------
# Small view helpers
# ---------------------------------------------------------------------------

def _attribution(names: dict[str, str], membership_id: Any, day: date | None, today: date) -> str:
    """"Μαρία · 12 Αυγ". Both halves, always — see the module docstring."""
    when = fmt.format_day(day, today) if day else fmt.EMPTY
    return f"{fmt.author_of(names, membership_id)} · {when}"


def _open_athlete(athlete: dict[str, Any]) -> None:
    st.session_state["athlete"] = athlete
    st.rerun()


def _start_session(athlete: dict[str, Any]) -> None:
    """Hand the log page an athlete and no open session, then go there.

    session_id is cleared rather than left alone: whatever workout was open
    belonged to whoever was on the screen before, and inheriting it would append
    this athlete's sets to another athlete's session.
    """
    nav.open_workout(None, athlete)
    page = (st.session_state.get("pages") or {}).get("log")
    if page is None:
        ui.notice(_NOTICE, "error", "Η σελίδα καταγραφής δεν είναι διαθέσιμη.")
        st.rerun()
    st.switch_page(page)


def _reopen_session(gym_id: str, session: dict[str, Any]) -> None:
    """Open a past workout on the log screen so it can be corrected.

    Reopening rather than a second read-only edit screen: the Προπόνηση screen
    already knows how to draw blocks, sets, the picker and the corrections, and
    a coach fixing yesterday's sheet is doing the same things as a coach writing
    today's. `status` goes back to active because that is exactly what is true —
    the workout is open again — and finished_at is cleared with it so
    sessions_finish_after_start cannot see a finish that precedes a later edit.
    """
    session_id = str(session["id"])
    if str(session.get("status") or "") != "active":
        try:
            rows = (
                db.client()
                .table("sessions")
                .update({"status": "active", "finished_at": None})
                .eq("gym_id", gym_id)
                .eq("id", session_id)
                .execute()
                .data
                or []
            )
        except Exception as exc:
            ui.notice(_NOTICE, "error", f"Η προπόνηση δεν άνοιξε: {exc}")
            st.rerun()
        if not rows:
            # An UPDATE no policy let through matches zero rows and reports
            # success, so silence here would send the coach to a screen that
            # then refuses the session it was sent for.
            ui.notice(_NOTICE, "error", "Η προπόνηση δεν άνοιξε. Δοκίμασε ξανά.")
            st.rerun()

    _last_session.clear()
    history.forget(gym_id, str((st.session_state.get("athlete") or {}).get("id") or ""))
    nav.open_workout(session_id)
    page = (st.session_state.get("pages") or {}).get("log")
    if page is None:
        ui.notice(_NOTICE, "error", "Η σελίδα καταγραφής δεν είναι διαθέσιμη.")
        st.rerun()
    st.switch_page(page)


# ---------------------------------------------------------------------------
# The roster
# ---------------------------------------------------------------------------

def _new_athlete_form(gym_id: str, expanded: bool) -> None:
    with st.expander("Νέος αθλητής", expanded=expanded):
        # A form so the whole thing is one round trip: a widget outside one
        # re-runs the script on every keystroke.
        with st.form("athletes_new", clear_on_submit=True):
            full_name = st.text_input(
                "Ονοματεπώνυμο",
                max_chars=160,
                placeholder="Νίκος Παπαδόπουλος",
            )
            submitted = st.form_submit_button("Προσθήκη", type="primary")

        if not submitted:
            return

        name = (full_name or "").strip()
        if not name:
            st.error("Γράψε το ονοματεπώνυμο του αθλητή.")
            return

        try:
            # gym_id and full_name only. created_by is stamped by the column
            # DEFAULT from the JWT, and everything else is the athlete's own
            # detail, edited later on their sheet.
            db.client().table("athletes").insert(
                {"gym_id": gym_id, "full_name": name}
            ).execute()
        except Exception as exc:
            message = str(exc)
            if "athletes_gym_name_uniq" in message or "duplicate key" in message:
                st.error(f"Υπάρχει ήδη αθλητής με το όνομα «{name}».")
            else:
                st.error("Ο αθλητής δεν καταχωρήθηκε.")
                st.caption(message)
            return

        _athletes.clear()
        ui.notice(_NOTICE, "ok", f"Ο/Η {name} μπήκε στη λίστα.")
        st.rerun()


def _roster(gym_id: str) -> None:
    st.header("Αθλητές")

    try:
        athletes = _athletes(gym_id)
    except Exception as exc:
        st.error("Η λίστα αθλητών δεν φορτώθηκε.")
        st.caption(str(exc))
        return

    # A selectbox and not a text field, and the difference is the whole point:
    # st.text_input reruns on Enter or on blur, so on a phone the roster only
    # filtered once the coach dismissed the keyboard — typing «Καμου» did
    # nothing until then. A selectbox filters in the browser as the letters
    # arrive, with no round trip at all.
    by_id = {str(a["id"]): (a.get("full_name") or fmt.EMPTY) for a in athletes}
    picked = st.selectbox(
        "Αναζήτηση",
        options=list(by_id),
        format_func=lambda key: by_id.get(key, fmt.EMPTY),
        index=None,
        placeholder="Γράψε όνομα — π.χ. Καμου",
        label_visibility="collapsed",
        key=_QUERY,
    )

    shown = [a for a in athletes if picked is None or str(a["id"]) == str(picked)]

    if not athletes:
        st.info("Κανένας αθλητής ακόμα. Πρόσθεσε τον πρώτο πιο κάτω.")
    else:
        for athlete in shown:
            with st.container(border=True):
                details, open_col, log_col = st.columns([6, 2, 3], vertical_alignment="center")
                with details:
                    st.markdown(f"**{fmt.md(athlete.get('full_name') or fmt.EMPTY)}**")
                    phase = (athlete.get("plan_phase") or "").strip()
                    if phase:
                        st.caption(fmt.md(phase))
                with open_col:
                    if st.button("Άνοιγμα", key=f"athlete_open_{athlete['id']}"):
                        _open_athlete(athlete)
                with log_col:
                    if st.button(
                        "Νέα προπόνηση",
                        key=f"athlete_log_{athlete['id']}",
                        type="primary",
                    ):
                        _start_session(athlete)

        st.caption("1 αθλητής" if len(shown) == 1 else f"{len(shown)} αθλητές")

    st.divider()
    # Below the roster, and never behind an early return: the empty roster is
    # exactly the moment this form has to be on the screen.
    _new_athlete_form(gym_id, expanded=not athletes)


# ---------------------------------------------------------------------------
# One athlete — the briefing
# ---------------------------------------------------------------------------

def _pinned_section(notes: list[dict[str, Any]], names: dict[str, str], tz: Any, today: date) -> None:
    """The warnings, above everything else and in the colour of a warning.

    A pinned note is "Προσοχή στον αριστερό ώμο". It is not a heading with a note
    under it: it is the first thing on the screen, it wraps rather than truncates,
    and it carries the name of the coach who wrote it so the covering trainer
    knows who to ask.
    """
    pinned = [n for n in notes if n.get("pinned") and not n.get("dismissed_at")]
    if not pinned:
        return
    for note in pinned:
        day = fmt.instant_day(note.get("created_at"), tz)
        st.error(
            f"{fmt.md(note.get('body') or '')}\n\n"
            f"— {fmt.md(_attribution(names, note.get('author'), day, today))}"
        )


def _last_session_section(
    gym_id: str,
    athlete_id: str,
    names: dict[str, str],
    today: date,
) -> None:
    """The last three workouts, each a box that opens for its sets and comments.

    What the coach covering a colleague reads first: what this athlete has been
    doing, day by day, with who coached it.
    """
    st.subheader("Τελευταίες προπονήσεις")

    try:
        session = _last_session(gym_id, athlete_id)
    except Exception as exc:
        st.error("Η τελευταία προπόνηση δεν φορτώθηκε.")
        st.caption(str(exc))
        return

    if not session:
        st.info("Καμία προπόνηση ακόμα.")
        return

    # An open workout is the one thing on this sheet a coach may need to get
    # back into — with or without a set in it yet.
    if (session.get("status") or "") == "active":
        day = fmt.parse_local_date(session.get("local_date"))
        st.caption(
            "Σε εξέλιξη: "
            + fmt.md(_attribution(names, session.get("logged_by"), day, today))
        )
        if st.button("Συνέχεια προπόνησης", key="athlete_edit_session", type="primary"):
            _reopen_session(gym_id, session)

    try:
        workouts = history.last_workouts(gym_id, athlete_id)
    except Exception as exc:
        st.caption("Οι προπονήσεις δεν φορτώθηκαν.")
        st.caption(str(exc))
        return
    if not workouts:
        st.caption("Καμία καταγεγραμμένη άσκηση ακόμα.")
        return

    def _open(workout: dict[str, Any]):
        row = workout["session"]
        label = "Συνέχεια" if (row.get("status") or "") == "active" else "Άνοιγμα για αλλαγές"
        return label, lambda: _reopen_session(gym_id, row)

    history.boxes(workouts, names, today, key="athlete_recent", action=_open)


_CALENDAR_KEY = "athlete_calendar"


def _calendar_section(gym_id: str, athlete_id: str, today: date) -> None:
    """A month at a glance, the days the athlete trained marked."""
    from views import progress

    try:
        trained = history.trained_days(progress._history(gym_id, athlete_id))
    except Exception:
        return

    stored = st.session_state.get(_CALENDAR_KEY)
    if isinstance(stored, dict) and stored.get("athlete") == athlete_id:
        year, month = stored["year"], stored["month"]
    else:
        year, month = today.year, today.month

    def _go(step: int) -> None:
        y, m = year, month + step
        if m == 0:
            y, m = y - 1, 12
        elif m == 13:
            y, m = y + 1, 1
        st.session_state[_CALENDAR_KEY] = {"athlete": athlete_id, "year": y, "month": m}

    st.subheader("Ημερολόγιο")
    row = st.container(horizontal=True, vertical_alignment="center", wrap=False)
    if row.button("‹", key="athlete_cal_back", width=48):
        _go(-1)
        st.rerun()
    from lib import recap

    row.markdown(
        f"**{recap.MONTHS_FULL_EL[month - 1]} {year}**", width="stretch", text_alignment="center"
    )
    if row.button("›", key="athlete_cal_forward", width=48,
                  disabled=(year, month) >= (today.year, today.month)):
        _go(1)
        st.rerun()
    st.markdown(history.month_calendar(year, month, trained, today), unsafe_allow_html=True)
    count = sum(1 for d in trained if d.year == year and d.month == month)
    st.caption(
        "Καμία προπόνηση αυτόν τον μήνα." if not count
        else ("1 προπόνηση" if count == 1 else f"{count} προπονήσεις") + " αυτόν τον μήνα."
    )


def _history_section(notes: list[dict[str, Any]], names: dict[str, str], tz: Any, today: date) -> None:
    st.subheader("Σημειώσεις")

    if not notes:
        st.info("Καμία σημείωση ακόμα.")
        return

    for note in notes:
        day = fmt.instant_day(note.get("created_at"), tz)
        with st.container(border=True):
            st.markdown(fmt.md(note.get("body") or ""))
            meta = _attribution(names, note.get("author"), day, today)
            if note.get("pinned") and not note.get("dismissed_at"):
                meta = f"Καρφιτσωμένη · {meta}"
            elif note.get("dismissed_at"):
                meta = f"Αποκρύφθηκε · {meta}"
            st.caption(fmt.md(meta))


def _new_note_form(gym_id: str, athlete_id: str) -> None:
    st.subheader("Νέα σημείωση")
    # Said out loud, because a trainer who expects to edit writes half a
    # correction and leaves the wrong half standing. There is no UPDATE policy on
    # notes.body and no column grant for it: an edit control here would not be a
    # missing feature, it would be a button that fails at the database.
    st.caption("Οι σημειώσεις δεν αλλάζουν. Μια διόρθωση γράφεται ως νέα σημείωση.")

    with st.form("athlete_new_note", clear_on_submit=True):
        body = st.text_area(
            "Σημείωση",
            max_chars=500,
            placeholder="Τι πρέπει να ξέρει ο επόμενος προπονητής;",
            label_visibility="collapsed",
        )
        pinned = st.checkbox("Καρφίτσωμα — εμφανίζεται ως προειδοποίηση στην κορυφή του αθλητή")
        submitted = st.form_submit_button("Καταχώριση", type="primary")

    if not submitted:
        return

    text = (body or "").strip()
    if not text:
        st.error("Γράψε τη σημείωση πριν την καταχωρίσεις.")
        return

    try:
        # `author` is deliberately not sent. Its column DEFAULT is
        # app.my_membership(), and notes_insert demands author = app.my_membership()
        # anyway — so the server names the author from the JWT and the client
        # cannot get it wrong or forge it.
        db.client().table("notes").insert(
            {"gym_id": gym_id, "athlete_id": athlete_id, "body": text, "pinned": bool(pinned)}
        ).execute()
    except Exception as exc:
        st.error("Η σημείωση δεν καταχωρήθηκε.")
        st.caption(str(exc))
        return

    _notes.clear()
    ui.notice(_NOTICE, "ok", "Η σημείωση καταχωρήθηκε.")
    st.rerun()


_CONFIRM_DELETE = "athletes_confirm_delete"


def _edit_athlete(gym_id: str, athlete: dict[str, Any], names: dict[str, str]) -> None:
    """Correct the sheet's own details, and — for the owner — remove the athlete.

    This is the one place in the app that keeps a confirm dialog instead of an
    undo, and CLAUDE.md says why: removing an athlete takes their whole history
    off every screen at once. An undo banner that scrolls away is not a good
    enough answer to that, the way it is for one set.

    The removal is still a soft delete — there is no DELETE policy anywhere in
    this schema — so the row and its sessions survive and a mistake is
    recoverable from the database. It is the SCREEN that treats it as final.
    """
    athlete_id = str(athlete["id"])

    with st.expander("✏️  Επεξεργασία / διαγραφή αθλητή"):
        with st.form("athlete_edit"):
            full_name = st.text_input(
                "Ονοματεπώνυμο",
                value=str(athlete.get("full_name") or ""),
                max_chars=160,
            )
            phase = st.text_input(
                "Φάση προγράμματος",
                value=str(athlete.get("plan_phase") or ""),
                max_chars=120,
                placeholder="π.χ. Όγκος",
            )
            focus = st.text_input(
                "Έμφαση",
                value=str(athlete.get("plan_focus") or ""),
                max_chars=120,
                placeholder="π.χ. Πλάτη / ώμοι",
            )
            # Who works here now, not everyone who ever did: `names` keeps
            # removed members because they wrote history, but an athlete
            # assigned to a trainer who left last year is a roster filter that
            # points at nobody. The current coach stays in the list whatever
            # their status, so the form can show what is stored.
            active = _active_coaches(gym_id, names)
            coach = str(athlete.get("coach_membership_id") or "")
            if coach and coach not in active and coach in names:
                active[coach] = names[coach]
            options: list[str | None] = [None] + sorted(
                active, key=lambda member_id: fmt.fold(active.get(member_id, ""))
            )
            picked = st.selectbox(
                "Προπονητής",
                options=options,
                index=options.index(coach) if coach in options else 0,
                format_func=lambda member_id: (
                    "Κανένας συγκεκριμένα"
                    if member_id is None
                    else names.get(member_id, fmt.UNKNOWN_AUTHOR)
                ),
                help=(
                    "Φίλτρο και όχι φράχτης: όποιος προπονητής του γυμναστηρίου "
                    "μπορεί να καταγράψει προπόνηση για οποιονδήποτε αθλητή."
                ),
            )
            saved = st.form_submit_button("Αποθήκευση", type="primary")

        if saved:
            name = (full_name or "").strip()
            if not name:
                st.error("Το ονοματεπώνυμο δεν μπορεί να μείνει κενό.")
                return
            try:
                rows = (
                    db.client()
                    .table("athletes")
                    .update(
                        {
                            "full_name": name,
                            "plan_phase": (phase or "").strip() or None,
                            "plan_focus": (focus or "").strip() or None,
                            "coach_membership_id": picked,
                        }
                    )
                    .eq("gym_id", gym_id)
                    .eq("id", athlete_id)
                    .execute()
                    .data
                    or []
                )
            except Exception as exc:
                message = str(exc)
                if "athletes_gym_name_uniq" in message or "duplicate key" in message:
                    st.error(f"Υπάρχει ήδη αθλητής με το όνομα «{name}».")
                else:
                    st.error("Οι αλλαγές δεν αποθηκεύτηκαν.")
                    st.caption(message)
                return
            if not rows:
                # An UPDATE no policy let through matches zero rows and reports
                # success, so silence here would be a change the coach believes
                # they made.
                st.error("Οι αλλαγές δεν αποθηκεύτηκαν. Δοκίμασε ξανά.")
                return

            _athletes.clear()
            st.session_state["athlete"] = {**athlete, "full_name": name}
            ui.notice(_NOTICE, "ok", "Τα στοιχεία ενημερώθηκαν.")
            st.rerun()

        st.divider()
        _remove_athlete(gym_id, athlete)


def _active_coaches(gym_id: str, names: dict[str, str]) -> dict[str, str]:
    """The members an athlete can be assigned to. The whole roster if unreadable."""
    try:
        return dict(gym.active_member_names(gym_id))
    except Exception:
        return dict(names)


def _remove_athlete(gym_id: str, athlete: dict[str, Any]) -> None:
    """Two taps and a sentence, owner only.

    `athletes_delete_owner_only` is AS RESTRICTIVE, so a trainer's attempt is
    refused by the database — and a button that the database will refuse is
    worse than no button, because the trainer reads the refusal as a bug.
    """
    athlete_id = str(athlete["id"])
    name = str(athlete.get("full_name") or fmt.EMPTY)

    if not db.is_owner():
        st.caption("Μόνο ο ιδιοκτήτης του γυμναστηρίου μπορεί να αφαιρέσει αθλητή.")
        return

    if st.session_state.get(_CONFIRM_DELETE) != athlete_id:
        st.caption("Η αφαίρεση βγάζει τον αθλητή και το ιστορικό του από όλες τις οθόνες.")
        if st.button("Αφαίρεση αθλητή", key="athlete_remove"):
            st.session_state[_CONFIRM_DELETE] = athlete_id
            st.rerun()
        return

    st.warning(f"Να αφαιρεθεί ο/η {name}; Οι προπονήσεις του φεύγουν από κάθε οθόνη.")
    cancel_col, confirm_col = st.columns(2)
    with cancel_col:
        if st.button("Ακύρωση", key="athlete_remove_cancel", type="primary"):
            st.session_state.pop(_CONFIRM_DELETE, None)
            st.rerun()
    with confirm_col:
        if st.button("Ναι, αφαίρεσέ τον", key="athlete_remove_confirm"):
            try:
                rows = (
                    db.client()
                    .table("athletes")
                    .update({"deleted_at": datetime.now(timezone.utc).isoformat()})
                    .eq("gym_id", gym_id)
                    .eq("id", athlete_id)
                    .execute()
                    .data
                    or []
                )
            except Exception as exc:
                st.error("Ο αθλητής δεν αφαιρέθηκε.")
                st.caption(str(exc))
                return
            if not rows:
                st.error("Ο αθλητής δεν αφαιρέθηκε. Δοκίμασε ξανά.")
                return

            _athletes.clear()
            _last_session.clear()
            _notes.clear()
            st.session_state.pop(_CONFIRM_DELETE, None)
            # The sheet is about to describe a row that no longer exists, and
            # an open workout belongs to the athlete just removed.
            nav.leave_workouts()
            ui.notice(_NOTICE, "ok", f"Ο/Η {name} αφαιρέθηκε.")
            st.rerun()


def _athlete_sheet(gym_id: str, selected: dict[str, Any]) -> None:
    athlete_id = str(selected.get("id") or "")

    if st.button("← Όλοι οι αθλητές", key="athlete_back"):
        st.session_state.pop("athlete", None)
        st.rerun()

    try:
        roster = _athletes(gym_id)
    except Exception as exc:
        st.error("Ο αθλητής δεν φορτώθηκε.")
        st.caption(str(exc))
        return

    # The stored dict is a snapshot from whenever the card was clicked. Re-reading
    # it by id means a plan phase changed on another screen shows here, and an
    # athlete removed in the meantime says so instead of rendering a ghost sheet.
    current = next((a for a in roster if a.get("id") == athlete_id), None)
    if current is None:
        st.warning("Ο αθλητής δεν βρέθηκε. Ίσως αφαιρέθηκε από τη λίστα.")
        return
    st.session_state["athlete"] = current

    st.header(fmt.md(current.get("full_name") or fmt.EMPTY))
    plan = " · ".join(
        part
        for part in (
            (current.get("plan_phase") or "").strip(),
            (current.get("plan_focus") or "").strip(),
        )
        if part
    )
    if plan:
        st.caption(fmt.md(plan))

    tz = gym.zone(gym_id)
    today = gym.today(gym_id)

    # An unreachable roster must not blank the briefing: the warnings and the last
    # session still matter, and fmt.author_of falls back to a named "unknown
    # member" rather than to silence.
    names = gym.names_or_empty(gym_id)

    try:
        notes = _notes(gym_id, athlete_id)
    except Exception as exc:
        notes = []
        st.error("Οι σημειώσεις δεν φορτώθηκαν.")
        st.caption(str(exc))

    # Directly under the name, not at the foot of the sheet. It was below the
    # briefing, the last session and the notes — three sections deep on a phone —
    # and the gym reported twice that an athlete could not be edited or removed
    # at all. A control nobody scrolls to is a control that does not exist.
    _edit_athlete(gym_id, current, names)

    st.divider()
    _pinned_section(notes, names, tz, today)

    if st.button("Νέα προπόνηση", key="athlete_new_session", type="primary"):
        _start_session(current)

    _last_session_section(gym_id, athlete_id, names, today)
    _calendar_section(gym_id, athlete_id, today)

    st.divider()
    _history_section(notes, names, tz, today)

    st.divider()
    _new_note_form(gym_id, athlete_id)


# ---------------------------------------------------------------------------

def render() -> None:
    gym_id = db.gym_id()
    if not gym_id:
        st.header("Αθλητές")
        st.info("Ο λογαριασμός σου δεν ανήκει ακόμη σε γυμναστήριο.")
        return

    ui.flush_notice(_NOTICE)

    nav.recall(gym_id)
    selected = st.session_state.get("athlete")
    if isinstance(selected, dict) and selected.get("id"):
        nav.remember(str(selected["id"]), st.session_state.get(nav.SESSION_KEY))
        _athlete_sheet(gym_id, selected)
    else:
        nav.remember(None)
        # A malformed value is dropped rather than carried: navigation state is
        # written by four different screens.
        st.session_state.pop("athlete", None)
        _roster(gym_id)
