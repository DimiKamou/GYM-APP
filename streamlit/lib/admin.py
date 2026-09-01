"""Service-role admin calls — the only module in this app that holds that key.

The service_role key bypasses row-level security completely: PostgREST does not
evaluate a single policy for a request that carries it. So the moment this key
touches anything in `public.*`, the 44 policies in 001_init.sql stop being the
thing that protects the data and the only remaining protection is whether the
code in this one file happens to be correct. That is a much weaker guarantee,
and it fails silently — a wrong gym_id in a query reads another gym's athletes
with no error anywhere.

Therefore, and without exception:

  * the client built here is used for `auth.admin.*` against `auth.users` only;
  * it never calls `.table()` and never calls `.rpc()`;
  * every row in `public.*` — the memberships row included — is written with
    the signed-in OWNER's own RLS-scoped client from `lib.db`.

The schema is built for exactly that division: `memberships_insert` permits an
insert where `gym_id = app.my_gym()`, and the restrictive
`memberships_insert_owner_only` demands `app.my_role() = 'owner'`. An owner
adding to their own roster is a permitted write, and a trainer attempting the
same is refused by the database rather than by an `if` in this file.

Resetting a password has no such backstop: `auth.users` has no policies, so the
`if` in this file IS the whole permission system for it. It therefore reads the
caller's role from the server on every call (`_owner_gym`) instead of from the
membership cached in this browser session, which the database can demote
underneath — see db.fresh_membership().

The key lives in `st.secrets` (or the environment) and in nothing that is
committed. When it is
absent, ADMIN_AVAILABLE is False and the rest of the app runs untouched — only
creating accounts is unavailable.
"""

from __future__ import annotations

import re
from typing import Any, NoReturn

from supabase import Client, create_client

try:  # the export moved out of the private layout in supabase-py 2.x
    from supabase import ClientOptions  # type: ignore[attr-defined]
except ImportError:  # pragma: no cover - older layouts still expose it here
    from supabase.lib.client_options import ClientOptions  # type: ignore[no-redef]

from lib import auth, db


# The canonical secret names, plus the spellings people actually paste out of the
# Supabase dashboard. The canonical one is what `.streamlit/secrets.toml.example`
# documents AND what the missing-secret message names, so the fix is
# unambiguous — the two disagreeing is how an owner ends up adding a key under a
# name nothing reads.
_URL_SECRET = "SUPABASE_URL"
_URL_ALIASES = (_URL_SECRET, "SUPABASE_PROJECT_URL")
_SERVICE_SECRET = "SUPABASE_SERVICE_ROLE_KEY"
_SERVICE_ALIASES = (_SERVICE_SECRET, "SUPABASE_SERVICE_KEY", "SERVICE_ROLE_KEY")

# Supabase's own floor is 6. Eight is the shortest password worth handing to a
# trainer who will keep it for two years and type it on a phone at 06:55.
_MIN_PASSWORD = 8

_USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{2,32}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

_ROLES = ("owner", "trainer")


def _first(names: tuple[str, ...]) -> str:
    """The first of these settings that is actually set.

    `db.config` and not a second reader of `st.secrets`: it is the one place that
    already guards the missing-secrets-file case AND falls back to the
    environment. A private copy here read only st.secrets, so a container given
    the service key as an env var — which is how every host but Streamlit Cloud
    supplies it — silently had no "new user" button and no reason on screen why.
    """
    for name in names:
        value = (db.config(name) or "").strip()
        if value:
            return value
    return ""


_URL = _first(_URL_ALIASES)
_KEY = _first(_SERVICE_ALIASES)

ADMIN_AVAILABLE: bool = bool(_URL and _KEY)


