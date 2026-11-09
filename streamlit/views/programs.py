"""Προγράμματα — the owner writes the gym's programmes; every coach reads them.

A programme is numbered days, each a list of exercises with what is
prescribed: «Στήθος · Bench Press · Μπάρα · 3×12 · 60 kg». The athlete's sheet
hands one to an athlete with an order of days, and an empty workout offers the
next day of that order (lib/programs.py).

Only the owner sees the forms. RLS refuses anyone else's write regardless
(013's RESTRICTIVE policies), so hiding them is courtesy, not the guard.
"""

from __future__ import annotations

from typing import Any

import streamlit as st

from lib import db, exercises, fmt, programs, ui

_NOTICE = "programs_notice"
_OPEN_KEY = "programs_open"


def _restore(payload: dict[str, Any]) -> None:
    gym_id = db.gym_id() or ""
    programs.restore(gym_id, payload["table"], payload["id"])


def _item_line(item: dict[str, Any], catalogue: dict[str, dict[str, Any]], group_names: dict[str, str]) -> str:
    from views import log

    exercise = catalogue.get(str(item.get("exercise_id")))
    group = group_names.get(str(item.get("muscle_group_id") or ""), "")
    label = log._labelled(exercise or {}, str(item.get("equipment") or ""))
    return " · ".join(part for part in (group, label, programs.target_text(item)) if part)


def _item_form(gym_id: str, day: dict[str, Any]) -> None:
    """One exercise into a day: ομάδα, άσκηση, όργανο, then what is prescribed."""
    from views import log

    day_id = str(day["id"])
    grouped = log._grouped_exercises(gym_id)
    rows = log._pickable_rows(gym_id)
    group_index = int(st.selectbox(
        "Μυϊκή ομάδα",
        [-1] + list(range(len(grouped))),
        format_func=lambda i: "Όλες οι ασκήσεις" if i < 0 else grouped[i][0],
        key=f"prog_group_{day_id}",
    ))
    members = rows if group_index < 0 else grouped[group_index][2]
    group_id = None if group_index < 0 else grouped[group_index][1]
    by_name: dict[str, list[dict[str, Any]]] = {}
    for row in sorted(members, key=lambda r: fmt.fold(fmt.exercise_name(r))):
        by_name.setdefault(fmt.exercise_name(row), []).append(row)
    name = st.selectbox(
        "Άσκηση", options=list(by_name), index=None, placeholder="Γράψε ή διάλεξε",
        key=f"prog_name_{day_id}_{group_index}",
    )
    exercise = (by_name.get(name or "") or [None])[0]
    tools = exercises.offered_tools(gym_id, exercise)
    tool = st.selectbox(
        "Όργανο", options=tools, index=0 if len(tools) == 1 or (tools and tools[0] == "barbell") else None,
        format_func=lambda key: exercises.EQUIPMENT_LABELS.get(key, key),
        placeholder="Διάλεξε όργανο" if exercise else "Διάλεξε πρώτα άσκηση",
        key=f"prog_tool_{day_id}_{fmt.fold(name or '')}", disabled=exercise is None,
    )
    if exercise is not None and not group_id:
        filed = log._exercise_groups(gym_id, str(exercise["id"]))
        group_id = filed[0][0] if filed else None

    with st.form(f"prog_item_{day_id}", clear_on_submit=True):
        sets_col, reps_col = st.columns(2)
        sets = sets_col.number_input("σετ", min_value=1, max_value=programs.MAX_SETS, value=3, step=1,
                                     key=f"prog_sets_{day_id}")
        reps = reps_col.number_input("επαναλήψεις (0 = με χρόνο)", min_value=0, max_value=1000, value=12,
                                     step=1, key=f"prog_reps_{day_id}")
        kg_col, sec_col = st.columns(2)
        kg_text = kg_col.text_input("κιλά (προαιρετικά)", placeholder="π.χ. 60", key=f"prog_kg_{day_id}")
        seconds = sec_col.number_input("δευτερόλεπτα (για χρόνο)", min_value=0, max_value=3600, value=0,
                                       step=5, key=f"prog_sec_{day_id}")
        note = st.text_input("Σημείωση (προαιρετική)", max_chars=240, key=f"prog_note_{day_id}")
        added = st.form_submit_button("Προσθήκη στη μέρα", type="primary")
    if not added:
        return
    if exercise is None or not tool:
        st.error("Διάλεξε άσκηση και όργανο.")
        return
    load = None
    if (kg_text or "").strip():
        load = fmt.decimal(kg_text)
        if load is None or load < 0 or load > 1000:
            st.error("Τα κιλά δεν διαβάζονται — π.χ. 72,5.")
            return
    if not int(reps) and not int(seconds):
        st.error("Γράψε επαναλήψεις ή δευτερόλεπτα.")
        return
    values = {
        "exercise_id": exercise["id"],
        "equipment": tool,
        "muscle_group_id": group_id,
        "sets": int(sets),
        "reps": int(reps) or None,
        "seconds": int(seconds) or None,
        "load_kg": round(load, 2) if load else None,
        "note": (note or "").strip() or None,
    }
    try:
        programs.add_item(gym_id, day, values)
    except Exception as exc:
        st.error(f"Η άσκηση δεν μπήκε: {exc}")
        return
    ui.notice(_NOTICE, "ok", f"Μπήκε: {fmt.exercise_name(exercise)}")
    st.rerun()


