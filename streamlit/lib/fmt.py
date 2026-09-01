"""How a number, a date and a trainer-typed string are rendered. Pure, no I/O.

Every helper here was written twice — once in `views/athletes.py` and once in
`views/log.py` — by two people who could not see each other's file. Two of them
had already drifted apart, and the pair that matters most is `_decimal`: the
briefing screen and the log screen must read "72,5" as the same number or the
same set renders as two different weights on two screens. One copy, imported by
both, is the only version of that guarantee that survives the next edit.

Nothing here touches Streamlit or the database, so it can be exercised without
either.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime, timezone
from typing import Any

# Greek short month names, spelled the way Intl 'el-GR' spells them in the PWA
# (src/domain/format.ts). Hard-coded rather than taken from strftime: the server
# process has whatever locale Streamlit Cloud happens to boot with, and a Greek
# app that prints "Aug" on Tuesday and "Αυγ" on Wednesday is worse than one that
# always prints the same thing.
MONTHS_EL = (
    "Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαΐ", "Ιουν",
    "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ",
)

DEFAULT_TZ = "Europe/Athens"

EMPTY = "—"

# Rendered where a membership id does not resolve to a name. Never an empty
# string: a number whose author silently vanished reads as if nobody wrote it.
UNKNOWN_AUTHOR = "άγνωστο μέλος"

# Combining diacritical marks, i.e. everything NFD peels off an accented vowel.
_COMBINING = re.compile("[\u0300-\u036f]")

# CommonMark treats all of these as syntax. Athlete names, exercise names and
# note bodies are typed by trainers, and Streamlit renders every string as
# markdown, so an underscore in a name silently becomes italics and an asterisk
# in a warning swallows the text around it.
_MD_SPECIALS = re.compile(r"([\\`*_{}\[\]()<>#+\-.!|$~])")


# ---------------------------------------------------------------------------
# Text
# ---------------------------------------------------------------------------

def md(text: str) -> str:
    """Escape trainer-typed text for a markdown renderer, keeping line breaks.

    The two spaces before the newline are not cosmetic: without them CommonMark
    joins the lines, and a three-line injury warning is rendered as one run-on
    sentence.
    """
    return _MD_SPECIALS.sub(r"\\\1", text or "").replace("\n", "  \n")


def fold(text: str) -> str:
    """Accent- and sigma-insensitive comparison form of one string.

    Used to sort within a muscle group, so Άρσεις sits beside Ασκήσεις, and as
    the first half of `normalize`. JS lowercases "ΠΑΠΑΔΑΚΗΣ" to a final sigma
    while the same coach typing mid-word produces a medial one, so both fold to
    the same letter or the roster search misses the name on the screen.
    """
    stripped = _COMBINING.sub("", unicodedata.normalize("NFD", text or ""))
    return unicodedata.normalize("NFC", stripped).lower().replace("ς", "σ")


def normalize(text: str) -> str:
    """`fold`, with runs of whitespace collapsed — the PWA's `normalizeText`."""
    return " ".join(fold(text).split())


def matches(haystack: str, needle: str) -> bool:
    """Token-wise containment, so "παπ αννα" finds "Άννα Παπαδάκη".

    A coach searching a roster types the surname first about half the time, and a
    plain substring test answers "no results" to a name that is on the screen.
    """
    target = normalize(needle)
    if not target:
        return True
    source = normalize(haystack)
    return all(token in source for token in target.split(" "))


def exercise_name(exercise: dict[str, Any] | None) -> str:
    """Greek first, English as the fallback — a catalogue row may carry only one."""
    if not exercise:
        return EMPTY
    return (exercise.get("name_el") or exercise.get("name_en") or EMPTY).strip() or EMPTY


def author_of(names: dict[str, str], membership_id: Any) -> str:
    """A membership id rendered as the person, never as silence."""
    return names.get(str(membership_id or ""), UNKNOWN_AUTHOR)


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------

def format_day(value: date, today: date) -> str:
    """"12 Αυγ", and "12 Αυγ 2025" once the year stops being obvious.

    The year is not decoration on an old number: "12 Αυγ" against a two-year-old
    top set reads as last month, and the coach loads the bar accordingly.
    """
    head = f"{value.day} {MONTHS_EL[value.month - 1]}"
    return head if value.year == today.year else f"{head} {value.year}"


