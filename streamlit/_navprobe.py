"""ΔΟΚΙΜΑΣΤΙΚΟ — δεν είναι σελίδα της εφαρμογής και δεν γίνεται import από αυτήν.

Runs app.py with the sign-in stubbed out, so the navigation bar can be seen and
measured without a live Supabase project.

It exists because its absence caused a real bug: st.navigation(position="top")
is accepted by the signature and ignored by the renderer, which put all seven
pages behind a collapsed sidebar whose open button the app hides. Every browser
test until then had stopped at the sign-in screen — the screen before the one
that was broken — so the app was verified never to crash and never verified to
be usable.

Run it with:  streamlit run _navprobe.py
"""

import sys, types
import streamlit as st

from lib import auth, db

# Ψεύτικη ταυτότητα: ο gate() περνάει, ώστε να τρέξει η πλοήγηση.
auth.gate = lambda: True
db.gym_id = lambda: "aaaaaaaa-0000-0000-0000-000000000001"
db.me = lambda: {"id": "m1", "gym_id": "aaaaaaaa-0000-0000-0000-000000000001",
                 "display_name": "Δημήτρης", "role": "owner", "status": "active"}
db.is_owner = lambda: True
db.user_id = lambda: "u1"

import runpy
runpy.run_path("app.py", run_name="__main__")
