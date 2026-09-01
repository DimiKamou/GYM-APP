"""TrainHub — the Streamlit pilot. One script, four pages, shaped for a phone.

This is the second client on the gym's Supabase project; the React PWA in `src/`
is the first. Both read and write the same rows through the same policies, so
this file adds no rules of its own: it decides what is on the screen, and the
database decides what may be read or written. A page is therefore listed for
everyone and left to refuse from inside — hiding a link is decoration, and the
Ομάδα screen is protected by RLS whether the link is drawn or not.

The order below is load-bearing:

  1. `st.set_page_config` must be the first Streamlit call in the run.
  2. the chrome CSS, so that the sign-in form is drawn under it too.
  3. `auth.gate()`, which draws sign-in and the "no gym yet" bootstrap. Nothing
     past it runs until there is a signed-in member with a gym.
  4. the page table, published in `st.session_state["pages"]` *before*
     navigation runs — `views/athletes.py` reaches for the log page object to
     `st.switch_page()` into a new workout.
"""

from __future__ import annotations

import streamlit as st

from lib import auth
from views import athletes, log, settings, team

st.set_page_config(
    page_title="TrainHub",
    page_icon="💪",
    # A gym phone held in one hand. The wide layout stretches a set row to the
    # width of a laptop and puts the weight and the reps at opposite edges.
    layout="centered",
    initial_sidebar_state="collapsed",
)


_CHROME_CSS = """
<style>
/* Streamlit's desktop furniture — Deploy button, hamburger, running indicator,
   the gradient strip — sits exactly where a thumb lands, and every control in
   it does something a trainer never wants (rerun, clear cache, deploy). The
   header element itself stays: top navigation is rendered inside it. */
[data-testid="stToolbar"],
[data-testid="stAppDeployButton"],
[data-testid="stMainMenu"],
[data-testid="stStatusWidget"],
[data-testid="stDecoration"],
[data-testid="stSidebarCollapsedControl"],
#MainMenu,
footer { display: none !important; }

/* The default top padding is most of a phone screen: the athlete's name starts
   below the fold before anything has been drawn. */
[data-testid="stMainBlockContainer"],
.block-container { padding-top: 1.5rem; padding-bottom: 4rem; }

/* 44px minimum hit target (CLAUDE.md) against Streamlit's 38px controls. */
div[data-testid="stForm"] button,
div.stButton > button,
div[data-baseweb="input"] input,
div[data-baseweb="select"] > div { min-height: 44px; }
</style>
"""

st.markdown(_CHROME_CSS, unsafe_allow_html=True)

if not auth.gate():
    st.stop()


# key -> (render function, tab label, icon, is the landing page)
# Every render function is named `render`, so Streamlit would infer the same URL
# path four times and refuse the navigation. The key is the path.
_PAGES = (
    ("athletes", athletes.render, "Αθλητές", "👥", True),
    ("log", log.render, "Προπόνηση", "📝", False),
    # Listed for everyone: an ordinary trainer opens it to read the roster,
    # which is the legend for every name stamped on a set. What they may *do*
    # there is decided by team.render() and, underneath it, by the policies.
    ("team", team.render, "Ομάδα", "🤝", False),
    ("settings", settings.render, "Ρυθμίσεις", "🔧", False),
)

pages = {
    key: st.Page(view, title=title, icon=icon, url_path=key, default=is_default)
    for key, view, title, icon, is_default in _PAGES
}
st.session_state["pages"] = pages

# Top, not the sidebar: the sidebar is a hamburger nobody opens mid-set, and a
# tab bar in reach of a thumb is the difference between four screens and one.
st.navigation(list(pages.values()), position="top").run()
