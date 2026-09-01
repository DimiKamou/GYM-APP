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

from datetime import date
from typing import Any

import streamlit as st

from lib import db, fmt, gym, ui

# Same count as the PWA's briefing card. Three lines is what a coach reads
# standing up; the fourth is already scrolling.
_TOP_LINES = 3

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


@st.cache_data(ttl=30, show_spinner=False)
def _top_lines(gym_id: str, session_id: str) -> list[str]:
    """"Πιέσεις Στήθους · 72,5×5" — the top set of each of the session's first blocks."""
    client = db.client()

    blocks = (
        client.table("blocks")
        .select("id, exercise_id, position")
        .eq("gym_id", gym_id)
        .eq("session_id", session_id)
        .is_("deleted_at", "null")
        # (position, id), never position alone: two offline inserts can mint the
        # same position and the id is the only tie-break both devices agree on.
        .order("position")
        .order("id")
        .execute()
        .data
        or []
    )
    if not blocks:
        return []

    sets = (
        client.table("sets")
        .select("id, block_id, position, kind, load_kg, reps, seconds, meters")
        .eq("gym_id", gym_id)
        .in_("block_id", [block["id"] for block in blocks])
        .is_("deleted_at", "null")
        .order("position")
        .order("id")
        .execute()
        .data
        or []
    )
    if not sets:
        return []

    exercise_ids = sorted({block["exercise_id"] for block in blocks if block.get("exercise_id")})
    exercises: list[dict[str, Any]] = []
    if exercise_ids:
        exercises = (
            client.table("exercises")
            .select("id, name_el, name_en")
            .in_("id", exercise_ids)
            .execute()
            .data
            or []
        )
    by_id = {row["id"]: row for row in exercises}

    by_block: dict[str, list[dict[str, Any]]] = {}
    for row in sets:
        by_block.setdefault(row["block_id"], []).append(row)

    lines: list[str] = []
    for block in blocks:
        performed = by_block.get(block["id"]) or []
        exercise = by_id.get(block.get("exercise_id") or "")
        if not performed or exercise is None:
            continue
        # The kind of the first set is the block's kind: a treadmill block and a
        # bench block are not comparable and must not be rendered alike.
        kind = performed[0].get("kind") or "weight_reps"
        top = max(performed, key=fmt.score)
        # Greek first, English as the fallback, from the same helper the log screen
        # uses — the two screens naming the same exercise differently is the seam.
        lines.append(f"{fmt.exercise_name(exercise)} · {fmt.format_set(top, kind)}")
        if len(lines) == _TOP_LINES:
            break
    return lines


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
    st.session_state["athlete"] = athlete
    st.session_state.pop("session_id", None)
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

    # Outside a form on purpose: filtering a list is the one place where a
    # keystroke should change the screen, and every read behind it is cached.
    query = st.text_input(
        "Αναζήτηση",
        key=_QUERY,
        placeholder="Όνομα αθλητή",
        label_visibility="collapsed",
    )

    shown = [a for a in athletes if fmt.matches(a.get("full_name") or "", query or "")]

    if not athletes:
        st.info("Κανένας αθλητής ακόμα. Πρόσθεσε τον πρώτο πιο κάτω.")
    elif not shown:
        st.info(f"Κανένας αθλητής δεν ταιριάζει με «{query}».")
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
    st.subheader("Τελευταία προπόνηση")

    try:
        session = _last_session(gym_id, athlete_id)
    except Exception as exc:
        st.error("Η τελευταία προπόνηση δεν φορτώθηκε.")
        st.caption(str(exc))
        return

    if not session:
        st.info("Καμία προπόνηση ακόμα.")
        return

    day = fmt.parse_local_date(session.get("local_date"))
    header = _attribution(names, session.get("logged_by"), day, today)
    title = (session.get("title") or "").strip()
    if title:
        header = f"{header} · {title}"
    st.markdown(f"**{fmt.md(header)}**")

    # Two different facts, and the schema keeps them apart for a reason: who
    # typed it is immutable, who it is credited to is the editable half.
    credited = session.get("credited_to")
    if credited and credited != session.get("logged_by"):
        st.caption(f"Χρεώνεται σε {fmt.md(fmt.author_of(names, credited))}")

    if (session.get("status") or "") == "active":
        st.caption("Σε εξέλιξη.")

    try:
        lines = _top_lines(gym_id, session["id"])
    except Exception as exc:
        st.caption("Οι ασκήσεις της προπόνησης δεν φορτώθηκαν.")
        st.caption(str(exc))
        return

    if lines:
        for line in lines:
            st.markdown(f"- {fmt.md(line)}")
    else:
        st.caption("Καμία καταγεγραμμένη άσκηση σε αυτή την προπόνηση.")

    session_notes = (session.get("notes") or "").strip()
    if session_notes:
        st.caption(fmt.md(session_notes))


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

    _pinned_section(notes, names, tz, today)

    _last_session_section(gym_id, athlete_id, names, today)

    if st.button("Νέα προπόνηση", key="athlete_new_session", type="primary"):
        _start_session(current)

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

    selected = st.session_state.get("athlete")
    if isinstance(selected, dict) and selected.get("id"):
        _athlete_sheet(gym_id, selected)
    else:
        # A malformed value is dropped rather than carried: navigation state is
        # written by four different screens.
        st.session_state.pop("athlete", None)
        _roster(gym_id)
