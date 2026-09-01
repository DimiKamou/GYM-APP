"""Ασκήσεις — the catalogue, and the trainer's own additions to it.

Two kinds of row live here and they are not equal. The shared catalogue
(`gym_id is null`) ships classified and no gym may write it; a gym's own rows
are its own. The policies enforce that asymmetry — SELECT allows `gym_id is
null`, INSERT and UPDATE demand `gym_id = app.my_gym()` — so this screen only
has to be honest about which is which, not to guard anything itself.

Grouping is by μυϊκή ομάδα, in `muscle_groups.position` order and never
alphabetically: in Greek alphabetical order Τρικέφαλοι sorts above Στήθος,
which is nobody's mental model of a body.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import streamlit as st

from lib import db, fmt, ui

_NOTICE = "library_notice"

_CATEGORY_LABELS = {
    "upper": "Άνω κορμός",
    "lower": "Κάτω κορμός",
    "core": "Κορμός",
    "cardio": "Καρδιοαναπνευστικό",
    "mobility": "Κινητικότητα",
}
_CATEGORY_CHOICES = {label: value for value, label in _CATEGORY_LABELS.items()}

_EQUIPMENT_LABELS = {
    "barbell": "Μπάρα",
    "dumbbell": "Αλτήρες",
    "machine": "Μηχάνημα",
    "cable": "Τροχαλία",
    "bodyweight": "Σωματικό βάρος",
    "cardio": "Cardio",
    "kettlebell": "Kettlebell",
    "other": "Άλλο",
}
_EQUIPMENT_CHOICES = {label: value for value, label in _EQUIPMENT_LABELS.items()}

_KIND_LABELS = {
    "weight_reps": "Κιλά × επαναλήψεις",
    "bodyweight": "Σωματικό βάρος",
    "duration": "Χρόνος",
    "distance": "Απόσταση",
}
_KIND_CHOICES = {label: value for value, label in _KIND_LABELS.items()}

_UNGROUPED = "Χωρίς μυϊκή ομάδα"


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

@st.cache_data(ttl=60, show_spinner=False)
def _exercises(gym_id: str) -> list[dict[str, Any]]:
    # gym_id keys the cache even though RLS scopes the query: a cache hit is
    # served from this process and never reaches a policy again.
    return (
        db.client()
        .table("exercises")
        .select("id, gym_id, name_el, name_en, category, equipment, default_set_kind, is_archived, merged_into_id")
        .is_("deleted_at", "null")
        .order("name_el")
        .execute()
        .data
        or []
    )


@st.cache_data(ttl=300, show_spinner=False)
def _muscle_groups(gym_id: str) -> list[dict[str, Any]]:
    return (
        db.client()
        .table("muscle_groups")
        .select("id, gym_id, name_el, region, position")
        .is_("deleted_at", "null")
        .order("position")
        .order("name_el")
        .execute()
        .data
        or []
    )


@st.cache_data(ttl=300, show_spinner=False)
def _links(gym_id: str) -> list[dict[str, Any]]:
    return (
        db.client()
        .table("exercise_muscles")
        .select("exercise_id, muscle_group_id, role")
        .is_("deleted_at", "null")
        .execute()
        .data
        or []
    )


def _clear() -> None:
    _exercises.clear()
    _links.clear()
    _muscle_groups.clear()


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------

def _create_exercise(
    gym_id: str,
    name_el: str,
    category: str,
    equipment: str,
    kind: str,
    primary_group: str | None,
    secondary_groups: list[str],
) -> None:
    """One call files the exercise and its muscles.

    A trainer adds "Πιέσεις Στήθους σε μηχάνημα" while standing in a live
    session; a second round trip to classify it is a second chance to leave it
    unclassified forever, and an exercise with no primary group falls out of
    every heading in the picker.
    """
    client = db.client()
    exercise_id = str(uuid4())
    client.table("exercises").insert(
        {
            "id": exercise_id,
            "gym_id": gym_id,
            "name_el": name_el.strip(),
            "category": category,
            "equipment": equipment,
            "default_set_kind": kind,
        }
    ).execute()

    links = []
    if primary_group:
        links.append({"exercise_id": exercise_id, "muscle_group_id": primary_group, "role": "primary", "gym_id": gym_id})
    for group_id in secondary_groups:
        if group_id and group_id != primary_group:
            links.append({"exercise_id": exercise_id, "muscle_group_id": group_id, "role": "secondary", "gym_id": gym_id})
    if links:
        # exercise_muscles_stamp_scope() fills the two scope columns from the
        # parents it looks up itself, so gym_id here is the mapping's tenancy
        # and not a claim about either parent.
        client.table("exercise_muscles").insert(links).execute()


def _set_archived(exercise_id: str, archived: bool) -> None:
    db.client().table("exercises").update({"is_archived": archived}).eq("id", exercise_id).execute()


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def _index_by_group(
    exercises: list[dict[str, Any]],
    groups: list[dict[str, Any]],
    links: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """Group heading -> exercises, in muscle_groups.position order.

    Both roles are indexed, not only primary: filed under primary alone,
    Τραπεζοειδείς and Προσαγωγοί come out empty, because almost nothing in the
    catalogue names them as the main mover.
    """
    by_exercise: dict[str, list[str]] = {}
    for link in links:
        by_exercise.setdefault(link["exercise_id"], []).append(link["muscle_group_id"])

    names = {g["id"]: g["name_el"] for g in groups}
    buckets: dict[str, list[dict[str, Any]]] = {g["name_el"]: [] for g in groups}
    buckets[_UNGROUPED] = []

    for exercise in exercises:
        group_ids = by_exercise.get(exercise["id"]) or []
        placed = False
        for group_id in group_ids:
            heading = names.get(group_id)
            if heading:
                buckets[heading].append(exercise)
                placed = True
        if not placed:
            buckets[_UNGROUPED].append(exercise)

    return {heading: rows for heading, rows in buckets.items() if rows}


def _exercise_row(exercise: dict[str, Any], can_edit: bool) -> None:
    name = fmt.exercise_name(exercise)
    mine = exercise.get("gym_id") is not None
    archived = bool(exercise.get("is_archived"))

    label = fmt.md(name)
    if archived:
        label = f"~~{label}~~"
    bits = [
        _EQUIPMENT_LABELS.get(exercise.get("equipment") or "", ""),
        _KIND_LABELS.get(exercise.get("default_set_kind") or "", ""),
    ]
    if mine:
        bits.append("δική σας")

    left, right = st.columns([4, 1])
    left.markdown(label)
    left.caption(" · ".join(b for b in bits if b))

    # Only a gym's own rows can be touched: the shared catalogue is read-only by
    # policy, and offering a button that the database will refuse is worse than
    # offering none.
    if mine and can_edit:
        if archived:
            if right.button("Επαναφορά", key=f"un-{exercise['id']}"):
                _set_archived(exercise["id"], False)
                _clear()
                ui.notice(_NOTICE, "ok", f"Η «{name}» επανήλθε.")
                st.rerun()
        elif right.button("Απόσυρση", key=f"ar-{exercise['id']}"):
            # Archiving, not deleting. Historical blocks keep pointing at the
            # row and must keep rendering its name.
            _set_archived(exercise["id"], True)
            _clear()
            ui.notice(_NOTICE, "ok", f"Η «{name}» αποσύρθηκε από τον κατάλογο.")
            st.rerun()


def _new_exercise_form(gym_id: str, groups: list[dict[str, Any]]) -> None:
    with st.expander("Νέα άσκηση"):
        with st.form("library_new", clear_on_submit=True):
            name_el = st.text_input(
                "Όνομα στα ελληνικά",
                max_chars=120,
                placeholder="Πιέσεις στήθους σε μηχάνημα",
                help="Τα ελληνικά είναι υποχρεωτικά — έτσι τη λένε οι προπονητές και έτσι θα την ψάξουν.",
            )
            category_label = st.selectbox("Περιοχή σώματος", options=list(_CATEGORY_CHOICES))
            equipment_label = st.selectbox("Εξοπλισμός", options=list(_EQUIPMENT_CHOICES))
            kind_label = st.selectbox(
                "Τι μετράει",
                options=list(_KIND_CHOICES),
                help="Ο χρόνος στον διάδρομο και οι επαναλήψεις στη μπάρα δεν είναι το ίδιο μέγεθος.",
            )

            by_id = {g["id"]: g["name_el"] for g in groups}
            primary = st.selectbox(
                "Κύρια μυϊκή ομάδα",
                options=list(by_id),
                format_func=lambda i: by_id[i],
                index=None,
                placeholder="Διάλεξε ομάδα",
                help="Χωρίς κύρια ομάδα, η άσκηση δεν εμφανίζεται κάτω από καμία επικεφαλίδα στην προπόνηση.",
            )
            secondary = st.multiselect(
                "Δευτερεύουσες",
                options=list(by_id),
                format_func=lambda i: by_id[i],
                help="Προαιρετικά. Οι πιέσεις στήθους δουλεύουν και τρικέφαλους και πρόσθιους δελτοειδείς.",
            )
            submitted = st.form_submit_button("Προσθήκη", type="primary")

        if not submitted:
            return
        if not name_el.strip():
            st.error("Γράψε το ελληνικό όνομα.")
            return
        if not primary:
            st.error("Διάλεξε κύρια μυϊκή ομάδα, αλλιώς η άσκηση δεν θα βρίσκεται στην προπόνηση.")
            return

        try:
            _create_exercise(
                gym_id,
                name_el,
                _CATEGORY_CHOICES[category_label],
                _EQUIPMENT_CHOICES[equipment_label],
                _KIND_CHOICES[kind_label],
                primary,
                list(secondary),
            )
        except Exception as exc:
            st.error(f"Η άσκηση δεν προστέθηκε: {exc}")
            return

        _clear()
        ui.notice(_NOTICE, "ok", f"Η «{name_el.strip()}» μπήκε στον κατάλογο.")
        st.rerun()


def render() -> None:
    st.header("Ασκήσεις")

    gym_id = db.gym_id()
    if not gym_id:
        st.info("Ο λογαριασμός σου δεν ανήκει ακόμη σε γυμναστήριο.")
        return

    ui.flush_notice(_NOTICE)

    try:
        exercises = _exercises(gym_id)
        groups = _muscle_groups(gym_id)
        links = _links(gym_id)
    except Exception as exc:
        st.error("Ο κατάλογος δεν φορτώθηκε.")
        st.caption(str(exc))
        return

    search = st.text_input("Αναζήτηση", placeholder="Όνομα άσκησης", label_visibility="collapsed")
    show_archived = st.toggle("Δείξε και τις αποσυρμένες", value=False)

    visible = [
        e
        for e in exercises
        # A merged duplicate is not a separate movement any more; the block that
        # still points at it follows the arrow when it renders its name.
        if not e.get("merged_into_id")
        and (show_archived or not e.get("is_archived"))
        and (not search or fmt.matches(fmt.exercise_name(e), search))
    ]

    mine = sum(1 for e in visible if e.get("gym_id"))
    st.caption(f"{len(visible)} ασκήσεις, από τις οποίες {mine} δικές σας.")

    if not visible:
        st.info("Καμία άσκηση δεν ταιριάζει.")
    else:
        for heading, rows in _index_by_group(visible, groups, links).items():
            with st.expander(f"{heading} · {len(rows)}", expanded=bool(search)):
                for exercise in rows:
                    _exercise_row(exercise, can_edit=True)

    st.divider()
    _new_exercise_form(gym_id, groups)
