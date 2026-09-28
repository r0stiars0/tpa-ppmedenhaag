-- ============================================================
-- 031 — Add the Pemula level ahead of Jilid 1, and correct every
-- jilid's page_count to the real Yanbu'a edition (ADR-048)
--
-- PPME's physical Yanbu'a set has an eighth, unmodelled level before
-- Jilid 1 — "Pemula" — and migration 030's continuous-page backfill
-- used a placeholder of 44 pages for every jilid (004_seed_data.sql's
-- own open question), not the real counts. Both are corrected here,
-- confirmed against the physical book:
--   Pemula 1-50, Jilid 1 51-96, Jilid 2 97-142, Jilid 3 143-188,
--   Jilid 4 189-236, Jilid 5 237-286, Jilid 6 287-336, Jilid 7 337-386.
-- i.e. page_count: Pemula 50, Jilid 1-3 46 each, Jilid 4 48,
-- Jilid 5-7 50 each.
--
-- Three steps, in order:
-- ============================================================

-- (1) Undo migration 030's backfill, using yanbua_jilid exactly as it
-- stands right now (page_count = 44 for every jilid, no Pemula row) —
-- the same values 030 itself used — to recover each row's original,
-- tutor-entered, per-jilid-local page number.
update public.yanbua_progress p
set page = p.page - coalesce(
  (select sum(j.page_count) from public.yanbua_jilid j where j.jilid < p.jilid),
  0
)
where p.jilid > 1;

-- (2) Bring yanbua_jilid up to the real edition: widen the check
-- constraint to admit jilid 0 (Pemula), add it, and correct every
-- existing page_count.
alter table public.yanbua_jilid drop constraint yanbua_jilid_jilid_check;
alter table public.yanbua_jilid add constraint yanbua_jilid_jilid_check check (jilid between 0 and 7);

insert into public.yanbua_jilid (jilid, page_count, label_id, label_nl) values
  (0, 50, 'Pemula', 'Pemula');

update public.yanbua_jilid set page_count = 46 where jilid = 1;
update public.yanbua_jilid set page_count = 46 where jilid = 2;
update public.yanbua_jilid set page_count = 46 where jilid = 3;
update public.yanbua_jilid set page_count = 48 where jilid = 4;
update public.yanbua_jilid set page_count = 50 where jilid = 5;
update public.yanbua_jilid set page_count = 50 where jilid = 6;
update public.yanbua_jilid set page_count = 50 where jilid = 7;

-- (3) Reapply the continuous backfill using the now-correct
-- yanbua_jilid (Pemula included), for every jilid >= 1 this time —
-- unlike step (1)/migration 030, jilid 1 rows now need the Pemula
-- offset too, since Pemula is no longer absent from the cumulative sum.
update public.yanbua_progress p
set page = p.page + coalesce(
  (select sum(j.page_count) from public.yanbua_jilid j where j.jilid < p.jilid),
  0
)
where p.jilid >= 1;
