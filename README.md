# TrainHub — PowerHouse

A web app that replaces the shared paper PT sheet at a gym. Installable from a URL, and on Google Play
as the same web app in a Trusted Web Activity (`android/README.md`) — no second codebase, no iOS/Android
split. Branded **PowerHouse** for the gym it is built for.

Two panels: the **staff** log and read the sheet; each **athlete**, invited by a link from the owner,
reads their own sessions and progress — never the staff's notes, never anyone else's.

## What this actually is

Not a workout logger. Trainers have managed sets and reps on paper for thirty years without complaint.
What breaks when four coaches share one sheet is not the *writing* — it is the **briefing**: who did what,
who wrote it, what to push, what to avoid.

So the product is one durable, attributed, always-legible sheet per athlete, and it has to beat paper on
exactly two axes:

1. A covering coach reads it in **five seconds** while the athlete ties their shoes.
2. **Every line says who wrote it.**

The full reasoning, milestones and open decisions live in the build plan:
<https://claude.ai/code/artifact/481209c8-fed2-4ca7-b8c9-427f4d8164e5>

## Stack

| | |
|---|---|
| Build | Vite + React 18 + TypeScript (strict) |
| Routing | React Router v7 |
| Server | Supabase — Postgres, Auth, Row-Level Security. Region `eu-central-1` (Frankfurt) |
| Auth | Trainers: username + password (the Streamlit accounts). Athletes: Google, Microsoft or email sign-up. Email code as recovery |
| Data | TanStack Query with a persisted read cache, plus an idempotent write outbox |
| State | Zustand for ephemeral UI state only; server state belongs to Query |
| i18n | i18next — **Greek is the default**, English is the fallback |
| Charts | Hand-rolled inline SVG, as in the prototype. No chart library |
| PWA | Static manifest + generated service worker; a new build waits for a tap (see below) |

## Four decisions that are hard to reverse

These are in `supabase/migrations/001_init.sql` and cannot be retrofitted once a real gym has history.

**A set is a row, not a leaf of a JSON document.** With a nested session document the smallest possible
write is the whole session, so a trainer saving at 18:05 silently erases a colleague's 07:30 sets — the
precise failure this product exists to prevent. Flattened, two coaches appending sets mint different UUIDs
and the merge is a union with nothing to resolve.

**`gym_id` on every row, with composite foreign keys.** `unique (gym_id, id)` on each parent plus
`foreign key (gym_id, session_id) references sessions(gym_id, id)` is what makes the denormalised column
trustworthy rather than merely convenient: a buggy or hostile client cannot write a row into another gym's
tree.

**Two author columns.** `logged_by` is stamped by a trigger from `auth.uid()` and is immutable;
`credited_to` is editable and audited. One immutable column cannot represent the owner typing up a
colleague's sheet on Friday, so trainers would share a login — which destroys attribution completely. One
editable column lets anyone point a session at someone else.

**A `set_kind` enum.** The prototype stored 20 treadmill minutes and 10 pull-ups identically as
`{kg: 0, reps: N}`, so every volume total counted both as zero and no consumer could tell them apart.

## Sync

Supabase is the source of truth from the first commit. On top of it sits a persisted read cache
(`persistQueryClient` → IndexedDB) and a write outbox of idempotent mutation intents drained through the
`apply_ops` RPC. `applied_ops` records each `op_id`, so a retry after a lost response is a no-op rather
than a duplicate session.

A full local-first replication engine was considered and rejected: it is three to four weeks of work
defending against two trainers editing one session *simultaneously*, which does not happen — a personal
trainer is with one athlete at a time. But online-only is also wrong, because the thing that must survive
a dead spot in the free-weights corner is not logging (a coach can retype four sets) but **reading the
briefing**.

Conflict model, in full: rows merge as a union by id. A genuine same-row clash resolves last-write-wins
and writes a `session_events` row, so the losing value is always recoverable.

## The service worker, and why it waits for a tap

It was held back during the pilot: a worker serves the trainer the bug you fixed an hour ago, and being
able to fix a fumble at 09:15 and have it live for the 09:30 client is the strongest argument for the web.
The Play Store build changed the trade — an installed app that opens to Chrome's offline page is broken —
so it ships, with that objection answered: a new build is announced by a banner and applied by a tap, the
button waits while the outbox holds writes, and the app checks for a new build every time it returns to
the foreground. See `src/pwa/serviceWorker.ts`. Supabase reads are never cached by the worker; that is the
persisted query cache's job.

## Running it

```bash
npm install
npm run dev
```

That is the whole setup. **No Supabase project is required to run the app.** With no credentials
configured it starts against a local IndexedDB repository seeded with a realistic gym — PowerHouse Gym,
two trainers, five athletes, three months of sessions — signs you in as Δημήτρης, and works
end to end. Settings says so plainly rather than implying the data is synced anywhere.

That seam exists because an app nobody can open is an app nobody can judge. A trainer deciding
whether this beats their clipboard has to be able to hold it first.

To point it at a real server instead:

```bash
cp .env.example .env      # Supabase URL + anon key; see supabase/README.md
npm run dev
```

`VITE_OFFLINE_FIXTURE=1` forces the local repository even when Supabase *is* configured, which is
how you demo without touching the gym's data.

```bash
npm run check     # typecheck + unit tests
npm run test      # vitest
npm run e2e       # Playwright — smoke suite runs locally; the two-device gate needs a project
npm run build
```

## Two clients, one database

There are two apps in this repository and they share the gym's Supabase project,
its schema and its 44 policies.