def _program(gym_id: str, program: dict[str, Any], owner: bool, catalogue: dict[str, dict[str, Any]],
             group_names: dict[str, str], athlete_names: dict[str, str]) -> None:
    program_id = str(program["id"])
    title = str(program.get("name") or "")
    who = athlete_names.get(str(program.get("athlete_id") or ""))
    days = program.get("days") or []
    label = f"📋 {title}" + (f" · για {who}" if who else "") + f" · {len(days)} μέρες"
    with st.expander(label, expanded=st.session_state.get(_OPEN_KEY) == program_id):
        for day in days:
            day_id = str(day["id"])
            st.markdown(f"**{fmt.md(programs.day_label(day))}**")
            for item in day.get("items") or []:
                line = st.container(horizontal=True, vertical_alignment="center", wrap=False)
                line.markdown(f"- {fmt.md(_item_line(item, catalogue, group_names))}", width="stretch")
                if owner and line.button("✕", key=f"prog_del_item_{item['id']}", width=44):
                    programs.soft_delete(gym_id, "program_items", str(item["id"]))
                    st.session_state[_OPEN_KEY] = program_id
                    ui.undoable(_NOTICE, "Η άσκηση βγήκε από τη μέρα.",
                                {"table": "program_items", "id": str(item["id"])})
                    st.rerun()
            if not day.get("items"):
                st.caption("Καμία άσκηση ακόμα.")
            if owner:
                with st.popover("+ Άσκηση σε αυτή τη μέρα", key=f"prog_add_pop_{day_id}"):
                    _item_form(gym_id, day)
                if st.button("Αφαίρεση μέρας", key=f"prog_del_day_{day_id}"):
                    programs.soft_delete(gym_id, "program_days", day_id)
                    st.session_state[_OPEN_KEY] = program_id
                    ui.undoable(_NOTICE, f"Η {programs.day_label(day)} αφαιρέθηκε.",
                                {"table": "program_days", "id": day_id})
                    st.rerun()
            st.divider()

        if not owner:
            return
        with st.form(f"prog_new_day_{program_id}", clear_on_submit=True):
            name = st.text_input("Νέα μέρα — όνομα (προαιρετικό)", placeholder="π.χ. Πόδια", max_chars=60)
            if st.form_submit_button(f"+ Ημέρα {len(days) + 1}"):
                programs.add_day(gym_id, program, name or "")
                st.session_state[_OPEN_KEY] = program_id
                st.rerun()
        with st.form(f"prog_rename_{program_id}"):
            new_name = st.text_input("Όνομα προγράμματος", value=title, max_chars=120)
            if st.form_submit_button("Αποθήκευση ονόματος") and new_name.strip() and new_name.strip() != title:
                programs.rename_program(gym_id, program_id, new_name)
                st.session_state[_OPEN_KEY] = program_id
                st.rerun()
        if st.button("Αφαίρεση προγράμματος", key=f"prog_del_{program_id}"):
            programs.soft_delete(gym_id, "programs", program_id)
            ui.undoable(_NOTICE, f"Το «{title}» αφαιρέθηκε.", {"table": "programs", "id": program_id})
            st.rerun()


def render() -> None:
    st.header("Προγράμματα")

    gym_id = db.gym_id()
    if not gym_id:
        st.info("Ο λογαριασμός σου δεν ανήκει ακόμη σε γυμναστήριο.")
        return
    if not programs.ready(gym_id):
        st.info("Τα προγράμματα χρειάζονται το SQL «trainhub-προγραμματα-κοινοποιηση-μικρη-μπαρα.sql». "
                "Τρέξ' το μία φορά στο Supabase SQL Editor.")
        return

    ui.flush_notice(_NOTICE)
    ui.flush_undo(_NOTICE, _restore)
    owner = db.is_owner()

    try:
        found = programs.programs(gym_id)
        from views import log

        catalogue = {str(e["id"]): e for e in log._catalogue(gym_id)}
        group_names = {str(g["id"]): str(g.get("name_el") or g.get("name_en") or "")
                       for g in log._muscle_groups(gym_id)}
        athlete_rows = db.client().table("athletes").select("id, full_name").eq("gym_id", gym_id).execute().data or []
    except Exception as exc:
        st.error("Τα προγράμματα δεν φορτώθηκαν.")
        st.caption(str(exc))
        return
    athlete_names = {str(a["id"]): str(a.get("full_name") or "") for a in athlete_rows}

    if owner:
        with st.form("prog_new", clear_on_submit=True):
            name = st.text_input("Νέο πρόγραμμα", placeholder="π.χ. Πρόγραμμα Α — Όγκος", max_chars=120)
            if st.form_submit_button("Δημιουργία", type="primary"):
                if not (name or "").strip():
                    st.error("Γράψε όνομα.")
                else:
                    try:
                        new_id = programs.create_program(gym_id, name)
                        program = {"id": new_id, "days": []}
                        programs.add_day(gym_id, program)
                    except Exception as exc:
                        st.error(f"Το πρόγραμμα δεν φτιάχτηκε: {exc}")
                    else:
                        st.session_state[_OPEN_KEY] = new_id
                        st.rerun()
    else:
        st.caption("Τα προγράμματα τα γράφει ο ιδιοκτήτης. Εδώ τα διαβάζεις· στον αθλητή φαίνεται ποιο ακολουθεί.")

    if not found:
        st.info("Κανένα πρόγραμμα ακόμα.")
        return
    for program in found:
        _program(gym_id, program, owner, catalogue, group_names, athlete_names)
