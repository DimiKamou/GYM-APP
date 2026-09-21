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

import os
import pathlib
import sys
import time
import traceback

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

# lib/db.py refuses to build a client without these, and they live in the
# gitignored secrets.toml — so a fresh clone got 47 failures that all read
# "no gym yet". The values are never dialled: create_client is replaced below.
os.environ.setdefault("SUPABASE_URL", "http://fake.invalid")
os.environ.setdefault("SUPABASE_ANON_KEY", "fake-anon-key")
os.environ.setdefault("USERNAME_DOMAIN", "powerhouse.gr")

import fake_supabase  # noqa: E402
import state  # noqa: E402
from lib import db  # noqa: E402
from fake_supabase import FakeClient  # noqa: E402
from streamlit.testing.v1 import AppTest  # noqa: E402

# lib/auth.py reaches the server through db.client(); the unit tests below call
# it outside any AppTest run, so the seam has to be open here too.
db.create_client = lambda *args, **kwargs: FakeClient(state.STORE, state.USER_ID, state.stamp)

DRIVER = str(HERE / "_drive_log.py")
ATHLETES_DRIVER = str(HERE / "_drive_athletes.py")
LIBRARY_DRIVER = str(HERE / "_drive_library.py")
CALENDAR_DRIVER = str(HERE / "_drive_calendar.py")
PROGRESS_DRIVER = str(HERE / "_drive_progress.py")

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
        if value is None:
            del at.session_state[key]
        else:
            at.session_state[key] = value
    at.run()
    raise_on_exception(at)
    return at


def open_athlete(**session_state) -> AppTest:
    """The Αθλητές screen, signed in, with the seeded athlete's sheet open."""
    at = AppTest.from_file(ATHLETES_DRIVER, default_timeout=60)
    at.session_state[db.ACCESS_KEY] = "fake-access"
    at.session_state[db.REFRESH_KEY] = "fake-refresh"
    at.session_state[db.USER_ID_KEY] = state.USER_ID
    at.session_state["_auth_expires_at"] = 9e12
    at.session_state["athlete"] = state.STORE["athletes"][0]
    for key, value in session_state.items():
        at.session_state[key] = value
    at.run()
    raise_on_exception(at)
    return at


def open_library(**session_state) -> AppTest:
    """The Ασκήσεις screen, signed in."""
    at = AppTest.from_file(LIBRARY_DRIVER, default_timeout=60)
    at.session_state[db.ACCESS_KEY] = "fake-access"
    at.session_state[db.REFRESH_KEY] = "fake-refresh"
    at.session_state[db.USER_ID_KEY] = state.USER_ID
    at.session_state["_auth_expires_at"] = 9e12
    for key, value in session_state.items():
        at.session_state[key] = value
    at.run()
    raise_on_exception(at)
    return at


def open_screen(driver: str, **session_state) -> AppTest:
    """Any other screen, signed in, with the seeded athlete on the sheet."""
    at = AppTest.from_file(driver, default_timeout=60)
    at.session_state[db.ACCESS_KEY] = "fake-access"
    at.session_state[db.REFRESH_KEY] = "fake-refresh"
    at.session_state[db.USER_ID_KEY] = state.USER_ID
    at.session_state["_auth_expires_at"] = 9e12
    at.session_state["athlete"] = state.STORE["athletes"][0]
    for key, value in session_state.items():
        at.session_state[key] = value
    at.run()
    raise_on_exception(at)
    return at


def press(at: AppTest, key: str) -> AppTest:
    """Click a button the way a thumb can: never one the screen has greyed out.

    AppTest happily clicks a disabled widget and runs its handler, so a
    regression that greys a live button out was invisible to every test that
    clicked it.
    """
    widget = button(at, key)
    if getattr(widget, "disabled", False):
        raise AssertionError(f"button {key!r} is disabled")
    widget.click().run()
    raise_on_exception(at)
    return at


def raise_on_exception(at: AppTest) -> None:
    if at.exception:
        raise AssertionError("; ".join(str(e.value) for e in at.exception))


def button(at: AppTest, key: str):
    """The button with this key, or the submit button of the form with this id.

    Exact before prefix, and never a loose substring: "athlete_edit" matched
    "athlete_edit_session" that way and the test pressed a navigation button
    while believing it had saved a form.
    """
    for widget in at.button:
        if widget.key == key:
            return widget
    # A form's submit button is keyed "FormSubmitter:<form id>-<label>".
    for widget in at.button:
        if (widget.key or "").startswith(f"FormSubmitter:{key}-"):
            return widget
    raise AssertionError(f"no button {key!r}; have {[b.key for b in at.button]}")


def name_list(at: AppTest):
    """The second list: one entry per movement, whatever it is loaded with."""
    return [widget for widget in at.selectbox if widget.label == "Άσκηση"][0]


def way_list(at: AppTest):
    """The third list. It exists only once a movement is chosen."""
    found = [widget for widget in at.selectbox if widget.label == "Τρόπος άσκησης"]
    return found[0] if found else None


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


def test_the_second_list_names_a_movement_once() -> None:
    """One row per movement. exercises_gym_el_uniq guarantees it, in fact."""
    state.reset()
    at = open_log()
    check("each movement appears once", list(name_list(at).options) == ["Έλξεις", "Κωπηλατική", "Πιέσεις σε μηχάνημα", "Πιέσεις Στήθους"],
          str(name_list(at).options))


def test_the_third_list_offers_every_implement() -> None:
    """One movement, any implement — which is the whole of 008.

    The list used to hold only the rows that existed, and since a gym cannot
    have two exercises with the same name it always held exactly one. A coach
    who wanted «Πιέσεις Στήθους» with dumbbells had nowhere to say so.
    """
    state.reset()
    at = open_log()
    name_list(at).set_value("Πιέσεις Στήθους").run()
    raise_on_exception(at)

    ways = way_list(at)
    check("every implement is offered", len(ways.options) == 9, str(ways.options))
    check("μπάρα and αλτήρες both among them",
          "Μπάρα" in ways.options and "Αλτήρες" in ways.options, str(ways.options))
    check("the exercise's own is the default", ways.value == "barbell", str(ways.value))


def test_the_implement_the_coach_picks_is_what_gets_written() -> None:
    state.reset()
    at = open_log()
    name_list(at).set_value("Πιέσεις Στήθους").run()
    way_list(at).set_value("dumbbell").run()
    button(at, "log_add_-1").click().run()
    raise_on_exception(at)

    added = [b for b in state.rows("blocks", session_id=state.SESSION) if b["id"] != state.BLOCK]
    check("the block records dumbbells, not the exercise's barbell",
          added and added[0].get("equipment") == "dumbbell", str(added))
    check("and the card says so", "Πιέσεις Στήθους · Αλτήρες" in texts(at), texts(at)[:400])


def test_the_add_button_is_dead_until_there_is_something_to_add() -> None:
    """A button that looks live and does nothing is worse than one that says wait."""
    state.reset()
    at = open_log()
    add = button(at, "log_add_-1")
    check("«Προσθήκη άσκησης» starts disabled", add.disabled is True, str(add.disabled))

    name_list(at).set_value("Έλξεις").run()
    raise_on_exception(at)
    check("and comes alive once a movement is chosen",
          button(at, "log_add_-1").disabled is False,
          str(button(at, "log_add_-1").disabled))


