"""TrainHub — the Streamlit pilot. One script, seven pages, shaped for a phone.

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

from lib import auth, version
from views import athletes, calendar, library, log, progress, settings, team

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
footer,
/* The header too, now that navigation is ours. It is 60px of invisible,
   fixed-position furniture — measured — and it was clipping the top row of the
   tab bar underneath it: the pills were at y=40 and the header covered them to
   y=60, so «Αθλητές» rendered sliced in half. Everything it used to hold is
   already hidden above. */
header[data-testid="stHeader"] { display: none !important; }

/* The default top padding is most of a phone screen: the athlete's name starts
   below the fold before anything has been drawn. */
[data-testid="stMainBlockContainer"],
.block-container { padding-top: 1rem; padding-bottom: 4rem; }

/* 44px minimum hit target (CLAUDE.md).

   Addressed by data-testid, not by data-baseweb. Streamlit 1.62 renders a text
   field as [data-testid="stTextInputField"] inside stTextInputRootElement and
   exposes no data-baseweb="input" hook at all, so the obvious rule matches
   nothing and fails silently — measured in a browser, the sign-in fields were
   36px while this block claimed to have set them to 44.

   The number stepper's two buttons are here because they are what a coach taps
   between sets, one-handed, with the other hand on the bar. */
[data-testid="stTextInputField"],
[data-testid="stTextInputRootElement"],
[data-testid="stNumberInputField"],
[data-testid="stNumberInputContainer"],
[data-testid="stNumberInputStepUp"],
[data-testid="stNumberInputStepDown"],
[data-testid="stDateInputField"],
[data-testid="stTextAreaRootElement"],
[data-testid="stSelectbox"] div[role="combobox"],
div[data-testid="stForm"] button,
div.stButton > button,
/* The navigation bar. Measured at 32px without this, which is under the floor
   for a control every screen change goes through. */
[data-testid="stPills"] button,
[data-testid="stButtonGroup"] button { min-height: 44px; }
</style>
"""

st.markdown(_CHROME_CSS, unsafe_allow_html=True)

if not auth.gate():
    st.stop()


# key -> (render function, tab label, icon, is the landing page)
# Every render function is named `render`, so Streamlit would infer the same URL
# path seven times and refuse the navigation. The key is the path.
_PAGES = (
    ("athletes", athletes.render, "Αθλητές", "👥", True),
    ("log", log.render, "Προπόνηση", "📝", False),
    ("calendar", calendar.render, "Πρόγραμμα", "📅", False),
    ("library", library.render, "Ασκήσεις", "📚", False),
    ("progress", progress.render, "Πρόοδος", "📈", False),
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

# The navigation is drawn by hand, and `position="hidden"` is what lets it be.
#
# `st.navigation(..., position="top")` is accepted by the signature and IGNORED
# by the renderer in Streamlit 1.62: measured in a browser, it emits
# stSidebarNav either way. Combined with initial_sidebar_state="collapsed" and
# the rule above that hides stSidebarCollapsedControl, that put all seven pages
# behind a hamburger with no button to open it — the app showed Αθλητές and
# nothing else, with no error anywhere. Checking the signature is not checking
# the screen.
nav = st.navigation(list(pages.values()), position="hidden")

# Which page is running. The default page reports an empty url_path.
_current = nav.url_path or _PAGES[0][0]
_LABELS = {key: f"{icon} {title}" for key, _, title, icon, _ in _PAGES}
_NAV_KEY = "trainhub_nav"
_NAV_SEEN = "trainhub_nav_seen"


def _tab_bar() -> None:
    """Seven pages, one wrapped bar, always visible.

    Not st.columns: on a 412px phone they stack, so seven links became seven
    full-width rows and ate 252px of screen before the athlete's name. Pills
    wrap instead — three rows, about a hundred pixels — and read as a tab bar
    rather than a menu. Measured both ways in a browser rather than assumed,
    which is the mistake that produced the bug this replaces.
    """
    # The bar keeps its own memory, and that memory can disagree with the page
    # that is actually running: «Νέα προπόνηση» moves screens with
    # st.switch_page, not by tapping a tab, so the widget still said "athletes"
    # while the log was on screen — and the check below then bounced the coach
    # straight back to the roster, every single time.
    #
    # _NAV_SEEN is the page the bar was last drawn for. When the page changed by
    # some other means, realign the widget silently. When it did not, the widget
    # holding something else means the coach just tapped a tab, and that is a
    # real request to move.
    if st.session_state.get(_NAV_SEEN) != _current:
        st.session_state[_NAV_KEY] = _current
        st.session_state[_NAV_SEEN] = _current

    choice = st.pills(
        "Πλοήγηση",
        options=list(_LABELS),
        format_func=lambda key: _LABELS[key],
        label_visibility="collapsed",
        key=_NAV_KEY,
    )
    # None when the coach taps the active pill again — st.pills allows
    # deselection, and treating that as "go nowhere" keeps them where they are.
    if choice and choice != _current:
        st.session_state[_NAV_SEEN] = choice
        st.switch_page(pages[choice])


_tab_bar()
nav.run()

# The version, on every screen, in the smallest type the page has.
#
# It lives here rather than only in Ρυθμίσεις because the question it answers —
# "is what I am looking at the build you told me about?" — is asked from a phone,
# in the middle of a workout, by someone who has no reason to go hunting through
# a settings screen to find out. Community Cloud serves the last build it made
# until a push or a reboot wakes it, so "it is on main" and "your phone has it"
# are different facts, and only one of them was ever visible from the gym.
st.caption(f"TrainHub {version.VERSION}")
