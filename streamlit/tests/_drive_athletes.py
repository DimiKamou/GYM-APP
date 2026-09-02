"""The script AppTest runs for the Αθλητές screen, with the database faked."""

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

from views import athletes  # noqa: E402

st.session_state.setdefault("pages", {})
athletes.render()
