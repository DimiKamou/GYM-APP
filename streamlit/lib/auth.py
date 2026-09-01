"""Sign-in, session survival, and the gate every page runs behind.

Trainers sign in with a USERNAME and a password. The username is mapped to a
synthetic email — "Dimitris" becomes "dimitris@<USERNAME_DOMAIN>" — and Supabase
Auth then does ordinary email+password from there. That keeps `auth.uid()` real,
which is what every trigger and policy in 001_init.sql is built on.

The refresh token is kept in a cookie because `st.session_state` dies with the
browser tab. Without it a trainer re-enters their credentials every time the
phone locks, mid-session, holding a barbell.
"""

from __future__ import annotations

import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import extra_streamlit_components as stx
import streamlit as st

from lib import db


# The synthetic mail domain never receives a message; it only has to be stable
# and identical to the one the accounts were created with. The fallback keeps
# this module importable when secrets are absent — gate() refuses to draw a
# sign-in form in that state, so the fallback can never sign anyone in.
USERNAME_DOMAIN: str = (db.config("USERNAME_DOMAIN") or "trainhub.local").strip().lstrip("@").lower()

_COOKIE_NAME = "trainhub_session"
_COOKIE_DAYS = 30
# Refresh a little before the hour is up: a token that expires mid-set turns
# every query into an empty screen.
_REFRESH_MARGIN_S = 120
# The cookie component answers one round trip after it mounts. Two short waits
# cover that; past them we stop guessing and draw the sign-in form, so a browser
# that blocks the component can still be used.
_PROBE_LIMIT = 2
_PROBE_PAUSE_S = 0.4

_MANAGER_KEY = "_cookie_manager"
_PENDING_COOKIE_KEY = "_cookie_pending"
_COOKIE_OP_KEY = "_cookie_op_seq"
_EXPIRES_KEY = "_auth_expires_at"
_EMAIL_KEY = "_auth_email"
_PROBE_KEY = "_cookie_probes"

# A username has to survive being an email local part.
_USERNAME_RE = re.compile(r"^[a-z0-9._-]{1,64}$")

# One sentence for every rejection the auth API can give, so the form cannot be
# used to find out which usernames exist.
_BAD_CREDENTIALS = "Λάθος χρήστης ή κωδικός."
_RATE_LIMITED = "Πολλές προσπάθειες. Περίμενε ένα λεπτό και δοκίμασε ξανά."
_NO_CONNECTION = "Δεν υπάρχει σύνδεση με τον διακομιστή. Έλεγξε το δίκτυο και δοκίμασε ξανά."
_EMPTY_FIELDS = "Συμπλήρωσε χρήστη και κωδικό."

# Zones a Greek gym actually runs in. A free-text zone that Postgres does not
# know would not fail here — it would fail much later, inside
# sessions_set_local_date(), the first time somebody logged a workout.
_TIMEZONES = (
    "Europe/Athens",
    "Europe/Nicosia",
    "Europe/Bucharest",
    "Europe/Berlin",
    "Europe/London",
    "UTC",
)

# The 44px hit-target rule lives in app.py, which writes it before gate() is
# ever called, so every screen below is already under it. A second copy here
# would be two rules to keep in step with Streamlit's DOM — and the first
# version of that rule was written against a selector Streamlit no longer
# emits, which is precisely the failure a duplicate doubles.


# ---------------------------------------------------------------------------
# Username <-> synthetic email
# ---------------------------------------------------------------------------

def email_for(username: str) -> str:
    """The address Supabase Auth knows this trainer by."""
    text = (username or "").strip().lower()
    if not text:
        raise ValueError("Γράψε όνομα χρήστη.")
    if "@" in text:
        # The very first account is created by hand in the Supabase dashboard and
        # may carry a real address. Refusing it here would lock the owner out of
        # the gym he is about to create.
        return text
    if not _USERNAME_RE.match(text):
        raise ValueError(
            "Το όνομα χρήστη δέχεται μόνο λατινικά γράμματα, αριθμούς, τελεία, παύλα και κάτω παύλα."
        )
    return f"{text}@{USERNAME_DOMAIN}"


def username_of(email: str) -> str:
    """The inverse, for anything that renders an account back to a human."""
    text = (email or "").strip()
    local, separator, domain = text.partition("@")
    if separator and domain.lower() == USERNAME_DOMAIN:
        return local
    # A real address is not a username and is shown whole rather than truncated
    # into something that looks like one.
    return text