def test_last_time_does_not_read_one_implement_under_another() -> None:
    """40 kg of dumbbells is not 80 kg of barbell, and must never be shown as it.

    This is the reason equipment exists as a column at all, and moving it onto
    the block is exactly what could have broken it.
    """
    state.reset()
    # Last week: the same movement, on dumbbells.
    state.STORE["blocks"].append({
        "id": "b-db-hist", "gym_id": state.GYM, "session_id": state.LAST_SESSION,
        "exercise_id": "e-bar", "position": 1, "note": None,
        "equipment": "dumbbell", "deleted_at": None,
    })
    state.STORE["sets"].append({
        "id": "s-db-hist", "gym_id": state.GYM, "block_id": "b-db-hist", "position": 0,
        "kind": "weight_reps", "load_kg": "40.00", "reps": 10, "seconds": None,
        "meters": None, "note": None, "done_at": state.NOW, "created_by": state.OWNER,
        "deleted_at": None,
    })
    at = open_log()

    body = texts(at)
    check("today's barbell block does not quote the dumbbell numbers",
          "40×10" not in body, body[:400])
    check("it quotes nothing, because this is the first barbell press",
          "Πρώτη φορά" in body, body[:400])

    # And the positive half, or an empty history passes both checks above: the
    # same implement IS quoted, whole — number, day and author — because the
    # coach loads a bar from this line.
    import streamlit as st

    st.cache_data.clear()
    state.STORE["blocks"].append({
        "id": "b-bar-hist", "gym_id": state.GYM, "session_id": state.LAST_SESSION,
        "exercise_id": "e-bar", "position": 2, "note": None,
        "equipment": None, "deleted_at": None,
    })
    state.STORE["sets"].append({
        "id": "s-bar-hist", "gym_id": state.GYM, "block_id": "b-bar-hist", "position": 0,
        "kind": "weight_reps", "load_kg": "77.50", "reps": 5, "seconds": None,
        "meters": None, "note": None, "done_at": state.NOW, "created_by": state.OWNER,
        "deleted_at": None,
    })
    at = open_log()
    body = texts(at)
    check("the barbell history is quoted with its day and author",
          "Τελευταία φορά: 77,5×5 · 25 Αυγ · Δημήτρης" in body, body[:600])
    check("and the dumbbell numbers still are not", "40×10" not in body, body[:600])


def test_the_add_button_waits_for_a_movement() -> None:
    state.reset()
    at = open_log()
    check("«Προσθήκη άσκησης» starts disabled",
          button(at, "log_add_-1").disabled is True)
    ways = way_list(at)
    check("and so does the implement list", ways.disabled is True)
    check("which says what to do first", ways.placeholder == "Διάλεξε πρώτα άσκηση",
          str(ways.placeholder))


def test_changing_the_muscle_group_clears_the_exercise_under_it() -> None:
    """A name left from another group is a name filed under a heading it is not in."""
    state.reset()
    at = open_log()
    name_list(at).set_value("Πιέσεις Στήθους").run()
    raise_on_exception(at)
    check("a movement is chosen", name_list(at).value == "Πιέσεις Στήθους")

    groups = [w for w in at.selectbox if w.label == "Μυϊκή ομάδα"][0]
    back = [i for i, option in enumerate(groups.options) if option.startswith("Πλάτη")][0]
    # options[0] is «Όλες», which the screen keys as -1; the real groups follow.
    groups.set_value(back - 1).run()
    raise_on_exception(at)
    check("the exercise list came back empty", name_list(at).value is None,
          str(name_list(at).value))


def test_adding_an_exercise_stays_on_the_workout() -> None:
    """The bug the gym reported: adding an exercise threw them back to the roster."""
    state.reset()
    at = open_log()
    name_list(at).set_value("Έλξεις").run()
    button(at, "log_add_-1").click().run()
    raise_on_exception(at)

    blocks = state.rows("blocks", session_id=state.SESSION)
    check("the exercise went into the workout", len(blocks) == 2, str(blocks))
    check("and it is the one that was chosen",
          any(b["exercise_id"] == "e-pullup" for b in blocks), str(blocks))
    check("the coach is still on the workout", "Δημήτρης Καμουτσής" in texts(at))


def test_an_athletes_details_can_be_corrected() -> None:
    state.reset()
    at = open_athlete()
    [t for t in at.text_input if t.label == "Ονοματεπώνυμο"][0].set_value("Δημήτρης Καμουτσής")
    [t for t in at.text_input if t.label == "Φάση προγράμματος"][0].set_value("Δύναμη")
    [t for t in at.text_input if t.label == "Έμφαση"][0].set_value("Πλάτη")
    [s for s in at.selectbox if s.label == "Προπονητής"][0].set_value(state.TRAINER)
    button(at, "athlete_edit").click().run()
    raise_on_exception(at)

    row = state.rows("athletes", id=state.ATHLETE)[0]
    check("the phase is saved", row.get("plan_phase") == "Δύναμη", str(row.get("plan_phase")))
    check("the focus is saved", row.get("plan_focus") == "Πλάτη")
    check("the coach is saved", row.get("coach_membership_id") == state.TRAINER)


def test_removing_an_athlete_asks_first() -> None:
    """The one screen that keeps a confirm: removal takes a whole history off every screen."""
    state.reset()
    at = open_athlete()
    button(at, "athlete_remove").click().run()
    raise_on_exception(at)

    check("the athlete is still there after the first press",
          not state.deleted("athletes", state.ATHLETE))
    check("and the screen asks", "Να αφαιρεθεί" in texts(at), texts(at)[:200])

    button(at, "athlete_remove_cancel").click().run()
    raise_on_exception(at)
    check("cancelling leaves the athlete alone", not state.deleted("athletes", state.ATHLETE))

    button(at, "athlete_remove").click().run()
    button(at, "athlete_remove_confirm").click().run()
    raise_on_exception(at)
    check("confirming removes them", state.deleted("athletes", state.ATHLETE))
    check("the open sheet is dropped with them", "athlete" not in at.session_state)


def test_a_trainer_is_not_offered_a_removal_the_database_would_refuse() -> None:
    """athletes_delete_owner_only is AS RESTRICTIVE; a refused button reads as a bug."""
    state.reset()
    # The signed-in member becomes the trainer rather than the owner.
    for row in state.STORE["memberships"]:
        row["role"] = "trainer" if row["id"] == state.OWNER else row["role"]
    at = open_athlete()
    keys = [b.key for b in at.button]
    check("no removal button for a trainer", "athlete_remove" not in keys, str(keys))
    check("and the screen says why",
          "Μόνο ο ιδιοκτήτης" in texts(at), texts(at)[:200])
    # The exact matcher, not a substring: "athlete_edit" is also inside
    # "athlete_edit_session", the «Συνέχεια» button every role gets.
    check("editing the details is still offered", button(at, "athlete_edit") is not None, str(keys))


def test_choosing_an_exercise_adds_nothing_until_the_button() -> None:
    """Opening the lists and picking must not write; the button is the commitment."""
    state.reset()
    at = open_log()
    before = len(state.rows("blocks", session_id=state.SESSION))
    name_list(at).set_value("Έλξεις").run()
    raise_on_exception(at)
    at.run()
    raise_on_exception(at)

    check("browsing the lists wrote nothing",
          len(state.rows("blocks", session_id=state.SESSION)) == before,
          str(state.rows("blocks", session_id=state.SESSION)))


def test_the_search_reaches_every_exercise_without_choosing_a_group() -> None:
    """«Όλες οι ασκήσεις» is the default, so a coach can type the name straight away."""
    state.reset()
    at = open_log()
    groups = [s for s in at.selectbox if s.label == "Μυϊκή ομάδα"][0]
    check("«Όλες οι ασκήσεις» is the first option",
          groups.options[0].startswith("Όλες"), str(groups.options))
    # -1 is the sentinel the screen uses for «Όλες»; the real groups are indexes.
    check("and it is the one selected", groups.value == -1, str(groups.value))
    names = name_list(at)
    check("and the exercise list reaches every movement in the gym",
          list(names.options) == ["Έλξεις", "Κωπηλατική", "Πιέσεις σε μηχάνημα", "Πιέσεις Στήθους"], str(names.options))
    check("with nothing preselected, so opening the picker adds nothing",
          names.value is None, str(names.value))


