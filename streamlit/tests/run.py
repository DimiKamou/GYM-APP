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
import re
import sys
import time
import traceback
from datetime import date, datetime, timedelta

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
    check("each movement appears once", list(name_list(at).options) == ["Cable Lateral Raise", "Incline Bench Press", "Step-Up", "Έλξεις", "Κωπηλατική", "Πιέσεις σε μηχάνημα", "Πιέσεις Στήθους"],
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

    from lib import exercises

    ways = way_list(at)
    check("an exercise that never said offers every implement",
          len(ways.options) == len(exercises.EQUIPMENT_LABELS), str(ways.options))
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
    last_lines = [line for line in body.splitlines() if "Τελευταία φορά" in line or "Πρώτη φορά" in line]
    check("today's barbell block does not quote the dumbbell numbers",
          not any("40×10" in line for line in last_lines), str(last_lines))
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
          "Τελευταία φορά: **77,5×5** · 25 Αυγ · Δημήτρης" in body, body[:600])
    last_lines = [line for line in body.splitlines() if "Τελευταία φορά" in line]
    check("and the dumbbell numbers still are not", not any("40×10" in line for line in last_lines),
          str(last_lines))


def test_an_empty_block_does_not_hide_last_time() -> None:
    """A workout opened, given the bench and left without a set is not the
    bench's last time. «Νέα προπόνηση» leaves the earlier workout open, so this
    is ordinary use, and it used to read «Πρώτη φορά» over last week's 77,5×5."""
    import streamlit as st

    def history_and_a_newer_empty_block(*, deleted_set: bool) -> None:
        state.reset()
        st.cache_data.clear()
        state.STORE["blocks"].append({
            "id": "b-bar-hist", "gym_id": state.GYM, "session_id": state.LAST_SESSION,
            "exercise_id": "e-bar", "position": 1, "note": None,
            "equipment": "barbell", "deleted_at": None,
        })
        state.STORE["sets"].append({
            "id": "s-bar-hist", "gym_id": state.GYM, "block_id": "b-bar-hist", "position": 0,
            "kind": "weight_reps", "load_kg": "77.50", "reps": 5, "seconds": None,
            "meters": None, "note": None, "done_at": state.NOW, "created_by": state.OWNER,
            "deleted_at": None,
        })
        # 28 Aug: between last week's workout and today's, with the bench in it
        # and nothing logged — or one set, then deleted.
        state.STORE["sessions"].append({
            "id": "s-empty", "gym_id": state.GYM, "athlete_id": state.ATHLETE,
            "status": "finished", "title": None, "notes": None, "local_date": "2026-08-28",
            "started_at": "2026-08-28T07:00:00+00:00",
            "finished_at": "2026-08-28T08:00:00+00:00",
            "logged_by": state.TRAINER, "credited_to": None, "created_at": state.NOW,
            "deleted_at": None,
        })
        state.STORE["blocks"].append({
            "id": "b-empty", "gym_id": state.GYM, "session_id": "s-empty",
            "exercise_id": "e-bar", "position": 0, "note": None,
            "equipment": "barbell", "deleted_at": None,
        })
        if deleted_set:
            state.STORE["sets"].append({
                "id": "s-gone", "gym_id": state.GYM, "block_id": "b-empty", "position": 0,
                "kind": "weight_reps", "load_kg": "90.00", "reps": 3, "seconds": None,
                "meters": None, "note": None, "done_at": state.NOW,
                "created_by": state.TRAINER, "deleted_at": "2026-08-28T07:11:00+00:00",
            })

    history_and_a_newer_empty_block(deleted_set=False)
    body = texts(open_log())
    check("an empty newer block falls back to the last real bench",
          "Τελευταία φορά: **77,5×5** · 25 Αυγ · Δημήτρης" in body, body[:600])
    check("and does not call it the first time", "Πρώτη φορά" not in body, body[:600])

    history_and_a_newer_empty_block(deleted_set=True)
    body = texts(open_log())
    check("a newer block whose only set was deleted falls back too",
          "Τελευταία φορά: **77,5×5** · 25 Αυγ · Δημήτρης" in body, body[:600])
    check("and the deleted set is not quoted", "90×3" not in body, body[:600])

    # On this database a hang is a count. Looking further back must cost one
    # more query, not one per abandoned workout: here the bench was left empty
    # in twenty workouts in a row, on the barbell and on dumbbells.
    def sets_reads_to_open(empty_workouts: int) -> tuple[int, str]:
        history_and_a_newer_empty_block(deleted_set=False)
        for n in range(empty_workouts):
            day = f"2026-08-{26 + n % 3:02d}"
            state.STORE["sessions"].append({
                "id": f"s-left-{n}", "gym_id": state.GYM, "athlete_id": state.ATHLETE,
                "status": "active", "title": None, "notes": None, "local_date": day,
                "started_at": f"{day}T{6 + n // 3:02d}:00:00+00:00", "finished_at": None,
                "logged_by": state.TRAINER, "credited_to": None, "created_at": state.NOW,
                "deleted_at": None,
            })
            for gear in ("barbell", "dumbbell"):
                state.STORE["blocks"].append({
                    "id": f"b-left-{n}-{gear}", "gym_id": state.GYM,
                    "session_id": f"s-left-{n}", "exercise_id": "e-bar", "position": 0,
                    "note": None, "equipment": gear, "deleted_at": None,
                })
        fake_supabase.reset_round_trips()
        body = texts(open_log())
        return sum(trip == "select:sets" for trip in fake_supabase.ROUND_TRIPS), body

    one_empty, _ = sets_reads_to_open(0)
    many_empty, body = sets_reads_to_open(20)
    check("twenty abandoned workouts still fall back to the last real bench",
          "Τελευταία φορά: **77,5×5** · 25 Αυγ · Δημήτρης" in body, body[:600])
    check(f"and cost the same sets reads as one ({many_empty} vs {one_empty})",
          many_empty == one_empty, " ".join(fake_supabase.ROUND_TRIPS))


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
          list(names.options) == ["Cable Lateral Raise", "Incline Bench Press", "Step-Up", "Έλξεις", "Κωπηλατική", "Πιέσεις σε μηχάνημα", "Πιέσεις Στήθους"], str(names.options))
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
          "Τελευταία φορά: **24×12** · 25 Αυγ · Δημήτρης" in body, body[:800])


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

    edits = [b for b in at.button if (b.key or "").startswith("ed-") and b.key.endswith("-e-mine")]
    check("the exercise offers an edit under each heading", len(edits) == 2, str([b.key for b in edits]))
    check("with different keys", len({b.key for b in edits}) == 2, str([b.key for b in edits]))

    # And editing from one heading opens exactly one form, not two.
    edits[0].click().run()
    raise_on_exception(at)
    forms = [b.key for b in at.button if (b.key or "").startswith("FormSubmitter:library_edit-")]
    check("one heading opens one form", len(set(k.rsplit("-", 1)[0] for k in forms)) == 1, str(forms))


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

    [t for t in at.text_input if t.label == "Όνομα"][0].set_value("Smith Press")
    [m for m in at.multiselect if m.label == "Όργανα"][0].set_value(["Smith"])
    button(at, "library_edit-mg-chest-e-mine").click().run()
    raise_on_exception(at)

    row = state.rows("exercises", id="e-mine")[0]
    check("the name is saved, in the gym's one name column",
          row["name_en"] == "Smith Press" and row["name_el"] is None, str(row))
    check("the equipment is saved", row["equipment"] == "smith", str(row["equipment"]))
    check("as the exercise's only tool, so the picker selects it by itself",
          row["equipment_options"] == ["smith"], str(row.get("equipment_options")))


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
    """A preselected όργανο is one nobody reads, and it decides what 40 kg means.

    Left empty, it means what the gym asked for when it said a new exercise
    should not have to commit: any tool, chosen at the time.
    """
    state.reset()
    at = open_library()
    tools = [m for m in at.multiselect if m.label == "Όργανα"]
    check("the new-exercise form asks rather than assumes",
          len(tools) == 1 and tools[0].value == [], str([m.value for m in tools]))

    [t for t in at.text_input if t.label == "Όνομα"][0].set_value("Landmine Press")
    [s for s in at.selectbox if s.label == "Κύρια μυϊκή ομάδα"][0].set_value(state.CHEST)
    press(at, "library_new")
    rows = state.rows("exercises", name_en="Landmine Press")
    check("it is saved", len(rows) == 1, str(rows))
    check("offering every tool, none preselected at log time",
          rows and len(rows[0]["equipment_options"]) == 15, str(rows))


