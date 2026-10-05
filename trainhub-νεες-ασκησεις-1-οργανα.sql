-- 010 — the tools on PowerHouseGym's own exercise list join the equipment enum.
--
-- The gym wrote its list by tool: squats with a trap bar or on a Bosu, hip
-- thrusts with a sandbag, curls with the EZ-bar, dips on a box or on the
-- Equalizer bars. None of those had a value, and recording them as 'other' or
-- 'barbell' is exactly the misreading equipment exists to prevent — 60 kg on a
-- trap bar is not 60 kg on a straight bar, and the coach loading it has to know
-- which one the number was.
--
-- A file of its own, and run on its own, because a new enum value cannot be
-- USED in the transaction that adds it (Postgres 12+). 011 uses these values,
-- and the Supabase SQL editor runs a pasted script as one transaction — so
-- this one is pasted and run first, then 011.
--
-- IF NOT EXISTS makes it re-runnable, like every migration after 001.

alter type public.equipment add value if not exists 'ez_bar';
alter type public.equipment add value if not exists 'trap_bar';
alter type public.equipment add value if not exists 'sandbag';
alter type public.equipment add value if not exists 'bosu';
alter type public.equipment add value if not exists 'box';
alter type public.equipment add value if not exists 'equalizer';
