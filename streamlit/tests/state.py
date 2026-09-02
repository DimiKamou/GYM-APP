"""The gym these tests are set in, and the store the fake client reads it from.

Module-level on purpose: AppTest runs the script inside this process, so the
script and the test see the same dict — a set logged by a simulated tap is a row
the next assertion can read.

The seed is small but not simplified. Three exercises share one muscle group and
differ only by όργανο, because that is the case the log screen kept getting
wrong: «Πιέσεις Στήθους» on the barbell, on dumbbells and on the Smith are three
different movements whose numbers must never be read as each other's.
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from typing import Any

import fake_supabase

GYM = "g1"
OWNER = "m1"
TRAINER = "m2"
USER_ID = "u1"
ATHLETE = "a1"
SESSION = "s1"
LAST_SESSION = "s0"
BLOCK = "b1"
SET = "set1"
CHEST = "mg-chest"
BACK = "mg-back"

NOW = "2026-09-01T07:00:00+00:00"

_SEED: dict[str, list[dict[str, Any]]] = {
    "gyms": [
        {"id": GYM, "name": "PowerHouseGym", "timezone": "Europe/Athens",
         "display_unit": "kg", "deleted_at": None},
    ],
    "memberships": [
        {"id": OWNER, "gym_id": GYM, "user_id": USER_ID, "display_name": "Δημήτρης",
         "email": "dimitris@powerhouse.gr", "role": "owner", "status": "active",
         "created_at": NOW, "deleted_at": None},
        {"id": TRAINER, "gym_id": GYM, "user_id": "u2", "display_name": "Γιώργος",
         "email": "giorgos@powerhouse.gr", "role": "trainer", "status": "active",
         "created_at": NOW, "deleted_at": None},
    ],
    "athletes": [
        {"id": ATHLETE, "gym_id": GYM, "full_name": "Δημήτρης Καμουτσής",
         "plan_phase": "Όγκος", "plan_focus": "Στήθος", "coach_membership_id": OWNER,
         "deleted_at": None},
    ],
    "muscle_groups": [
        {"id": CHEST, "gym_id": None, "name_el": "Στήθος", "name_en": "Chest",
         "region": "upper", "position": 1, "deleted_at": None},
        {"id": BACK, "gym_id": None, "name_el": "Πλάτη", "name_en": "Back",
         "region": "upper", "position": 2, "deleted_at": None},
    ],
    "exercises": [
        # One implement only, which is the case the third list must not turn
        # into a pointless extra tap.
        {"id": "e-pullup", "gym_id": None, "name_el": "Έλξεις", "name_en": "Pull-up",
         "category": "upper", "equipment": "bodyweight", "default_set_kind": "bodyweight",
         "is_archived": False, "merged_into_id": None, "deleted_at": None},
        {"id": "e-bar", "gym_id": None, "name_el": "Πιέσεις Στήθους", "name_en": "Bench Press",
         "category": "upper", "equipment": "barbell", "default_set_kind": "weight_reps",
         "is_archived": False, "merged_into_id": None, "deleted_at": None},
        {"id": "e-db", "gym_id": None, "name_el": "Πιέσεις Στήθους", "name_en": "DB Press",
         "category": "upper", "equipment": "dumbbell", "default_set_kind": "weight_reps",
         "is_archived": False, "merged_into_id": None, "deleted_at": None},
        {"id": "e-smith", "gym_id": None, "name_el": "Πιέσεις Στήθους", "name_en": "Smith Press",
         "category": "upper", "equipment": "smith", "default_set_kind": "weight_reps",
         "is_archived": False, "merged_into_id": None, "deleted_at": None},
    ],
    "exercise_muscles": [
        {"exercise_id": "e-pullup", "muscle_group_id": BACK, "role": "primary",
         "gym_id": None, "deleted_at": None},
        {"exercise_id": "e-bar", "muscle_group_id": CHEST, "role": "primary",
         "gym_id": None, "deleted_at": None},
        {"exercise_id": "e-db", "muscle_group_id": CHEST, "role": "primary",
         "gym_id": None, "deleted_at": None},
        {"exercise_id": "e-smith", "muscle_group_id": CHEST, "role": "primary",
         "gym_id": None, "deleted_at": None},
    ],
    "sessions": [
        # Last week's workout, so the picker has something to offer as a repeat.
        {"id": LAST_SESSION, "gym_id": GYM, "athlete_id": ATHLETE, "status": "finished",
         "title": None, "notes": None, "local_date": "2026-08-25",
         "started_at": "2026-08-25T07:00:00+00:00", "finished_at": "2026-08-25T08:00:00+00:00",
         "logged_by": OWNER, "credited_to": None, "created_at": NOW, "deleted_at": None},
        {"id": SESSION, "gym_id": GYM, "athlete_id": ATHLETE, "status": "active",
         "title": None, "notes": None, "local_date": "2026-09-01", "started_at": NOW,
         "finished_at": None, "logged_by": OWNER, "credited_to": None,
         "created_at": NOW, "deleted_at": None},
    ],
    "blocks": [
        {"id": "b0", "gym_id": GYM, "session_id": LAST_SESSION, "exercise_id": "e-db",
         "position": 0, "deleted_at": None},
        {"id": BLOCK, "gym_id": GYM, "session_id": SESSION, "exercise_id": "e-bar",
         "position": 0, "deleted_at": None},
    ],
    "sets": [
        {"id": SET, "gym_id": GYM, "block_id": BLOCK, "position": 0, "kind": "weight_reps",
         "load_kg": "80.00", "reps": 8, "seconds": None, "meters": None, "note": None,
         "done_at": NOW, "created_by": OWNER, "deleted_at": None},
    ],
    "notes": [],
    "appointments": [],
}

STORE: dict[str, list[dict[str, Any]]] = {}


def stamp(table: str, row: dict[str, Any]) -> None:
    """The BEFORE INSERT triggers, in the two places a screen can tell.

    Not an attempt to be Postgres. These two are here because the app is written
    around them — it deliberately sends neither `logged_by` nor `local_date`,
    since a client that sent either would be stating an opinion where the server
    holds the fact — so a fake that does not stamp them makes every new workout
    render as "άγνωστο μέλος · —".
    """
    if table == "sessions":
        row.setdefault("status", "active")
        row.setdefault("started_at", datetime.now(timezone.utc).isoformat())
        row.setdefault("title", None)
        row.setdefault("notes", None)
        row.setdefault("credited_to", None)
        # sessions_stamp_author(): app.my_membership(), which in these tests is
        # always the owner.
        row["logged_by"] = OWNER
        # sessions_set_local_date(): the gym's day, not the server's.
        started = datetime.fromisoformat(str(row["started_at"]).replace("Z", "+00:00"))
        try:
            from zoneinfo import ZoneInfo

            started = started.astimezone(ZoneInfo("Europe/Athens"))
        except Exception:
            pass
        row["local_date"] = started.date().isoformat()
    if table in ("sets", "blocks", "notes", "athletes"):
        row.setdefault("created_by", OWNER)


def reset() -> None:
    STORE.clear()
    STORE.update(deepcopy(_SEED))
    fake_supabase.reset_round_trips()
    # Streamlit's caches outlive an AppTest run — they belong to the process,
    # not the script — so a seeded store with stale cache entries over it is a
    # different world from a fresh one. This bit the suite the moment the ttls
    # were raised: one test's answer was served to the next.
    try:
        import streamlit as st

        st.cache_data.clear()
    except Exception:
        pass


def rows(table: str, **where: Any) -> list[dict[str, Any]]:
    """Every live row of `table` matching `where`. Soft-deleted rows are excluded."""
    out = [r for r in STORE.get(table, []) if r.get("deleted_at") is None]
    for column, value in where.items():
        out = [r for r in out if str(r.get(column)) == str(value)]
    return out


def deleted(table: str, row_id: str) -> bool:
    for row in STORE.get(table, []):
        if str(row.get("id")) == str(row_id):
            return row.get("deleted_at") is not None
    return False


reset()
