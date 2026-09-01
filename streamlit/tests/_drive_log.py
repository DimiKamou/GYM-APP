"""The script AppTest runs: the Προπόνηση screen, with the database faked.

Not the app entry point. app.py draws sign-in and the tab bar, and neither is
what these tests are about — the screen underneath them is.
"""

import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import streamlit as st  # noqa: E402

import state  # noqa: E402
from fake_supabase import FakeClient  # noqa: E402
from lib import db  # noqa: E402

db.create_client = lambda *args, **kwargs: FakeClient(state.STORE, state.USER_ID, state.stamp)

from views import log  # noqa: E402

st.session_state.setdefault("pages", {})
log.render()
