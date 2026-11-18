-- ============================================================
-- TPA PPME Den Haag — ROLLBACK for migration 032 (TAD ADR-049)
--
-- NOT a migration. It lives outside supabase/migrations/ on purpose so
-- `supabase db push` / `db reset` never apply it. Run it by hand, only
-- if migration 032 has to be undone on a live database:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollback/032_edit_progress_records.down.sql
--
-- Revert the frontend (the PR merge) first or together with this: the
-- Yanbu'a/Quran screens call `fn_progress_authors` and write through the
-- UPDATE policies dropped below, so the old UI is the one that matches a
-- rolled-back database.
--
-- ── What is lost ──────────────────────────────────────────────
-- Only the edit markers: `edited_at` / `edited_by` are dropped with their
-- data, so every entry stops saying it was edited and by whom. The
-- corrected content itself (jilid, page, mastery, notes, surah, ayah
-- range, quality, tajweed notes) is NOT touched — an entry stays as it
-- was last edited. Entries and their recorders are untouched.
--
-- ── What is restored ──────────────────────────────────────────
-- Migration 007's table-level UPDATE grant on both tables (which 032
-- narrowed to a column list), so admin's `*_admin_all` policy behaves as
-- it did before 032. Tutors go back to INSERT + SELECT only: no UPDATE
-- policy remains for them.
--
-- Idempotent: safe to run twice. One transaction: all or nothing.
-- ============================================================

begin;

-- ---------- names ----------
drop function if exists public.fn_progress_authors(uuid);

-- ---------- edit marker ----------
drop trigger if exists trg_yanbua_mark_edited on public.yanbua_progress;
drop trigger if exists trg_quran_mark_edited  on public.quran_progress;
drop function if exists public.fn_yanbua_mark_edited();
drop function if exists public.fn_quran_mark_edited();

-- ---------- UPDATE policies ----------
drop policy if exists yanbua_tutor_update on public.yanbua_progress;
drop policy if exists quran_tutor_update  on public.quran_progress;

-- ---------- grants: back to 007's table-level UPDATE ----------
-- REVOKE at table level also clears the column-level grants 032 made.
revoke update on public.yanbua_progress from anon, authenticated;
revoke update on public.quran_progress  from anon, authenticated;
grant  update on public.yanbua_progress to anon, authenticated;
grant  update on public.quran_progress  to anon, authenticated;

-- ---------- columns ----------
alter table public.yanbua_progress drop column if exists edited_at, drop column if exists edited_by;
alter table public.quran_progress  drop column if exists edited_at, drop column if exists edited_by;

commit;
