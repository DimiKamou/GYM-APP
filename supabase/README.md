# TrainHub — Supabase backend

Two migrations, applied in order, are the whole backend. There is no server
code: the browser talks to PostgREST, and every rule about who may read or
write what is a policy, a constraint or a trigger inside `001_init.sql`.

| file | what it is |
| --- | --- |
| `migrations/001_init.sql` | types, tables, triggers, functions, RLS, grants |
| `migrations/002_seed_catalogue.sql` | the 28-exercise bilingual catalogue and its Greek aliases |

---

## 1. Whose account this lives in

**Create the project in an account the gym owner controls.** Not a developer's
personal account, not a trainer's, not an agency's.

The project holds every athlete's name, phone, birth date and injury history,
and it holds the billing relationship. If it lives in someone else's account
then the gym's records are only available for as long as that relationship
stays friendly, and the day it does not, there is no recovery path — Supabase
has no concept of "the real owner of this data". Recovering a project from a
departed contractor means asking them nicely.

Practically:

1. The owner signs up at supabase.com with the gym's own email address
   (`info@ironlab.gr`, not a personal Gmail) and the gym's card.
2. The owner creates the organisation and the project.
3. Developers are added to the organisation as members afterwards, and can be
   removed afterwards.
4. Add a second organisation owner — a co-owner or the accountant. A single
   account with a single 2FA device is one lost phone away from a locked door.

---

## 2. Region: `eu-central-1` (Frankfurt)

Pick it at project creation. **The region cannot be changed later** without
creating a new project and migrating the data.

Three reasons, in the order that will matter to you:

- **Latency.** Athens ↔ Frankfurt is roughly 35–50 ms round trip; Athens ↔
  `us-east-1` is 140–180 ms. TrainHub writes one row per set, while a coach is
  standing at the rack between sets with a phone in one hand. The difference
  between those two numbers is the difference between a UI that feels like
  paper and one that feels like a website.
- **The data is health data.** Athlete rows carry a birth date, a phone number
  and notes like *"Προσοχή στον αριστερό ώμο"*. Under GDPR that is personal
  data about EU residents, some of it arguably health-related. Keeping it in an
  EU region means there is no third-country transfer to justify, no SCCs to
  sign, and nothing to explain to an athlete who asks where their record is.
- **It is the closest EU region on offer.** There is no Athens region.
  Frankfurt is the shortest network path of the European options.

---

## 3. Applying the migrations

### With the Supabase CLI (preferred — it records what has been applied)

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

### From the dashboard

SQL Editor → paste `001_init.sql` → Run → paste `002_seed_catalogue.sql` → Run →
paste `003_muscle_groups.sql` → Run.
**In that order.** `002` inserts into tables `001` creates, and `003` maps the
28 exercises `002` seeds onto the muscle groups it creates.

### Verify

```sql
select count(*) from public.exercises where gym_id is null;        -- 28
select count(*) from public.exercise_aliases where gym_id is null; -- 108
select count(*) from public.muscle_groups where gym_id is null;    -- 16
select count(*) from public.exercise_muscles;                      -- 76
select count(*) from pg_policies where schemaname = 'public';      -- 44

-- Nothing in the shared catalogue may be unfindable in the picker: an exercise
-- with no primary muscle group falls out of every group heading.
select count(*) from public.exercises e
 where e.gym_id is null and e.deleted_at is null
   and not exists (select 1 from public.exercise_muscles em
                    where em.exercise_id = e.id and em.role = 'primary');
                                                                   -- 0
select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
                                                                   -- must be empty
```

That last query is the one worth keeping. A table without RLS in a Supabase
project is world-readable to anyone holding the anon key, which is compiled
into the JavaScript bundle and therefore public by construction.

`002` and `003` are idempotent — re-running either refreshes its seed in place.
`001` is not, and is not meant to be; it runs once.

### After the migrations