def test_the_library_says_which_tools_and_saves_them() -> None:
    """One tool is fixed by the name; several are the coach's choice. Same field."""
    from lib import exercises

    state.reset()
    at = open_library()
    body = texts(at)
    check("a choice exercise lists its tools", "Μπάρα / Αλτήρες / Smith" in body, body[:900])
    check("a fixed one names its tool", "Τροχαλία · Κιλά × επαναλήψεις" in body, body[:900])

    [t for t in at.text_input if t.label == "Όνομα"][0].set_value("Romanian Deadlift")
    [m for m in at.multiselect if m.label == "Όργανα"][0].set_value(["Μπάρα", "Trap bar", "Kettlebell"])
    [s for s in at.selectbox if s.label == "Κύρια μυϊκή ομάδα"][0].set_value(state.QUADS)
    press(at, "library_new")
    row = state.rows("exercises", name_en="Romanian Deadlift")
    check("several tools are stored in the order given",
          row and row[0]["equipment_options"] == ["barbell", "trap_bar", "kettlebell"], str(row))
    check("and the first is the column the schema requires",
          row and row[0]["equipment"] == "barbell", str(row))
    check("so the picker will ask", row and exercises.is_choice(row[0]))

    # Editing opens on the stored tools and the English name — the name box
    # was bound to name_el and opened empty on every exercise of the new list.
    at = open_library()
    press(at, f"ed-{state.CHEST}-{state.CHOICE}")
    name_box = [t for t in at.text_input if t.label == "Όνομα"][0]
    check("the edit form shows the English name", name_box.value == "Incline Bench Press", str(name_box.value))
    tools = [m for m in at.multiselect if m.label == "Όργανα"][0]
    check("and the stored tools", tools.value == ["Μπάρα", "Αλτήρες", "Smith"], str(tools.value))


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
    rows = state.rows("exercises", name_en="Κωπηλασία 2000μ")
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
    rows = state.rows("exercises", name_en="Διάδρομος")
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
    check("the exercise is in the catalogue", len(state.rows("exercises", name_en="Πιέσεις σε Smith")) == 1)
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
    # exercises_gym_en_uniq is (gym_id, lower(name_en)): the collision is with
    # another of the gym's own rows, named in English like every row after 011.
    state.STORE["exercises"].append({
        "id": "e-ours", "gym_id": state.GYM, "name_el": None, "name_en": "Δική μας",
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
# The gym's own list (011): a tool fixed by the name, or the coach's choice.
# ---------------------------------------------------------------------------

def _pick(at: AppTest, name: str) -> AppTest:
    name_list(at).set_value(name).run()
    raise_on_exception(at)
    return at


def test_a_tool_in_the_name_is_selected_by_itself() -> None:
    """«Cable Lateral Raise» is the cable; the owner's own example."""
    state.reset()
    at = _pick(open_log(), "Cable Lateral Raise")
    ways = way_list(at)
    check("the third list holds that one tool", list(ways.options) == ["Τροχαλία"], str(ways.options))
    check("already selected", ways.value == "cable", str(ways.value))
    check("and locked, because the name already said it", ways.disabled is True)
    check("the button is live straight away", button(at, "log_add_-1").disabled is False)
    press(at, "log_add_-1")
    added = state.rows("blocks", session_id=state.SESSION, exercise_id=state.FIXED)
    check("the block records the cable", added and added[0].get("equipment") == "cable", str(added))
    check("and the card says so", "Cable Lateral Raise · Τροχαλία" in texts(at), texts(at)[:500])


def test_a_choice_of_tools_is_the_coachs_to_make() -> None:
    """«Bench Press» with barbell, dumbbell or Smith: nothing preselected."""
    state.reset()
    at = _pick(open_log(), "Incline Bench Press")
    ways = way_list(at)
    check("only the exercise's own tools are offered",
          list(ways.options) == ["Μπάρα", "Αλτήρες", "Smith"], str(ways.options))
    check("none of them preselected", ways.value is None, str(ways.value))
    check("and the list is open", ways.disabled is False)

    before = len(state.rows("blocks", session_id=state.SESSION))
    press(at, "log_add_-1")
    check("adding without a tool is refused", len(state.rows("blocks", session_id=state.SESSION)) == before)
    check("with the reason", "Διάλεξε τρόπο εκτέλεσης" in texts(at), texts(at)[:500])

    way_list(at).set_value("dumbbell").run()
    press(at, "log_add_-1")
    added = state.rows("blocks", session_id=state.SESSION, exercise_id=state.CHOICE)
    check("the chosen tool is written", added and added[0].get("equipment") == "dumbbell", str(added))
    check("and shown", "Incline Bench Press · Αλτήρες" in texts(at), texts(at)[:500])


def test_a_choice_exercise_never_claims_its_fallback_tool() -> None:
    """A block with no tool on an exercise that offers several says no tool at all.

    The `equipment` column of a choice exercise is only there because the
    schema requires one. Printed, it would put «Μπάρα» on a number that may
    have been dumbbells.
    """
    state.reset()
    state.STORE["blocks"].append({
        "id": "b-unknown", "gym_id": state.GYM, "session_id": state.SESSION,
        "exercise_id": state.CHOICE, "position": 1, "note": None, "equipment": None,
        "deleted_at": None,
    })
    at = open_log()
    body = texts(at)
    check("the card names the exercise", "Incline Bench Press" in body, body[:600])
    check("and no tool", "Incline Bench Press · Μπάρα" not in body, body[:600])


def test_bodyweight_chosen_asks_for_reps_not_kilos() -> None:
    """A step-up on the body alone is twelve reps, not «0 κιλά × 12»."""
    state.reset()
    at = _pick(open_log(), "Step-Up")
    way_list(at).set_value("bodyweight").run()
    press(at, "log_add_-1")
    block = state.rows("blocks", session_id=state.SESSION, exercise_id=state.STEP_UP)[0]
    keys = {w.key for w in at.number_input} | {w.key for w in at.text_input}
    check("the set form is the bodyweight one", f"log_bwreps_{block['id']}" in keys, str(sorted(k for k in keys if k)))
    check("and not kilos × reps", f"log_kg_{block['id']}" not in keys)

    at.number_input(key=f"log_bwreps_{block['id']}").set_value(12)
    press(at, f"log_set_{block['id']}")
    rows = state.rows("sets", block_id=block["id"])
    check("twelve bodyweight reps are logged", rows and rows[0]["kind"] == "bodyweight"
          and rows[0]["reps"] == 12, str(rows))

    # The same exercise with a barbell is kilos × reps as usual.
    at = _pick(open_log(), "Step-Up")
    way_list(at).set_value("barbell").run()
    press(at, "log_add_-1")
    loaded = [b for b in state.rows("blocks", session_id=state.SESSION, exercise_id=state.STEP_UP)
              if b.get("equipment") == "barbell"][0]
    keys = {w.key for w in at.text_input}
    check("loaded, it asks for kilos", f"log_kg_{loaded['id']}" in keys, str(sorted(k for k in keys if k)))


def test_repeating_a_choice_exercise_needs_its_tool() -> None:
    """Last week's block knows its tool: repeat it. One that does not: let the lists ask."""
    state.reset()
    state.STORE["blocks"].append({
        "id": "b-hist-choice", "gym_id": state.GYM, "session_id": state.LAST_SESSION,
        "exercise_id": state.CHOICE, "position": 1, "note": None, "equipment": "smith",
        "deleted_at": None,
    })
    at = open_log()
    labels = [b.label for b in at.button if b.label.startswith("+ ")]
    check("the tool it was done with is on the button",
          "+ Incline Bench Press · Smith" in labels, str(labels))

    state.reset()
    state.STORE["blocks"].append({
        "id": "b-hist-unknown", "gym_id": state.GYM, "session_id": state.LAST_SESSION,
        "exercise_id": state.CHOICE, "position": 1, "note": None, "equipment": None,
        "deleted_at": None,
    })
    at = open_log()
    labels = [b.label for b in at.button if b.label.startswith("+ ")]
    check("a block that never said which tool is not repeated blind",
          not any("Incline Bench Press" in label for label in labels), str(labels))


def test_a_new_exercise_in_the_workout_can_offer_a_choice() -> None:
    """The tool of today, and the others it can be done with."""
    state.reset()
    at = open_log()
    at.selectbox(key="log_group").set_value(0).run()
    [t for t in at.text_input if t.label == "Όνομα άσκησης"][0].set_value("Decline Bench Press")
    at.selectbox(key=f"log_new_gear_{state.CHEST}").set_value("Μπάρα")
    at.multiselect(key=f"log_new_more_{state.CHEST}").set_value(["Αλτήρες", "Smith"])
    press(at, f"log_new_exercise_{state.CHEST}")
    row = state.rows("exercises", name_en="Decline Bench Press")
    check("created with all three tools", row and row[0]["equipment_options"] == ["barbell", "dumbbell", "smith"],
          str(row))
    check("named in English, in name_en", row and row[0].get("name_el") is None, str(row))
    block = state.rows("blocks", session_id=state.SESSION, exercise_id=row[0]["id"]) if row else []
    check("and in today's workout on the barbell", block and block[0].get("equipment") == "barbell", str(block))

    # Nothing added: the tool is fixed by the name from now on.
    at = open_log()
    at.selectbox(key="log_group").set_value(0).run()
    [t for t in at.text_input if t.label == "Όνομα άσκησης"][0].set_value("Cable Crossover")
    at.selectbox(key=f"log_new_gear_{state.CHEST}").set_value("Τροχαλία")
    press(at, f"log_new_exercise_{state.CHEST}")
    row = state.rows("exercises", name_en="Cable Crossover")
    check("one tool is a fixed tool", row and row[0]["equipment_options"] == ["cable"], str(row))


def test_the_options_helpers_read_what_postgrest_sends() -> None:
    from lib import exercises

    check("a JSON list", exercises.options_of({"equipment_options": ["barbell", "dumbbell"]}) == ["barbell", "dumbbell"])
    check("the text form", exercises.options_of({"equipment_options": "{barbell,smith}"}) == ["barbell", "smith"])
    check("NULL is 'never said'", exercises.options_of({"equipment_options": None}) is None)
    check("an unknown tool is dropped", exercises.options_of({"equipment_options": ["laser"]}) is None)
    check("a fixed exercise's tool is known",
          exercises.implement_of({"equipment": "cable", "equipment_options": ["cable"]}) == "cable")
    check("a choice exercise's is not",
          exercises.implement_of({"equipment": "barbell", "equipment_options": ["barbell", "dumbbell"]}) == "")
    check("the block's own answer always wins",
          exercises.implement_of({"equipment": "barbell", "equipment_options": ["barbell", "dumbbell"]}, "dumbbell") == "dumbbell")
    check("no tools chosen is every tool, with the neutral column",
          exercises.stored_tools([]) == ("other", list(exercises.EQUIPMENT_LABELS)))
    check("the two tables agree on which tools are the body",
          exercises.BODYWEIGHT_TOOLS
          == {tool for tool, kind in exercises.KIND_FOR_EQUIPMENT.items() if kind == "bodyweight"},
          str(exercises.BODYWEIGHT_TOOLS))
    check("bodyweight tools switch a loaded exercise to reps",
          exercises.kind_for_block("weight_reps", "equalizer") == "bodyweight"
          and exercises.kind_for_block("weight_reps", "barbell") == "weight_reps"
          and exercises.kind_for_block("duration", "bodyweight") == "duration")


def test_the_app_keeps_working_until_the_sql_is_run() -> None:
    """The app deploys on merge; the gym pastes the SQL afterwards.

    In between, a select naming `equipment_options` is refused (42703). Every
    screen that reads an exercise named it, so the first deploy would have
    taken the workout screen down until someone found the Supabase editor.
    """
    from lib import exercises

    state.reset()
    fake_supabase.MISSING_COLUMNS["exercises"] = {"equipment_options"}
    for row in state.STORE["exercises"]:
        row.pop("equipment_options", None)

    at = open_log()
    check("the workout screen opens", "Πιέσεις Στήθους · Μπάρα" in texts(at), texts(at)[:300])
    _pick(at, "Πιέσεις Στήθους")
    ways = way_list(at)
    check("the third list offers only the tools the old schema has",
          len(ways.options) == 9 and "EZ bar" not in ways.options, str(ways.options))
    way_list(at).set_value("dumbbell").run()
    press(at, "log_add_-1")
    check("and an exercise still goes in", any(b.get("equipment") == "dumbbell"
          for b in state.rows("blocks", session_id=state.SESSION)))

    at = open_library()
    check("the library's tool field is the old single one",
          not [m for m in at.multiselect if m.label == "Όργανα"]
          and [s for s in at.selectbox if s.label == "Εξοπλισμός"], str([w.label for w in at.selectbox]))
    [t for t in at.text_input if t.label == "Όνομα"][0].set_value("Landmine Press")
    [s for s in at.selectbox if s.label == "Κύρια μυϊκή ομάδα"][0].set_value(state.CHEST)
    press(at, "library_new")
    check("and still requires a tool", "Διάλεξε εξοπλισμό" in texts(at), texts(at)[:300])
    [s for s in at.selectbox if s.label == "Εξοπλισμός"][0].set_value("Μπάρα")
    press(at, "library_new")
    row = state.rows("exercises", name_el="Landmine Press")
    check("the library still creates exercises, in the column the old names are in",
          len(row) == 1 and "equipment_options" not in row[0] and row[0]["equipment"] == "barbell", str(row))

    # Saving an old row must not move its Greek name over its English one:
    # 011 recognises the old catalogue by the English name. The pilot gym owns
    # its old rows since 006, so this one is made the gym's.
    state.rows("exercises", id="e-pullup")[0]["gym_id"] = state.GYM
    import streamlit as st

    st.cache_data.clear()
    fake_supabase.MISSING_COLUMNS["exercises"] = {"equipment_options"}
    at = open_library()
    press(at, f"ed-{state.BACK}-e-pullup")
    press(at, f"library_edit-{state.BACK}-e-pullup")
    pullup = state.rows("exercises", id="e-pullup")[0]
    check("an old row saved before 011 keeps both its names",
          pullup["name_el"] == "Έλξεις" and pullup["name_en"] == "Pull-up", str(pullup))

    at = open_log()
    at.selectbox(key="log_group").set_value(0).run()
    check("the workout's new-exercise form does not offer tools it cannot keep",
          not [m for m in at.multiselect if m.label == "Γίνεται και με"], str([m.label for m in at.multiselect]))

    at = open_athlete()
    check("the athlete sheet reads its last workout", "δεν φορτώθηκ" not in texts(at)
          and "Πιέσεις Στήθους · Μπάρα · 80×8" in texts(at), texts(at)[:500])
    at = open_screen(PROGRESS_DRIVER)
    check("and Πρόοδος reads its history", "δεν φορτώθηκ" not in texts(at)
          and len(at.dataframe) >= 1, texts(at)[:300])

    # The SQL runs; within the probe's minute the new behaviour is on.
    fake_supabase.MISSING_COLUMNS.clear()
    exercises.has_tool_lists.clear()
    check("the column is seen once it exists", exercises.has_tool_lists(state.GYM) is True)


def test_a_stale_screen_cannot_write_over_011() -> None:
    """For up to a minute after the paste a screen can show a row read before it.

    Saving that row must not write the pre-011 name and tool over what 011 did.
    The screen is drawn before the paste; 011 then rewrites the row; the save
    from the old screen must reach nothing and say so.
    """
    from lib import exercises

    state.reset()
    row = state.rows("exercises", id=state.CHOICE)[0]
    row.update({"name_el": "Επικλινείς Πιέσεις", "name_en": "Incline Dumbbell Press",
                "equipment": "dumbbell", "updated_at": "2026-09-01T07:00:00+00:00"})
    row.pop("equipment_options", None)
    fake_supabase.MISSING_COLUMNS["exercises"] = {"equipment_options"}
    at = open_library()

    # The owner pastes 011. The probe notices within its minute; the screen's
    # own copy of the catalogue is still the one from before.
    row.update({"name_el": None, "name_en": "Incline Bench Press", "equipment": "barbell",
                "equipment_options": ["barbell", "dumbbell", "smith"],
                "updated_at": "2026-10-05T07:00:00+00:00"})
    fake_supabase.MISSING_COLUMNS.clear()
    exercises.has_tool_lists.clear()

    press(at, f"ed-{state.CHEST}-{state.CHOICE}")
    press(at, f"library_edit-{state.CHEST}-{state.CHOICE}")
    after = state.rows("exercises", id=state.CHOICE)[0]
    check("011's name survived the stale save", after["name_en"] == "Incline Bench Press"
          and after["name_el"] is None, str(after))
    check("and so did its tools", after["equipment_options"] == ["barbell", "dumbbell", "smith"],
          str(after.get("equipment_options")))
    check("the coach is told to reopen it", "άλλαξε στο μεταξύ" in texts(at), texts(at)[:400])


def test_a_dropped_probe_is_not_remembered_as_no_column() -> None:
    """One lost request must not switch every exercise to the old mode for a minute."""
    from lib import exercises

    state.reset()
    exercises.has_tool_lists.clear()
    fake_supabase.FAIL_ONCE[:] = ["select:exercises"]
    try:
        exercises.has_tool_lists(state.GYM)
        raised = False
    except Exception:
        raised = True
    check("a network failure is an error, not an answer", raised)
    check("and the next look sees the column", exercises.has_tool_lists(state.GYM) is True)


def test_repeat_never_bypasses_the_exercises_own_tools() -> None:
    """A lateral raise logged on the cable before 011 is not a dumbbell Lateral Raise."""
    state.reset()
    state.STORE["blocks"].append({
        "id": "b-hist-cable", "gym_id": state.GYM, "session_id": state.LAST_SESSION,
        "exercise_id": state.CHOICE, "position": 1, "note": None, "equipment": "cable",
        "deleted_at": None,
    })
    at = open_log()
    labels = [b.label for b in at.button if b.label.startswith("+ ")]
    check("a tool the exercise does not offer is not repeated",
          not any("Incline Bench Press" in label for label in labels), str(labels))

    # A fixed exercise repeated from a block that never said its tool gets it.
    state.reset()
    state.STORE["blocks"].append({
        "id": "b-hist-fixed", "gym_id": state.GYM, "session_id": state.LAST_SESSION,
        "exercise_id": state.FIXED, "position": 1, "note": None, "equipment": None,
        "deleted_at": None,
    })
    at = open_log()
    press(at, f"log_again_{state.FIXED}")
    added = state.rows("blocks", session_id=state.SESSION, exercise_id=state.FIXED)
    check("a fixed exercise is repeated with its tool written down",
          added and added[0].get("equipment") == "cable", str(added))


def test_changing_an_exercises_tools_resets_the_third_list() -> None:
    """Fixed → choice must not leave the old tool preselected."""
    state.reset()
    at = _pick(open_log(), "Cable Lateral Raise")
    check("fixed: the cable is selected", way_list(at).value == "cable")
    state.rows("exercises", id=state.FIXED)[0]["equipment_options"] = ["cable", "dumbbell"]
    import streamlit as st

    st.cache_data.clear()
    at.run()
    raise_on_exception(at)
    ways = way_list(at)
    check("after the owner adds dumbbells, the coach chooses afresh",
          ways.value is None and list(ways.options) == ["Τροχαλία", "Αλτήρες"],
          f"{ways.value} {list(ways.options)}")


def test_a_new_exercise_is_measured_by_all_its_tools() -> None:
    """Bodyweight today and a barbell next week is measured in kilos."""
    state.reset()
    at = open_log()
    at.selectbox(key="log_group").set_value(0).run()
    [t for t in at.text_input if t.label == "Όνομα άσκησης"][0].set_value("Walking Lunge")
    at.selectbox(key=f"log_new_gear_{state.CHEST}").set_value("Σωματικό βάρος")
    at.multiselect(key=f"log_new_more_{state.CHEST}").set_value(["Μπάρα", "Αλτήρες"])
    press(at, f"log_new_exercise_{state.CHEST}")
    row = state.rows("exercises", name_en="Walking Lunge")
    check("the exercise is kilos × reps", row and row[0]["default_set_kind"] == "weight_reps", str(row))
    block = state.rows("blocks", session_id=state.SESSION, exercise_id=row[0]["id"])[0] if row else {}
    keys = {w.key for w in at.number_input}
    check("today's bodyweight block still gets the reps form", f"log_bwreps_{block.get('id')}" in keys,
          str(sorted(k for k in keys if k)))


# ---------------------------------------------------------------------------
# Past workouts in a coach's words: the last three above the log, and Πρόοδος
# a week or a month at a time.
# ---------------------------------------------------------------------------

def _past_workout(session_id: str, day: str, lifts: list[tuple[str, str | None, list[tuple]]],
                  *, coach: str = state.OWNER, credited: str | None = None,
                  title: str | None = None, athlete: str = state.ATHLETE) -> None:
    """A finished workout on `day`: per exercise (id, όργανο, [(kg, reps, done)])."""
    state.STORE["sessions"].append({
        "id": session_id, "gym_id": state.GYM, "athlete_id": athlete, "status": "finished",
        "title": title, "notes": None, "local_date": day,
        "started_at": f"{day}T07:00:00+00:00", "finished_at": f"{day}T08:00:00+00:00",
        "logged_by": coach, "credited_to": credited, "created_at": state.NOW, "deleted_at": None,
    })
    for b, (exercise_id, gear, sets) in enumerate(lifts):
        block_id = f"{session_id}-b{b}"
        state.STORE["blocks"].append({
            "id": block_id, "gym_id": state.GYM, "session_id": session_id,
            "exercise_id": exercise_id, "position": b, "note": None,
            "equipment": gear, "deleted_at": None,
        })
        for n, (kg, reps, done) in enumerate(sets):
            state.STORE["sets"].append({
                "id": f"{block_id}-s{n}", "gym_id": state.GYM, "block_id": block_id,
                "position": n, "kind": "weight_reps", "load_kg": kg, "reps": reps,
                "seconds": None, "meters": None, "note": None,
                "done_at": f"{day}T07:30:00+00:00" if done else None,
                "created_by": coach, "deleted_at": None,
            })


def _empty_open_workout() -> None:
    """Today's workout with nothing in it yet: the moment the coach reads the recap."""
    state.STORE["blocks"] = [b for b in state.STORE["blocks"] if b["session_id"] != state.SESSION]
    state.STORE["sets"] = [s for s in state.STORE["sets"] if s["block_id"] != state.BLOCK]


def _lines(at: AppTest) -> list[str]:
    """Every markdown element, unescaped and with plain spaces, in screen order."""
    return [re.sub(r"\\(.)", r"\1", str(m.value)).replace("\u00a0", " ") for m in at.markdown]


def test_recap_lines_say_sets_reps_and_load() -> None:
    """«3×12 · 60 kg» is sets × reps, then the load — the owner's own words."""
    from lib import recap as real

    class recap:  # noqa: N801 — the same functions, read with ordinary spaces
        @staticmethod
        def sets_summary(rows):
            return real.sets_summary(rows).replace("\u00a0", " ")

    def row(i, kg, reps, kind="weight_reps", done=True, **extra):
        return {"id": f"r{i}", "position": i, "kind": kind, "load_kg": kg, "reps": reps,
                "seconds": extra.get("seconds"), "meters": extra.get("meters"),
                "done_at": state.NOW if done else None}

    check("straight sets", recap.sets_summary([row(i, "60.00", 12) for i in range(3)]) == "3×12 · 60 kg",
          recap.sets_summary([row(i, "60.00", 12) for i in range(3)]))
    got = recap.sets_summary([row(0, "60", 12), row(1, "60", 12), row(2, "70", 8)])
    check("the bar going up lists every set, kilos × reps", got == "60×12, 60×12, 70×8", got)
    got = recap.sets_summary([row(2, "70", 8), row(0, "60", 12), row(1, "60", 12)])
    check("ordered by position, not by how they arrived", got == "60×12, 60×12, 70×8", got)
    got = recap.sets_summary([row(0, "72.50", 10), row(1, "72.5", 10)])
    check("a Greek decimal comma, and 72,50 is 72,5", got == "2×10 · 72,5 kg", got)
    got = recap.sets_summary([row(0, "60", 12), row(1, "200", 1, done=False)])
    check("a prescribed set nobody lifted is not in it", got == "60×12", got)
    check("nothing done is an empty string", recap.sets_summary([row(0, "60", 12, done=False)]) == "")
    got = recap.sets_summary([row(i, None, 10, kind="bodyweight") for i in range(3)])
    check("bodyweight is just sets × reps", got == "3×10", got)
    got = recap.sets_summary([row(0, "10", 8, kind="bodyweight")])
    check("a belt is added load", got == "+10×8", got)
    got = recap.sets_summary([row(i, None, None, kind="duration", seconds=45) for i in range(2)])
    check("a plank is time", got == "2×45 δευτ.", got)
    got = recap.sets_summary([row(0, None, None, kind="distance", meters="5000")])
    check("a run is distance", got == "5,0 χλμ", got)
    got = recap.sets_summary([row(0, "0", 10, kind="bodyweight"), row(1, None, 10, kind="bodyweight"),
                              row(2, "0.00", 10, kind="bodyweight")])
    check("sets that read the same are one run, whatever the columns hold", got == "3×10", got)
    got = recap.sets_summary([row(0, None, None, kind="distance", meters="2000"),
                              row(1, None, None, kind="distance", meters="2040")])
    check("and so are two distances that print the same", got == "2×2,0 χλμ", got)
    check("a block whose exercise was not read still names its tool",
          "Μπάρα" in real.block_line(None, {"equipment": "barbell"}, [row(0, "80", 8)]),
          real.block_line(None, {"equipment": "barbell"}, [row(0, "80", 8)]))


def test_recap_periods_are_calendar_weeks_and_months() -> None:
    from lib import recap

    first, last = recap.period(recap.WEEK, date(2026, 10, 18))
    check("a Sunday belongs to the week that began on Monday",
          (first, last) == (date(2026, 10, 12), date(2026, 10, 18)), f"{first} {last}")
    first, last = recap.period(recap.MONTH, date(2028, 2, 10))
    check("February of a leap year ends on the 29th", last == date(2028, 2, 29), str(last))
    first, last = recap.period(recap.MONTH, date(2026, 12, 31))
    check("December ends on the 31st", (first, last) == (date(2026, 12, 1), date(2026, 12, 31)))

    today = date(2026, 10, 14)
    check("a week inside one month", recap.period_label(
        recap.WEEK, date(2026, 10, 12), date(2026, 10, 18), today) == "12–18 Οκτ")
    check("a week across two months", recap.period_label(
        recap.WEEK, date(2026, 9, 28), date(2026, 10, 4), today) == "28 Σεπ – 4 Οκτ")
    got = recap.period_label(recap.WEEK, date(2025, 12, 29), date(2026, 1, 4), today)
    check("a week across two years names both", got == "29 Δεκ 2025 – 4 Ιαν 2026", got)
    got = recap.period_label(recap.WEEK, date(2025, 10, 13), date(2025, 10, 19), today)
    check("last year's week says so", got == "13–19 Οκτ 2025", got)
    got = recap.period_label(recap.MONTH, date(2026, 10, 1), date(2026, 10, 31), today)
    check("a month is its name and year", got == "Οκτώβριος 2026", got)


def test_recap_names_the_folded_movement_and_its_credited_coach() -> None:
    from lib import recap

    by_id = {
        "e-dup": {"id": "e-dup", "name_el": "Πιέσεις (παλιό)", "merged_into_id": "e-bar",
                  "equipment": "barbell"},
        "e-bar": {"id": "e-bar", "name_el": "Πιέσεις Στήθους", "merged_into_id": None,
                  "equipment": "barbell"},
        state.CHOICE: {"id": state.CHOICE, "name_el": None, "name_en": "Incline Bench Press",
                       "equipment": "barbell", "equipment_options": ["barbell", "dumbbell", "smith"]},
    }
    blocks = [{"id": "x1", "exercise_id": "e-dup", "position": 0, "equipment": None},
              {"id": "x2", "exercise_id": state.CHOICE, "position": 1, "equipment": None},
              {"id": "x3", "exercise_id": "e-bar", "position": 2, "equipment": None}]
    sets = [{"id": "y1", "block_id": "x1", "position": 0, "kind": "weight_reps",
             "load_kg": "80", "reps": 8, "done_at": state.NOW},
            {"id": "y2", "block_id": "x2", "position": 0, "kind": "weight_reps",
             "load_kg": "30", "reps": 10, "done_at": state.NOW}]
    lines = [line.replace("\u00a0", " ") for line in
             recap.workout_lines(blocks, sets, by_id, {"e-bar": "Στήθος", state.CHOICE: "Στήθος"})]
    check("a block naming the folded duplicate reads as the movement it became",
          lines[0] == "Στήθος · Πιέσεις Στήθους · Μπάρα · 80×8", str(lines))
    check("a choice of tools that was never made prints no tool",
          lines[1] == "Στήθος · Incline Bench Press · 30×10", str(lines))
    check("an exercise with nothing done is left out", len(lines) == 2, str(lines))

    names = {state.OWNER: "Δημήτρης", state.TRAINER: "Γιώργος"}
    heading = recap.workout_heading(
        {"local_date": "2026-10-13", "logged_by": state.OWNER, "credited_to": state.TRAINER,
         "title": "Πόδια"}, names, date(2026, 10, 14))
    check("the heading is the day, the coach it is credited to, and the title",
          heading == "Τρίτη 13 Οκτ · Γιώργος · Πόδια", heading)
    heading = recap.workout_heading({"local_date": "2026-10-13", "logged_by": "m-gone"},
                                    names, date(2026, 10, 14))
    check("an author nobody can name is said so, never left blank",
          heading == "Τρίτη 13 Οκτ · άγνωστο μέλος", heading)


def test_the_log_opens_with_the_last_three_workouts() -> None:
    """The coach starting a workout sees what this athlete has been doing, newest first."""
    state.reset()
    _empty_open_workout()
    _past_workout("p18", "2026-08-18", [("e-bar", "barbell", [("70.00", 10, True)])])
    _past_workout("p20", "2026-08-20", [("e-pullup", None, [(None, 8, True)] * 3)],
                  coach=state.TRAINER)
    _past_workout("p28", "2026-08-28", [
        (state.CHOICE, "barbell", [("60.00", 12, True)] * 3 + [("70.00", 8, True)]),
        ("e-db", "dumbbell", [("40.00", 10, True)] * 3),
        ("e-bar", "barbell", [("200.00", 1, False)]),
    ], credited=state.TRAINER)
    # Opened and left: nothing done in it, so it is not one of the three.
    _past_workout("p29", "2026-08-29", [("e-bar", "barbell", [])])
    # The seeded 25 Aug workout gets something done in it.
    state.STORE["sets"].append({
        "id": "s-b0", "gym_id": state.GYM, "block_id": "b0", "position": 0,
        "kind": "weight_reps", "load_kg": "35.00", "reps": 12, "seconds": None,
        "meters": None, "note": None, "done_at": state.NOW, "created_by": state.OWNER,
        "deleted_at": None,
    })

    at = open_log()
    lines = _lines(at)
    check("the section names how many, always on screen",
          "**Οι 3 τελευταίες προπονήσεις**" in lines, str(lines[:6]))
    check("each workout opens for its details",
          [e.label for e in at.expander].count("Λεπτομέρειες") == 3, str([e.label for e in at.expander]))

    headings = [line for line in lines if line.startswith("**") and " · " in line]
    order = [h for h in headings if any(d in h for d in ("28 Αυγ", "25 Αυγ", "20 Αυγ", "18 Αυγ", "29 Αυγ"))]
    check("the three are newest first, each with its day and coach",
          order[:3] == ["**Παρασκευή 28 Αυγ · Γιώργος**", "**Τρίτη 25 Αυγ · Δημήτρης**",
                        "**Πέμπτη 20 Αυγ · Γιώργος**"], str(order))
    check("the fourth is not shown", not any("18 Αυγ" in h for h in headings), str(headings))
    check("an empty workout is skipped, not shown blank",
          not any("29 Αυγ" in h for h in headings), str(headings))
    body = "\n".join(lines)
    check("the line the owner asked for",
          "- Στήθος · Incline Bench Press · Μπάρα · 60×12, 60×12, 60×12, 70×8" in body, body[:900])
    check("every exercise of that workout, in order",
          "- Πλάτη · Κωπηλατική · Αλτήρες · 3×10 · 40 kg" in body, body[:900])
    check("bodyweight work as sets × reps", "- Πλάτη · Έλξεις · Σωματικό βάρος · 3×8" in body, body[:900])
    check("the set nobody lifted is not in it", "200" not in body, body[:900])


def test_the_recap_stays_on_top_once_the_workout_has_an_exercise() -> None:
    state.reset()
    state.STORE["sets"].append({
        "id": "s-b0", "gym_id": state.GYM, "block_id": "b0", "position": 0,
        "kind": "weight_reps", "load_kg": "35.00", "reps": 12, "seconds": None,
        "meters": None, "note": None, "done_at": state.NOW, "created_by": state.OWNER,
        "deleted_at": None,
    })
    at = open_log()
    lines = _lines(at)
    check("one past workout is named in the singular", "**Η προηγούμενη προπόνηση**" in lines, str(lines[:6]))
    check("and it is still on screen with an exercise in today's workout",
          "- Πλάτη · Κωπηλατική · Αλτήρες · 35×12" in lines[3:6] or any(
              "Κωπηλατική · Αλτήρες · 35×12" in line for line in lines), str(lines[:8]))

    # And logging a set does not read the history again: nothing before this
    # workout changed.
    fake_supabase.reset_round_trips()
    at.text_input(key=f"log_kg_{state.BLOCK}").set_value("60")
    at.number_input(key=f"log_reps_{state.BLOCK}").set_value(10)
    button(at, f"log_set_{state.BLOCK}").click().run()
    raise_on_exception(at)
    trips = list(fake_supabase.ROUND_TRIPS)
    check("a set costs no history reads", trips.count("select:blocks") <= 1, " ".join(trips))


def test_a_reopened_workout_does_not_summarise_the_ones_after_it() -> None:
    state.reset()
    for row in state.rows("sessions", id=state.SESSION):
        row["status"] = "finished"
    for row in state.rows("sessions", id=state.LAST_SESSION):
        row["status"] = "active"
    _past_workout("p20", "2026-08-20", [("e-bar", "barbell", [("70.00", 10, True)])])
    at = open_log(session_id=state.LAST_SESSION)
    body = "\n".join(_lines(at))
    check("the workout before it is shown", "Πέμπτη 20 Αυγ" in body, body[:600])
    check("the one after it is not", "1 Σεπ ·" not in body.replace("Σε εξέλιξη", ""), body[:600])


def test_a_workout_reopened_from_long_ago_still_gets_its_three() -> None:
    """Thirteen later workouts used to fill the whole window and leave none before it."""
    state.reset()
    for row in state.rows("sessions", id=state.SESSION):
        row["status"] = "finished"
    for row in state.rows("sessions", id=state.LAST_SESSION):
        row["status"] = "active"
    for n in range(3):
        _past_workout(f"before{n}", f"2026-08-1{n + 1}", [("e-bar", "barbell", [("70.00", 10, True)])])
    for n in range(14):
        _past_workout(f"after{n}", f"2026-09-{n + 2:02d}", [("e-db", "dumbbell", [("40.00", 10, True)])])
    at = open_log(session_id=state.LAST_SESSION)
    check("the three before it", "**Οι 3 τελευταίες προπονήσεις**" in _lines(at), str(_lines(at)[:5]))
    body = "\n".join(_lines(at))
    check("and none after it", "Σεπ" not in body.split("Σε εξέλιξη")[-1].replace("Σε εξέλιξη", ""),
          body[:600])


def test_the_recap_sits_above_the_set_forms() -> None:
    """Filled after the forms, so its reads wait for them — but still drawn on top."""
    state.reset()
    state.STORE["sets"].append({
        "id": "s-b0", "gym_id": state.GYM, "block_id": "b0", "position": 0,
        "kind": "weight_reps", "load_kg": "35.00", "reps": 12, "seconds": None,
        "meters": None, "note": None, "done_at": state.NOW, "created_by": state.OWNER,
        "deleted_at": None,
    })
    at = open_log()
    lines = _lines(at)
    recap_at = next((i for i, line in enumerate(lines) if "Τρίτη 25 Αυγ" in line), -1)
    card_at = next((i for i, line in enumerate(lines) if "Πιέσεις Στήθους · Μπάρα · 1 σετ" in line), -1)
    check("the last workouts come before today's first exercise", -1 < recap_at < card_at,
          f"{recap_at} {card_at}")


def test_the_recap_survives_its_lookups_failing() -> None:
    import streamlit as st

    state.reset()
    state.STORE["sets"].append({
        "id": "s-b0", "gym_id": state.GYM, "block_id": "b0", "position": 0,
        "kind": "weight_reps", "load_kg": "35.00", "reps": 12, "seconds": None,
        "meters": None, "note": None, "done_at": state.NOW, "created_by": state.OWNER,
        "deleted_at": None,
    })
    st.cache_data.clear()
    fake_supabase.FAIL_ONCE[:] = ["select:exercise_muscles"]
    at = open_log()
    fake_supabase.FAIL_ONCE[:] = []
    body = "\n".join(_lines(at))
    check("a failed muscle-group read keeps the workouts, without the group",
          "- Κωπηλατική · Αλτήρες · 35×12" in body, body[:600])

    st.cache_data.clear()
    fake_supabase.FAIL_ONCE[:] = ["select:exercises"]
    at = open_log()
    fake_supabase.FAIL_ONCE[:] = []
    body = "\n".join(_lines(at))
    check("a failed catalogue read still names the workouts: they read their own names",
          "Κωπηλατική · Αλτήρες · 35×12" in body, body[:600])


def test_no_past_workout_no_section() -> None:
    state.reset()
    state.STORE["sessions"] = [s for s in state.STORE["sessions"] if s["id"] != state.LAST_SESSION]
    state.STORE["blocks"] = [b for b in state.STORE["blocks"] if b["session_id"] != state.LAST_SESSION]
    at = open_log()
    labels = [e.label for e in at.expander]
    check("a first workout has nothing to summarise",
          not any("προπόνησ" in label and label != "Επεξεργασία προπόνησης" for label in labels),
          str(labels))


def _progress_texts(at: AppTest) -> str:
    return "\n".join(_lines(at))


def test_progress_opens_on_the_last_week_the_athlete_trained() -> None:
    """This week is empty on a Monday; an empty page is not what the coach came for."""
    state.reset()
    _past_workout("p25b", "2026-08-27", [("e-db", "dumbbell", [("40.00", 10, True)] * 3)])
    at = open_screen(PROGRESS_DRIVER)
    body = _progress_texts(at)
    check("the week of the latest workout", "#### 31 Αυγ – 6 Σεπ" in body, body[:400])
    check("with that workout, its day and its coach", "**Τρίτη 1 Σεπ · Δημήτρης · σε εξέλιξη**" in body, body[:600])
    check("and its exercise in the owner's words",
          "- Στήθος · Πιέσεις Στήθους · Μπάρα · 80×8" in body, body[:600])
    check("not the week before's", "Κωπηλατική" not in body, body[:600])
    check("the way back to this week is there",
          any(b.key == "progress_now" for b in at.button), str([b.key for b in at.button]))

    press(at, "progress_back")
    body = _progress_texts(at)
    check("‹ steps back one week", "#### 24–30 Αυγ" in body, body[:400])
    check("to that week's workouts",
          "- Πλάτη · Κωπηλατική · Αλτήρες · 3×10 · 40 kg" in body and "Πέμπτη 27 Αυγ" in body, body[:600])
    check("its muscle groups in sets", "Μυϊκές ομάδες: Πλάτη 3 σετ" in texts(at), texts(at)[:600])
    check("and its totals on one line", "**1 προπόνηση · 3 σετ · 1.200 kg**" in body, body[:600])


def test_progress_does_not_open_on_an_empty_workout() -> None:
    """The workout open right now with nothing in it is not the athlete's last week."""
    state.reset()
    _empty_open_workout()
    _past_workout("p25b", "2026-08-27", [("e-db", "dumbbell", [("40.00", 10, True)] * 3)])
    at = open_screen(PROGRESS_DRIVER)
    body = _progress_texts(at)
    check("it opens on the last week something was done", "#### 24–30 Αυγ" in body, body[:400])
    press(at, "progress_forward")
    body = _progress_texts(at)
    check("and the week of the empty workout lists nothing", "Τρίτη 1 Σεπ" not in body, body[:400])
    check("so it says so", "Καμία προπόνηση αυτή την εβδομάδα." in texts(at), texts(at)[:400])


def test_progress_steps_a_month_at_a_time() -> None:
    state.reset()
    _past_workout("p25b", "2026-08-27", [("e-db", "dumbbell", [("40.00", 10, True)] * 3)])
    state.STORE["sets"].append({
        "id": "s-b0", "gym_id": state.GYM, "block_id": "b0", "position": 0,
        "kind": "weight_reps", "load_kg": "35.00", "reps": 12, "seconds": None,
        "meters": None, "note": None, "done_at": state.NOW, "created_by": state.OWNER,
        "deleted_at": None,
    })
    at = open_screen(PROGRESS_DRIVER)
    at.radio(key="progress_period").set_value("month").run()
    raise_on_exception(at)
    body = _progress_texts(at)
    check("the month of the latest workout", "#### Σεπτέμβριος 2026" in body, body[:400])
    press(at, "progress_back")
    body = _progress_texts(at)
    check("‹ steps back a month", "#### Αύγουστος 2026" in body, body[:400])
    check("with every workout of it, in the order they happened",
          body.find("Πέμπτη 27 Αυγ") > body.find("Τρίτη 25 Αυγ") > -1, body[:800])


def test_progress_does_not_step_into_the_future() -> None:
    state.reset()
    at = open_screen(PROGRESS_DRIVER)
    press(at, "progress_now")
    forward = button(at, "progress_forward")
    check("› is greyed out on this week", forward.disabled)
    check("an empty week says so", "Καμία προπόνηση αυτή την εβδομάδα." in texts(at), texts(at)[:400])
    jump = [b for b in at.button if b.key == "progress_latest"]
    check("and offers the latest workout instead",
          bool(jump) and "1 Σεπ" in str(jump[0].label), str([b.label for b in at.button]))
    press(at, "progress_latest")
    check("which it goes to", "#### 31 Αυγ – 6 Σεπ" in _progress_texts(at), _progress_texts(at)[:300])


def _gym_today() -> date:
    """Today where the gym is, the way gym.today() works it out."""
    from zoneinfo import ZoneInfo

    return datetime.now(ZoneInfo("Europe/Athens")).date()


def test_progress_comes_back_to_a_workout_logged_since() -> None:
    """The coach looks, trains the athlete, looks again: today's workout is there."""
    import streamlit as st
    from lib import recap

    state.reset()
    st.cache_data.clear()
    at = open_screen(PROGRESS_DRIVER)
    check("first look: the last week trained", "#### 31 Αυγ – 6 Σεπ" in _progress_texts(at))
    check("the screen's own choice is not written down as the coach's",
          "progress_anchor" not in at.session_state, "")

    today = _gym_today()
    _past_workout("p-today", today.isoformat(), [("e-bar", "barbell", [("90.00", 5, True)] * 3)])
    st.cache_data.clear()
    at.run()
    raise_on_exception(at)
    first, last = recap.period(recap.WEEK, today)
    label = recap.period_label(recap.WEEK, first, last, today)
    body = _progress_texts(at)
    check("second look: this week, with today's workout", f"#### {label}" in body
          and "3×5 · 90 kg" in body, body[:400])

    # A week the coach stepped to stays where they put it.
    press(at, "progress_back")
    at.run()
    raise_on_exception(at)
    first, last = recap.period(recap.WEEK, first - timedelta(days=1))
    check("a week the coach chose is kept across reruns",
          f"#### {recap.period_label(recap.WEEK, first, last, today)}" in _progress_texts(at),
          _progress_texts(at)[:300])


def test_progress_default_follows_the_period_kind() -> None:
    """Μήνας → Εβδομάδα must not land on an empty current week."""
    from lib import recap

    trained = [{"local_date": "2026-10-02"}]
    today = date(2026, 10, 14)
    check("this month had a workout, so the month opens on today",
          recap.default_anchor(recap.MONTH, trained, today) == today)
    check("this week had none, so the week opens on the latest workout's",
          recap.default_anchor(recap.WEEK, trained, today) == date(2026, 10, 2))
    check("nobody trained yet: today", recap.default_anchor(recap.WEEK, [], today) == today)
    check("a workout dated after today does not pull the screen into the future",
          recap.default_anchor(recap.WEEK, [{"local_date": "2026-11-02"}], today) == today)


def test_finishing_a_workout_refreshes_progress() -> None:
    """Πρόοδος keeps its history five minutes; a finished workout is news it must see."""
    import streamlit as st
    from lib import recap

    state.reset()
    st.cache_data.clear()
    open_screen(PROGRESS_DRIVER)
    today = _gym_today()
    _past_workout("p-today", today.isoformat(), [("e-bar", "barbell", [("90.00", 5, True)] * 3)])
    at = open_log()
    press(at, "log_finish")
    at = open_screen(PROGRESS_DRIVER)
    first, last = recap.period(recap.WEEK, today)
    check("after «Τέλος προπόνησης» the new workout is on Πρόοδος",
          f"#### {recap.period_label(recap.WEEK, first, last, today)}" in _progress_texts(at),
          _progress_texts(at)[:300])


def test_progress_starts_each_athlete_on_their_own_latest_week() -> None:
    state.reset()
    state.STORE["athletes"].append({
        "id": "a2", "gym_id": state.GYM, "full_name": "Άννα Παπά", "plan_phase": None,
        "plan_focus": None, "coach_membership_id": state.TRAINER, "deleted_at": None,
    })
    _past_workout("q1", "2026-07-15", [("e-bar", "barbell", [("40.00", 12, True)] * 3)],
                  coach=state.TRAINER, athlete="a2")
    at = open_screen(PROGRESS_DRIVER)
    check("the first athlete opens on hers", "#### 31 Αυγ – 6 Σεπ" in _progress_texts(at))
    at.selectbox[0].set_value("a2").run()
    raise_on_exception(at)
    body = _progress_texts(at)
    check("the next one on his own, not on the week left open",
          "#### 13–19 Ιουλ" in body and "**Τετάρτη 15 Ιουλ · Γιώργος**" in body, body[:500])
    check("in his own numbers", "- Στήθος · Πιέσεις Στήθους · Μπάρα · 3×12 · 40 kg" in body, body[:500])


# ---------------------------------------------------------------------------
# The owner's list of 27 Οκτ: edit a set, fold what is done, survive the
# phone locking, the athlete's last workouts and calendar.
# ---------------------------------------------------------------------------

def test_a_set_can_be_changed_where_it_stands() -> None:
    """62,5×10, not 60×12 — without deleting the set and typing it again."""
    state.reset()
    at = open_log()
    press(at, f"log_fix_{state.BLOCK}")
    press(at, f"log_edit_set_btn_{state.SET}")
    at.text_input(key=f"log_edit_kg_{state.SET}").set_value("82,5")
    at.number_input(key=f"log_edit_reps_{state.SET}").set_value(6)
    at.text_input(key=f"log_edit_note_{state.SET}").set_value("πιο βαθιά")
    button(at, f"log_edit_set_{state.SET}").click().run()
    raise_on_exception(at)
    row = state.rows("sets", id=state.SET)
    check("the same set, changed", bool(row) and str(row[0]["load_kg"]) in ("82.5", "82.50")
          and row[0]["reps"] == 6 and row[0]["note"] == "πιο βαθιά", str(row))
    check("and still one set, not a deleted one and a new one",
          len(state.rows("sets", block_id=state.BLOCK)) == 1, str(state.rows("sets", block_id=state.BLOCK)))
    check("the card says so", "82,5×6" in texts(at), texts(at)[:500])

    press(at, f"log_edit_set_btn_{state.SET}")
    at.text_input(key=f"log_edit_kg_{state.SET}").set_value("πολλά")
    button(at, f"log_edit_set_{state.SET}").click().run()
    raise_on_exception(at)
    check("an unreadable weight is refused, not written",
          str(state.rows("sets", id=state.SET)[0]["load_kg"]) in ("82.5", "82.50")
          and "Τα κιλά δεν διαβάζονται" in texts(at), texts(at)[:500])


def test_a_finished_exercise_folds_and_stays_folded() -> None:
    state.reset()
    state.STORE["blocks"].append({
        "id": "b2", "gym_id": state.GYM, "session_id": state.SESSION, "exercise_id": "e-db",
        "position": 1, "note": None, "equipment": "dumbbell", "deleted_at": None,
    })
    at = open_log()
    keys = {w.key for w in at.text_input}
    check("moving on to the next exercise folds the last one",
          f"log_kg_{state.BLOCK}" not in keys and "log_kg_b2" in keys, str(sorted(k for k in keys if k)))
    press(at, f"log_fold_{state.BLOCK}")
    check("it opens when the coach opens it", f"log_kg_{state.BLOCK}" in {w.key for w in at.text_input})
    press(at, f"log_done_{state.BLOCK}")
    check("«✓ Τέλος άσκησης» folds it again",
          f"log_kg_{state.BLOCK}" not in {w.key for w in at.text_input})
    at.run()
    check("and it stays folded", f"log_kg_{state.BLOCK}" not in {w.key for w in at.text_input})


def test_a_locked_phone_comes_back_to_the_same_workout() -> None:
    """A new browser session after a long lock: no athlete in memory, only the address."""
    state.reset()
    at = open_log()
    check("the open workout is written into the address",
          at.query_params.get("a") == [state.ATHLETE] or at.query_params.get("a") == state.ATHLETE,
          str(dict(at.query_params)))

    fresh = AppTest.from_file(DRIVER, default_timeout=60)
    fresh.session_state[db.ACCESS_KEY] = "fake-access"
    fresh.session_state[db.REFRESH_KEY] = "fake-refresh"
    fresh.session_state[db.USER_ID_KEY] = state.USER_ID
    fresh.session_state["_auth_expires_at"] = 9e12
    fresh.query_params["a"] = state.ATHLETE
    fresh.query_params["w"] = state.SESSION
    fresh.run()
    raise_on_exception(fresh)
    body = texts(fresh)
    check("the coach is back in the same athlete's workout",
          "Δημήτρης Καμουτσής" in body and "Σε εξέλιξη" in body, body[:300])
    check("the same workout, not a new one", fresh.session_state["session_id"] == state.SESSION
          and len(state.rows("sessions", athlete_id=state.ATHLETE)) == 2,
          str(fresh.session_state["session_id"]))
    check("with its sets", "80×8" in body, body[:400])

    press(fresh, "log_finish")
    check("a finished workout leaves the address, so a reconnect cannot reopen it",
          "w" not in dict(fresh.query_params), str(dict(fresh.query_params)))


def test_the_athlete_sheet_shows_the_last_three_and_a_calendar() -> None:
    state.reset()
    _past_workout("p18", "2026-08-18", [("e-bar", "barbell", [("70.00", 10, True)])])
    _past_workout("p20", "2026-08-20", [(state.CHOICE, "barbell",
                                         [("60.00", 12, True), ("65.00", 10, True), ("70.00", 8, True)])],
                  coach=state.TRAINER)
    _past_workout("p22", "2026-08-22", [("e-db", "dumbbell", [("40.00", 10, True)] * 3)])
    at = open_athlete()
    body = "\n".join(_lines(at))
    check("the newest three, each a box with its day and coach",
          "**Τρίτη 1 Σεπ · Δημήτρης · σε εξέλιξη**" in body and "**Σάββατο 22 Αυγ · Δημήτρης**" in body
          and "**Πέμπτη 20 Αυγ · Γιώργος**" in body and "18 Αυγ" not in body, body[:900])
    check("a pyramid set by set", "Incline Bench Press · Μπάρα · 60×12, 65×10, 70×8" in body, body[:900])
    check("each opens for details", [e.label for e in at.expander].count("Λεπτομέρειες") == 3,
          str([e.label for e in at.expander]))
    check("and can be opened to correct it",
          any(b.key == "athlete_recent_1_action" for b in at.button), str([b.key for b in at.button]))

    html = "\n".join(str(m.value) for m in at.markdown if "th-cal" in str(m.value))
    check("a calendar is drawn", "<table" in html, html[:200])
    press(at, "athlete_cal_back")
    html = "\n".join(str(m.value) for m in at.markdown if "th-cal" in str(m.value))
    # Step back to August 2026 whatever month the tests run in.
    for _ in range(36):
        if "Αύγουστος 2026" in texts(at):
            break
        press(at, "athlete_cal_back")
    html = "\n".join(str(m.value) for m in at.markdown if "th-cal" in str(m.value))
    for day in (18, 20, 22):
        check(f"{day} Αυγ is marked", f'class="done"><span>{day}</span>' in html, html[:300])
    check("a day without a workout is not", 'class="done"><span>19</span>' not in html)
    check("and the month says how many", "3 προπονήσεις αυτόν τον μήνα." in texts(at), texts(at)[-400:])


def test_last_time_shows_the_whole_day_in_bold() -> None:
    """«Τελευταία φορά: 60×12, 65×10, 70×8», the numbers the coach loads, in bold."""
    state.reset()
    state.rows("blocks", id=state.BLOCK)[0]["equipment"] = "barbell"
    _past_workout("p25b", "2026-08-27", [("e-bar", "barbell",
                                          [("60.00", 12, True), ("65.00", 10, True), ("70.00", 8, True)])])
    at = open_log()
    check("every set of last time, bold, with its day and coach",
          "Τελευταία φορά: **60×12, 65×10, 70×8** · 27 Αυγ · Δημήτρης" in texts(at), texts(at)[:600])


def test_progress_month_has_the_calendar() -> None:
    state.reset()
    at = open_screen(PROGRESS_DRIVER)
    at.radio(key="progress_period").set_value("month").run()
    html = "\n".join(str(m.value) for m in at.markdown if "th-cal" in str(m.value))
    check("the month view draws its calendar, 1 Σεπ marked",
          'class="done"><span>1</span>' in html, html[:300])


# ---------------------------------------------------------------------------
# 012: a superset, and the muscle group an exercise counted toward.
# ---------------------------------------------------------------------------

def _fresh_workout_open() -> AppTest:
    import streamlit as st

    state.reset()
    st.cache_data.clear()
    _empty_open_workout()
    return open_log()


def test_an_exercise_in_one_group_takes_it_by_itself() -> None:
    at = _fresh_workout_open()
    _pick(at, "Incline Bench Press")
    way_list(at).set_value("dumbbell").run()
    check("its group is said, not asked", "Μυϊκή ομάδα: Στήθος" in texts(at), texts(at)[-500:])
    check("nothing to choose", not [w for w in at.selectbox if w.label == "Για ποια μυϊκή ομάδα;"])
    press(at, "log_add_-1")
    block = state.rows("blocks", session_id=state.SESSION)[0]
    check("and it is kept on the block", block.get("muscle_group_id") == state.CHEST, str(block))


def test_an_exercise_in_two_groups_makes_the_coach_choose() -> None:
    """«Πιέσεις σε μηχάνημα» is filed under chest and back: which was it for today?"""
    at = _fresh_workout_open()
    _pick(at, "Πιέσεις σε μηχάνημα")
    ask = [w for w in at.selectbox if w.label == "Για ποια μυϊκή ομάδα;"]
    check("the coach is asked", bool(ask), str([w.label for w in at.selectbox]))
    check("with nothing chosen for them", bool(ask) and ask[0].value is None)
    check("and «Προσθήκη» waits for the answer", button(at, "log_add_-1").disabled)
    ask[0].set_value(state.BACK).run()
    press(at, "log_add_-1")
    block = state.rows("blocks", session_id=state.SESSION)[0]
    check("the answer is kept on the block", block.get("muscle_group_id") == state.BACK, str(block))

    # Chosen from the first list, the group is already said.
    at = _fresh_workout_open()
    at.selectbox(key="log_group").set_value(0).run()
    name = [w for w in at.selectbox if w.label == "Άσκηση"][0]
    name.set_value("Πιέσεις σε μηχάνημα").run()
    check("picked under a group, nothing more is asked",
          not [w for w in at.selectbox if w.label == "Για ποια μυϊκή ομάδα;"])


def test_the_logged_group_is_the_one_history_counts() -> None:
    from lib import recap

    lines = recap.workout_lines(
        [{"id": "x", "exercise_id": "e-mine", "position": 0, "equipment": "machine",
          "muscle_group_id": state.BACK}],
        [{"id": "y", "block_id": "x", "position": 0, "kind": "weight_reps", "load_kg": "50",
          "reps": 10, "done_at": state.NOW}],
        {"e-mine": {"id": "e-mine", "name_el": "Πιέσεις σε μηχάνημα", "equipment": "machine"}},
        {"e-mine": "Στήθος"},
        {state.BACK: "Πλάτη", state.CHEST: "Στήθος"},
    )
    check("the coach's group, not the primary", lines and lines[0].startswith("Πλάτη · "), str(lines))


def test_a_superset_is_two_exercises_logged_as_one_set() -> None:
    at = _fresh_workout_open()
    at.radio(key="log_mode").set_value("superset").run()
    raise_on_exception(at)
    at.selectbox(key="log_ss_name_1").set_value("Πιέσεις Στήθους").run()
    at.selectbox(key="log_ss_name_2").set_value("Κωπηλατική").run()
    press(at, "log_add_superset")
    added = sorted(state.rows("blocks", session_id=state.SESSION), key=lambda b: b["position"])
    check("two blocks", len(added) == 2, str(added))
    check("sharing one superset", len(added) == 2 and added[0].get("superset_id")
          and added[0].get("superset_id") == added[1].get("superset_id"), str(added))
    check("each on its own tool", [b.get("equipment") for b in added] == ["barbell", "dumbbell"], str(added))

    body = "\n".join(_lines(at))
    check("one card for both", "Super set · Πιέσεις Στήθους · Μπάρα + Κωπηλατική · Αλτήρες" in body, body[:600])
    first, second = (str(b["id"]) for b in added)
    at.text_input(key=f"log_ss_kg_{first}").set_value("60")
    at.number_input(key=f"log_ss_reps_{first}").set_value(10)
    at.text_input(key=f"log_ss_kg_{second}").set_value("22,5")
    at.number_input(key=f"log_ss_reps_{second}").set_value(12)
    button(at, f"log_ss_{first}").click().run()
    raise_on_exception(at)
    a = state.rows("sets", block_id=first)
    b = state.rows("sets", block_id=second)
    check("one press, a set of each", len(a) == 1 and len(b) == 1, f"{a} {b}")
    check("with their own numbers",
          a and str(a[0]["load_kg"]).startswith("60") and a[0]["reps"] == 10
          and b and str(b[0]["load_kg"]).startswith("22.5") and b[0]["reps"] == 12, f"{a} {b}")
    check("the card counts rounds", "· 1 γύροι" in texts(at) or "1 γύροι" in texts(at), texts(at)[:500])

    from lib import recap
    lines = recap.workout_lines(added, a + b, {r["id"]: r for r in state.STORE["exercises"]}, {})
    check("history says which two went together",
          len(lines) == 2 and all(line.startswith("Super set · ") for line in lines), str(lines))


def test_before_012_the_picker_is_what_it_was() -> None:
    """The app ships before the SQL: no superset, no question, and adding still works."""
    import streamlit as st

    try:
        state.reset()
        st.cache_data.clear()
        _empty_open_workout()
        # After reset(), which clears the fake's list of missing columns.
        fake_supabase.MISSING_COLUMNS["blocks"] = {"superset_id", "muscle_group_id"}
        at = open_log()
        check("no superset choice yet", not [r for r in at.radio if r.label == "Τι προσθέτεις;"],
              str([r.label for r in at.radio]))
        _pick(at, "Πιέσεις σε μηχάνημα")
        check("no group question with nowhere to keep the answer",
              not [w for w in at.selectbox if w.label == "Για ποια μυϊκή ομάδα;"])
        press(at, "log_add_-1")
        check("and the exercise goes in", len(state.rows("blocks", session_id=state.SESSION)) == 1,
              texts(at)[:400])
        check("the workout still reads", "Πιέσεις σε μηχάνημα" in texts(at), texts(at)[:400])
    finally:
        fake_supabase.MISSING_COLUMNS.clear()
        st.cache_data.clear()


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
