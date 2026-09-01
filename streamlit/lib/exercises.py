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

from lib import db

# The public.equipment enum, in Greek. Keys are the enum values exactly as
# 001_init.sql and 005_equipment_smith.sql declare them.
EQUIPMENT_LABELS: dict[str, str] = {
    "barbell": "Μπάρα",
    "dumbbell": "Αλτήρες",
    "smith": "Smith",
    "machine": "Μηχάνημα",
    "cable": "Τροχαλία",
    "kettlebell": "Kettlebell",
    "bodyweight": "Σωματικό βάρος",
    "cardio": "Cardio",
    "other": "Άλλο",
}
EQUIPMENT_CHOICES: dict[str, str] = {label: value for value, label in EQUIPMENT_LABELS.items()}

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
    "dumbbell": "weight_reps",
    "smith": "weight_reps",
    "machine": "weight_reps",
    "cable": "weight_reps",
    "kettlebell": "weight_reps",
    "bodyweight": "bodyweight",
    "cardio": "duration",
    "other": "weight_reps",
}


def equipment_of(exercise: dict[str, Any] | None) -> str:
    """The Greek name of the όργανο, or '' when there is none to show."""
    if not exercise:
        return ""
    return EQUIPMENT_LABELS.get(str(exercise.get("equipment") or ""), "")


def create(
    gym_id: str,
    *,
    name_el: str,
    category: str,
    equipment: str,
    kind: str,
    primary_group: str | None,
    secondary_groups: list[str] | None = None,
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
    client.table("exercises").insert(
        {
            "id": exercise_id,
            # Never null: null is the shared catalogue, which the policies make
            # read-only to every client. The insert would be refused.
            "gym_id": gym_id,
            "name_el": name_el.strip(),
            "category": category,
            "equipment": equipment,
            "default_set_kind": kind,
        }
    ).execute()

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