- **Settings → API → Exposed schemas**: leave it as `public`. Do **not** add
  `app`. `app.my_gym()` and friends are the machinery the policies are built
  from; exposing them gains the client nothing and hands an attacker a probe.
- **Settings → Database → Backups**: turn on daily backups, and Point-in-Time
  Recovery if the plan allows. The paper sheet this replaces had exactly one
  copy, which was the problem.

---

## 4. Auth: email OTP with a real sender

TrainHub uses **email one-time codes**. No passwords: a shared gym password is
how the paper sheet's attribution problem gets recreated in software, and a
per-trainer password is a thing trainers forget and reset from the front desk.

### Dashboard → Authentication → Providers → Email

- **Enable Email provider**: on.
- **Confirm email**: on (OTP is a confirmation by construction).
- **Enable email signups**: **on**. This is not the hole it looks like. A
  freshly signed-up account has no `memberships` row, so `app.my_gym()` returns
  null, so every policy in the database evaluates false and the account can see
  precisely nothing. It becomes a trainer only by redeeming an invite. Turning
  signups off would break the invite flow, because the invitee has to have an
  account before they can redeem anything.
- **OTP expiry**: 3600 s or less. Supabase's security advisor flags anything
  longer.
- **OTP length**: 6.

### Dashboard → Authentication → URL Configuration

- **Site URL**: the deployed PWA origin (`https://trainhub.ironlab.gr`).
- **Redirect URLs**: that origin plus `http://localhost:5173` for development.
  Anything not on this list is refused, silently, at the moment a coach clicks
  the link in their inbox.

### Dashboard → Project Settings → Authentication → SMTP Settings

**Configure a real transactional sender before anyone but you uses the app.**

Supabase's built-in email is explicitly a development convenience: it is rate
limited to a handful of messages per hour per project, it sends from a shared
domain whose reputation you do not control, and it will land in Gmail's spam
folder often enough to matter. The failure mode is a trainer standing at the
door at 06:55 who never receives a code, and the app looks broken rather than
misconfigured.

Use one of:

| provider | note |
| --- | --- |
| **Resend** | simplest setup, EU region available |
| **Postmark** | best deliverability for transactional mail |
| **Amazon SES** (`eu-central-1`) | cheapest at volume, needs a production-access request |
| **Mailgun EU** | fine, EU region available |

Whichever you pick:

1. Verify the gym's own sending domain (`ironlab.gr`), not a subdomain of the
   provider.
2. Publish **SPF** and **DKIM** DNS records, and a **DMARC** record at
   `p=none` to start. Without these, Greek recipients on Gmail, Outlook and
   Yahoo will get the code in spam or not at all.
3. Sender name/address: `Iron Lab <noreply@ironlab.gr>`.
4. Prefer the provider's EU endpoint, for the same reason as the database
   region.

### Dashboard → Authentication → Rate Limits

Raise "Emails per hour" to something a real gym uses — a dozen trainers signing
in on a Monday morning exceeds the default. The limit only applies once your
own SMTP is configured; before that Supabase's cap applies regardless.

### Templates

Rewrite the Magic Link / OTP template in **Greek**. The default English one is
the first thing a new trainer sees, and it is where an app that is otherwise
entirely in Greek loses their trust.

---

## 5. Environment variables

`.env.local` at the repository root, from `.env.example`:

