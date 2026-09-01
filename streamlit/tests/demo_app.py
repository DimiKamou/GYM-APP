"""ΔΟΚΙΜΑΣΤΙΚΟ — the whole app in a browser, with the database faked.

    streamlit run tests/demo_app.py     (from the streamlit/ directory)

It is not a page of the app and nothing in the app imports it. It exists because
its absence caused two real bugs. `st.navigation(position="top")` is accepted by
the signature and ignored by the renderer, which put all seven screens behind a
collapsed sidebar whose open button the app hides; and later the tab bar sent a
coach who reached the workout via «Νέα προπόνηση» straight back to the roster.
Every browser test until then had stopped at the sign-in form — the screen
BEFORE the broken one — so the app was verified never to crash and never
verified to be usable.

`tests/run.py` covers the same screens faster and in more detail. This is for
the questions a test tree cannot answer: how tall the tab bar is on a 412px
phone, whether a thumb can reach the keypad, whether the header clips anything.
"""

import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import state  # noqa: E402
from fake_supabase import FakeClient  # noqa: E402
from lib import auth, db  # noqa: E402

# Ψεύτικη ταυτότητα: ο gate() περνάει, ώστε να τρέξει η πλοήγηση.
auth.gate = lambda: True
db.create_client = lambda *args, **kwargs: FakeClient(state.STORE, state.USER_ID, state.stamp)
db.gym_id = lambda: state.GYM
db.me = lambda: dict(state.STORE["memberships"][0])
db.is_owner = lambda: True
db.user_id = lambda: state.USER_ID

import runpy  # noqa: E402

runpy.run_path(str(HERE.parent / "app.py"), run_name="__main__")