def test_last_weeks_exercises_are_one_tap() -> None:
    """A coach repeats a programme far more often than they invent one."""
    state.reset()
    at = open_log()
    labels = [b.label for b in at.button if b.label.startswith("+ ")]
    check("last week's exercise is offered", labels == ["+ Κωπηλατική · Αλτήρες"], str(labels))
    check("today's is not offered twice",
          not any("Πιέσεις Στήθους" in label for label in labels), str(labels))

    button(at, "log_again_e-db").click().run()
    raise_on_exception(at)
    blocks = state.rows("blocks", session_id=state.SESSION)
    check("one tap put it in the workout",
          any(b["exercise_id"] == "e-db" for b in blocks), str(blocks))


def test_the_repeat_button_repeats_the_implement_too() -> None:
    """«Repeat what they did» must not change the όργανο on the way.

    Last week's row was done with a kettlebell, not the exercise's default
    dumbbells. The button used to say «· Αλτήρες», write a block with no
    implement, and then tell the coach it was the athlete's first time.
    """
    state.reset()
    state.rows("blocks", id="b0")[0]["equipment"] = "kettlebell"
    state.STORE["sets"].append({
        "id": "s-kb-hist", "gym_id": state.GYM, "block_id": "b0", "position": 0,
        "kind": "weight_reps", "load_kg": "24.00", "reps": 12, "seconds": None,
        "meters": None, "note": None, "done_at": state.NOW, "created_by": state.OWNER,
        "deleted_at": None,
    })
    at = open_log()
    labels = [b.label for b in at.button if b.label.startswith("+ ")]
    check("the button names the implement it was done on",
          labels == ["+ Κωπηλατική · Kettlebell"], str(labels))

    button(at, "log_again_e-db").click().run()
    raise_on_exception(at)
    added = [b for b in state.rows("blocks", session_id=state.SESSION) if b["exercise_id"] == "e-db"]
    check("the block records that implement", added and added[0].get("equipment") == "kettlebell",
          str(added))
    body = texts(at)
    check("the card is headed with it", "Κωπηλατική · Kettlebell" in body, body[:500])
    check("and last week's numbers are quoted, on the same implement",
          "Τελευταία φορά: 24×12 · 25 Αυγ · Δημήτρης" in body, body[:800])


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
    # «Διόρθωση / σχόλιο» opens the panel; it used to be an expander, whose
    # contents AppTest could reach without opening.
    button(at, f"log_fix_{state.BLOCK}").click().run()
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
    button(at, f"log_fix_{state.BLOCK}").click().run()
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


def test_a_replayed_submit_does_not_log_the_set_twice() -> None:
    """A write is followed by a rerun; on slow wifi the coach taps again during it."""
    from views import log

    state.reset()
    # Two full AppTest runs sit between the taps; on a loaded box they can take
    # longer than the real window, and the second set would be legitimately
    # written. The window is widened, not the assertion weakened.
    log._DOUBLE_TAP_S = 600.0
    try:
        _replayed_submit()
    finally:
        log._DOUBLE_TAP_S = 3.0


def _replayed_submit() -> None:
    at = open_log()
    at.text_input(key=f"log_kg_{state.BLOCK}").set_value("80")
    at.number_input(key=f"log_reps_{state.BLOCK}").set_value(8)
    button(at, f"log_set_{state.BLOCK}").click().run()
    raise_on_exception(at)
    after_first = len(state.rows("sets", block_id=state.BLOCK))

    # The same submission arriving again, which is what a second tap during the
    # dead time replays.
    at.text_input(key=f"log_kg_{state.BLOCK}").set_value("80")
    at.number_input(key=f"log_reps_{state.BLOCK}").set_value(8)
    button(at, f"log_set_{state.BLOCK}").click().run()
    raise_on_exception(at)

    check("the second tap wrote nothing",
          len(state.rows("sets", block_id=state.BLOCK)) == after_first,
          str(len(state.rows("sets", block_id=state.BLOCK))))
    check("and the coach is told it already landed",
          "είχε ήδη καταχωρηθεί" in texts(at), texts(at)[:200])


def test_a_different_set_straight_after_is_still_written() -> None:
    """The guard is about the same numbers twice, not about logging quickly."""
    state.reset()
    at = open_log()
    at.text_input(key=f"log_kg_{state.BLOCK}").set_value("80")
    at.number_input(key=f"log_reps_{state.BLOCK}").set_value(8)
    button(at, f"log_set_{state.BLOCK}").click().run()
    raise_on_exception(at)
    at.text_input(key=f"log_kg_{state.BLOCK}").set_value("82,5")
    at.number_input(key=f"log_reps_{state.BLOCK}").set_value(6)
    button(at, f"log_set_{state.BLOCK}").click().run()
    raise_on_exception(at)

    written = [r for r in state.rows("sets", block_id=state.BLOCK) if r["id"] != state.SET]
    check("both sets are there", len(written) == 2, str(written))
    check("the heavier one included",
          any(r.get("load_kg") == 82.5 for r in written), str(written))


def test_logging_a_set_does_not_refetch_the_whole_catalogue() -> None:
    """The gym said the screen hangs. On this database a hang is a round-trip count.

    Clearing the catalogue after every set meant the rerun that follows a set
    refetched two hundred exercise rows to show a number the coach had just
    typed. Nothing about a set changes the catalogue.
    """
    state.reset()
    at = open_log()

    fake_supabase.reset_round_trips()
    at.text_input(key=f"log_kg_{state.BLOCK}").set_value("60")
    at.number_input(key=f"log_reps_{state.BLOCK}").set_value(10)
    button(at, f"log_set_{state.BLOCK}").click().run()
    raise_on_exception(at)

    trips = list(fake_supabase.ROUND_TRIPS)
    check("the set was written", "insert:sets" in trips, str(trips))
    check("and the catalogue was not read again to show it",
          "select:exercises" not in trips, " ".join(trips))
    # A ceiling, not a target: it is here so that adding a read to this path is
    # a decision somebody makes on purpose.
    check(f"the whole tap cost {len(trips)} round trips, not a dozen",
          len(trips) <= 8, " ".join(trips))


def test_an_idle_rerun_costs_nothing() -> None:
    """Every tap reruns the whole script. A rerun that re-reads everything is the hang."""
    state.reset()
    at = open_log()

    fake_supabase.reset_round_trips()
    at.run()
    raise_on_exception(at)
    trips = list(fake_supabase.ROUND_TRIPS)
    check(f"a rerun with nothing changed cost {len(trips)} round trips",
          len(trips) <= 2, " ".join(trips))


def test_one_entry_can_stand_for_several_straight_sets() -> None:
    """3×80×8 is one number typed once, not the same two numbers typed three times."""
    state.reset()
    at = open_log()
    at.text_input(key=f"log_kg_{state.BLOCK}").set_value("80")
    at.number_input(key=f"log_reps_{state.BLOCK}").set_value(8)
    at.number_input(key=f"log_times_{state.BLOCK}").set_value(3)
    button(at, f"log_set_{state.BLOCK}").click().run()
    raise_on_exception(at)

    written = [r for r in state.rows("sets", block_id=state.BLOCK) if r["id"] != state.SET]
    check("three sets were written", len(written) == 3, str(len(written)))
    check("all three carry the numbers that were typed once",
          all(r.get("load_kg") == 80.0 and r.get("reps") == 8 for r in written), str(written))
    check("and they take consecutive positions, so they read 1., 2., 3.",
          sorted(r["position"] for r in written) == [1, 2, 3],
          str(sorted(r["position"] for r in written)))
    check("the card shows all three", texts(at).count("80×8") >= 3, texts(at)[:300])