| variable | where to find it | notes |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Settings → API → Project URL | `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Settings → API → Project API keys → `anon` `public` | safe in the bundle; RLS is what protects the data |
| `VITE_OFFLINE_FIXTURE` | — | set to `1` to run the UI against in-memory fixtures with no backend at all |

**Never put the `service_role` key in a `VITE_` variable, or in this repository
at all.** Everything prefixed `VITE_` is inlined into the JavaScript bundle and
served to every visitor. The `service_role` key bypasses row-level security
completely; publishing it publishes every gym's entire database. If it is ever
pasted into a client file, rotate it in Settings → API immediately — removing
the file is not enough, it was served.

---

## 6. First run

### Create the gym and its owner

`bootstrap_gym()` is the only way a `gyms` row can be created — there is no
INSERT policy on that table — and it creates the gym and the owner membership
in one transaction, so a gym without an owner cannot exist.

It reads `auth.uid()`, which means **it must be called with the owner's JWT**,
from the app. The dashboard SQL editor runs as `postgres` with no JWT and will
get `sign in first`.

1. The owner signs in to the deployed app with their email code.
2. The app calls:

```ts
const { data, error } = await supabase.rpc('bootstrap_gym', {
  p_name: 'Iron Lab',
  p_display_name: 'Δημήτρης Κ.',
  p_timezone: 'Europe/Athens',
})
```

If you must do it from the dashboard instead — because the onboarding screen
does not exist yet — the equivalent as `postgres`, with the owner's `auth.users`
id in hand:

```sql
with g as (
  insert into public.gyms (name, timezone) values ('Iron Lab', 'Europe/Athens')
  returning id
)
insert into public.memberships (gym_id, user_id, display_name, email, role, status)
select g.id, '<auth.users.id>', 'Δημήτρης Κ.', 'dimitris@ironlab.gr', 'owner', 'active'
from g;
```

### Invite the other trainers

There is **no gym-wide invite code**. The prototype had one (`TRAIN-2026`):
plaintext, printed in the UI, never expiring, editable by any trainer, and
therefore un-revocable — you cannot take it back from a departing coach without
locking out everyone else who has it. It is gone.

In its place, per-recipient invites:

```sql
-- as the owner, from the app:
select public.create_invite('maria@ironlab.gr', 'trainer');
-- => {"id": "...", "secret": "9f3c…", "expires_at": "..."}
```

The `secret` is 128 bits of CSPRNG output and is returned **exactly once**.
Only its SHA-256 is stored, so nobody — not the owner, not a database dump, not
a leaked backup — can read it back. Send it as a link:
`https://trainhub.ironlab.gr/join#<secret>`.

The recipient signs in with their own email, and the app calls
`redeem_invite(secret)`. Every way that can fail — wrong secret, expired, used,
revoked, addressed to someone else — returns the same message, `invalid or
expired invite`, so the endpoint cannot be used to discover which invites or
gyms exist.

Invites default to single-use and 14 days. `revoke_invite(id)` kills one
immediately; `list_invites()` shows the pending ones (and cannot return the
hashes). There is no RLS policy on `public.invites` for any client role at all,
so these four functions are the only doors.

---

## 7. What is enforced, and where

Worth knowing before changing anything, because a lot of it is not where you
would guess.

| rule | enforced by |
| --- | --- |
| a client only ever sees its own gym | RLS `USING (gym_id = app.my_gym())` on every table |
| a child row cannot be re-parented into another gym | composite FKs `(gym_id, parent_id)` |
| `sessions.logged_by` is who actually typed it | `sessions_stamp_author()` overwrites whatever the client sent |
| …and can never be edited afterwards | `sessions_guard_immutable()` |
| trainers may not delete athletes | an **`AS RESTRICTIVE`** UPDATE policy |
| nobody may hard-delete anything | no DELETE policy on any table, plus `revoke delete` |
| the global exercise catalogue is read-only | SELECT allows `gym_id is null`, INSERT/UPDATE demand `gym_id = app.my_gym()` |
| the shared muscle-group taxonomy is read-only | the same asymmetry on `muscle_groups` |
| trainers may not archive a muscle group | an **`AS RESTRICTIVE`** UPDATE policy on `muscle_groups` |
| a gym cannot file another gym's exercise under a group | `exercise_muscles_stamp_scope()` stamps the parents' gyms, then a CHECK compares them |
| a note's body cannot be rewritten | a column-level `GRANT UPDATE (pinned, dismissed_at, dismissed_by)` |
| the audit trail cannot be forged | `revoke insert on session_events`; only the SECURITY DEFINER trigger writes it |
| a device with a wrong clock cannot win every merge | `touch_updated_at()` clamps timestamps >2 min in the future |
| a coach's offline batch is not lost because one op is bad | `apply_ops()`, one subtransaction per op |
| replaying a batch after a lost response does nothing | `applied_ops`, keyed on the client-minted `op_id` |

