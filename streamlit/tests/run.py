"""Runs the Προπόνηση screen the way a coach does, and checks what came out.

    python3 tests/run.py        (from the streamlit/ directory)

No pytest, for the same reason `supabase/tests/run.sh` is a shell script: one
more dependency between somebody and running the tests is one more reason the
tests do not get run.

These are screen tests, not unit tests. Every one of them presses a real button
through `streamlit.testing.v1.AppTest` and then reads the rows that the press
produced, because the bugs this file exists to catch were all of that shape — a
column missing from a `select`, a widget disagreeing with the page it is on, a
delete with no way back. None of them is visible in the source of the function
that contains it.
"""

from __future__ import annotations

import pathlib
import sys
import traceback

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import state  # noqa: E402
from lib import db  # noqa: E402
from streamlit.testing.v1 import AppTest  # noqa: E402

DRIVER = str(HERE / "_drive_log.py")

_failures: list[str] = []
_passes = 0


def check(label: str, condition: bool, detail: str = "") -> None:
    global _passes
    if condition:
        _passes += 1
        print(f"  ✓ {label}")
    else:
        _failures.append(f"{label}{(' — ' + detail) if detail else ''}")
        print(f"  ✗ {label}" + (f" — {detail}" if detail else ""))


def open_log(**session_state) -> AppTest:
    """The log screen, signed in, on the seeded athlete's open workout."""
    at = AppTest.from_file(DRIVER, default_timeout=60)
    at.session_state[db.ACCESS_KEY] = "fake-access"
    at.session_state[db.REFRESH_KEY] = "fake-refresh"
    at.session_state[db.USER_ID_KEY] = state.USER_ID
    at.session_state["_auth_expires_at"] = 9e12
    at.session_state["athlete"] = state.STORE["athletes"][0]
    at.session_state["session_id"] = state.SESSION
    for key, value in session_state.items():
        at.session_state[key] = value
    at.run()
    raise_on_exception(at)
    return at


def raise_on_exception(at: AppTest) -> None:
    if at.exception:
        raise AssertionError("; ".join(str(e.value) for e in at.exception))


def button(at: AppTest, key: str):
    for widget in at.button:
        # A form's submit button is keyed "FormSubmitter:<form>-<label>", so the
        # form id is a substring rather than the whole key.
        if widget.key == key or key in (widget.key or ""):
            return widget
    raise AssertionError(f"no button {key!r}; have {[b.key for b in at.button]}")


def exercise_picker(at: AppTest):
    """The «Άσκηση» search box. Its key carries a generation counter."""
    return [widget for widget in at.selectbox if widget.label == "Άσκηση"][0]


def texts(at: AppTest) -> str:
    out = []
    for kind in ("markdown", "caption", "header", "subheader",
                 "info", "warning", "error", "success"):
        for element in getattr(at, kind):
            out.append(str(element.value))
    return "\n".join(out)


# ---------------------------------------------------------------------------

def test_equipment_is_on_the_block_card() -> None:
    """The όργανο, on the card and not only in the picker.

    «Πιέσεις Στήθους · 40×10» read back without "Αλτήρες" is how a coach loads
    40 kg on a barbell for an athlete who pressed two 20s.
    """
    state.reset()
    at = open_log()
    check(
        "block card names the όργανο",
        "Πιέσεις Στήθους · Μπάρα" in texts(at),
        texts(at)[:200],
    )


def test_picker_offers_the_three_variants_apart() -> None:
    state.reset()
    at = open_log()
    picker = [s for s in at.selectbox if s.label == "Άσκηση"][0]
    # AppTest reports the options as the coach sees them, already formatted.
    labels = list(picker.options)
    check("picker separates the three variants",
          # Latin before Greek is what fold() gives, and any stable order beats
          # the id order this replaced: the point is that a coach who saw
          # «Smith» second yesterday sees it second today.
          labels == ["Πιέσεις Στήθους · Smith",
                     "Πιέσεις Στήθους · Αλτήρες",
                     "Πιέσεις Στήθους · Μπάρα"],
          str(labels))