def test_the_multiplier_defaults_to_one_set() -> None:
    """A coach who ignores it gets exactly the old behaviour."""
    state.reset()
    at = open_log()
    times = at.number_input(key=f"log_times_{state.BLOCK}")
    check("«× σετ» starts at 1", times.value == 1, str(times.value))
    check("and it is capped, because this multiplies into INSERTs",
          times.max == 12, str(times.max))

    at.text_input(key=f"log_kg_{state.BLOCK}").set_value("82,5")
    at.number_input(key=f"log_reps_{state.BLOCK}").set_value(6)
    button(at, f"log_set_{state.BLOCK}").click().run()
    raise_on_exception(at)
    written = [r for r in state.rows("sets", block_id=state.BLOCK) if r["id"] != state.SET]
    check("one entry, one set", len(written) == 1, str(written))
    check("and the next set could be heavier than the last",
          written[0].get("load_kg") == 82.5, str(written))


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


def test_an_exercise_in_two_groups_does_not_collide_with_itself() -> None:
    """It is drawn once per heading it is filed under, and each needs its own key.

    This crashed the live app — StreamlitDuplicateElementKey on the ✏️ — the
    moment 006 gave the gym an owner for every catalogue row. Until then the
    buttons were only drawn for the gym's own exercises and the gym had none,
    so the collision was there and unreachable.
    """
    state.reset()
    at = open_library()  # raises on any exception, which is most of this test

    edits = [b for b in at.button if (b.key or "").startswith("ed-")]
    check("the exercise offers an edit under each heading", len(edits) == 2, str([b.key for b in edits]))
    check("with different keys", len({b.key for b in edits}) == 2, str([b.key for b in edits]))

    # And editing from one heading opens exactly one form, not two.
    edits[0].click().run()
    raise_on_exception(at)
    check("one heading opens one form",
          len([t for t in at.text_input if t.label == "Όνομα"]) == 1,
          str([t.label for t in at.text_input]))


def test_only_the_gyms_own_exercises_offer_an_edit() -> None:
    """exercises_update demands gym_id = app.my_gym(); a shared row has none."""
    state.reset()
    at = open_library()
    keys = [b.key for b in at.button]
    # Keys carry the heading now: one exercise is drawn once per group it is
    # filed under, and each drawing needs a key of its own.
    check("the gym's own exercise can be edited",
          any(k and k.startswith("ed-") and k.endswith("-e-mine") for k in keys), str(keys))
    check("the shared catalogue cannot",
          not any(k and k.endswith("-e-bar") for k in keys), str(keys))
    check("and the screen says why",
          "κλειδωμένος από τη βάση" in texts(at), texts(at)[:400])


def test_an_exercise_can_be_renamed_and_re_equipped() -> None:
    state.reset()
    at = open_library()
    button(at, "ed-mg-chest-e-mine").click().run()
    raise_on_exception(at)

    [t for t in at.text_input if t.label == "Όνομα"][0].set_value("Πιέσεις σε Smith")
    [s for s in at.selectbox if s.label == "Εξοπλισμός"][0].set_value("Smith")
    button(at, "library_edit-mg-chest-e-mine").click().run()
    raise_on_exception(at)

    row = state.rows("exercises", id="e-mine")[0]
    check("the name is saved", row["name_el"] == "Πιέσεις σε Smith", str(row["name_el"]))
    check("the equipment is saved", row["equipment"] == "smith", str(row["equipment"]))


def test_deleting_an_exercise_can_be_taken_back() -> None:
    state.reset()
    at = open_library()
    button(at, "rm-mg-chest-e-mine").click().run()
    raise_on_exception(at)
    check("it is gone", state.deleted("exercises", "e-mine"))
    check("with an offer to undo", "Διαγράφηκε" in texts(at), texts(at)[:300])

    button(at, "library_notice_undo_button").click().run()
    raise_on_exception(at)
    check("undo brings it back", not state.deleted("exercises", "e-mine"))


def test_a_new_exercise_starts_with_no_equipment_chosen() -> None:
    """A preselected όργανο is one nobody reads, and it decides what 40 kg means."""
    state.reset()
    at = open_library()
    gear = [s for s in at.selectbox if s.label == "Εξοπλισμός"]
    check("the new-exercise form asks rather than assumes",
          any(w.value is None for w in gear), str([w.value for w in gear]))

    [t for t in at.text_input if t.label == "Όνομα στα ελληνικά"][0].set_value("Κάτι νέο")
    button(at, "library_new").click().run()
    raise_on_exception(at)
    check("and refuses to save without one",
          "Διάλεξε εξοπλισμό" in texts(at), texts(at)[:300])


def test_a_network_blip_on_wake_keeps_the_coach_signed_in() -> None:
    """Locking the phone must not sign anyone out or lose the open workout.

    A phone waking from lock reconnects its websocket and its wifi at the same
    moment, which is the likeliest second in the day for a token refresh to die
    on the network. That used to run _sign_out_state(), which drops the session
    AND pops "athlete" and "session_id" — so a one-second blip logged the coach
    out and threw away the workout they were standing in.

    This calls the function itself rather than a screen: the refresh lives in
    gate(), which the screen drivers deliberately skip, so a screen test would
    pass without ever reaching the line that changed.
    """
    import streamlit as st
    from lib import auth, db as db_mod

    state.reset()
    st.session_state.clear()
    st.session_state[db_mod.ACCESS_KEY] = "still-valid-for-two-more-minutes"
    st.session_state[db_mod.REFRESH_KEY] = "some-refresh-token"
    st.session_state[db_mod.USER_ID_KEY] = state.USER_ID
    st.session_state["athlete"] = state.STORE["athletes"][0]
    st.session_state["session_id"] = state.SESSION

    fake_supabase.REFRESH_FAILURE = "network"
    try:
        kept = auth._use_refresh_token("some-refresh-token")
    finally:
        fake_supabase.REFRESH_FAILURE = None

    check("the coach stays signed in", kept is True, str(kept))
    check("the token in hand is untouched",
          st.session_state.get(db_mod.ACCESS_KEY) == "still-valid-for-two-more-minutes",
          str(st.session_state.get(db_mod.ACCESS_KEY)))
    check("the open workout survived",
          st.session_state.get("session_id") == state.SESSION,
          str(st.session_state.get("session_id")))
    check("and the athlete on screen with it",
          st.session_state.get("athlete") is not None)
    check("no cookie deletion was queued",
          st.session_state.get("_cookie_pending") is None,
          str(st.session_state.get("_cookie_pending")))
    check("the dead call is latched so it is not remade every rerun",
          auth._REFRESH_FAILED_KEY in st.session_state)


def test_a_token_the_server_refuses_does_sign_out() -> None:
    """The other half. A spent token is not a blip, and must not be treated as one."""
    import streamlit as st
    from lib import auth, db as db_mod

    state.reset()
    st.session_state.clear()
    st.session_state[db_mod.ACCESS_KEY] = "spent"
    st.session_state[db_mod.REFRESH_KEY] = "spent-refresh"
    st.session_state["athlete"] = state.STORE["athletes"][0]
    st.session_state["session_id"] = state.SESSION

    fake_supabase.REFRESH_FAILURE = "rejected"
    try:
        kept = auth._use_refresh_token("spent-refresh")
    finally:
        fake_supabase.REFRESH_FAILURE = None

    check("a refused token signs the coach out", kept is False, str(kept))
    check("the session is dropped", not st.session_state.get(db_mod.ACCESS_KEY),
          str(st.session_state.get(db_mod.ACCESS_KEY)))
    # _flush_cookie() consumes the queued delete on the spot, so the durable
    # evidence is the signed-out flag, which is what every later run reads.
    check("and the browser is marked signed out, because this token is spent",
          st.session_state.get(auth._SIGNED_OUT_KEY) is True,
          str(st.session_state.get(auth._SIGNED_OUT_KEY)))


