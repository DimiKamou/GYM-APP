-- Minimal stand-in for the parts of a Supabase project the migration assumes exist.
create extension if not exists citext;
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

-- A "must FAIL" step that merely prints ERROR proves nothing to a script: psql
-- with ON_ERROR_STOP off exits 0 either way, and check 2 of the RLS suite sat
-- green for months while its INSERT was quietly being allowed. This runs the
-- statement as whoever the session currently is (SECURITY INVOKER, so RLS sees
-- `authenticated` and its JWT claim) and turns the outcome into one line the
-- harness can grep: refused → «σωστό», allowed → «ΛΑΘΟΣ».
--
-- Only the ways the schema refuses things count as refusal: a policy (42501,
-- also column grants), a CHECK or guard trigger (23514), a unique or foreign
-- key (23505, 23503), a `raise exception` in a function (P0001). A typo in the
-- statement itself (undefined column, syntax) propagates, so a broken test
-- cannot pass as a refusal. Zero rows matched is the other honest refusal,
-- for UPDATE and DELETE only: a policy's USING clause filters the row out and
-- raises nothing at all. It is not one for anything else — a DO block or an
-- INSERT reports 0 rows on success, and a migration that quietly returned
-- instead of raising would otherwise pass as "refused".
create schema if not exists tests;
create or replace function tests.must_fail(stmt text) returns text
language plpgsql
as $$
declare
  affected bigint;
  verb     text := lower(substring(stmt from '^\s*(?:--[^\n]*\n\s*)*(\w+)'));
begin
  execute stmt;
  get diagnostics affected = row_count;
  if affected = 0 and verb in ('update', 'delete') then
    return 'refused (0 rows matched): σωστό';
  end if;
  return 'ΛΑΘΟΣ: was allowed — ' || verb || ' ran, ' || affected || ' row(s)';
exception
  when insufficient_privilege or check_violation or unique_violation
    or foreign_key_violation or raise_exception then
    return 'refused (' || sqlstate || '): σωστό — ' || sqlerrm;
end;
$$;
grant usage on schema tests to authenticated, anon, service_role;
