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

from datetime import datetime, timezone
from typing import Any

import streamlit as st

from lib import db, exercises, fmt, ui

_NOTICE = "library_notice"

# The vocabulary lives in lib/exercises.py, with the write that uses it. It was
# private to this file until the picker inside a workout needed to name an
# όργανο too, and a second copy is two lists to keep in step with one enum.
_CATEGORY_LABELS = exercises.CATEGORY_LABELS
_CATEGORY_CHOICES = exercises.CATEGORY_CHOICES
_EQUIPMENT_LABELS = exercises.EQUIPMENT_LABELS
_EQUIPMENT_CHOICES = exercises.EQUIPMENT_CHOICES
_KIND_LABELS = exercises.KIND_LABELS
_KIND_CHOICES = exercises.KIND_CHOICES

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

def _set_archived(exercise_id: str, archived: bool) -> None:
    db.client().table("exercises").update({"is_archived": archived}).eq("id", exercise_id).execute()


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def _index_by_group(
    # `rows`, not `exercises`: that name is the module this file imports, and a
    # parameter shadowing it would make lib/exercises unreachable inside here
    # the moment somebody needed it.
    rows: list[dict[str, Any]],
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

    for exercise in rows:
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


_EDITING = "library_editing"


def _update_exercise(exercise_id: str, gym_id: str, values: dict[str, Any]) -> int:
    """Rewrite a gym's own exercise. Returns the rows the UPDATE actually reached."""
    rows = (
        db.client()
        .table("exercises")
        .update(values)
        .eq("gym_id", gym_id)
        .eq("id", exercise_id)
        .execute()
        .data
        or []
    )
    return len(rows)


def _refile(exercise_id: str, gym_id: str, group_id: str | None) -> None:
    """Move the exercise to another primary muscle group.

    The old mappings are soft-deleted rather than rewritten: exercise_muscles
    has no natural key this screen can rely on, and a stale primary left behind
    puts the exercise under two headings in the picker at once.
    """
    client = db.client()
    client.table("exercise_muscles").update(
        {"deleted_at": datetime.now(timezone.utc).isoformat()}
    ).eq("exercise_id", exercise_id).eq("role", "primary").execute()
    if group_id:
        client.table("exercise_muscles").insert(
            {"exercise_id": exercise_id, "muscle_group_id": group_id,
             "role": "primary", "gym_id": gym_id}
        ).execute()


def _delete_exercise(exercise_id: str, gym_id: str) -> int:
    rows = (
        db.client()
        .table("exercises")
        .update({"deleted_at": datetime.now(timezone.utc).isoformat()})
        .eq("gym_id", gym_id)
        .eq("id", exercise_id)
        .execute()
        .data
        or []
    )
    return len(rows)


def _restore(payload: dict[str, Any]) -> None:
    """Undo a deleted exercise. Same shape as the delete, deleted_at back to null."""
    ids = [str(value) for value in (payload.get("ids") or []) if value]
    gym_id = str(payload.get("gym_id") or "")
    if not ids or not gym_id:
        return
    try:
        db.client().table("exercises").update({"deleted_at": None}).eq(
            "gym_id", gym_id
        ).in_("id", ids).execute()
    except Exception as exc:
        ui.notice(_NOTICE, "error", f"Η επαναφορά δεν έγινε: {exc}")
        st.rerun()
    _clear()
    ui.notice(_NOTICE, "ok", "Η άσκηση επανήλθε.")
    st.rerun()


def _key(scope: str, prefix: str, exercise_id: str) -> str:
    """A widget key that survives the same exercise appearing under two headings.

    _index_by_group files an exercise under EVERY muscle group it is linked to,
    primary and secondary both — deliberately, or Τραπεζοειδείς and Προσαγωγοί
    come out empty. So one row is drawn more than once, and a key built from the
    exercise alone is a duplicate the second time.

    This never fired before the catalogue was adopted: the buttons are only
    drawn for a gym's OWN rows, and the gym had none. The migration that gave
    them all an owner turned a latent collision into a screen that would not
    load.
    """
    return f"{prefix}-{fmt.fold(scope).replace(' ', '_')}-{exercise_id}"


def _edit_form(
    exercise: dict[str, Any], gym_id: str, groups: list[dict[str, Any]], scope: str
) -> None:
    """The row, replaced in place by a form to change it.

    In place and not in an expander: this row is already inside the muscle
    group's expander, and Streamlit refuses to nest one inside another.
    """
    exercise_id = str(exercise["id"])
    name = fmt.exercise_name(exercise)

    with st.form(_key(scope, "library_edit", exercise_id)):
        st.caption(f"Επεξεργασία: {fmt.md(name)}")
        name_el = st.text_input("Όνομα", value=str(exercise.get("name_el") or ""), max_chars=120)

        equipment_labels = list(_EQUIPMENT_CHOICES)
        current_gear = _EQUIPMENT_LABELS.get(str(exercise.get("equipment") or ""), "")
        gear_label = st.selectbox(
            "Εξοπλισμός",
            options=equipment_labels,
            index=equipment_labels.index(current_gear) if current_gear in equipment_labels else None,
            placeholder="Διάλεξε όργανο",
        )

        kind_labels = list(_KIND_CHOICES)
        current_kind = _KIND_LABELS.get(str(exercise.get("default_set_kind") or ""), "")
        kind_label = st.selectbox(
            "Τι μετράει",
            options=kind_labels,
            index=kind_labels.index(current_kind) if current_kind in kind_labels else None,
            placeholder="Διάλεξε τι μετράει",
        )

        by_id = {str(g["id"]): g["name_el"] for g in groups}
        group_id = st.selectbox(
            "Μυϊκή ομάδα",
            options=list(by_id),
            format_func=lambda key: by_id[key],
            index=None,
            placeholder="Άφησέ το κενό για να μείνει όπως είναι",
            help="Άλλαξέ την μόνο αν η άσκηση είναι φιλαρισμένη σε λάθος ομάδα.",
        )

        save_col, cancel_col = st.columns(2)
        saved = save_col.form_submit_button("Αποθήκευση", type="primary")
        cancelled = cancel_col.form_submit_button("Άκυρο")

    if cancelled:
        st.session_state.pop(_EDITING, None)
        st.rerun()

    if not saved:
        return

    if not (name_el or "").strip():
        st.error("Το όνομα δεν μπορεί να μείνει κενό.")
        return
    if not gear_label or not kind_label:
        st.error("Διάλεξε εξοπλισμό και τι μετράει.")
        return

    try:
        touched = _update_exercise(
            exercise_id,
            gym_id,
            {
                "name_el": name_el.strip(),
                "equipment": _EQUIPMENT_CHOICES[gear_label],
                "default_set_kind": _KIND_CHOICES[kind_label],
            },
        )
        if group_id:
            _refile(exercise_id, gym_id, group_id)
    except Exception as exc:
        st.error("Οι αλλαγές δεν αποθηκεύτηκαν.")
        st.caption(str(exc))
        return
    if not touched:
        # An UPDATE no policy let through matches zero rows and reports success.
        st.error("Οι αλλαγές δεν αποθηκεύτηκαν. Δοκίμασε ξανά.")
        return

    _clear()
    st.session_state.pop(_EDITING, None)
    ui.notice(_NOTICE, "ok", f"Η «{name_el.strip()}» ενημερώθηκε.")
    st.rerun()


def _exercise_row(
    exercise: dict[str, Any],
    can_edit: bool,
    gym_id: str = "",
    groups: list[dict[str, Any]] | None = None,
    scope: str = "",
) -> None:
    exercise_id = str(exercise["id"])
    name = fmt.exercise_name(exercise)
    mine = exercise.get("gym_id") is not None
    archived = bool(exercise.get("is_archived"))

    # The heading is part of the identity here too: the same exercise under two
    # headings must not open two copies of the form, which would collide on the
    # form key the same way the buttons did.
    editing = _key(scope, "editing", exercise_id)
    if mine and can_edit and st.session_state.get(_EDITING) == editing:
        _edit_form(exercise, gym_id, groups or [], scope)
        return

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
    # policy — `exercises_update` demands gym_id = app.my_gym() and a shared row
    # has none — and offering a button the database will refuse is worse than
    # offering none.
    if not (mine and can_edit):
        return

    if archived:
        if right.button("Επαναφορά", key=_key(scope, "un", exercise_id)):
            _set_archived(exercise_id, False)
            _clear()
            ui.notice(_NOTICE, "ok", f"Η «{name}» επανήλθε.")
            st.rerun()
        return

    if right.button("✏️", key=_key(scope, "ed", exercise_id), help="Άλλαξε όνομα, εξοπλισμό ή ομάδα"):
        st.session_state[_EDITING] = editing
        st.rerun()

    hide_col, drop_col = st.columns(2)
    if hide_col.button("Απόσυρση", key=_key(scope, "ar", exercise_id)):
        # Archiving, not deleting. Historical blocks keep pointing at the row
        # and must keep rendering its name.
        _set_archived(exercise_id, True)
        _clear()
        ui.notice(_NOTICE, "ok", f"Η «{name}» αποσύρθηκε από τον κατάλογο.")
        st.rerun()
    if drop_col.button("Διαγραφή", key=_key(scope, "rm", exercise_id)):
        try:
            removed = _delete_exercise(exercise_id, gym_id)
        except Exception as exc:
            ui.notice(_NOTICE, "error", f"Η άσκηση δεν διαγράφηκε: {exc}")
            st.rerun()
        if not removed:
            ui.notice(_NOTICE, "error", "Η άσκηση δεν διαγράφηκε. Δοκίμασε ξανά.")
            st.rerun()
        _clear()
        ui.undoable(
            _NOTICE,
            f"Διαγράφηκε: {name}",
            {"table": "exercises", "ids": [exercise_id], "gym_id": gym_id},
        )
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
            # Blank, not «Μπάρα». A preselected όργανο is one nobody reads, and
            # this field decides whether 40 kg means dumbbells or a barbell.
            equipment_label = st.selectbox(
                "Εξοπλισμός",
                options=list(_EQUIPMENT_CHOICES),
                index=None,
                placeholder="Διάλεξε όργανο",
            )
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
        if not equipment_label:
            st.error("Διάλεξε εξοπλισμό — με τι γίνεται η άσκηση.")
            return
        if not primary:
            st.error("Διάλεξε κύρια μυϊκή ομάδα, αλλιώς η άσκηση δεν θα βρίσκεται στην προπόνηση.")
            return

        try:
            exercises.create(
                gym_id,
                name_el=name_el,
                category=_CATEGORY_CHOICES[category_label],
                equipment=_EQUIPMENT_CHOICES[equipment_label],
                kind=_KIND_CHOICES[kind_label],
                primary_group=primary,
                secondary_groups=list(secondary),
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
    ui.flush_undo(_NOTICE, lambda payload: _restore(payload))

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
    line = f"{len(visible)} ασκήσεις, από τις οποίες {mine} δικές σας."
    if mine < len(visible):
        # Only worth saying while there is something locked to explain. After
        # 006 the whole catalogue belongs to the gym and this sentence would be
        # a rule about nothing.
        line += (
            " Μόνο τις δικές σας μπορείτε να αλλάξετε ή να διαγράψετε — ο κοινός"
            " κατάλογος είναι κλειδωμένος από τη βάση για όλα τα γυμναστήρια."
        )
    st.caption(line)

    if not visible:
        st.info("Καμία άσκηση δεν ταιριάζει.")
    else:
        for heading, rows in _index_by_group(visible, groups, links).items():
            with st.expander(f"{heading} · {len(rows)}", expanded=bool(search)):
                for exercise in rows:
                    _exercise_row(exercise, True, gym_id, groups, heading)

    st.divider()
    _new_exercise_form(gym_id, groups)
