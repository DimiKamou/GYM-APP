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

import re
import unicodedata
from datetime import date, datetime, timezone
from typing import Any

import streamlit as st

from lib import db

# Greek short month names, spelled the way Intl 'el-GR' spells them in the PWA
# (src/domain/format.ts). Hard-coded rather than taken from strftime: the server
# process has whatever locale Streamlit Cloud happens to boot with, and a Greek
# app that prints "Aug" on Tuesday and "Αυγ" on Wednesday is worse than one that
# always prints the same thing.
_MONTHS_EL = (
    "Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαΐ", "Ιουν",
    "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ",
)

_DEFAULT_TZ = "Europe/Athens"

# Same count as the PWA's briefing card. Three lines is what a coach reads
# standing up; the fourth is already scrolling.
_TOP_LINES = 3

# Rendered where a membership id does not resolve to a name. Never an empty
# string: a note whose author silently vanished reads as if nobody wrote it.
_UNKNOWN_AUTHOR = "άγνωστο μέλος"

_EMPTY = "—"

_NOTICE = "athletes_notice"
_QUERY = "athletes_query"

# Combining diacritical marks, i.e. everything NFD peels off an accented vowel.
_COMBINING = re.compile("[\u0300-\u036f]")

# CommonMark treats all of these as syntax. Note bodies and athlete names are
# typed by trainers, and Streamlit renders them as markdown, so an underscore in
# a name or an asterisk in a warning would silently restyle or swallow text.
_MD_SPECIALS = re.compile(r"([\\`*_{}\[\]()<>#+\-.!|$~])")


# ---------------------------------------------------------------------------
# Text
# ---------------------------------------------------------------------------

def _normalize(text: str) -> str:
    """The comparison form the PWA's `normalizeText` produces.

    A coach types "παπαδακη", never "Παπαδάκη", and JS lowercases "ΠΑΠΑΔΑΚΗΣ" to
    a final sigma while the same coach typing mid-word produces a medial one.
    Folding both, plus the accents, is what makes the roster search find the
    athlete they are looking at.
    """
    stripped = _COMBINING.sub("", unicodedata.normalize("NFD", text or ""))
    folded = unicodedata.normalize("NFC", stripped).lower().replace("ς", "σ")
    return " ".join(folded.split())


def _matches(haystack: str, needle: str) -> bool:
    """Token-wise containment, so "παπ αννα" finds "Άννα Παπαδάκη".

    A coach searching a roster types the surname first about half the time, and a
    plain substring test answers "no results" to a name that is on the screen.
    """
    target = _normalize(needle)
    if not target:
        return True
    source = _normalize(haystack)
    return all(token in source for token in target.split(" "))


def _md(text: str) -> str:
    """Escape trainer-typed text for a markdown renderer, keeping line breaks."""
    return _MD_SPECIALS.sub(r"\\\1", text or "").replace("\n", "  \n")


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------

def _format_day(value: date, today: date) -> str:
    """"12 Αυγ", and "12 Αυγ 2025" once the year stops being obvious.

    The year is not decoration on an old note: "12 Αυγ" on a two-year-old
    shoulder warning reads as last month.
    """
    head = f"{value.day} {_MONTHS_EL[value.month - 1]}"
    return head if value.year == today.year else f"{head} {value.year}"