def test_an_exercise_can_be_folded_away_and_stays_folded() -> None:
    """Six exercises on a phone is a lot of scrolling to reach the one in hand."""
    state.reset()
    at = open_log()
    check("the sets are on screen to begin with", "80×8" in texts(at), texts(at)[:200])

    button(at, f"log_fold_{state.BLOCK}").click().run()
    raise_on_exception(at)
    # The numbered list goes; "80×8" itself stays, in the heading, which is the
    # point — a folded exercise still says what was done on it.
    check("folded away, the set list is gone", "1. 80×8" not in texts(at), texts(at)[:300])
    check("but the heading still says what is in there",
          "Πιέσεις Στήθους · Μπάρα · 1 σετ · 80×8" in texts(at), texts(at)[:300])

    # Any later rerun must not quietly unfold it.
    at.run()
    raise_on_exception(at)
    check("and it stays folded", "1. 80×8" not in texts(at))

    button(at, f"log_fold_{state.BLOCK}").click().run()
    raise_on_exception(at)
    check("unfolding brings them back", "1. 80×8" in texts(at), texts(at)[:300])


def test_a_set_can_carry_a_comment() -> None:
    state.reset()
    at = open_log()
    at.text_input(key=f"log_kg_{state.BLOCK}").set_value("70")
    at.number_input(key=f"log_reps_{state.BLOCK}").set_value(10)
    at.text_input(key=f"log_setnote_{state.BLOCK}").set_value("πόνεσε ο ώμος")
    button(at, f"log_set_{state.BLOCK}").click().run()
    raise_on_exception(at)

    written = [r for r in state.rows("sets", block_id=state.BLOCK) if r["id"] != state.SET]
    check("the comment was saved with the set",
          written and written[0].get("note") == "πόνεσε ο ώμος", str(written))
    check("and it is on the card", "πόνεσε ο ώμος" in texts(at), texts(at)[:300])


def test_the_comment_does_not_defeat_the_double_tap_guard() -> None:
    """Same numbers twice is the same set, whatever was typed in the comment box."""
    from views import log

    state.reset()
    log._DOUBLE_TAP_S = 600.0
    try:
        _replayed_with_comment()
    finally:
        log._DOUBLE_TAP_S = 3.0


def _replayed_with_comment() -> None:
    at = open_log()
    at.text_input(key=f"log_kg_{state.BLOCK}").set_value("70")
    at.number_input(key=f"log_reps_{state.BLOCK}").set_value(10)
    button(at, f"log_set_{state.BLOCK}").click().run()
    raise_on_exception(at)
    after_first = len(state.rows("sets", block_id=state.BLOCK))

    at.text_input(key=f"log_kg_{state.BLOCK}").set_value("70")
    at.number_input(key=f"log_reps_{state.BLOCK}").set_value(10)
    at.text_input(key=f"log_setnote_{state.BLOCK}").set_value("κάτι άλλο")
    button(at, f"log_set_{state.BLOCK}").click().run()
    raise_on_exception(at)

    check("the replayed set was still recognised",
          len(state.rows("sets", block_id=state.BLOCK)) == after_first,
          str(len(state.rows("sets", block_id=state.BLOCK))))


def test_an_exercise_can_carry_a_comment_for_this_workout() -> None:
    """On the block, so it belongs to today rather than to the movement forever."""
    state.reset()
    at = open_log()
    button(at, f"log_fix_{state.BLOCK}").click().run()
    raise_on_exception(at)

    [t for t in at.text_area if t.label == "Σχόλιο για την άσκηση"][0].set_value(
        "πήγαμε ελαφρύ σήμερα"
    )
    button(at, f"log_block_note_{state.BLOCK}").click().run()
    raise_on_exception(at)

    row = state.rows("blocks", id=state.BLOCK)[0]
    check("the comment is on the block", row.get("note") == "πήγαμε ελαφρύ σήμερα",
          str(row.get("note")))
    check("and shows on the exercise", "πήγαμε ελαφρύ σήμερα" in texts(at), texts(at)[:300])
    check("the exercise row itself is untouched",
          state.rows("exercises", id="e-bar")[0].get("note") is None)


def test_a_fresh_workout_can_be_started_from_nothing() -> None:
    """«Νέα προπόνηση» arrives with no session_id, and that path had no test.

    It shipped a NameError for one commit: the screen crashed the moment a coach
    started a workout rather than continuing one, and every test passed, because
    every test handed the screen a session that already existed.
    """
    state.reset()
    before = len(state.STORE["sessions"])
    at = open_log(session_id=None)

    check("a workout was started", len(state.STORE["sessions"]) == before + 1,
          str(len(state.STORE["sessions"])))
    check("and the screen is the workout, not an error",
          "Δημήτρης Καμουτσής" in texts(at), texts(at)[:200])
    check("it belongs to this athlete",
          state.STORE["sessions"][-1]["athlete_id"] == state.ATHLETE,
          str(state.STORE["sessions"][-1]))
    check("with the author stamped by the trigger, not sent by the client",
          state.STORE["sessions"][-1]["logged_by"] == state.OWNER,
          str(state.STORE["sessions"][-1].get("logged_by")))


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
# The debug sweep of September 2026: one test per defect it found.
# ---------------------------------------------------------------------------

def test_the_finish_summary_names_the_blocks_implement() -> None:
    """The last thing the coach reads before closing the sheet named the wrong όργανο."""
    state.reset()
    state.rows("blocks", id=state.BLOCK)[0]["equipment"] = "dumbbell"
    at = open_log()
    check("the card says dumbbells", "Πιέσεις Στήθους · Αλτήρες" in texts(at), texts(at)[:300])
    press(at, "log_finish")
    body = texts(at)
    check("the workout is closed", "Η προπόνηση ολοκληρώθηκε." in body, body[:300])
    check("and the summary says dumbbells too",
          "Πιέσεις Στήθους · Αλτήρες · 80×8" in body, body[:500])
    check("never the exercise's barbell", "Πιέσεις Στήθους · Μπάρα" not in body, body[:500])


def test_a_stale_finished_page_does_not_hijack_the_next_workout() -> None:
    """Finish, leave by the tab bar, come back to the same athlete with a workout in hand."""
    state.reset()
    # The stop-state from an older workout, with a live session handed to the
    # screen by Αθλητές or Πρόγραμμα.
    at = open_log(log_finished={"session_id": "s-older", "athlete_id": state.ATHLETE})
    body = texts(at)
    check("the workout the screen was handed is drawn", "80×8" in body, body[:400])
    check("not the old «ολοκληρώθηκε» page", "ολοκληρώθηκε" not in body, body[:400])
    check("and the stop-state is gone", "log_finished" not in at.session_state)

    # The legitimate case still stops: no session in hand, the stop-state is
    # about this athlete — nothing must open a fresh workout.
    before = len(state.STORE["sessions"])
    at = open_log(session_id=None,
                  log_finished={"session_id": state.SESSION, "athlete_id": state.ATHLETE})
    check("straight after finishing, the page still stops",
          "Η προπόνηση ολοκληρώθηκε." in texts(at), texts(at)[:300])
    check("and starts nothing", len(state.STORE["sessions"]) == before)


def test_reopening_from_the_sheet_forgets_the_finished_page() -> None:
    """«Συνέχεια» on Αθλητές hands over a session; the stop-state must not outlive it."""
    state.reset()
    at = open_athlete(log_finished={"session_id": state.SESSION, "athlete_id": state.ATHLETE})
    press(at, "athlete_edit_session")
    check("the session was handed over", at.session_state["session_id"] == state.SESSION,
          str(at.session_state["session_id"]))
    check("and the finished page was dropped on the way", "log_finished" not in at.session_state)
    check("the reopened workout is active again",
          state.rows("sessions", id=state.SESSION)[0]["status"] == "active")

    at = open_athlete(log_finished={"session_id": state.SESSION, "athlete_id": state.ATHLETE},
                      session_id=state.SESSION)
    press(at, "athlete_new_session")
    check("«Νέα προπόνηση» drops the old session", "session_id" not in at.session_state)
    check("and the finished page", "log_finished" not in at.session_state)