def _unavailable_reason() -> str:
    if ADMIN_AVAILABLE:
        return ""
    missing = [name for name, value in ((_URL_SECRET, _URL), (_SERVICE_SECRET, _KEY)) if not value]
    quoted = "», «".join(missing)
    head = (
        f"Λείπει από τα st.secrets το «{quoted}»."
        if len(missing) == 1
        else f"Λείπουν από τα st.secrets τα «{quoted}»."
    )
    return (
        head
        + " Μέχρι να μπει, δεν δημιουργείται λογαριασμός χρήστη και δεν αλλάζει "
        "κωδικός άλλου μέλους — όλα τα υπόλοιπα της εφαρμογής δουλεύουν κανονικά. "
        "Γράψ' το στο "
        ".streamlit/secrets.toml (Supabase → Project Settings → API → service_role) "
        "και ξαναφόρτωσε την εφαρμογή. Το κλειδί δεν μπαίνει ποτέ σε αρχείο του "
        "repository."
    )


ADMIN_UNAVAILABLE_REASON: str = _unavailable_reason()


def _admin_client() -> Client:
    """A throwaway service-role client, built per call.

    Deliberately not `@st.cache_resource` and not a module-level singleton: one
    long-lived object holding this key is an ambient superuser for the whole
    server process, and the two operations that need it happen a handful of
    times in a gym's life. Nothing about it is per-session either, so there is
    no identity here to leak between visitors — the reason it is short-lived is
    blast radius, not correctness.
    """
    if not ADMIN_AVAILABLE:
        raise RuntimeError(ADMIN_UNAVAILABLE_REASON)
    return create_client(
        _URL,
        _KEY,
        ClientOptions(persist_session=False, auto_refresh_token=False),
    )


def _owner_gym(denial: str) -> str:
    """The caller's gym, from a role resolved NOW. Never from db.me()'s cache.

    `db.is_owner()` answers from a snapshot taken when the tab was opened, and
    the database can invalidate it without this process noticing:
    transfer_ownership() demotes an owner to trainer, and their open tab still
    says owner. Nothing further down catches it — the service_role key is
    evaluated against no policy at all, and memberships_select shows the whole
    roster to every active member, so the "is this one of mine?" check passes
    for a demoted owner too. On this path the only owner check that exists is
    this one, so it is a round trip and it fails closed.
    """
    try:
        mine = db.fresh_membership()
    except Exception as exc:
        raise RuntimeError(
            "Ο ρόλος σου δεν επιβεβαιώθηκε από τον διακομιστή, οπότε δεν έγινε "
            f"τίποτα. Έλεγξε τη σύνδεση και δοκίμασε ξανά. Αιτία: {_text(exc)}"
        ) from exc

    if (mine.get("role") or "") != "owner":
        raise PermissionError(denial)
    gym = str(mine.get("gym_id") or "")
    if not gym:
        raise PermissionError("Ο λογαριασμός σου δεν ανήκει σε γυμναστήριο.")
    return gym


def _text(exc: BaseException) -> str:
    """Everything an API error carries, flattened for a message a human reads."""
    parts = [str(getattr(exc, attr, "") or "") for attr in ("message", "code", "details", "hint")]
    parts.append(str(exc))
    seen: list[str] = []
    for part in parts:
        part = part.strip()
        if part and part not in seen:
            seen.append(part)
    return " · ".join(seen)


def _is_duplicate(exc: BaseException) -> bool:
    blob = _text(exc).lower()
    return "23505" in blob or "duplicate key" in blob or "already exists" in blob


def _is_taken_address(exc: BaseException) -> bool:
    blob = _text(exc).lower()
    return "already been registered" in blob or "already registered" in blob or "user_already_exists" in blob


def _clean_username(raw: str) -> str:
    """Validate here, where the cause is, not at Supabase, where it is not.

    The username becomes `<username>@USERNAME_DOMAIN`. A space or a Greek
    letter produces an address Supabase refuses, and its refusal arrives as a
    generic auth error with no hint that the username field is what is wrong.
    """
    username = (raw or "").strip()
    if not username:
        raise ValueError("Γράψε όνομα χρήστη.")
    if not _USERNAME_RE.match(username):
        raise ValueError(
            f"Το «{username}» δεν κάνει για όνομα χρήστη. Δέχεται μόνο λατινικά "
            "γράμματα, ψηφία, τελεία, κάτω παύλα και παύλα, από 2 έως 32 χαρακτήρες "
            "— ένα κενό ή ένα ελληνικό γράμμα φτιάχνει διεύθυνση που το Supabase "
            "απορρίπτει."
        )
    if username.startswith(".") or username.endswith(".") or ".." in username:
        raise ValueError(
            "Το όνομα χρήστη δεν ξεκινά ούτε τελειώνει με τελεία, και δεν έχει δύο "
            "τελείες στη σειρά — η διεύθυνση που θα προέκυπτε δεν είναι έγκυρη."
        )
    return username.lower()


