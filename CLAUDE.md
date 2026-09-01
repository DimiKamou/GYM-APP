# TrainHub — working notes

Read `README.md` first for what this is and why. This file is the stuff that is easy to get wrong.

## The product in one line

One durable, attributed, always-legible sheet per athlete. A covering coach reads it in five seconds; every
line says who wrote it. When a change makes either of those worse, it is the wrong change however good the
feature is.

## Decisions already made — do not re-litigate without a reason

- **Supabase is the source of truth from commit one.** A persisted read cache plus a write outbox, not a
  replication engine. A full local-first sync layer was considered and rejected as the largest schedule risk.
- **Email OTP, not Google OAuth.** An OAuth redirect from a standalone home-screen app returns to Safari and
  leaves the installed app signed out. OTP also doubles as the lockout recovery path.
- **Two roles**, `owner` and `trainer`. The four-role matrix was cut. Adding `manager` is one migration.
- **Assignment is a filter, never a fence.** Any active member may log for any athlete in the gym. Fencing by
  assignment stops work when a coach covers a sick colleague, and the workaround is a shared login.
- **Greek is the default locale.** English is the fallback.
- **Daylight is the default theme, Slate is its dark pair.** Both are pure token files.
- **Soft delete everywhere, undo instead of confirm.** No DELETE policy exists in the schema. Confirm dialogs
  survive only for removing an athlete or a trainer.
- **No service worker until M5.** See README.

## Traps

**RLS: owner-only restrictions must be `AS RESTRICTIVE`.** Permissive policies on the same table and command
are OR'd together, so "trainers may not delete athletes" written as an extra permissive policy is silently a
no-op. This is the single easiest way to ship an unenforced permission here.

**`logged_by` cannot be a column DEFAULT.** A Postgres default may not reference a sibling column, so it is a
BEFORE INSERT trigger plus an INSERT policy `with check (logged_by = app.my_membership())`.

**Sort sets and blocks by `(position, id)`, never `position` alone.** Two offline inserts can mint the same
position.

**Never render a coaching number without its date and author.** "80×8" alone is worse than nothing, because
the coach loads a bar with it. The rendering is always "80×8 · 12 Αυγ · Μαρία".

**Parse decimals with `parseDecimal`, never `Number()`.** `Number("72,5")` is `NaN`, a Greek trainer types a
comma, and that NaN propagates into every volume total and chart. This is the likeliest silent data loss in
the whole app.

**Wrap every `localStorage` / IndexedDB access in try/catch.** In private mode and locked-down browsers the
accessor itself throws, not just the read.

**Notes are append-only.** There is no UPDATE policy on `notes.body`. That is what keeps them safe under
last-write-wins — otherwise a trainer holding a stale athlete row republishes old notes over a colleague's.

## The Streamlit pilot in `streamlit/`

A second client on the same Supabase project, for the first-phase pilot. It signs
trainers in with a **username and password** — `Dimitris` becomes
`dimitris@<USERNAME_DOMAIN>` internally — so `auth.uid()` is real and every
trigger and policy in `001_init.sql` works untouched. Deployed from `main` on
Streamlit Community Cloud, entry point `streamlit_app.py` at the repository root.

### Traps that are specific to it

**`@st.cache_resource` and `@st.cache_data` are global to the server process.**
One Python process serves every trainer. Cache the Supabase client and the next
visitor inherits the previous one's JWT — their gym, their identity on every set
they write. The client lives in `st.session_state`, which is per browser session.

**Every `@st.cache_data` takes `gym_id` as its first argument**, even where the
body ignores it. A cache hit is served from this process and never reaches
PostgREST, so RLS never sees the request: leave the tenant out of the key and
gym B is served gym A's athletes out of memory, past every policy.

**`service_role` touches `auth.users` and nothing else.** It is confined to
`lib/admin.py`, for creating accounts. The moment it reads or writes any
`public.*` table, the 44 policies stop being what protects the data — and
`sessions_stamp_author()` raises without a JWT anyway, so a session cannot even
be created.

**Checking a signature is not checking the screen.** `st.navigation(...,
position="top")` is accepted by the signature and ignored by the renderer in
1.62; combined with a collapsed sidebar whose control the app hides, it put six
of seven screens behind no door at all, with no error. Every test until then had
stopped at the sign-in form — the screen before the broken one. `tests/` is the
answer to that: `python3 tests/run.py` presses real buttons through
`streamlit.testing.v1.AppTest` against an in-memory PostgREST, and
`streamlit run tests/demo_app.py` puts the whole app in a browser with no
Supabase behind it.

**Ask for every column you read.** PostgREST returns exactly the columns named
in `.select(...)` and nothing complains about the rest — a screen reading one it
forgot to ask for gets `None` and renders an empty string. `equipment` was
missing from the log screen's catalogue read for a week: the όργανο never
appeared anywhere, and the code that was supposed to show it looked correct.
The fake in `tests/` projects the select list for this reason.

**Equipment belongs to the exercise, not the set.** 40 kg of dumbbells is not
80 kg of barbell; the variants are separate rows, which is what keeps the
"τελευταία φορά" line honest.

## Conventions

- Comment **why**, never **what**. A comment restating the line above it gets deleted in review.
- Code, identifiers and comments are English. UI strings are Greek first, and live only in `src/i18n/`.
- `src/domain/types.ts` is the contract. When the schema changes, it changes in the same commit.
- Pure logic goes in `src/domain/` with tests. Nothing there does I/O.
- 44px minimum hit target, and nothing destructive within a thumb's width of something routine.

## The design handoff is not fully trustworthy

`trainhub_web_handoff/` is the visual and behavioural spec, but: all seven `screens/*.png` are JPEGs with a
`.png` extension, `workout-log.png` is byte-identical to `athlete-detail.png`, and two others are stale
Athletes-list captures. There is no reference image for the Workout Log. Use the running prototype
(`design_reference/TrainHub.html`) rather than the screenshots, and treat `README.md` in that package as out
of date wherever it disagrees with the prototype source.