def test_what_a_new_exercise_measures_is_what_the_coach_said() -> None:
    """«Cardio» + «Απόσταση» stored twenty rowing minutes as time; the choice was dropped."""
    state.reset()
    at = open_log()
    at.selectbox(key="log_group").set_value(0).run()
    raise_on_exception(at)
    form = f"log_new_exercise_{state.CHEST}"
    [t for t in at.text_input if t.label == "Όνομα άσκησης"][0].set_value("Κωπηλασία 2000μ")
    at.selectbox(key=f"log_new_gear_{state.CHEST}").set_value("Cardio")
    at.selectbox(key=f"log_new_kind_{state.CHEST}").set_value("Απόσταση")
    press(at, form)
    rows = state.rows("exercises", name_el="Κωπηλασία 2000μ")
    check("the exercise was created", len(rows) == 1, str(rows))
    check("measuring what the coach said, not what the όργανο implies",
          rows and rows[0]["default_set_kind"] == "distance", str(rows))
    check("and it is in the workout",
          any(b["exercise_id"] == rows[0]["id"] for b in state.rows("blocks", session_id=state.SESSION)))

    # Left blank, the measure follows the όργανο — the default the form used
    # to promise and could not keep.
    at = open_log()
    at.selectbox(key="log_group").set_value(0).run()
    [t for t in at.text_input if t.label == "Όνομα άσκησης"][0].set_value("Διάδρομος")
    at.selectbox(key=f"log_new_gear_{state.CHEST}").set_value("Cardio")
    press(at, form)
    rows = state.rows("exercises", name_el="Διάδρομος")
    check("blank «Τι μετράει» on Cardio means time",
          rows and rows[0]["default_set_kind"] == "duration", str(rows))


def test_a_new_exercise_survives_its_block_failing() -> None:
    """The row landed; the picker must know, or the retry hits the unique index."""
    state.reset()
    at = open_log()
    at.selectbox(key="log_group").set_value(0).run()
    [t for t in at.text_input if t.label == "Όνομα άσκησης"][0].set_value("Πιέσεις σε Smith")
    at.selectbox(key=f"log_new_gear_{state.CHEST}").set_value("Smith")
    fake_supabase.FAIL_ONCE[:] = ["insert:blocks"]
    press(at, f"log_new_exercise_{state.CHEST}")
    body = texts(at)
    check("the coach is told the exercise exists and where to find it",
          "δεν μπήκε στην προπόνηση" in body, body[:600])
    check("the exercise is in the catalogue", len(state.rows("exercises", name_el="Πιέσεις σε Smith")) == 1)
    at.run()
    raise_on_exception(at)
    check("and the picker offers it without a reboot",
          "Πιέσεις σε Smith" in name_list(at).options, str(name_list(at).options))


def test_removing_an_exercise_puts_the_sets_back_when_the_block_stays() -> None:
    """Sets stamped, block UPDATE dies on the wifi: the sets used to vanish with no undo."""
    state.reset()
    at = open_log()
    press(at, f"log_fix_{state.BLOCK}")
    fake_supabase.FAIL_ONCE[:] = ["update:blocks"]
    press(at, f"log_del_block_{state.BLOCK}")
    check("the exercise is still there", not state.deleted("blocks", state.BLOCK))
    check("and so is its set", not state.deleted("sets", state.SET))
    check("with an error, not a success", "δεν αφαιρέθηκε" in texts(at), texts(at)[:400])

    # Worse: the restore dies too. Then the coach gets the button that retries.
    state.reset()
    at = open_log()
    press(at, f"log_fix_{state.BLOCK}")
    fake_supabase.FAIL_ONCE[:] = ["update:blocks", "update:sets"]
    press(at, f"log_del_block_{state.BLOCK}")
    check("the block is live", not state.deleted("blocks", state.BLOCK))
    check("the set is hidden for now", state.deleted("sets", state.SET))
    check("and «Αναίρεση» is offered for it", "κρύφτηκαν" in texts(at), texts(at)[:400])
    press(at, "log_notice_undo_button")
    check("which brings the set back once the connection is there",
          not state.deleted("sets", state.SET))


def test_an_undo_offer_does_not_follow_the_coach_to_another_athlete() -> None:
    state.reset()
    state.STORE["athletes"].append({
        "id": "a2", "gym_id": state.GYM, "full_name": "Μαρία Ιωάννου",
        "plan_phase": None, "plan_focus": None, "coach_membership_id": None, "deleted_at": None,
    })
    at = open_log()
    press(at, f"log_fix_{state.BLOCK}")
    press(at, f"log_del_set_{state.SET}")
    check("the offer is on this athlete's sheet", "Διαγράφηκε: 80×8" in texts(at))

    at.session_state["athlete"] = state.rows("athletes", id="a2")[0]
    del at.session_state["session_id"]
    at.run()
    raise_on_exception(at)
    check("the other athlete's sheet opened", "Μαρία Ιωάννου" in texts(at), texts(at)[:300])
    check("without the offer", "Διαγράφηκε: 80×8" not in texts(at), texts(at)[:300])
    check("and no button to accept it", not any(b.key == "log_notice_undo_button" for b in at.button))


def test_finishing_clears_a_pending_undo() -> None:
    state.reset()
    at = open_log()
    press(at, f"log_fix_{state.BLOCK}")
    press(at, f"log_del_set_{state.SET}")
    press(at, "log_finish")
    check("no «Αναίρεση» over «ολοκληρώθηκε»",
          not any(b.key == "log_notice_undo_button" for b in at.button), str([b.key for b in at.button]))


def test_undo_says_so_when_it_restored_nothing() -> None:
    state.reset()
    at = open_log(log_notice_undo=("Διαγράφηκε: 80×8", {"table": "sets", "ids": ["gone-elsewhere"]},
                                   state.ATHLETE))
    press(at, "log_notice_undo_button")
    body = texts(at)
    check("an UPDATE that reached nothing is not «Επανήλθε.»", "Επανήλθε." not in body, body[:300])
    check("it is an error", "Η επαναφορά δεν έγινε" in body, body[:300])


def test_the_set_comment_cannot_exceed_what_the_column_holds() -> None:
    state.reset()
    at = open_log()
    widget = at.text_input(key=f"log_setnote_{state.BLOCK}")
    check("the box stops at sets.note's 240 characters",
          getattr(widget, "max_chars", None) == 240, str(getattr(widget, "max_chars", None)))


def test_a_gateway_error_on_refresh_keeps_the_coach_signed_in() -> None:
    """A 503 while Supabase restarts is not a verdict on the token."""
    import streamlit as st
    from lib import auth, db as db_mod

    state.reset()
    st.session_state.clear()
    st.session_state[db_mod.ACCESS_KEY] = "still-valid"
    st.session_state[db_mod.REFRESH_KEY] = "refresh"
    st.session_state["athlete"] = state.STORE["athletes"][0]
    st.session_state["session_id"] = state.SESSION

    fake_supabase.REFRESH_FAILURE = "gateway"
    try:
        kept = auth._use_refresh_token("refresh")
    finally:
        fake_supabase.REFRESH_FAILURE = None
    check("a 503 keeps the session", kept is True, str(kept))
    check("and the open workout", st.session_state.get("session_id") == state.SESSION)
    check("and queues no cookie deletion", st.session_state.get("_cookie_pending") is None)


