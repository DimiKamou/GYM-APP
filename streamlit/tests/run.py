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

import fake_supabase  # noqa: E402
import state  # noqa: E402
from lib import db  # noqa: E402
from streamlit.testing.v1 import AppTest  # noqa: E402

DRIVER = str(HERE / "_drive_log.py")
ATHLETES_DRIVER = str(HERE / "_drive_athletes.py")

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
    """«Πιέσεις Στήθους» is one exercise to a coach, whatever it is loaded with."""
    state.reset()
    at = open_log()
    names = list(name_list(at).options)
    check("each movement appears once, not once per implement",
          names == ["Έλξεις", "Πιέσεις Στήθους"], str(names))
    # Present, not absent. The gym asked for three drop-downs and got two plus
    # one that appeared later — which, holding the screen, is two.
    ways = way_list(at)
    check("the implement list is on screen from the start", ways is not None)
    check("waiting rather than empty-looking",
          ways is not None and ways.placeholder == "Διάλεξε πρώτα άσκηση",
          str(getattr(ways, "placeholder", None)))
    check("and it cannot be used yet", ways is not None and ways.disabled is True,
          str(getattr(ways, "disabled", None)))


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


def test_the_third_list_holds_the_implements() -> None:
    state.reset()
    at = open_log()
    name_list(at).set_value("Πιέσεις Στήθους").run()
    raise_on_exception(at)

    ways = way_list(at)
    check("all three implements are offered",
          sorted(ways.options) == ["Smith", "Αλτήρες", "Μπάρα"], str(ways.options))
    check("with none of them preselected", ways.value is None, str(ways.value))


def test_an_implement_must_be_chosen_before_the_exercise_is_added() -> None:
    """40 kg of dumbbells is not 80 kg of barbell; a default here writes the wrong one."""
    state.reset()
    at = open_log()
    name_list(at).set_value("Πιέσεις Στήθους").run()
    button(at, "log_add_-1").click().run()
    raise_on_exception(at)

    check("nothing was added",
          len(state.rows("blocks", session_id=state.SESSION)) == 1,
          str(state.rows("blocks", session_id=state.SESSION)))
    check("and the screen says what is missing",
          "Διάλεξε τρόπο εκτέλεσης" in texts(at), texts(at)[:200])


def test_a_movement_with_one_implement_shows_it_and_asks_nothing() -> None:
    state.reset()
    at = open_log()
    name_list(at).set_value("Έλξεις").run()
    raise_on_exception(at)

    ways = way_list(at)
    check("the one implement is named on screen",
          ways.options == ["Σωματικό βάρος"], str(ways.options))
    check("and already chosen, so it costs no tap", ways.value == "e-pullup", str(ways.value))

    button(at, "log_add_-1").click().run()
    raise_on_exception(at)
    blocks = state.rows("blocks", session_id=state.SESSION)
    check("one press adds it", any(b["exercise_id"] == "e-pullup" for b in blocks), str(blocks))


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
    name_list(at).set_value("Πιέσεις Στήθους").run()
    # set_value takes the option's underlying value — an exercise id — while
    # .options reports the labels the coach reads.
    way_list(at).set_value("e-smith").run()
    button(at, "log_add_-1").click().run()
    raise_on_exception(at)

    blocks = state.rows("blocks", session_id=state.SESSION)
    check("the exercise went into the workout", len(blocks) == 2, str(blocks))
    check("and it is the Smith one, not the barbell",
          any(b["exercise_id"] == "e-smith" for b in blocks), str(blocks))
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
    check("editing the details is still offered",
          any("athlete_edit" in (b.key or "") for b in at.button), str(keys))


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
          list(names.options) == ["Έλξεις", "Πιέσεις Στήθους"], str(names.options))
    check("with nothing preselected, so opening the picker adds nothing",
          names.value is None, str(names.value))


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


def test_a_replayed_submit_does_not_log_the_set_twice() -> None:
    """A write is followed by a rerun; on slow wifi the coach taps again during it."""
    state.reset()
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
