-- ============================================================
-- Migration 029 — year-end report sections per group
-- (TAD ADR-045(h), PRD Feature 8 release 8b-2, FR-008,
-- Resolved Decisions 20, 27 and 34)
--
-- ── What changes ────────────────────────────────────────────
-- There is still one report per student per academic year. For each
-- group with tracking OFF (an Aqidah group) the student attended during
-- the year, the report gains a SECTION: a grade on the existing scale, a
-- narrative, and that group's own attendance figures. Draft generation
-- (`generate-year-end-drafts`, service role) creates the sections.
--
-- ── Who does what (Resolved Decision 34) ───────────────────
--   * A tutor of the section's group fills in its grade and narrative,
--     only while the report is a draft, never on their own student
--     record. Once published, the section locks for them.
--   * The report's author reads every section and edits none of them.
--   * Families read sections of a published report only.
--   * An admin edits any section, published or not — the correction
--     path — and (in `publish-report`) may publish.
--   * Only grade and narrative are writable by a client (column grant);
--     sections are created and removed by the Function or an admin.
--
-- ── Order in production ─────────────────────────────────────
-- Additive only. Apply before merging the 8b-2 PR.
-- ============================================================

create table public.year_end_report_sections (
  id                  uuid primary key default gen_random_uuid(),
  report_id           uuid not null references public.year_end_reports (id) on delete cascade,
  class_id            uuid not null references public.classes (id) on delete cascade,
  -- The group's first tutor when the section was generated: the name
  -- shown as its writer. Any tutor of the group may fill it in.
  tutor_id            uuid references public.users (id) on delete set null,
  grade               public.report_grade,
  narrative           text check (narrative is null or char_length(narrative) <= 2000),
  attendance_present  smallint not null default 0,
  attendance_absent   smallint not null default 0,
  attendance_late     smallint not null default 0,
  attendance_rate     numeric(5,2) not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (report_id, class_id)
);
create index year_end_report_sections_class_idx on public.year_end_report_sections (class_id);

create trigger trg_year_end_report_sections_touch before update on public.year_end_report_sections
  for each row execute function public.fn_touch_updated_at();

-- ---------- helpers (the report row is not readable by a section tutor) ----------
create or replace function public.fn_report_student(p_report uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select student_id from public.year_end_reports where id = p_report
$$;

create or replace function public.fn_report_is_draft(p_report uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'draft' from public.year_end_reports where id = p_report), false)
$$;

-- Mirrors the year_end_reports SELECT policies: the report's tutors
-- (fn_my_report_students), and the family once it is published.
create or replace function public.fn_can_read_report(p_report uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.year_end_reports r
    where r.id = p_report
      and (r.student_id in (select public.fn_my_report_students())
           or (r.status = 'published'
               and (r.student_id in (select public.fn_my_children())
                    or r.student_id = public.fn_my_student_id())))
  )
$$;

revoke all on function public.fn_report_student(uuid) from public, anon;
revoke all on function public.fn_report_is_draft(uuid) from public, anon;
revoke all on function public.fn_can_read_report(uuid) from public, anon;
grant execute on function public.fn_report_student(uuid) to authenticated;
grant execute on function public.fn_report_is_draft(uuid) to authenticated;
grant execute on function public.fn_can_read_report(uuid) to authenticated;

-- ---------- RLS ----------
alter table public.year_end_report_sections enable row level security;

create policy yers_admin_all on public.year_end_report_sections for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

-- Read: the section's group tutors (not on their own record), and
-- whoever can read the report itself.
create policy yers_read on public.year_end_report_sections for select to authenticated
  using ((class_id in (select public.fn_my_classes())
          and public.fn_report_student(report_id) is distinct from public.fn_my_student_id())
         or public.fn_can_read_report(report_id));

-- Write: the section's group tutors, while the report is a draft.
create policy yers_tutor_update on public.year_end_report_sections for update to authenticated
  using (class_id in (select public.fn_my_classes())
         and public.fn_report_student(report_id) is distinct from public.fn_my_student_id()
         and public.fn_report_is_draft(report_id))
  with check (class_id in (select public.fn_my_classes())
              and public.fn_report_student(report_id) is distinct from public.fn_my_student_id()
              and public.fn_report_is_draft(report_id));

-- Only grade and narrative are writable from a client, for everyone
-- (admins included); everything else is the draft generator's.
revoke insert, update, delete on public.year_end_report_sections from authenticated, anon;
grant select on public.year_end_report_sections to authenticated;
grant update (grade, narrative) on public.year_end_report_sections to authenticated;

-- ---------- the section tutor's list ----------
-- What a section tutor needs about the report they cannot read: whose
-- it is, the year, whether it is still a draft, and who authors it.
create or replace function public.fn_my_report_sections(p_class uuid)
returns table (
  section_id uuid, report_id uuid, student_id uuid, student_name text,
  academic_year text, report_status public.report_status, author_id uuid, author_name text,
  grade public.report_grade, narrative text,
  attendance_present smallint, attendance_absent smallint, attendance_late smallint, attendance_rate numeric
)
language sql stable security definer set search_path = public as $$
  select s.id, r.id, st.id, st.full_name, r.academic_year, r.status, r.tutor_id, u.full_name,
         s.grade, s.narrative, s.attendance_present, s.attendance_absent, s.attendance_late, s.attendance_rate
  from public.year_end_report_sections s
  join public.year_end_reports r on r.id = s.report_id
  join public.students st on st.id = r.student_id
  left join public.users u on u.id = r.tutor_id
  where s.class_id = p_class
    and (public.fn_is_admin()
         or (p_class in (select public.fn_my_classes())
             and r.student_id is distinct from public.fn_my_student_id()))
  order by r.academic_year desc, st.full_name
$$;

revoke all on function public.fn_my_report_sections(uuid) from public, anon;
grant execute on function public.fn_my_report_sections(uuid) to authenticated;

-- ---------- the admin's author picker (Resolved Decision 21) ----------
-- `year_end_reports.tutor_id` has no column grant, and must not get one:
-- `yer_tutor_rw` lets a co-tutor update a colleague's report row as long
-- as the result has `tutor_id = auth.uid()`, so a grant would let them
-- make themselves the author. Reassigning goes through this instead:
-- admin only, a draft only, and the new author must teach one of the
-- child's active groups, and not a 16+ student assistant.
create or replace function public.fn_admin_set_report_author(p_report uuid, p_tutor uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.year_end_reports where id = p_report and status = 'draft') then
    raise exception 'only a draft report can change author' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.year_end_reports r
    join public.class_members m on m.student_id = r.student_id
    join public.classes c on c.id = m.class_id
    where r.id = p_report and c.archived_at is null and p_tutor = any (c.tutor_ids)
  ) then
    raise exception 'the author must teach one of the student''s groups' using errcode = 'check_violation';
  end if;
  -- Not a 16+ student assistant: the author's name is printed on the
  -- family's PDF, and assistants are not named to families (RD 33).
  if exists (select 1 from public.students where user_id = p_tutor) then
    raise exception 'a student assistant cannot author a report' using errcode = 'check_violation';
  end if;
  update public.year_end_reports set tutor_id = p_tutor where id = p_report;
end $$;

revoke all on function public.fn_admin_set_report_author(uuid, uuid) from public, anon;
grant execute on function public.fn_admin_set_report_author(uuid, uuid) to authenticated;