| | |
|---|---|
| **`src/`** — the React PWA | Installs to a phone's home screen, reads the briefing with no signal, records a set in nine taps. Trainers sign in with the same username and password as in Streamlit; athletes with Google, Microsoft or an email sign-up. |
| **`streamlit/`** — the Python pilot | Seven screens in ~4,000 lines. Signs in with a username and password, so a gym can start with three accounts and no mail server at all. No offline mode: with no signal it does not load. |

The pilot exists because it puts a working app in front of trainers in an
afternoon, and because the owner creating accounts for their own staff is one
screen rather than an invite flow. It is deployed from `main` on Streamlit
Community Cloud, entry point `streamlit_app.py` at the repository root, with
`requirements.txt` and `.streamlit/config.toml` beside it because that is where
Community Cloud looks.

`streamlit/README.md` is its operator guide. `CLAUDE.md` carries the traps that
are specific to it — chiefly that Streamlit's caches are global to the server
process, so a cache key without the gym is a tenancy leak that never reaches a
policy.

## Deploying

Static hosting, because that is all this needs: Supabase is the backend, and the build is a
folder of files. `firebase.json` is checked in and configured for Firebase Hosting.

```bash
npm run build
npx firebase-tools deploy --only hosting     # or: firebase deploy --only hosting
```

Three things in that config are load-bearing:

- **The `**` → `/index.html` rewrite.** Without it every deep link 404s. A trainer who bookmarks
  an athlete, or reloads the page mid-session, gets a Firebase error page instead of the app —
  and mid-session is exactly when a reload happens, because that is when the phone is in a hand.
- **`index.html` is `no-cache`, `/assets/**` is immutable for a year.** The asset filenames are
  content-hashed, so they can be cached forever; the HTML that points at them cannot be, or a
  trainer keeps running last week's build until they clear Safari.
- **`/sw.js` is `no-cache`.** It is how the installed app learns a new build exists; cached, the
  app would serve last week's build until the cache expired.
- **Dotfiles are not ignored**, so `/.well-known/assetlinks.json` deploys. Firebase's default ignore list
  drops it, and the Play Store app then shows a browser URL bar.

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are read at *build* time and end up in the
bundle. That is correct for an anon key — it is public by design and RLS is what protects the
data — but it does mean changing projects means rebuilding, not reconfiguring.

Any other static host works the same way; the rewrite is the only thing that needs translating
(Netlify `_redirects`, Vercel `rewrites`, an nginx `try_files`). Failing that,
`VITE_HASH_ROUTER=1` moves routing into the fragment and needs no server config at all — it is
what the single-file preview build uses.

## Milestones

| | | |
|---|---|---|
| M0 | Week 0 | Photograph the real sheets; transcribe the roster and the exercise names *as trainers write them, in Greek*. No code. |
| **M1** | **Week 1** | **Schema + RLS, email-OTP auth, token layer, app shell. Gate: the two-device airplane-mode test.** |
| M2 | Week 2 | The Workout Log, and nothing else. Gate: a real workout logged with a stopwatch, no set over 8 seconds. |
| M3 | Week 3 | Briefing Card, roster, Finish sheet, invite redemption — then install day in the gym. |
| M4 | Weeks 4–5 | Paper-parallel pilot. Kill criterion: 90% of PT sessions in the app within 24h. |
| M5 | Week 6 | Service worker, Supabase Pro, print sheet, scoped export, privacy notice, handover. |
| M6 | Week 7+ | Calendar, Team, Library, Progress charts, English locale — the rest of the nine-screen scope. |

## Repository layout

```
supabase/migrations/   001_init.sql — schema, triggers, RLS, apply_ops, redeem_invite
                       002_seed_catalogue.sql — the shared bilingual exercise catalogue
                       003_muscle_groups.sql — the muscle taxonomy and exercise↔muscle links
                       012_athlete_accounts.sql — athlete links, the athlete's read, account deletion
supabase/functions/    delete-account — the one place the service_role key is used (auth.users only)
src/domain/            types (the contract), analytics, Greek text handling, parsing, formatting
src/data/              supabase client, query client + persister, the outbox, id minting
src/auth/              sign-in (password, Google/Microsoft, sign-up, email code), staff vs athlete resolution
src/theme/             the token contract, ThemeProvider, the theme-parity test
src/styles/            reset, shared tokens, themes/daylight.css, themes/slate.css
src/i18n/              el (default) and en resources
src/screens/           the staff screens; me/ — the athlete panel; account/ — shared account controls
src/pwa/               service worker registration and the update signal
public/                manifest, icons, privacy.html, delete-account.html, .well-known/assetlinks.json
android/               the Play Store runbook (Bubblewrap, asset links, listing, forms)
tests/e2e/             smoke, a11y and tap-budget — the gates CI runs on every push
                       two-device.spec.ts — the M1 gate, needs a real Supabase project
firebase.json          static hosting config; see Deploying
```

## Notes on the design handoff

The handoff package (`trainhub_web_handoff/`) is the visual and behavioural spec, with three caveats found
while porting it:

- Every file in `screens/` is a **JPEG with a `.png` extension**. `workout-log.png` is byte-identical to
  `athlete-detail.png`, and `calendar.png` / `library.png` are stale copies of the Athletes list from older
  builds. There is no visual reference for the Workout Log at all — use the running prototype, not the PNGs.
- The prototype's `createExercise` never sets `nameEl`, so every trainer-added exercise was English-only.
  Fixed here: creating an exercise asks for the Greek name and treats English as optional.
- The accent-ink rule `lum(hex) > 0.45` is not the WCAG crossover (which is near 0.179) and puts white on
  Slate's `#84A0D6` at 2.63:1, below the 4.5:1 floor. Both themes now set their accent ink explicitly.
