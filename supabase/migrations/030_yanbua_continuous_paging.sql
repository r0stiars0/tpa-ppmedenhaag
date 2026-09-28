-- ============================================================
-- 030 — Yanbu'a page numbering is continuous across jilid, not reset
-- per jilid (ADR-047)
--
-- The real Yanbu'a book numbers pages continuously across all 7 jilid:
-- jilid 2's first page is jilid 1's last page_count + 1, not page 1
-- again. `yanbua_progress.page` and `isJilidComplete()`
-- (`src/lib/yanbua.ts`) previously assumed the opposite — page reset to
-- 1 at the start of every jilid and was checked against that jilid's
-- own `page_count` in isolation. The app and the shared completion rule
-- are fixed in the same change as this migration; every existing row
-- was recorded under the old (per-jilid) assumption and needs
-- backfilling to the continuous scheme so history stays consistent
-- with newly recorded rows (PRD Resolved Decision #15, sequencing
-- Decision A(a): backfill now, against whatever `yanbua_jilid` holds).
--
-- The offset for a row is the sum of `page_count` for every jilid below
-- it, read from `yanbua_jilid` as it stands right now. `yanbua_jilid`'s
-- page_count values are themselves still a placeholder (44 for every
-- jilid — see 004_seed_data.sql's open question / PRD Open Question #3
-- "Yanbu'a Curriculum Variants", to be verified against PPME's actual
-- edition before launch); per Decision B(a), this migration is not
-- blocked on that — if those values are corrected before this runs,
-- the offsets below will already reflect the corrected counts, and if
-- they're corrected after, a follow-up backfill will be needed then.
-- Jilid 1 rows are untouched (offset 0, already continuous from page 1).
-- ============================================================

update public.yanbua_progress p
set page = p.page + coalesce(
  (select sum(j.page_count) from public.yanbua_jilid j where j.jilid < p.jilid),
  0
)
where p.jilid > 1;
