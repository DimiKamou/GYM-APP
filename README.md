# TrainHub

A web app that replaces the shared paper PT sheet at a gym. Installable from a URL — no app store,
no iOS/Android split, one link for every trainer.

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
| Auth | Email OTP. Deliberately **not** Google OAuth — see below |
| Data | TanStack Query with a persisted read cache, plus an idempotent write outbox |
| State | Zustand for ephemeral UI state only; server state belongs to Query |
| i18n | i18next — **Greek is the default**, English is the fallback |
| Charts | Hand-rolled inline SVG, as in the prototype. No chart library |
| PWA | Static manifest now; service worker in M5 (see below) |

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

## Why the service worker is not here yet

A service worker's job is to serve cached assets. During a live pilot that means serving a trainer the bug
you fixed an hour ago while you stare at a green deploy. Being able to fix a fumble at 09:15 and have it
live for the 09:30 client is the strongest argument for choosing the web at all, and a premature service
worker takes it away.

The **manifest** ships now — that is the entire no-app-store premise. `vite-plugin-pwa` is installed and
gets wired in M5, once the code stops changing daily, with the waiting worker held until the outbox drains.

## Running it

```bash
npm install
npm run dev
```

That is the whole setup. **No Supabase project is required to run the app.** With no credentials
configured it starts against a local IndexedDB repository seeded with a realistic gym — Iron Lab,
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
src/domain/            types (the contract), analytics, Greek text handling, parsing, formatting
src/data/              supabase client, query client + persister, the outbox, id minting
src/auth/              email-OTP auth, membership + gym resolution
src/theme/             the token contract, ThemeProvider, the theme-parity test
src/styles/            reset, shared tokens, themes/daylight.css, themes/slate.css
src/i18n/              el (default) and en resources
src/screens/           the nine screens
tests/e2e/             two-device.spec.ts — the M1 gate
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