def test_the_sign_in_form_blames_the_server_for_a_5xx() -> None:
    from lib import auth

    check("a 503 is «ο διακομιστής δεν απαντά»",
          auth._auth_error(fake_supabase._Gateway(503)) == auth._NO_CONNECTION)
    check("a 500 too", auth._auth_error(fake_supabase._Gateway(500)) == auth._NO_CONNECTION)
    check("a 400 is still the password", auth._auth_error(fake_supabase._Rejected()) == auth._BAD_CREDENTIALS)
    check("a 429 is still the rate limit",
          auth._auth_error(fake_supabase._Gateway(429)) == auth._RATE_LIMITED)
    check("no status is the server",
          auth._auth_error(fake_supabase._NetworkDown("reset")) == auth._NO_CONNECTION)
    check("and the password screen agrees",
          auth._password_error(fake_supabase._Gateway(502)) == auth._NO_CONNECTION)


def test_signing_out_ends_this_device_only() -> None:
    """Αποσύνδεση on the desk tablet must not sign the trainer's own phone out."""
    import streamlit as st
    from lib import auth, db as db_mod

    state.reset()
    st.session_state.clear()
    st.session_state[db_mod.ACCESS_KEY] = "access"
    st.session_state[db_mod.REFRESH_KEY] = "refresh"
    st.session_state[db_mod.USER_ID_KEY] = state.USER_ID
    st.session_state["session_id"] = state.SESSION
    st.session_state["log_finished"] = {"session_id": state.SESSION, "athlete_id": state.ATHLETE}
    st.session_state["log_notice_undo"] = ("x", {"table": "sets", "ids": ["set1"]}, state.ATHLETE)
    auth.sign_out()
    check("the server was asked for a local sign-out",
          fake_supabase.SIGN_OUT_CALLS and fake_supabase.SIGN_OUT_CALLS[-1] == {"scope": "local"},
          str(fake_supabase.SIGN_OUT_CALLS))
    check("the session is gone here", not st.session_state.get(db_mod.ACCESS_KEY))
    check("with the workout state", "session_id" not in st.session_state)
    check("the finished page", "log_finished" not in st.session_state)
    check("and the pending undo", "log_notice_undo" not in st.session_state)


def test_a_cookie_brings_the_session_back_on_a_cold_start() -> None:
    """The one path every phone takes after two minutes of lock, and it never worked.

    The cookie manager reads the browser's answer once, when it is constructed;
    kept for the whole session it kept the empty answer of the first run, so
    every cold start spent the probe budget and drew the sign-in form over a
    perfectly good session. Two constructions stand for two runs here.
    """
    import streamlit as st
    from lib import auth, db as db_mod

    class _Manager:
        built = 0

        def __init__(self, key: str = "init") -> None:
            _Manager.built += 1
            # Run 1: the iframe has not answered. Run 2 and later: it has.
            self.cookies = {} if _Manager.built == 1 else {"trainhub_session": "cookie-refresh"}

        def set(self, *args, **kwargs) -> None:
            return None

        def delete(self, *args, **kwargs) -> None:
            return None

    state.reset()
    st.session_state.clear()
    real_manager, real_pause = auth.stx.CookieManager, auth._PROBE_PAUSE_S
    auth.stx.CookieManager = _Manager
    auth._PROBE_PAUSE_S = 0.0
    # gate() draws the sign-in form on its first run, and outside a script run
    # `st.form()` has no block to create, so it stamps its FormData on the
    # process-wide main element instead — after which every AppTest run in
    # this process believes it is inside that form. Wipe it.
    from streamlit.delta_generator_singletons import get_dg_singleton_instance

    try:
        first = auth.gate()
        second = auth.gate()
    finally:
        auth.stx.CookieManager = real_manager
        auth._PROBE_PAUSE_S = real_pause
        get_dg_singleton_instance().main_dg._form_data = None

    check("the first run is still waiting for the browser", first is False, str(first))
    check("the second run is signed in", second is True, str(second))
    check("through the token the cookie held",
          fake_supabase.REFRESH_CALLS == ["cookie-refresh"], str(fake_supabase.REFRESH_CALLS))
    check("and the session is attached",
          st.session_state.get(db_mod.ACCESS_KEY) == "fresh-access",
          str(st.session_state.get(db_mod.ACCESS_KEY)))
    check("one manager per run, not one per session", _Manager.built == 2, str(_Manager.built))


def test_the_briefing_names_the_implement() -> None:
    """The sheet a covering coach reads in five seconds dropped the όργανο entirely."""
    state.reset()
    state.rows("blocks", id=state.BLOCK)[0]["equipment"] = "dumbbell"
    # A prescribed, never-lifted set with a big number: it must not win.
    state.STORE["sets"].append({
        "id": "s-plan", "gym_id": state.GYM, "block_id": state.BLOCK, "position": 1,
        "kind": "weight_reps", "load_kg": "200.00", "reps": 1, "seconds": None,
        "meters": None, "note": None, "done_at": None, "created_by": state.OWNER,
        "deleted_at": None,
    })
    at = open_athlete()
    body = texts(at)
    check("the top line carries the block's όργανο",
          "Πιέσεις Στήθους · Αλτήρες · 80×8" in body, body[:800])
    check("and not the set nobody lifted", "200×1" not in body, body[:800])


def test_an_athlete_cannot_be_assigned_to_someone_who_left() -> None:
    state.reset()
    state.STORE["memberships"].append({
        "id": "m-gone", "gym_id": state.GYM, "user_id": "u9", "display_name": "Παλιός",
        "email": "palios@powerhouse.gr", "role": "trainer", "status": "removed",
        "created_at": state.NOW, "deleted_at": None,
    })
    at = open_athlete()
    coach = [s for s in at.selectbox if s.label == "Προπονητής"][0]
    check("removed members are not offered", "Παλιός" not in coach.options, str(coach.options))
    check("active ones are", "Γιώργος" in coach.options, str(coach.options))

    # Unless they ARE the athlete's coach, so the form can show what is stored.
    state.reset()
    state.STORE["memberships"].append({
        "id": "m-gone", "gym_id": state.GYM, "user_id": "u9", "display_name": "Παλιός",
        "email": "palios@powerhouse.gr", "role": "trainer", "status": "removed",
        "created_at": state.NOW, "deleted_at": None,
    })
    state.rows("athletes", id=state.ATHLETE)[0]["coach_membership_id"] = "m-gone"
    at = open_athlete()
    coach = [s for s in at.selectbox if s.label == "Προπονητής"][0]
    check("the stored coach stays visible", coach.value == "m-gone", str(coach.value))


def test_refiling_reuses_the_pair_the_database_already_has() -> None:
    """exercise_muscles_pkey is (exercise, group) with no partial index: delete-then-insert collided."""
    state.reset()

    def live_links():
        return [(l["muscle_group_id"], l["role"]) for l in state.STORE["exercise_muscles"]
                if l["exercise_id"] == "e-mine" and l.get("deleted_at") is None]

    # e-mine is primary Στήθος, secondary Πλάτη. Refile to Πλάτη.
    at = open_library()
    press(at, "ed-mg-chest-e-mine")
    [s for s in at.selectbox if s.label == "Μυϊκή ομάδα"][0].set_value(state.BACK)
    press(at, "library_edit-mg-chest-e-mine")
    check("saved", "ενημερώθηκε" in texts(at), texts(at)[:300])
    check("Πλάτη is now the primary", (state.BACK, "primary") in live_links(), str(live_links()))
    check("Στήθος is retired", not any(g == state.CHEST for g, _ in live_links()), str(live_links()))
    check("exactly one primary", sum(1 for _, r in live_links() if r == "primary") == 1, str(live_links()))

    # And back again: the retired pair is brought back, not inserted twice.
    at = open_library()
    press(at, "ed-mg-back-e-mine")
    [s for s in at.selectbox if s.label == "Μυϊκή ομάδα"][0].set_value(state.CHEST)
    press(at, "library_edit-mg-back-e-mine")
    check("Στήθος is the primary again", live_links() == [(state.CHEST, "primary")], str(live_links()))
    pairs = [(l["exercise_id"], l["muscle_group_id"]) for l in state.STORE["exercise_muscles"]]
    check("and no (exercise, group) pair exists twice", len(pairs) == len(set(pairs)), str(pairs))