def test_adding_an_exercise_stays_on_the_workout() -> None:
    """The bug the gym reported: adding an exercise threw them back to the roster."""
    state.reset()
    at = open_log()
    picker = exercise_picker(at)
    check("the Smith variant is offered by name",
          any("Smith" in option for option in picker.options), str(picker.options))
    # set_value takes the option's underlying value — an exercise id — while
    # .options reports the formatted labels the coach reads.
    # One tap: choosing the exercise IS adding it, with no second press to
    # confirm what the first one already said.
    picker.set_value("e-smith").run()
    raise_on_exception(at)

    blocks = state.rows("blocks", session_id=state.SESSION)
    check("the exercise went into the workout", len(blocks) == 2, str(blocks))
    check("and it is the Smith one, not the barbell",
          any(b["exercise_id"] == "e-smith" for b in blocks), str(blocks))
    check("the coach is still on the workout",
          "Δημήτρης Καμουτσής" in texts(at))


def test_choosing_an_exercise_adds_it_exactly_once() -> None:
    """The widget keeps its value across reruns; the add must not repeat with it."""
    state.reset()
    at = open_log()
    picker = exercise_picker(at)
    picker.set_value("e-smith").run()
    raise_on_exception(at)
    # Any later interaction reruns the script with the widget state as it stands.
    at.run()
    raise_on_exception(at)

    smith = [b for b in state.rows("blocks", session_id=state.SESSION)
             if b["exercise_id"] == "e-smith"]
    check("added once, not once per rerun", len(smith) == 1, str(smith))


def test_the_search_reaches_every_exercise_without_choosing_a_group() -> None:
    """«Όλες οι ασκήσεις» is the default, so a coach can type the name straight away."""
    state.reset()
    at = open_log()
    groups = [s for s in at.selectbox if s.label == "Μυϊκή ομάδα"][0]
    check("«Όλες οι ασκήσεις» is the first option",
          groups.options[0].startswith("Όλες"), str(groups.options))
    # -1 is the sentinel the screen uses for «Όλες»; the real groups are indexes.
    check("and it is the one selected", groups.value == -1, str(groups.value))
    picker = exercise_picker(at)
    check("and the search offers all three variants at once",
          len(picker.options) == 3, str(picker.options))
    check("with nothing preselected, so nothing is added by opening the picker",
          picker.value is None, str(picker.value))


def test_last_weeks_exercises_are_one_tap() -> None:
    """A coach repeats a programme far more often than they invent one."""
    state.reset()
    at = open_log()
    labels = [b.label for b in at.button if b.label.startswith("+ ")]
    check("last week's exercise is offered", labels == ["+ Πιέσεις Στήθους · Αλτήρες"], str(labels))
    check("today's is not offered twice",
          not any("Μπάρα" in label for label in labels), str(labels))

    button(at, "log_again_e-db").click().run()
    raise_on_exception(at)
    blocks = state.rows("blocks", session_id=state.SESSION)
    check("one tap put it in the workout",
          any(b["exercise_id"] == "e-db" for b in blocks), str(blocks))


def test_logging_a_set_reads_a_greek_decimal() -> None:
    state.reset()
    at = open_log()
    at.text_input(key=f"log_kg_{state.BLOCK}").set_value("72,5")
    at.number_input(key=f"log_reps_{state.BLOCK}").set_value(5)
    button(at, f"log_set_{state.BLOCK}").click().run()
    raise_on_exception(at)

    rows = [r for r in state.rows("sets", block_id=state.BLOCK) if r["id"] != state.SET]
    check("the set was written", len(rows) == 1, str(rows))
    check("72,5 was read as 72.5 and not as NaN",
          bool(rows) and rows[0].get("load_kg") == 72.5, str(rows))


def test_a_set_can_be_deleted_and_taken_back() -> None:
    state.reset()
    at = open_log()
    button(at, f"log_del_set_{state.SET}").click().run()
    raise_on_exception(at)
    check("the set is gone", state.deleted("sets", state.SET))
    check("with an offer to undo it", "Διαγράφηκε: 80×8" in texts(at), texts(at)[:300])

    button(at, "log_notice_undo_button").click().run()
    raise_on_exception(at)
    check("and undo brings it back", not state.deleted("sets", state.SET))
    check("the set is on the card again", "80×8" in texts(at))