def parse_instant(value: Any) -> datetime | None:
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


def parse_local_date(value: Any) -> date | None:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    try:
        return date.fromisoformat(str(value or "")[:10])
    except ValueError:
        return None


def instant_day(value: Any, tz: Any) -> date | None:
    """The calendar day an instant fell on IN THE GYM'S ZONE.

    `sessions.local_date` exists because a session logged at 00:30 Athens time is
    Tuesday's, not Monday's UTC slice. Notes carry only `created_at`, so the same
    conversion has to happen here or the note history disagrees with the session
    list by a day for every late evening.
    """
    parsed = parse_instant(value)
    if parsed is None:
        return None
    if tz is not None:
        try:
            return parsed.astimezone(tz).date()
        except (ValueError, OverflowError):
            return None
    return parsed.date()


# ---------------------------------------------------------------------------
# Numbers
# ---------------------------------------------------------------------------

def decimal(value: Any) -> float | None:
    """Tolerant decimal parse. Returns None, never NaN.

    A Greek trainer types "72,5". `float("72,5")` raises and `Number("72,5")`
    would produce a NaN that propagates silently into every volume total and
    chart in the product — the likeliest silent data loss in the whole app. This
    is also the read path: PostgREST hands numeric columns back as strings.
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
    if parsed != parsed or parsed in (float("inf"), float("-inf")):
        return None
    return parsed


def integer(value: Any) -> int | None:
    parsed = decimal(value)
    return None if parsed is None else int(round(parsed))


def format_weight(kg: float) -> str:
    """"72,5" — Greek decimal comma, trailing zeros dropped, plates to 1,25 kg."""
    text = f"{kg:.2f}".rstrip("0").rstrip(".")
    return (text or "0").replace(".", ",")


def weight_input_default(value: Any) -> str:
    """What a κιλά or μέτρα box starts with — the same comma form the coach types."""
    parsed = decimal(value)
    return "" if parsed is None else format_weight(parsed)


def format_duration(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds} δευτ."
    minutes, rest = divmod(seconds, 60)
    # A ragged duration reads as a stopwatch. "1,5 λεπτά" is not how anyone
    # reports a plank.
    if rest:
        return f"{minutes}:{rest:02d}"
    return "1 λεπτό" if minutes == 1 else f"{minutes} λεπτά"


def format_distance(meters: float) -> str:
    if meters >= 1000:
        return f"{meters / 1000:.1f}".replace(".", ",") + " χλμ"
    return f"{round(meters)} μ."


def format_set(row: dict[str, Any], kind: str) -> str:
    """The one-line rendering of a set, per kind: "80×8", "10 επαναλήψεις", "20 λεπτά".

    The kind is passed in rather than read off the row because a block's sets are
    all read in the kind of its first set — 20 treadmill minutes and 10 pull-ups
    stored as the same shape is the bug `set_kind` exists to prevent.
    """
    load = decimal(row.get("load_kg"))
    reps = integer(row.get("reps"))

    if kind == "weight_reps":
        if load is not None and reps is not None:
            return f"{format_weight(load)}×{reps}"
        if load is not None:
            return f"{format_weight(load)} kg"
        if reps is not None:
            return f"{reps} επαναλήψεις"
        return EMPTY

    if kind == "bodyweight":
        if reps is None:
            return EMPTY
        if load is not None and load > 0:
            return f"+{format_weight(load)}×{reps}"
        return f"{reps} επαναλήψεις"

    if kind == "duration":
        seconds = integer(row.get("seconds"))
        return EMPTY if seconds is None or seconds < 0 else format_duration(seconds)

    if kind == "distance":
        meters = decimal(row.get("meters"))
        return EMPTY if meters is None or meters < 0 else format_distance(meters)

    return EMPTY


def score(row: dict[str, Any]) -> float:
    """One comparable magnitude per set, so "the top one" means something for every kind."""
    for column in ("load_kg", "meters", "seconds", "reps"):
        value = decimal(row.get(column))
        if value is not None:
            return value
    return 0.0