def _address_for(username: str) -> str:
    email = auth.email_for(username).strip().lower()
    if not _EMAIL_RE.match(email):
        raise RuntimeError(
            "Το «USERNAME_DOMAIN» στα st.secrets λείπει ή δεν είναι domain, οπότε το "
            f"«{username}» δεν γίνεται διεύθυνση που δέχεται το Supabase."
        )
    return email


def _check_password(password: str) -> None:
    if not password or len(password) < _MIN_PASSWORD:
        raise ValueError(f"Ο κωδικός θέλει τουλάχιστον {_MIN_PASSWORD} χαρακτήρες.")


def _rollback(user_id: str, username: str, exc: BaseException) -> NoReturn:
    """Undo the auth account, then re-raise. Only for a PROVABLY absent row.

    A half-created member is the worst outcome available on this path: an
    account that signs in perfectly and then sees an empty app, because
    `app.my_gym()` is null for a user with no membership row and every policy
    in the database evaluates false. Nobody diagnoses that from the symptom —
    it looks like the app is broken, not like the account is incomplete.

    The mirror image is worse still and is not undoable, which is why the caller
    must look before it deletes — see _settle_failed_insert().
    """
    try:
        _admin_client().auth.admin.delete_user(user_id)
    except Exception:
        raise RuntimeError(
            f"Ο λογαριασμός «{username}» δημιουργήθηκε, η εγγραφή στην ομάδα απέτυχε, "
            "και ο λογαριασμός ΔΕΝ διαγράφηκε. Σβήσ' τον από το Supabase "
            "(Authentication → Users) πριν ξαναδοκιμάσεις, αλλιώς θα μπορεί να "
            f"συνδέεται χωρίς να βλέπει τίποτα. Αιτία: {_text(exc)}"
        ) from exc

    if _is_duplicate(exc):
        raise ValueError(
            f"Υπάρχει ήδη μέλος με το όνομα χρήστη «{username}» ή ενεργός ιδιοκτήτης "
            "στο γυμναστήριο. Τίποτα δεν δημιουργήθηκε."
        ) from exc
    raise RuntimeError(
        f"Η εγγραφή στην ομάδα απέτυχε και ο λογαριασμός αναιρέθηκε: {_text(exc)}"
    ) from exc