def test_removing_an_exercise_takes_its_sets_and_gives_them_back() -> None:
    """Both halves together. A block restored without its sets is an empty heading."""
    state.reset()
    at = open_log()
    button(at, f"log_del_block_{state.BLOCK}").click().run()
    raise_on_exception(at)
    check("the exercise is gone", state.deleted("blocks", state.BLOCK))
    check("its sets went with it", state.deleted("sets", state.SET))
    check("with an offer to undo it",
          "Αφαιρέθηκε: Πιέσεις Στήθους · Μπάρα" in texts(at), texts(at)[:300])

    button(at, "log_notice_undo_button").click().run()
    raise_on_exception(at)
    check("undo restores the exercise", not state.deleted("blocks", state.BLOCK))
    check("and the sets it had", not state.deleted("sets", state.SET))


def test_editing_the_workout_saves_what_may_change() -> None:
    state.reset()
    at = open_log()
    title = [t for t in at.text_input if t.label == "Τίτλος"][0]
    title.set_value("Στήθος / πλάτη")
    notes = [t for t in at.text_area if t.label == "Σημειώσεις"][0]
    notes.set_value("Πονάει ο δεξιός ώμος.")
    credited = [s for s in at.selectbox if s.label == "Χρεώνεται σε"][0]
    credited.set_value(state.TRAINER)
    button(at, "log_edit_session").click().run()
    raise_on_exception(at)

    row = state.rows("sessions", id=state.SESSION)[0]
    check("the title is saved", row.get("title") == "Στήθος / πλάτη", str(row.get("title")))
    check("the notes are saved", row.get("notes") == "Πονάει ο δεξιός ώμος.")
    check("the credit moved to the colleague", row.get("credited_to") == state.TRAINER)
    check("who typed it did NOT move", row.get("logged_by") == state.OWNER)


def test_moving_the_workout_to_another_day_keeps_the_time() -> None:
    """started_at, never local_date: the trigger derives the day from the instant."""
    import datetime

    state.reset()
    at = open_log()
    day = [d for d in at.date_input if d.label == "Ημερομηνία"][0]
    day.set_value(datetime.date(2026, 8, 25))
    button(at, "log_edit_session").click().run()
    raise_on_exception(at)

    row = state.rows("sessions", id=state.SESSION)[0]
    moved = datetime.datetime.fromisoformat(str(row["started_at"]))
    athens = moved.astimezone(datetime.timezone(datetime.timedelta(hours=3)))
    check("the workout moved to the chosen day", athens.date() == datetime.date(2026, 8, 25),
          str(row["started_at"]))
    check("and it is still a 10:00 session", athens.hour == 10, str(athens))


def test_deleting_the_workout_does_not_start_another_one() -> None:
    """The trap: render() opens a workout whenever session_id is empty."""
    state.reset()
    before = len(state.STORE["sessions"])
    at = open_log()
    button(at, "log_delete_session").click().run()
    raise_on_exception(at)

    check("the workout is gone", state.deleted("sessions", state.SESSION))
    check("no replacement workout was started",
          len(state.STORE["sessions"]) == before, str(state.STORE["sessions"]))
    check("the screen says so", "Η προπόνηση διαγράφηκε." in texts(at), texts(at)[:300])

    button(at, "log_deleted_undo").click().run()
    raise_on_exception(at)
    check("undo brings the workout back", not state.deleted("sessions", state.SESSION))
    check("still no extra workout", len(state.STORE["sessions"]) == before)
    check("and the sets are on screen again", "80×8" in texts(at), texts(at)[:300])


# ---------------------------------------------------------------------------

def main() -> int:
    tests = [value for name, value in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        print(f"\n{test.__name__}")
        doc = (test.__doc__ or "").strip().splitlines()
        if doc:
            print(f"  ({doc[0]})")
        try:
            test()
        except Exception:
            _failures.append(f"{test.__name__} raised")
            print("  ✗ raised:")
            print("    " + traceback.format_exc().replace("\n", "\n    ")[:1500])

    print(f"\n{_passes} checks passed, {len(_failures)} failed")
    for failure in _failures:
        print(f"  - {failure}")
    return 1 if _failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