def sign_in_name(email: str | None) -> str:
    """What this member types into the Χρήστης box.

    `username_of` already answers this, and the Ομάδα and Ρυθμίσεις screens had
    each wrapped it in a private helper of the same name — one taking an address,
    one taking a membership row, one of them re-checking the domain that
    `username_of` had just checked. One function, so the roster and the settings
    screen cannot start disagreeing about what a person signs in as.
    """
    return username_of(str(email or ""))


def current_username() -> str | None:
    """Who is signed in, before a membership row exists to name them."""
    email = st.session_state.get(_EMAIL_KEY)
    return username_of(str(email)) if email else None


# ---------------------------------------------------------------------------
# The gate
# ---------------------------------------------------------------------------

def gate() -> bool:
    """Draw whichever of the three states applies; True only when ready.

    a) signed out          -> the sign-in form.
    b) signed in, no gym   -> the bootstrap_gym form (or, if the membership
                              lookup itself failed, a retry — because showing
                              "create a gym" to an owner whose network blipped
                              is a worse screen than saying so).
    c) signed in, has gym  -> nothing drawn, True returned.
    """
    missing = [
        name
        for name in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "USERNAME_DOMAIN")
        if not db.config(name)
    ]
    if missing:
        _render_not_configured(missing)
        return False

    _flush_cookie()

    if not _ensure_session():
        _render_sign_in()
        return False

    if db.me():
        return True

    _render_bootstrap()
    return False


def sign_out() -> None:
    """End the session here and on the server. The caller reruns."""
    try:
        db.client().auth.sign_out()
    except Exception:
        # An unreachable server must not trap a trainer in a session they asked
        # to end; the local half of the sign-out happens either way.
        pass
    _sign_out_state(drop_cookie=True)


def change_password(new_password: str) -> None:
    password = new_password or ""
    if len(password) < 8:
        raise ValueError("Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.")
    try:
        db.client().auth.update_user({"password": password})
    except Exception as exc:
        raise RuntimeError(_password_error(exc)) from exc


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------

def _ensure_session() -> bool:
    if st.session_state.get(db.ACCESS_KEY):
        if _needs_refresh():
            return _use_refresh_token(st.session_state.get(db.REFRESH_KEY))
        # Re-attaches the stored JWT if the client object itself was dropped.
        db.client()
        return True
    return _restore_from_cookie()


def _needs_refresh() -> bool:
    expires_at = st.session_state.get(_EXPIRES_KEY)
    if not expires_at:
        # Unknown expiry: let the query fail loudly rather than burn a refresh
        # token on every rerun.
        return False
    try:
        return time.time() > float(expires_at) - _REFRESH_MARGIN_S
    except (TypeError, ValueError):
        return False


def _use_refresh_token(token: str | None) -> bool:
    if not token:
        return False
    try:
        response = db.client().auth.refresh_session(token)
    except Exception as exc:
        # A token the server actively rejected is spent; a token that never
        # reached the server is not. Dropping the cookie on a dead gym wifi
        # would sign a trainer out for the rest of the shift.
        _sign_out_state(drop_cookie=getattr(exc, "status", None) is not None)
        _flush_cookie()
        return False

    session = getattr(response, "session", None)
    if not _remember(session):
        _sign_out_state(drop_cookie=True)
        _flush_cookie()
        return False
    _flush_cookie()
    return True


def _remember(session: Any) -> bool:
    """Store a session and queue the cookie that will outlive this tab."""
    access = getattr(session, "access_token", None)
    refresh = getattr(session, "refresh_token", None)
    if not access:
        return False

    user = getattr(session, "user", None)
    db.attach_session(access, refresh, getattr(user, "id", None))

    email = getattr(user, "email", None)
    if email:
        st.session_state[_EMAIL_KEY] = str(email)
    st.session_state[_EXPIRES_KEY] = _expiry_epoch(session)
    st.session_state.pop(_PROBE_KEY, None)
    if refresh:
        # Supabase rotates the refresh token on every use, so the cookie is
        # rewritten each time — an old one is already spent.
        st.session_state[_PENDING_COOKIE_KEY] = ("set", refresh)
    return True


def _expiry_epoch(session: Any) -> float:
    expires_at = getattr(session, "expires_at", None)
    if expires_at:
        try:
            return float(expires_at)
        except (TypeError, ValueError):
            pass
    expires_in = getattr(session, "expires_in", None)
    try:
        return time.time() + float(expires_in)
    except (TypeError, ValueError):
        return time.time() + 3600.0


