"""Creating an exercise, and the vocabulary for describing one.

Both the Ασκήσεις screen and the picker inside a live workout add exercises, and
they must add them the same way — an exercise filed from one place and not the
other is invisible in whichever screen did it differently. So the write lives
here once, and both call it.

The equipment vocabulary is here for the same reason. It was a private dict in
views/library.py, which meant the log screen could not name an όργανο at all.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import streamlit as st

from lib import db

# The public.equipment enum, in Greek. Keys are the enum values exactly as
# 001_init.sql, 005_equipment_smith.sql and 010_equipment_more.sql declare them.
# The 010 tools keep the names the gym itself uses for them — nobody in a Greek
# gym says anything but "trap bar" or "Bosu". Bars together, then free weights,
# then stations, then the body: the order a coach scans a rack in.
EQUIPMENT_LABELS: dict[str, str] = {
    "barbell": "Μπάρα",
    "ez_bar": "EZ bar",
    "trap_bar": "Trap bar",
    "dumbbell": "Αλτήρες",
    "kettlebell": "Kettlebell",
    "sandbag": "Sandbag",
    "smith": "Smith",
    "machine": "Μηχάνημα",
    "cable": "Τροχαλία",
    "bodyweight": "Σωματικό βάρος",
    "box": "Box",
    "equalizer": "Equalizer",
    "bosu": "Bosu",
    "cardio": "Cardio",
    "other": "Άλλο",
}
EQUIPMENT_CHOICES: dict[str, str] = {label: value for value, label in EQUIPMENT_LABELS.items()}

# The nine tools public.equipment had before 010. Offering one of the 010 tools
# to a database that has not run 010 yet is offering an INSERT that fails.
_TOOLS_BEFORE_010 = (
    "barbell", "dumbbell", "smith", "machine", "cable",
    "kettlebell", "bodyweight", "cardio", "other",
)


@st.cache_data(ttl=60, show_spinner=False)
def has_tool_lists(gym_id: str) -> bool:
    """Has this database run 010 and 011 — does `exercises.equipment_options` exist?

    The app deploys from `main` the moment a change merges, and the gym pastes
    the SQL by hand afterwards. In between, a select naming the new column is
    refused outright (42703), and every screen that reads an exercise would go
    down with it — the workout screen first. So the column is asked about once
    a minute, and until it exists the app behaves exactly as it did before.

    011 cannot exist without 010 (it uses 010's tools, and the SQL editor runs
    a paste as one transaction), so the column also answers whether the new
    tools can be written. gym_id keys the cache, as every cache here must.
    """
    try:
        db.client().table("exercises").select("equipment_options").limit(1).execute()
    except Exception as exc:
        text = str(exc)
        if getattr(exc, "code", None) == "42703" or (
            "equipment_options" in text and "does not exist" in text
        ):
            return False
        raise
    return True


def tools_ready(gym_id: str) -> bool:
    """has_tool_lists, for code that draws widgets and cannot stop on an error.

    A probe that could not reach the server says nothing about the schema; the
    read the caller is about to make will fail and report it properly.
    """
    try:
        return has_tool_lists(gym_id)
    except Exception:
        return True


def row_has_tools(exercise: dict[str, Any] | None) -> bool:
    """Was this row read from a database that has run 011?

    Decided from the row, not the probe, for every WRITE that starts from a row
    on screen. The two are cached apart: for up to a minute after the paste the
    probe can say yes while the screen still shows a row read before it — and
    saving that row would write the pre-011 name and tool over what 011 just
    did. A row carries the key exactly when it was selected with the column.
    """
    return bool(exercise) and "equipment_options" in exercise


def columns(gym_id: str, base: str) -> str:
    """`base`, plus the tool list once the database has one."""
    return f"{base}, equipment_options" if has_tool_lists(gym_id) else base


def tool_labels(gym_id: str) -> dict[str, str]:
    """The tools a form may offer on this database right now."""
    if tools_ready(gym_id):
        return dict(EQUIPMENT_LABELS)
    return {value: EQUIPMENT_LABELS[value] for value in _TOOLS_BEFORE_010}


# Tools whose load is the athlete's own body. Choosing one of these for an
# exercise that is usually loaded — a squat, a step-up — switches the set form
# to repetitions with optional added kilos, because "0 × 12" is not how anyone
# writes down twelve bodyweight squats. The Bosu is here too: a Bosu squat is
# done unloaded or holding light dumbbells, and reps plus added kilos records
# both. Every tool KIND_FOR_EQUIPMENT measures as bodyweight is in this set.
BODYWEIGHT_TOOLS: frozenset[str] = frozenset({"bodyweight", "box", "equalizer", "bosu"})

CATEGORY_LABELS: dict[str, str] = {
    "upper": "Άνω κορμός",
    "lower": "Κάτω κορμός",
    "core": "Κορμός",
    "cardio": "Καρδιοαναπνευστικό",
    "mobility": "Κινητικότητα",
}
CATEGORY_CHOICES: dict[str, str] = {label: value for value, label in CATEGORY_LABELS.items()}

# What a set of this exercise is measured in. Naming it in the trainer's words
# rather than the enum's, because the choice decides whether twenty treadmill
# minutes are stored as minutes or as twenty reps of nothing.
KIND_LABELS: dict[str, str] = {
    "weight_reps": "Κιλά × επαναλήψεις",
    "bodyweight": "Επαναλήψεις με σωματικό βάρος",
    "duration": "Χρόνος",
    "distance": "Απόσταση",
}
KIND_CHOICES: dict[str, str] = {label: value for value, label in KIND_LABELS.items()}

# Which όργανο implies which measurement, so the form can preselect the answer
# a coach would have given anyway. Only a default — every combination stays
# selectable, because a gym does dumbbell carries for distance.
KIND_FOR_EQUIPMENT: dict[str, str] = {
    "barbell": "weight_reps",
    "ez_bar": "weight_reps",
    "trap_bar": "weight_reps",
    "dumbbell": "weight_reps",
    "kettlebell": "weight_reps",
    "sandbag": "weight_reps",
    "smith": "weight_reps",
    "machine": "weight_reps",
    "cable": "weight_reps",
    "bodyweight": "bodyweight",
    "box": "bodyweight",
    "equalizer": "bodyweight",
    "bosu": "bodyweight",
    "cardio": "duration",
    "other": "weight_reps",
}


def options_of(exercise: dict[str, Any] | None) -> list[str] | None:
    """The tools this exercise can be done with, or None when it never said.

    `exercises.equipment_options` (011) is what lets one exercise be done with a
    choice of tool and another be fixed by its name:

      None      the exercise predates 011, or was written by a client that does
                not know the column: any tool, its own `equipment` first.
      [tool]    the name says the tool — «Cable Lateral Raise» is the cable —
                and it is selected the moment the exercise is.
      [a, b, …] the coach picks one of exactly these when logging. «Bench
                Press» is a barbell, dumbbell or Smith press, and which one is
                the half of the number that says what 80 kg means.

    Unknown values are dropped rather than trusted: a tool this screen cannot
    name is a tool it cannot offer.
    """
    if not exercise:
        return None
    raw = exercise.get("equipment_options")
    if isinstance(raw, str):
        # PostgREST sends arrays as JSON lists; the "{a,b}" text form only
        # arrives from a hand-written fixture, and costs nothing to accept.
        raw = [part.strip().strip('"') for part in raw.strip("{}").split(",") if part.strip()]
    if not isinstance(raw, (list, tuple)):
        return None
    known = [str(value) for value in raw if str(value) in EQUIPMENT_LABELS]
    return list(dict.fromkeys(known)) or None


def is_choice(exercise: dict[str, Any] | None) -> bool:
    """True when the coach must say which tool, because the exercise allows several."""
    allowed = options_of(exercise)
    return allowed is not None and len(allowed) > 1


def implement_of(exercise: dict[str, Any] | None, block_equipment: str = "") -> str:
    """The tool a block was done with, as an enum value, or '' when nobody knows.

    The block's own answer wins. Without one, a fixed exercise's tool is known
    from its name; an exercise that offers a choice says nothing — its
    `equipment` column is only a fallback for readers that need a value, and
    printing it would put «Μπάρα» on a number that may have been dumbbells.
    """
    if block_equipment:
        return str(block_equipment)
    if not exercise or is_choice(exercise):
        return ""
    return str(exercise.get("equipment") or "")


def equipment_of(exercise: dict[str, Any] | None, block_equipment: str = "") -> str:
    """The Greek name of the όργανο, or '' when there is none to show."""
    return EQUIPMENT_LABELS.get(implement_of(exercise, block_equipment), "")


def tools_label(exercise: dict[str, Any] | None) -> str:
    """What the Ασκήσεις screen says an exercise is done with."""
    allowed = options_of(exercise)
    if allowed is None:
        return EQUIPMENT_LABELS.get(str((exercise or {}).get("equipment") or ""), "")
    if len(allowed) == len(EQUIPMENT_LABELS):
        return "Όποιο όργανο, κάθε φορά"
    return " / ".join(EQUIPMENT_LABELS[value] for value in allowed)


def default_kind(tools: list[str]) -> str:
    """What a new exercise is measured in when the coach left it to the tools."""
    if len(tools) == 1:
        return KIND_FOR_EQUIPMENT.get(tools[0], "weight_reps")
    if tools and all(KIND_FOR_EQUIPMENT.get(tool) == "bodyweight" for tool in tools):
        return "bodyweight"
    return "weight_reps"


def kind_for_block(default: str, block_equipment: str) -> str:
    """A loaded exercise done on the body alone is logged as bodyweight reps."""
    if default == "weight_reps" and block_equipment in BODYWEIGHT_TOOLS:
        return "bodyweight"
    return default


def stored_tools(tools: list[str]) -> tuple[str, list[str]]:
    """(equipment, equipment_options) for a form's chosen tools.

    None chosen means "any tool, chosen at the time" — the option the gym asked
    for when it said a new exercise should not have to commit to one. It is
    stored as every tool, with the neutral 'other' as the column the schema
    requires; implement_of() never prints that fallback for a choice.
    """
    chosen = [tool for tool in dict.fromkeys(tools) if tool in EQUIPMENT_LABELS]
    if not chosen:
        return "other", list(EQUIPMENT_LABELS)
    return chosen[0], chosen


def create(
    gym_id: str,
    *,
    name: str,
    category: str,
    equipment: str,
    kind: str,
    primary_group: str | None,
    secondary_groups: list[str] | None = None,
    equipment_options: list[str] | None = None,
) -> str:
    """Insert one gym-owned exercise and file it into its muscle groups.

    Returns the new id, so the caller in the log screen can put it straight
    into the workout instead of making the coach find it again.

    The muscles go in the same call on purpose. A trainer adds "Πιέσεις
    Στήθους σε μηχάνημα" while standing at the machine with an athlete
    waiting; a second round trip to classify it is a second chance to leave it
    unclassified forever, and an exercise with no primary group falls out of
    every heading in the picker that would have shown it.
    """
    client = db.client()
    exercise_id = str(uuid4())
    ready = tools_ready(gym_id)
    row: dict[str, Any] = {
        "id": exercise_id,
        # Never null: null is the shared catalogue, which the policies make
        # read-only to every client. The insert would be refused.
        "gym_id": gym_id,
        "category": category,
        "equipment": equipment,
        "default_set_kind": kind,
    }
    # The column the gym's catalogue is named in. Since 011 that is name_en,
    # whatever language it is typed in: a name is unique only within its own
    # column, and a «Bench Press» typed into name_el would sit beside the
    # catalogue's own, two identical lines exercises_gym_en_uniq never sees.
    # Before 011 every name is in name_el, and a new one must collide with them
    # there — or «Πιέσεις Στήθους» could be created a second time.
    row["name_en" if ready else "name_el"] = name.strip()
    if equipment_options and ready:
        # exercises_equipment_options_check: the column's own tool is one of
        # the options, or the insert is refused.
        options = list(dict.fromkeys(equipment_options))
        if equipment not in options:
            options.insert(0, equipment)
        row["equipment_options"] = options
    client.table("exercises").insert(row).execute()

    links = []
    if primary_group:
        links.append(
            {"exercise_id": exercise_id, "muscle_group_id": primary_group,
             "role": "primary", "gym_id": gym_id}
        )
    for group_id in secondary_groups or []:
        if group_id and group_id != primary_group:
            links.append(
                {"exercise_id": exercise_id, "muscle_group_id": group_id,
                 "role": "secondary", "gym_id": gym_id}
            )
    if links:
        # exercise_muscles_stamp_scope() fills the two scope columns from the
        # parents it looks up itself, so gym_id here is the mapping's own
        # tenancy and not a claim about either parent.
        client.table("exercise_muscles").insert(links).execute()

    return exercise_id