def test_a_rename_to_an_existing_name_is_explained() -> None:
    state.reset()
    # exercises_gym_el_uniq is (gym_id, lower(name_el)): the collision is with
    # another of the gym's own rows, which is every row after 006.
    state.STORE["exercises"].append({
        "id": "e-ours", "gym_id": state.GYM, "name_el": "Δική μας", "name_en": None,
        "category": "upper", "equipment": "cable", "default_set_kind": "weight_reps",
        "is_archived": False, "merged_into_id": None, "deleted_at": None,
    })
    at = open_library()
    press(at, "ed-mg-chest-e-mine")
    [t for t in at.text_input if t.label == "Όνομα"][0].set_value("δική μας")
    press(at, "library_edit-mg-chest-e-mine")
    check("the collision is named", "Υπάρχει ήδη άσκηση" in texts(at), texts(at)[:300])
    check("and nothing changed", state.rows("exercises", id="e-mine")[0]["name_el"] == "Πιέσεις σε μηχάνημα")


def test_archiving_reports_a_row_it_did_not_reach() -> None:
    state.reset()
    at = open_library()
    fake_supabase.FAIL_ONCE[:] = ["update:exercises"]
    press(at, "ar-mg-chest-e-mine")
    check("a dead connection is an error, not a traceback", "Η αλλαγή δεν έγινε" in texts(at), texts(at)[:300])
    check("and the row is untouched", state.rows("exercises", id="e-mine")[0]["is_archived"] is False)


def _seed_slot(slot_id: str, athlete_id: str, when, clock: str = "18:00") -> None:
    state.STORE["appointments"].append({
        "id": slot_id, "gym_id": state.GYM, "athlete_id": athlete_id, "membership_id": state.OWNER,
        "date": when.isoformat(), "time": clock, "duration_min": 60, "type": "personal",
        "notes": None, "status": "scheduled", "session_id": None, "deleted_at": None,
    })


def test_a_slot_for_a_removed_athlete_can_still_be_cancelled() -> None:
    """Four future slots for a removed athlete were four dead cards until somebody wrote SQL."""
    from lib import gym

    state.reset()
    today = gym.today(state.GYM)
    _seed_slot("ap-gone", "a-removed", today)
    at = open_screen(CALENDAR_DRIVER)
    body = texts(at)
    check("the card says the athlete is gone", "Ο αθλητής δεν βρέθηκε." in body, body[:500])
    check("and still offers «Ακύρωση»", any(b.key == "del-ap-gone" for b in at.button),
          str([b.key for b in at.button]))
    press(at, "del-ap-gone")
    check("which works", state.deleted("appointments", "ap-gone"))
    check("and says so", "ακυρώθηκε" in texts(at), texts(at)[:300])


def test_starting_from_a_slot_links_it_to_the_workout() -> None:
    from lib import gym

    state.reset()
    today = gym.today(state.GYM)
    _seed_slot("ap1", state.ATHLETE, today, "07:00")
    at = open_screen(CALENDAR_DRIVER)
    before = len(state.STORE["sessions"])
    press(at, "go-ap1")
    slot = state.rows("appointments", id="ap1")[0]
    check("a workout was started", len(state.STORE["sessions"]) == before + 1)
    check("the slot points at it", slot["session_id"] == state.STORE["sessions"][-1]["id"], str(slot))
    check("and the log screen was handed it",
          at.session_state["session_id"] == state.STORE["sessions"][-1]["id"])

    # A second tap on a slot already started elsewhere must not mint another.
    press(at, "go-ap1") if any(b.key == "go-ap1" for b in at.button) else None
    check("no second workout for the same slot", len(state.STORE["sessions"]) == before + 1)

    # And a dead connection on the insert is a notice, not a traceback.
    import streamlit as st

    _seed_slot("ap2", state.ATHLETE, today, "08:00")
    st.cache_data.clear()
    at = open_screen(CALENDAR_DRIVER)
    fake_supabase.FAIL_ONCE[:] = ["insert:sessions"]
    press(at, "go-ap2")
    check("the failure is explained", "δεν ξεκίνησε" in texts(at), texts(at)[:400])


def test_progress_keeps_one_record_per_implement() -> None:
    """80 on the barbell and 40 on dumbbells are two bests, not one «Καλύτερο 80×8»."""
    state.reset()
    state.STORE["blocks"].append({
        "id": "b-db-hist", "gym_id": state.GYM, "session_id": state.LAST_SESSION,
        "exercise_id": "e-bar", "position": 1, "note": None,
        "equipment": "dumbbell", "deleted_at": None,
    })
    state.STORE["sets"].append({
        "id": "s-db-hist", "gym_id": state.GYM, "block_id": "b-db-hist", "position": 0,
        "kind": "weight_reps", "load_kg": "40.00", "reps": 10, "seconds": None,
        "meters": None, "note": None, "done_at": state.NOW, "created_by": state.OWNER,
        "deleted_at": None,
    })
    at = open_screen(PROGRESS_DRIVER)
    frames = [d.value for d in at.dataframe]
    check("the records table is drawn", len(frames) >= 1, str(len(frames)))
    table = frames[-1]
    rows = {row["Άσκηση"]: row for row in table.to_dict("records")}
    check("the barbell best is its own row",
          rows.get("Πιέσεις Στήθους · Μπάρα", {}).get("Καλύτερο") == "80×8", str(rows))
    check("and the dumbbell best is another",
          rows.get("Πιέσεις Στήθους · Αλτήρες", {}).get("Καλύτερο") == "40×10", str(rows))
    check("each with its date and author",
          rows.get("Πιέσεις Στήθους · Αλτήρες", {}).get("Ποιος") == "Δημήτρης", str(rows))


def test_progress_names_a_merged_movement() -> None:
    """A block still pointing at the folded duplicate must not read «—»."""
    state.reset()
    state.STORE["exercises"].append({
        "id": "e-dup", "gym_id": state.GYM, "name_el": "Πιέσεις στήθους (παλιό)", "name_en": None,
        "category": "upper", "equipment": "barbell", "default_set_kind": "weight_reps",
        "is_archived": True, "merged_into_id": "e-bar", "deleted_at": None,
    })
    state.rows("blocks", id=state.BLOCK)[0]["exercise_id"] = "e-dup"
    at = open_screen(PROGRESS_DRIVER)
    table = [d.value for d in at.dataframe][-1]
    names = [row["Άσκηση"] for row in table.to_dict("records")]
    check("the record is filed under the target's name",
          names == ["Πιέσεις Στήθους · Μπάρα"], str(names))
    check("and the set still counts towards its muscle group",
          "Καμία άσκηση δεν είναι ακόμη κατηγοριοποιημένη" not in texts(at), texts(at)[:400])


def test_the_fake_sorts_the_way_postgres_does() -> None:
    """The mandated (position, id) sort was never exercised: the last .order() won outright."""
    from fake_supabase import _Query

    store = {"t": [{"id": "z", "position": 0}, {"id": "a", "position": 1},
                   {"id": "m", "position": 0}, {"id": "k", "position": 10}]}
    got = [r["id"] for r in _Query(store, "t").order("position").order("id").execute().data]
    check("position first, then id", got == ["m", "z", "a", "k"], str(got))
    got = [r["position"] for r in _Query(store, "t").order("position").execute().data]
    check("numbers as numbers", got == [0, 0, 1, 10], str(got))
    got = [r["id"] for r in _Query(store, "t").gte("position", 1).execute().data]
    check("gte works", sorted(got) == ["a", "k"], str(got))


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