def _sign_out_state(drop_cookie: bool = True) -> None:
    db.forget_session()
    for key in (_EXPIRES_KEY, _EMAIL_KEY, _PROBE_KEY):
        st.session_state.pop(key, None)
    # Navigation state belongs to a person: the next trainer on this tablet must
    # not inherit the previous one's open athlete or half-written session.
    for key in ("athlete", "session_id"):
        st.session_state.pop(key, None)
    if drop_cookie:
        st.session_state[_PENDING_COOKIE_KEY] = ("delete", None)
    try:
        # @st.cache_data is global to the server process. Every cached function
        # is keyed by gym_id, so this is belt and braces — and cheap.
        st.cache_data.clear()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Cookie
# ---------------------------------------------------------------------------

def _cookie_manager() -> Any | None:
    """The one manager for this session. Two on a page fight over the same key."""
    manager = st.session_state.get(_MANAGER_KEY)
    if manager is not None:
        return manager
    try:
        manager = stx.CookieManager(key="trainhub_cookie_manager")
    except TypeError:
        manager = stx.CookieManager()
    except Exception:
        return None
    st.session_state[_MANAGER_KEY] = manager
    return manager


def _cookie_snapshot() -> dict[str, Any] | None:
    """What the browser has told us. None means it has not answered yet."""
    manager = _cookie_manager()
    if manager is None:
        return {}
    read_all = getattr(manager, "get_all", None)
    try:
        cookies = read_all() if callable(read_all) else {_COOKIE_NAME: manager.get(_COOKIE_NAME)}
    except Exception:
        # In private mode and locked-down browsers the accessor itself throws.
        return {}
    if cookies is None:
        return None
    try:
        return dict(cookies)
    except Exception:
        return {}


def _restore_from_cookie() -> bool:
    cookies = _cookie_snapshot()
    if cookies is None:
        probes = int(st.session_state.get(_PROBE_KEY, 0) or 0)
        if probes < _PROBE_LIMIT:
            st.session_state[_PROBE_KEY] = probes + 1
            with st.spinner("Έλεγχος σύνδεσης…"):
                time.sleep(_PROBE_PAUSE_S)
            st.rerun()
        return False

    token = cookies.get(_COOKIE_NAME)
    if not token:
        return False
    return _use_refresh_token(str(token))


def _flush_cookie() -> None:
    """Perform a queued cookie write. Called before anything else is drawn."""
    pending = st.session_state.pop(_PENDING_COOKIE_KEY, None)
    if not pending:
        return
    manager = _cookie_manager()
    if manager is None:
        return

    action, token = pending
    sequence = int(st.session_state.get(_COOKIE_OP_KEY, 0) or 0) + 1
    st.session_state[_COOKIE_OP_KEY] = sequence
    # Each write renders its own component; a shared key would be a duplicate
    # widget id the moment two writes land in one run.
    key = f"trainhub_cookie_{action}_{sequence}"

    try:
        if action == "set" and token:
            manager.set(
                _COOKIE_NAME,
                token,
                expires_at=datetime.now(timezone.utc) + timedelta(days=_COOKIE_DAYS),
                secure=_cookie_secure(),
                same_site="lax",
                key=key,
            )
        elif action == "delete":
            manager.delete(_COOKIE_NAME, key=key)
    except Exception:
        # No cookie means no survival across a locked phone. The session in this
        # tab still works, so this is a degradation, not a failure.
        pass


def _cookie_secure() -> bool:
    # Secure by default; the escape hatch exists because a Secure cookie is
    # dropped over plain http, which is how a laptop on the gym LAN serves it.
    value = (db.config("COOKIE_SECURE", "1") or "1").strip().lower()
    return value not in ("0", "false", "no", "off")


# ---------------------------------------------------------------------------
# Screens
# ---------------------------------------------------------------------------

def _render_not_configured(missing: list[str]) -> None:
    st.title("TrainHub")
    st.error("Ο διακομιστής δεν έχει ρυθμιστεί.")
    st.caption("Λείπουν οι ρυθμίσεις: " + ", ".join(missing) + ".")