def _settle_failed_insert(
    data: Client,
    gym: str,
    email: str,
    user_id: str,
    username: str,
    exc: BaseException,
) -> dict[str, Any]:
    """Work out what actually happened, then undo only what actually failed.

    `.execute()` raises identically for "PostgREST refused the insert" and for
    "the row committed and the answer never came back" — a read timeout, a
    dropped connection. Deleting the auth account on the second one cannot be
    undone: memberships.user_id is ON DELETE SET NULL, so the committed row
    survives with no account and status active, and memberships_gym_email_uniq
    is not partial, so that username is taken in this gym forever by a member
    who cannot sign in. So the row is read back before anything is deleted, and
    a read that itself fails leaves BOTH halves alone.
    """
    try:
        rows = (
            data.table("memberships")
            .select("id, gym_id, user_id, display_name, email, role, status")
            .eq("gym_id", gym)
            .eq("email", email)
            .limit(1)
            .execute()
            .data
            or []
        )
    except Exception as read_exc:
        # Neither half is provably wrong, so neither is touched. An owner told
        # which username to look at can finish this in a minute; an owner told
        # "nothing was created" is being sent to retry into a wall.
        raise RuntimeError(
            f"Δεν επιβεβαιώθηκε αν ο/η «{username}» μπήκε στην ομάδα, και τίποτα "
            "δεν αναιρέθηκε. Ξαναφόρτωσε την Ομάδα: αν εμφανίζεται, ο λογαριασμός "
            "είναι έτοιμος και ισχύει ο κωδικός που μόλις έδωσες· αν δεν "
            f"εμφανίζεται, σβήσε τον λογαριασμό «{username}» από το Supabase "
            f"(Authentication → Users) πριν ξαναδοκιμάσεις. Αιτία: {_text(exc)} · "
            f"{_text(read_exc)}"
        ) from exc

    committed = dict(rows[0]) if rows else {}
    holder = str(committed.get("user_id") or "")
    if not committed or (holder and holder != user_id):
        # No row, or a row belonging to somebody else: this insert really was
        # refused, and the account just minted has nothing to belong to.
        _rollback(user_id, username, exc)

    if not holder:
        # The row committed and then the connection dropped, so the account this
        # row was inserted for is the one just created. Link it rather than
        # leaving a member who can never sign in and whose username is spent.
        try:
            patched = (
                data.table("memberships")
                .update({"user_id": user_id})
                .eq("gym_id", gym)
                .eq("id", committed["id"])
                .execute()
                .data
                or []
            )
        except Exception as patch_exc:
            raise RuntimeError(
                f"Ο/Η «{username}» μπήκε στην ομάδα αλλά δεν συνδέθηκε με τον "
                "λογαριασμό σύνδεσης, οπότε δεν μπορεί ακόμη να μπει. Μην "
                "ξαναδημιουργήσεις τον χρήστη — δοκίμασε ξανά σε λίγο. Αιτία: "
                f"{_text(patch_exc)}"
            ) from exc
        if patched:
            committed = dict(patched[0])
        else:
            committed["user_id"] = user_id

    return committed