def _parse_instant(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    text = str(value or "").strip()
    if not text:
        return None
    # PostgREST hands back "+00:00" on some columns and a bare "Z" on others.
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _instant_day(value: Any, tz: Any) -> date | None:
    """The calendar day an instant fell on IN THE GYM'S ZONE.

    `sessions.local_date` exists because a session logged at 00:30 Athens time is
    Tuesday's, not Monday's UTC slice. Notes carry only `created_at`, so the same
    conversion has to happen here or the note history disagrees with the session
    list by a day for every late evening.
    """
    parsed = _parse_instant(value)
    if parsed is None:
        return None
    if tz is not None:
        try:
            return parsed.astimezone(tz).date()
        except (ValueError, OverflowError):
            return None
    return parsed.date()


def _parse_local_date(value: Any) -> date | None:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    try:
        return date.fromisoformat(str(value or "")[:10])
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Numbers
# ---------------------------------------------------------------------------

def _decimal(value: Any) -> float | None:
    """Tolerant decimal parse. Returns None, never NaN.

    A Greek trainer types "72,5" and PostgREST can hand a numeric column back as
    a string, so `float()` alone raises on the comma while `Number()`-style
    coercion would produce a NaN that propagates into every total downstream.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        parsed = float(value)
    else:
        text = str(value).strip().replace(",", ".")
        if not text:
            return None
        try:
            parsed = float(text)
        except ValueError:
            return None
    return parsed if parsed == parsed and parsed not in (float("inf"), float("-inf")) else None


def _integer(value: Any) -> int | None:
    parsed = _decimal(value)
    return None if parsed is None else int(round(parsed))


def _format_weight(kg: float) -> str:
    """"72,5" — Greek decimal comma, trailing zeros dropped, plates to 1,25 kg."""
    text = f"{kg:.2f}".rstrip("0").rstrip(".")
    return (text or "0").replace(".", ",")


def _format_duration(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds} δευτ."
    minutes, rest = divmod(seconds, 60)
    # A ragged duration reads as a stopwatch. "1,5 λεπτά" is not how anyone
    # reports a plank.
    if rest:
        return f"{minutes}:{rest:02d}"
    return "1 λεπτό" if minutes == 1 else f"{minutes} λεπτά"


def _format_distance(meters: float) -> str:
    if meters >= 1000:
        return f"{meters / 1000:.1f}".replace(".", ",") + " χλμ"
    return f"{round(meters)} μ."


def _format_set(row: dict[str, Any], kind: str) -> str:
    """The one-line rendering of a set, per kind: "80×8", "10 επαναλήψεις", "20 λεπτά".

    The kind is passed in rather than read off the row because a block's sets are
    all read in the kind of its first set — 20 treadmill minutes and 10 pull-ups
    stored as the same shape is the bug `set_kind` exists to prevent.
    """
    load = _decimal(row.get("load_kg"))
    reps = _integer(row.get("reps"))

    if kind == "weight_reps":
        if load is not None and reps is not None:
            return f"{_format_weight(load)}×{reps}"
        if load is not None:
            return f"{_format_weight(load)} kg"
        if reps is not None:
            return f"{reps} επαναλήψεις"
        return _EMPTY

    if kind == "bodyweight":
        if reps is None:
            return _EMPTY
        if load is not None and load > 0:
            return f"+{_format_weight(load)}×{reps}"
        return f"{reps} επαναλήψεις"

    if kind == "duration":
        seconds = _integer(row.get("seconds"))
        return _EMPTY if seconds is None or seconds < 0 else _format_duration(seconds)

    if kind == "distance":
        meters = _decimal(row.get("meters"))
        return _EMPTY if meters is None or meters < 0 else _format_distance(meters)

    return _EMPTY


def _score(row: dict[str, Any]) -> float:
    """One comparable magnitude per set, so "the top one" means something for every kind."""
    for column in ("load_kg", "meters", "seconds", "reps"):
        value = _decimal(row.get(column))
        if value is not None:
            return value
    return 0.0


# ---------------------------------------------------------------------------
# Reads
#
# Every one of these takes gym_id first, even where the body does not need it.
# @st.cache_data is global to the server process, so a cache hit is served
# without ever reaching a policy — the tenant has to be part of the key or the
# cache is the leak that RLS was there to prevent.
# ---------------------------------------------------------------------------

@st.cache_data(ttl=300, show_spinner=False)
def _gym_timezone(gym_id: str) -> str:
    row = (
        db.client()
        .table("gyms")
        .select("timezone")
        .eq("id", gym_id)
        .limit(1)
        .execute()
        .data
    )
    return (row[0].get("timezone") if row else None) or _DEFAULT_TZ


@st.cache_data(ttl=300, show_spinner=False)
def _member_names(gym_id: str) -> dict[str, str]:
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
    return {row["id"]: row.get("display_name") or _UNKNOWN_AUTHOR for row in rows}


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
    # Greek first, English as the fallback — a catalogue row may carry only one.
    names = {row["id"]: (row.get("name_el") or row.get("name_en") or "") for row in exercises}

    by_block: dict[str, list[dict[str, Any]]] = {}
    for row in sets:
        by_block.setdefault(row["block_id"], []).append(row)

    lines: list[str] = []
    for block in blocks:
        performed = by_block.get(block["id"]) or []
        name = names.get(block.get("exercise_id") or "")
        if not performed or not name:
            continue
        # The kind of the first set is the block's kind: a treadmill block and a
        # bench block are not comparable and must not be rendered alike.
        kind = performed[0].get("kind") or "weight_reps"
        top = max(performed, key=_score)
        lines.append(f"{name} · {_format_set(top, kind)}")
        if len(lines) == _TOP_LINES:
            break
    return lines


# ---------------------------------------------------------------------------
# Small view helpers
# ---------------------------------------------------------------------------

def _zone(gym_id: str) -> Any:
    """The gym's tz object, or None when the platform has no tz database."""
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(_gym_timezone(gym_id))
    except Exception:
        return None


def _author_of(names: dict[str, str], membership_id: Any) -> str:
    return names.get(str(membership_id or ""), _UNKNOWN_AUTHOR)


def _attribution(names: dict[str, str], membership_id: Any, day: date | None, today: date) -> str:
    """"Μαρία · 12 Αυγ". Both halves, always — see the module docstring."""
    when = _format_day(day, today) if day else _EMPTY
    return f"{_author_of(names, membership_id)} · {when}"


def _flush_notice() -> None:
    notice = st.session_state.pop(_NOTICE, None)
    if not notice:
        return
    kind, message = notice
    if kind == "ok":
        st.success(message)
    else:
        st.error(message)


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
        st.session_state[_NOTICE] = ("error", "Η σελίδα καταγραφής δεν είναι διαθέσιμη.")
        st.rerun()
    st.switch_page(page)


# ---------------------------------------------------------------------------
# The roster
# ---------------------------------------------------------------------------

def _new_athlete_form(gym: str, expanded: bool) -> None:
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
                {"gym_id": gym, "full_name": name}
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
        st.session_state[_NOTICE] = ("ok", f"Ο/Η {name} μπήκε στη λίστα.")
        st.rerun()


def _roster(gym: str) -> None:
    st.header("Αθλητές")

    try:
        athletes = _athletes(gym)
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

    shown = [a for a in athletes if _matches(a.get("full_name") or "", query or "")]

    if not athletes:
        st.info("Κανένας αθλητής ακόμα. Πρόσθεσε τον πρώτο πιο κάτω.")
    elif not shown:
        st.info(f"Κανένας αθλητής δεν ταιριάζει με «{query}».")
    else:
        for athlete in shown:
            with st.container(border=True):
                details, open_col, log_col = st.columns([6, 2, 3], vertical_alignment="center")
                with details:
                    st.markdown(f"**{_md(athlete.get('full_name') or _EMPTY)}**")
                    phase = (athlete.get("plan_phase") or "").strip()
                    if phase:
                        st.caption(_md(phase))
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
    _new_athlete_form(gym, expanded=not athletes)


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
        day = _instant_day(note.get("created_at"), tz)
        st.error(
            f"{_md(note.get('body') or '')}\n\n"
            f"— {_md(_attribution(names, note.get('author'), day, today))}"
        )


def _last_session_section(
    gym: str,
    athlete_id: str,
    names: dict[str, str],
    today: date,
) -> None:
    st.subheader("Τελευταία προπόνηση")

    try:
        session = _last_session(gym, athlete_id)
    except Exception as exc:
        st.error("Η τελευταία προπόνηση δεν φορτώθηκε.")
        st.caption(str(exc))
        return

    if not session:
        st.info("Καμία προπόνηση ακόμα.")
        return

    day = _parse_local_date(session.get("local_date"))
    header = _attribution(names, session.get("logged_by"), day, today)
    title = (session.get("title") or "").strip()
    if title:
        header = f"{header} · {title}"
    st.markdown(f"**{_md(header)}**")

    # Two different facts, and the schema keeps them apart for a reason: who
    # typed it is immutable, who it is credited to is the editable half.
    credited = session.get("credited_to")
    if credited and credited != session.get("logged_by"):
        st.caption(f"Χρεώνεται σε {_md(_author_of(names, credited))}")

    if (session.get("status") or "") == "active":
        st.caption("Σε εξέλιξη.")

    try:
        lines = _top_lines(gym, session["id"])
    except Exception as exc:
        st.caption("Οι ασκήσεις της προπόνησης δεν φορτώθηκαν.")
        st.caption(str(exc))
        return

    if lines:
        for line in lines:
            st.markdown(f"- {_md(line)}")
    else:
        st.caption("Καμία καταγεγραμμένη άσκηση σε αυτή την προπόνηση.")

    session_notes = (session.get("notes") or "").strip()
    if session_notes:
        st.caption(_md(session_notes))


def _history_section(notes: list[dict[str, Any]], names: dict[str, str], tz: Any, today: date) -> None:
    st.subheader("Σημειώσεις")

    if not notes:
        st.info("Καμία σημείωση ακόμα.")
        return

    for note in notes:
        day = _instant_day(note.get("created_at"), tz)
        with st.container(border=True):
            st.markdown(_md(note.get("body") or ""))
            meta = _attribution(names, note.get("author"), day, today)
            if note.get("pinned") and not note.get("dismissed_at"):
                meta = f"Καρφιτσωμένη · {meta}"
            elif note.get("dismissed_at"):
                meta = f"Αποκρύφθηκε · {meta}"
            st.caption(_md(meta))


def _new_note_form(gym: str, athlete_id: str) -> None:
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
            {"gym_id": gym, "athlete_id": athlete_id, "body": text, "pinned": bool(pinned)}
        ).execute()
    except Exception as exc:
        st.error("Η σημείωση δεν καταχωρήθηκε.")
        st.caption(str(exc))
        return

    _notes.clear()
    st.session_state[_NOTICE] = ("ok", "Η σημείωση καταχωρήθηκε.")
    st.rerun()