def _render_sign_in() -> None:
    st.title("TrainHub")
    st.caption("Όπου καταγράφεται κάθε επανάληψη.")

    with st.form("trainhub_sign_in"):
        st.subheader("Σύνδεση")
        username = st.text_input("Χρήστης", autocomplete="username")
        password = st.text_input("Κωδικός", type="password", autocomplete="current-password")
        submitted = st.form_submit_button("Σύνδεση", type="primary")

    # There is no self-service reset: these accounts have no reachable mailbox,
    # so the only recovery path is the owner, from the Ομάδα screen.
    st.caption("Ξέχασες τον κωδικό; Ο ιδιοκτήτης του γυμναστηρίου τον αλλάζει από την Ομάδα.")

    if not submitted:
        return

    if not (username or "").strip() or not password:
        st.error(_EMPTY_FIELDS)
        return

    try:
        email = email_for(username)
    except ValueError:
        # Not "that is not a valid username" — the screen says the same thing
        # whatever was wrong with it.
        st.error(_BAD_CREDENTIALS)
        return

    try:
        response = db.client().auth.sign_in_with_password(
            {"email": email, "password": password}
        )
    except Exception as exc:
        st.error(_auth_error(exc))
        return

    if not _remember(getattr(response, "session", None)):
        st.error(_BAD_CREDENTIALS)
        return

    db.clear_identity()
    st.rerun()


def _render_bootstrap() -> None:
    st.title("TrainHub")

    who = current_username()
    if who:
        st.caption(f"Σύνδεση ως {who}")

    failure = st.session_state.get(db.LOAD_ERROR_KEY)
    if failure:
        st.error("Ο λογαριασμός σου δεν διαβάστηκε. Έλεγξε τη σύνδεση και δοκίμασε ξανά.")
        st.caption(str(failure)[:200])
        if st.button("Δοκίμασε ξανά", key="gate_retry"):
            db.clear_identity()
            st.rerun()
        _render_sign_out_button()
        return

    st.subheader("Νέο γυμναστήριο")
    st.write(
        "Ο λογαριασμός σου δεν ανήκει ακόμη σε γυμναστήριο. "
        "Φτιάξε το τώρα και γίνεσαι ο ιδιοκτήτης του."
    )

    with st.form("trainhub_bootstrap"):
        gym_name = st.text_input("Όνομα γυμναστηρίου", max_chars=120)
        display_name = st.text_input("Το όνομά σου", max_chars=120)
        gym_timezone = st.selectbox("Ζώνη ώρας", _TIMEZONES, index=0)
        submitted = st.form_submit_button("Δημιουργία γυμναστηρίου", type="primary")

    _render_sign_out_button()

    if not submitted:
        return

    name = (gym_name or "").strip()
    display = (display_name or "").strip()
    if not name:
        st.error("Γράψε το όνομα του γυμναστηρίου.")
        return
    if not display:
        st.error("Γράψε το όνομά σου.")
        return

    try:
        db.client().rpc(
            "bootstrap_gym",
            {"p_name": name, "p_display_name": display, "p_timezone": gym_timezone},
        ).execute()
    except Exception as exc:
        message, stale = _bootstrap_error(exc)
        st.error(message)
        if stale:
            # The server knows about a membership this session had not read yet.
            db.clear_identity()
        return

    db.clear_identity()
    st.rerun()


def _render_sign_out_button() -> None:
    if st.button("Αποσύνδεση", key="gate_sign_out"):
        sign_out()
        st.rerun()


# ---------------------------------------------------------------------------
# Error copy
# ---------------------------------------------------------------------------

def _auth_error(exc: Exception) -> str:
    status = getattr(exc, "status", None)
    if status == 429:
        return _RATE_LIMITED
    if status is not None:
        # An HTTP status means the server answered and refused. Unknown user,
        # wrong password, unconfirmed address — all one sentence.
        return _BAD_CREDENTIALS
    return _NO_CONNECTION


def _bootstrap_error(exc: Exception) -> tuple[str, bool]:
    """Map the two errors bootstrap_gym() actually raises. Second value: recheck."""
    text = str(exc).lower()
    if "sign in first" in text:
        return "Η σύνδεση έληξε. Κάνε αποσύνδεση, μπες ξανά και δοκίμασε.", False
    if "already belongs to a gym" in text:
        return "Ο λογαριασμός σου ανήκει ήδη σε γυμναστήριο.", True
    if getattr(exc, "code", None) is None and getattr(exc, "status", None) is None:
        # Nothing answered: no PostgREST error code and no HTTP status.
        return _NO_CONNECTION, False
    return "Το γυμναστήριο δεν δημιουργήθηκε. Δοκίμασε ξανά.", False


def _password_error(exc: Exception) -> str:
    text = str(exc).lower()
    if "different from the old" in text or "should be different" in text:
        return "Ο νέος κωδικός πρέπει να διαφέρει από τον παλιό."
    if "weak" in text or "at least" in text or "short" in text:
        return "Ο κωδικός είναι πολύ αδύναμος. Διάλεξε μεγαλύτερο."
    if getattr(exc, "status", None) is None:
        return _NO_CONNECTION
    return "Ο κωδικός δεν άλλαξε. Δοκίμασε ξανά."
