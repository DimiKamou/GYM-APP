-- 005 — `smith` joins the equipment enum.
--
-- The gym asked for the όργανο to be visible when logging: αλτήρες, μπάρα,
-- smith, kettlebells, σωματικό βάρος. Everything on that list was already in
-- public.equipment except the Smith machine, which until now could only be
-- recorded as the generic 'machine'.
--
-- It earns its own value rather than staying 'machine' because a coach reading
-- back "Πιέσεις Στήθους · μηχάνημα" cannot tell whether that was a chest press
-- machine or a Smith rack, and the load means something different in each. The
-- point of storing equipment at all is to stop two numbers that are not
-- comparable from looking comparable.
--
-- ALTER TYPE ... ADD VALUE is transaction-safe from Postgres 12 onward as long
-- as the new value is not USED in the same transaction. Nothing here uses it,
-- so this migration is safe inside the combined setup file.
--
-- IF NOT EXISTS makes it re-runnable, like every other migration after 001.

alter type public.equipment add value if not exists 'smith';