def _athlete_sheet(gym: str, selected: dict[str, Any]) -> None:
    athlete_id = str(selected.get("id") or "")

    if st.button("← Όλοι οι αθλητές", key="athlete_back"):
        st.session_state.pop("athlete", None)
        st.rerun()

    try:
        roster = _athletes(gym)
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

    st.header(_md(current.get("full_name") or _EMPTY))
    plan = " · ".join(
        part
        for part in (
            (current.get("plan_phase") or "").strip(),
            (current.get("plan_focus") or "").strip(),
        )
        if part
    )
    if plan:
        st.caption(_md(plan))

    tz = _zone(gym)
    today = datetime.now(tz).date() if tz is not None else datetime.now(timezone.utc).date()

    try:
        names = _member_names(gym)
    except Exception:
        # An unreachable roster must not blank the briefing: the warnings and the
        # last session still matter, and _author_of falls back to a named
        # "unknown member" rather than to silence.
        names = {}

    try:
        notes = _notes(gym, athlete_id)
    except Exception as exc:
        notes = []
        st.error("Οι σημειώσεις δεν φορτώθηκαν.")
        st.caption(str(exc))

    _pinned_section(notes, names, tz, today)

    _last_session_section(gym, athlete_id, names, today)

    if st.button("Νέα προπόνηση", key="athlete_new_session", type="primary"):
        _start_session(current)

    st.divider()
    _history_section(notes, names, tz, today)

    st.divider()
    _new_note_form(gym, athlete_id)


# ---------------------------------------------------------------------------

def render() -> None:
    gym = db.gym_id()
    if not gym:
        st.header("Αθλητές")
        st.info("Ο λογαριασμός σου δεν ανήκει ακόμη σε γυμναστήριο.")
        return

    _flush_notice()

    selected = st.session_state.get("athlete")
    if isinstance(selected, dict) and selected.get("id"):
        _athlete_sheet(gym, selected)
    else:
        # A malformed value is dropped rather than carried: navigation state is
        # written by four different screens.
        st.session_state.pop("athlete", None)
        _roster(gym)
