-- ============================================================
-- TPA PPME Den Haag — Migration 016: year_end_reports write boundary
--
-- Closes two findings with a shared root cause, TAD ADR-034.
--
-- ── The shared root cause ─────────────────────────────────────
-- `yer_tutor_rw` (migration 013) is `for all` and gates only
-- `student_id`. RLS is row-scoped, never column-scoped, so every column
-- a tutor's USING/WITH CHECK let them reach was theirs to write —
-- including the four that encode publication state and integrity rather
-- than authored content: `status`, `pdf_path`, and the attendance
-- snapshot `generate-year-end-drafts` computes. A tutor could publish
-- their own report with no PDF behind it (bypassing publish-report's
-- narrative gate and firing the real "report ready" push), repoint
-- `pdf_path` at another family's deterministic object, falsify the
-- attendance snapshot, or delete the row outright — all four verified
-- against a disposable local Postgres.
--
-- The fix is the same technique migration 012 already established for
-- `notifications`: narrow the grant to the eight columns a tutor
-- actually authors, which are exactly the `ReportEdit` type in
-- `src/features/reports/api.ts`. No policy predicate changes — the row-
-- level rule in `yer_tutor_rw`, and migration 013's self-exclusion
-- (`fn_my_recordable_students()`, ADR-023) inside it, are untouched.
--
-- ── Why this also narrows admin ───────────────────────────────
-- `authenticated` is the one Postgres role every signed-in session
-- connects as — admin included, per `netlify/functions/lib/callerAuth.ts`
-- and `fn_is_admin()` reading `public.users.role`. The revoke below
-- therefore narrows what admin's own session can write directly, too.
-- That costs nothing real: `publish-report.mts` already 403s any caller
-- whose id is not the report's `tutor_id`, so admin never legitimately
-- wrote `status`/`pdf_path`/`published_at` through any route this app
-- offers (ADR-013, kept by ADR-014). What admin keeps is exactly
-- ADR-014(e)'s promise — full content editing (the eight granted
-- columns) of both drafts and published reports.
--
-- ── DELETE and the FK cascade (GDPR art. 17) ──────────────────
-- `year_end_reports.student_id … on delete cascade` is enforced by
-- Postgres' own referential-integrity trigger on `students`, which runs
-- independent of the deleting session's privileges on the *referencing*
-- table. Deleting a student still removes their reports after this
-- migration — proven in RLS-51 (`supabase/tests/database/rls.test.sql`)
-- rather than assumed, the same standard migration 012's own comment
-- invoked for `notifications`.
--
-- ── The touch trigger ──────────────────────────────────────────
-- `trg_year_end_reports_touch` writes `updated_at` on every UPDATE.
-- Column-privilege checks look only at the statement's own target-column
-- list, not at what a trigger modifies afterward, so `updated_at` not
-- being in the grant list below does not stop it firing on a permitted
-- edit — proven in RLS-50, not assumed.
--
-- ── service_role ────────────────────────────────────────────────
-- The revoke names only `anon, authenticated`. `publish-report` and
-- `generate-year-end-drafts` hold `service_role`, which bypasses RLS and
-- grants entirely by Supabase platform default — untouched by
-- construction, and this migration creates no table, so no
-- `alter default privileges` change is needed either.
--
-- ── pdf_path stays a column, not a rename ──────────────────────
-- `publish-report` still writes it and `report-pdf`'s 404 branch still
-- reads it as a presence flag (`netlify/functions/lib/reportAccess.ts`
-- stops trusting it as an object name, but does not touch the column).
-- This migration is the defence-in-depth half of that same fix: the
-- Function change holds on its own, and holds even harder
-- once the column a tutor could repoint is no longer theirs to write.
--
-- No data migration: this narrows an existing grant and writes nothing.
-- ============================================================

revoke update, delete on public.year_end_reports from anon, authenticated;

grant update (narrative,
              yanbua_grade, yanbua_notes,
              quran_grade,  quran_notes,
              murajaah_grade, murajaah_notes,
              overall_grade)
  on public.year_end_reports to authenticated;