Two of these are worth spelling out because they are easy to break:

**Owner-only rules must be `AS RESTRICTIVE`.** Permissive policies on the same
table and command are OR'd. Adding a second permissive policy that says "only
owners" does not restrict anything: a trainer fails the new policy, passes the
old one, and the OR makes it true. It fails open, silently, and it tests green
if you only test the happy path.

**Assignment is a filter, never a fence.** `athletes.coach_membership_id`
appears in no policy. Trainers rotate across the same athlete — that is the
entire product — so any active member may log for any athlete. The assignment
is a default for the UI and a reporting dimension, nothing more.

---

## 8. Muscle groups (`003_muscle_groups.sql`)

The gym owner's request was "κατηγοριοποιημένες όταν πάω να κάνω προσθήκη
άσκησης στο session" — the picker inside a live workout, grouped by μυϊκή
ομάδα, with a trainer able to file a new exercise into a group without leaving
the log. Two tables carry that.

### `muscle_groups`

| column | notes |
| --- | --- |
| `gym_id` | `NULL` = the shared taxonomy every gym reads and no client writes. Non-null = this gym's own group. |
| `slug` | The canonical comparison form `normalizeText()` produces — lowercase, accentless, **final sigma folded**. `Στήθος` is stored as `στηθοσ`. |
| `name_el` / `name_en` | Greek is `NOT NULL`; English is the fallback. |
| `region` | The existing `public.exercise_category` enum. |
| `position` | Display order, so Στήθος does not sort after Τρικέφαλοι. |

The sixteen shared groups, in display order: Στήθος, Πλάτη, Ώμοι, Δικέφαλοι,
Τρικέφαλοι, Τραπεζοειδείς, Τετρακέφαλοι, Οπίσθιοι Μηριαίοι, Γλουτοί, Γάμπες,
Προσαγωγοί, Κοιλιακοί, Ραχιαίοι, Σταθεροποίηση, Καρδιοαναπνευστικό,
Κινητικότητα.

### `exercise_muscles`

`(exercise_id, muscle_group_id)` with `role in ('primary','secondary')`, keyed
on the pair. A bench press is chest **primary** and triceps plus front delts
**secondary**; a single column on `exercises` would force that row to lie, and
"how much chest work has this athlete done" is exactly the question the grouping
exists to answer — it needs the role, or every accessory movement counts as
chest work.

`exercises.category` is untouched and stays. It is the coarse body region, it is
on every historical block, and `bodyPartShare()` is built on it. Muscle groups
are an additional, finer axis, and `muscle_groups.region` maps each group back
onto the same enum so the two can never disagree about which half of the body a
group belongs to.

### How a gym adds its own group

Any active member may do it; only the owner may archive one.

`app` is not an exposed schema, so from the client send the gym id literally;
`app.my_gym()` below is the SQL-editor shorthand for the same value.

```sql
-- as any active trainer
insert into public.muscle_groups (gym_id, slug, name_el, name_en, region, position)
values (app.my_gym(), 'περιστροφεισ ωμου', 'Περιστροφείς Ώμου', 'Rotator cuff', 'upper', 20);

-- then file an exercise into it. gym_id is the MAPPING's tenancy; the two
-- scope columns are stamped by the server, never sent by the client.
insert into public.exercise_muscles (exercise_id, muscle_group_id, role, gym_id)
values ('<an exercise>', '<the group>', 'primary', app.my_gym());
```

