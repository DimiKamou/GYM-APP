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
