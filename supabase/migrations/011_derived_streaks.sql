-- 011_derived_streaks.sql
--
-- Streaks become derived rather than stored (TAD ADR-016).
--
-- `murajaah_log.streak_count` and its `fn_set_streak_count` trigger date
-- from migration 002, where they were written with an explicit caveat:
-- "Simplified daily model; '3x_week' and 'weekly' frequencies count
-- consecutive *scheduled* periods — refine in function layer if
-- per-frequency streaks are required." Milestone 7 is where that
-- refinement was due, and doing it properly removes the column's reason
-- to exist rather than changing what it holds.
--
-- Two things were wrong with a stored count, and only one of them could
-- have been fixed in place:
--
--   1. It only ever changed on INSERT. A row from three days ago reading
--      streak_count = 7 described a run that had already been broken,
--      and nothing in the database could know. The original plan was a
--      nightly `calculate-streak-resets` job to go and zero those rows.
--   2. It counted *days*, but a target carries a `frequency`. A
--      '3x_week' target confirmed every Monday, Wednesday and Friday for
--      a year had a stored streak of 1 — no two confirmations were ever
--      on consecutive days.
--
-- `computeStreak` in `src/lib/murajaah.ts` answers both from the log
-- itself, in the period the frequency actually asks for, at read time.
-- A derived streak cannot go stale, so the scheduled job is not built
-- either; ADR-016 records both as superseded.
--
-- Nothing reads the column after this migration: the family view and the
-- confirmation timeline both derive it, and no pgTAP case, report or
-- Function ever referenced it. It is dropped rather than left in place
-- so there is no second, wrong answer to "what is this child's streak"
-- sitting in the table for a future query to find.

drop trigger if exists trg_murajaah_streak on public.murajaah_log;
drop function if exists public.fn_set_streak_count();
alter table public.murajaah_log drop column if exists streak_count;