The group may be a shared one and the exercise a gym-owned one — that is the
headline case, a trainer filing "Πιέσεις με λάστιχο" under Στήθος. What is
refused is pointing at *another gym's* row: `exercise_muscles_stamp_scope()`
looks the parents up as `SECURITY DEFINER` and writes `exercise_gym_id` /
`muscle_gym_id` from them, so a client cannot claim a parent it does not own,
and `exercise_muscles_exercise_scope` then rejects the row. The composite FKs
`(exercise_gym_id, exercise_id)` and `(muscle_gym_id, muscle_group_id)` sit
behind that and stop a parent from ever being re-parented out from under a
mapping.

Archiving is `deleted_at`, owner-only, and enforced by an **`AS RESTRICTIVE`**
policy — as a plain second permissive policy it would be OR'd with
`muscle_groups_update` and silently do nothing.

---

## 9. Running the schema locally

You do not need a Supabase project to test the schema. Any Postgres 15+ works
once you stub the two things Supabase supplies:

```sql
create schema if not exists auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated;
```

Then apply `001` and `002`, and impersonate a coach:

```sql
begin;
  set local request.jwt.claim.sub = '<an auth.users id>';
  set local role authenticated;
  select app.my_gym(), app.my_role();
  -- everything from here behaves exactly as it will through PostgREST
commit;
```

This is the fastest way to check a policy change. A policy that is wrong in the
permissive/restrictive direction produces no error anywhere — the write just
succeeds when it should not — so testing the *denials* is the only way to know.

---

## 10. Things that will bite you

- **An UPDATE filtered out by RLS raises nothing.** It matches zero rows and
  reports success. `apply_op()` turns that into a rejection on purpose; client
  code that writes directly must check the returned row count, or it will drop
  edits from its outbox that never landed.
- **`sessions.local_date` is derived, not supplied.** It comes from
  `started_at` at the *gym's* timezone, so a session logged at 00:30 Athens
  time files under that day and not the UTC one. Changing `gyms.timezone` does
  not retro-fix existing rows.
- **Patching a note means patching only `pinned` / `dismissed_at` /
  `dismissed_by`.** `authenticated` has UPDATE on those three columns and no
  others, so `.update({ pinned: false })` works and `.update(wholeNoteObject)`
  is refused outright — PostgREST sends every key you hand it, including the
  unchanged `body`. Same shape of trap on `gyms`, where only `name`,
  `timezone` and `display_unit` are granted.
- **Every read must filter `deleted_at is null`.** Deletion is soft, because a
  hard delete is invisible to sync: the offline device still holds the row and
  re-inserts it on the next flush.
- **`apply_ops` is `SECURITY INVOKER` deliberately.** Do not "fix" it to
  DEFINER for convenience. As INVOKER, the offline flush and a live edit go
  through the identical policies, so there is exactly one answer to "may this
  coach write this row" instead of two that drift.
- **Two shared groups have no primary exercise.** Nothing in the 28-exercise
  catalogue is traps-primary or adductors-primary, so a picker that groups by
  `role = 'primary'` alone renders Τραπεζοειδείς and Προσαγωγοί empty. Render
  the secondary members under the heading too (after the primaries), or those
  two groups look broken.
- **`exercise_muscles` is keyed on the pair, not per gym.** Two gyms cannot each
  file the same shared exercise under the same shared group with different
  roles — the second one hits a primary-key violation on a row it cannot see.
  It does not arise for a gym's own exercises, which is where gym-added mappings
  actually live, but a client writing mappings onto *shared* exercises must
  treat `23505` as "already filed" rather than surfacing it.
- **Do not enable `FORCE ROW LEVEL SECURITY` on `memberships`.** Forcing RLS on
  the table owner re-arms the policy recursion that `app.my_gym()` exists to
  break, and every query in the app starts failing with "infinite recursion
  detected in policy".