def create_member(username: str, full_name: str, role: str, password: str) -> dict[str, Any]:
    """Create an auth account and the membership row that gives it a gym.

    Returns the inserted membership row plus the `username` the person signs in
    with. Raises PermissionError when the caller is not the owner, ValueError
    for anything the owner can fix by retyping, RuntimeError for the rest.
    """
    gym = _owner_gym("Μόνο ο ιδιοκτήτης του γυμναστηρίου προσθέτει χρήστες.")

    if role not in _ROLES:
        raise ValueError("Ο ρόλος είναι «προπονητής» ή «ιδιοκτήτης».")

    name = (full_name or "").strip()
    if not name:
        raise ValueError(
            "Γράψε ονοματεπώνυμο — αυτό βλέπει ο επόμενος προπονητής δίπλα σε κάθε "
            "νούμερο που θα γράψει αυτός ο χρήστης."
        )
    if len(name) > 120:
        raise ValueError("Το ονοματεπώνυμο δεν ξεπερνά τους 120 χαρακτήρες.")

    username = _clean_username(username)
    _check_password(password)
    email = _address_for(username)

    if not ADMIN_AVAILABLE:
        raise RuntimeError(ADMIN_UNAVAILABLE_REASON)

    # The owner's own client: RLS-scoped, so these reads answer "in MY gym?"
    # rather than "anywhere in this Supabase project?".
    data = db.client()

    # Both checks below are answered by unique indexes anyway. Asking first
    # means the common mistakes cost a SELECT instead of an auth account that
    # then has to be deleted again.
    taken = (
        data.table("memberships")
        # user_id, because "taken" has two very different meanings: a member who
        # signs in with it, and a row left without an account, which is a member
        # nobody can repair by retyping the form.
        .select("id, display_name, status, user_id")
        .eq("gym_id", gym)
        .eq("email", email)
        .limit(1)
        .execute()
        .data
        or []
    )
    if taken:
        holder = taken[0].get("display_name") or "άλλο μέλος"
        if taken[0].get("status") == "removed":
            raise ValueError(
                f"Το όνομα χρήστη «{username}» ανήκει στον/στην {holder}, που έχει "
                "αφαιρεθεί. Επανέφερέ τον αντί να φτιάξεις δεύτερο λογαριασμό — έτσι "
                "η παλιά του δουλειά μένει στο όνομά του."
            )
        if not taken[0].get("user_id"):
            raise ValueError(
                f"Το όνομα χρήστη «{username}» το κρατά η γραμμή του/της {holder}, "
                "που δεν έχει λογαριασμό σύνδεσης. Δεύτερη γραμμή με το ίδιο όνομα "
                "χρήστη δεν επιτρέπεται: διάλεξε άλλο όνομα, ή φτιάξε τον λογαριασμό "
                "από το Supabase (Authentication → Users) και σύνδεσέ τον με αυτή τη "
                "γραμμή."
            )
        raise ValueError(f"Το όνομα χρήστη «{username}» το έχει ήδη ο/η {holder}.")

    if role == "owner":
        owners = (
            data.table("memberships")
            .select("id, display_name")
            .eq("gym_id", gym)
            .eq("role", "owner")
            .eq("status", "active")
            .is_("deleted_at", "null")
            .limit(1)
            .execute()
            .data
            or []
        )
        if owners:
            holder = owners[0].get("display_name") or "κάποιος"
            raise ValueError(
                f"Το γυμναστήριο έχει ήδη ενεργό ιδιοκτήτη ({holder}) και δεν επιτρέπεται "
                "δεύτερος. Φτιάξε τον λογαριασμό ως προπονητή και μετά μεταβίβασε την "
                "ιδιοκτησία."
            )

    try:
        created = _admin_client().auth.admin.create_user(
            {
                "email": email,
                "password": password,
                # No mail is ever sent to these synthetic addresses — nobody
                # reads maria@<USERNAME_DOMAIN> — so an unconfirmed account
                # would be one that can never sign in and never be repaired
                # from inside the app.
                "email_confirm": True,
                "user_metadata": {"username": username, "full_name": name},
            }
        )
    except Exception as exc:
        if _is_taken_address(exc):
            raise ValueError(
                f"Το όνομα χρήστη «{username}» χρησιμοποιείται ήδη σε αυτό το Supabase. "
                "Διάλεξε άλλο."
            ) from exc
        raise RuntimeError(f"Ο λογαριασμός δεν δημιουργήθηκε: {_text(exc)}") from exc

    user = getattr(created, "user", None)
    user_id = getattr(user, "id", None)
    if not user_id:
        raise RuntimeError(
            "Το Supabase δεν επέστρεψε λογαριασμό. Τίποτα δεν καταχωρήθηκε στην ομάδα."
        )
    user_id = str(user_id)

    try:
        # id, created_at and created_by are the database's business: created_by
        # defaults to app.my_membership(), and a value sent from here would be a
        # claim about authorship rather than a fact read from the JWT.
        inserted = (
            data.table("memberships")
            .insert(
                {
                    "gym_id": gym,
                    "user_id": user_id,
                    "display_name": name,
                    "email": email,
                    "role": role,
                    "status": "active",
                }
            )
            .execute()
            .data
            or []
        )
        if not inserted:
            raise RuntimeError("η εγγραφή μέλους δεν επέστρεψε γραμμή")
    except Exception as exc:
        member = _settle_failed_insert(data, gym, email, user_id, username, exc)
    else:
        member = dict(inserted[0])

    member["username"] = username
    return member


def reset_password(user_id: str, new_password: str) -> None:
    """Set another member's password. Owner only, and only inside their gym."""
    gym = _owner_gym("Μόνο ο ιδιοκτήτης αλλάζει τον κωδικό άλλου χρήστη.")

    _check_password(new_password)

    if not ADMIN_AVAILABLE:
        raise RuntimeError(ADMIN_UNAVAILABLE_REASON)

    # The service key is global to the Supabase project, so it would happily
    # reset the password of a user in someone else's gym. "Is this one of
    # mine?" is a question only the RLS-scoped client can answer honestly, and
    # it has to be asked before the admin call, not after.
    target = (
        db.client()
        .table("memberships")
        .select("id, display_name")
        .eq("gym_id", gym)
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not target:
        raise PermissionError("Αυτός ο λογαριασμός δεν ανήκει στο γυμναστήριό σου.")

    try:
        _admin_client().auth.admin.update_user_by_id(user_id, {"password": new_password})
    except Exception as exc:
        raise RuntimeError(f"Ο κωδικός δεν άλλαξε: {_text(exc)}") from exc
