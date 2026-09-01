"""Streamlit Community Cloud entry point.

Community Cloud looks for `streamlit_app.py` and a `requirements.txt` at the
repository root, and reads `.streamlit/config.toml` from there too. The app
itself lives in `streamlit/`, so this file is the two lines that bridge the two
conventions rather than a second copy of the app.

`streamlit/` goes on sys.path first: the app imports `lib` and `views` as
top-level packages, which resolves when Streamlit runs `streamlit/app.py`
directly (it puts the script's own folder on the path) but not when the
entry point sits a directory above.
"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path

APP_DIR = Path(__file__).parent / "streamlit"
ENTRY = APP_DIR / "app.py"

if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

if not ENTRY.exists():
    # Community Cloud deploys whatever a branch currently holds, so this file can be
    # live while the app it points at is not on that branch yet. A missing entry point
    # is a deploy pointed at the wrong branch far more often than it is a broken repo,
    # and a Python traceback on the page says neither of those things.
    import streamlit as st

    st.set_page_config(page_title="TrainHub", page_icon="🏋️", layout="centered")
    st.title("TrainHub")
    st.error("Η εφαρμογή δεν βρέθηκε σε αυτό το branch.")
    st.write(
        f"Λείπει το `{ENTRY.relative_to(Path(__file__).parent)}`. "
        "Στο Streamlit Cloud άλλαξε το branch από τα **Settings**, ή κάνε merge το branch "
        "που περιέχει την εφαρμογή."
    )
    st.stop()

# run_name="__main__" so the app behaves identically to `streamlit run streamlit/app.py`.
# runpy re-executes the module on every Streamlit rerun, which is exactly what the
# rerun model expects — there is no import cache to stale out.
runpy.run_path(str(ENTRY), run_name="__main__")
