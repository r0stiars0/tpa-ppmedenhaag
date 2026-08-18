-- ============================================================
-- TPA PPME Den Haag — Migration 005: Year-End Curriculum Reports
--
-- Adds: report_status / report_grade enums, year_end_reports table,
-- RLS policies (drafts visible to tutor/admin only — never parent/
-- student), and the private Storage bucket for generated PDFs.
-- ============================================================

-- ---------- enums ----------
do $$ begin
  create type report_status as enum ('draft', 'published');
exception when duplicate_object then null;
end $$;

-- Same 5-level scale as quran_quality, kept as a separate type so
-- report grading isn't semantically coupled to Quran-specific quality.
do $$ begin
  create type report_grade as enum (
    'mumtaz', 'jayyid_jiddan', 'jayyid', 'maqbul', 'perlu_bimbingan'
  );
exception when duplicate_object then null;
end $$;

-- ---------- table ----------
create table public.year_end_reports (
  id                  uuid primary key default gen_random_uuid(),
  student_id          uuid not null references public.students (id) on delete cascade,
  academic_year       text not null,              -- format 'YYYY/YYYY', e.g. '2025/2026'.
                                                    -- PPME's TPA academic year runs late
                                                    -- Aug/early Sep to early/mid Jul.
  tutor_id            uuid not null references public.users (id),

  status              report_status not null default 'draft',

  -- tutor-authored content (empty on draft creation, filled before publish)
  narrative           text,
  yanbua_grade        report_grade,
  yanbua_notes        text,
  quran_grade         report_grade,
  quran_notes         text,
  murajaah_grade      report_grade,
  murajaah_notes      text,
  overall_grade       report_grade,

  -- stats snapshot, computed at draft generation time by
  -- generate-year-end-drafts (not user-editable via the API)
  attendance_present  smallint not null default 0,
  attendance_absent   smallint not null default 0,
  attendance_late     smallint not null default 0,
  attendance_rate     numeric(5,2) not null default 0,   -- percentage, e.g. 92.31

  pdf_path            text,                        -- Storage path once generated; NULL until first publish
  generated_at        timestamptz not null default now(),
  published_at        timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (student_id, academic_year)
);

create index idx_year_end_reports_student on public.year_end_reports (student_id);
create index idx_year_end_reports_tutor   on public.year_end_reports (tutor_id);

create trigger trg_year_end_reports_touch
  before update on public.year_end_reports
  for each row execute function public.fn_touch_updated_at();  -- reuses fn from migration 002

-- ---------- RLS ----------
alter table public.year_end_reports enable row level security;

-- Tutor: full visibility + edit rights over reports for their own class's students,
-- any status (including drafts). Publishing itself (draft -> published, PDF write)
-- happens through the publish-report Netlify Function using the service role, not
-- a direct client UPDATE — but tutors can still PATCH narrative/grades on a
-- published report via PostgREST (FR-006 post-publish edit), which the Function
-- picks up on next regeneration.
create policy yer_tutor_rw on public.year_end_reports
  for all to authenticated
  using (student_id in (select public.fn_my_class_students()))
  with check (student_id in (select public.fn_my_class_students()) and tutor_id = auth.uid());

-- Parent: published only, own children only. Drafts are invisible by construction
-- (status = 'published' is part of the USING clause, not an app-layer filter).
create policy yer_parent_read on public.year_end_reports
  for select to authenticated
  using (student_id in (select public.fn_my_children()) and status = 'published');

-- Student (16+, self-login): published only, own record only.
create policy yer_student_read on public.year_end_reports
  for select to authenticated
  using (student_id = public.fn_my_student_id() and status = 'published');

create policy yer_admin_all on public.year_end_reports
  for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());

-- ---------- Storage bucket for generated PDFs ----------
-- Private bucket: no public read. All access goes through the report-pdf
-- Function, which mints a short-lived signed URL after checking the same
-- authorization the RLS policies above encode.
insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do nothing;

-- Only the service role (used server-side by Netlify Functions) may write.
-- No client-facing SELECT/INSERT policy is created on purpose — signed URLs
-- bypass RLS, so there is deliberately no direct client path to this bucket.
create policy reports_bucket_service_write on storage.objects
  for insert to service_role
  with check (bucket_id = 'reports');

create policy reports_bucket_service_update on storage.objects
  for update to service_role
  using (bucket_id = 'reports');
