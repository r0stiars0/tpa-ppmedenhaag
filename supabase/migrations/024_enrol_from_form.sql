-- ============================================================
-- TPA PPME Den Haag — Migration 024: enrolment from the Google form
--
-- Lets the annual "Daftar Ulang" Google Form enrol a family without an
-- admin re-typing it: a bound Apps Script POSTs each response to the
-- `enrol-from-form` Netlify Function, which resolves/creates the parent
-- `auth.users` row (GoTrue admin API, exactly as `invite-user` does) and
-- then calls `fn_enrol_from_form` here to write the profile, the student
-- and the guardian link in one transaction (TAD ADR-043, PRD FR-010).
--
-- ── Why a new RPC and not fn_admin_save_student (ADR-040(g)) ──
-- That function opens with `if not fn_is_admin() then raise`. The
-- Function holds the service-role key, so `auth.uid()` is null and that
-- check always fails for it. And the student + guardian rows MUST land
-- in one transaction: migration 021's `trg_student_has_guardian` is
-- `AFTER INSERT ON students DEFERRABLE INITIALLY DEFERRED`, so a student
-- with no active guardian fails at COMMIT — and supabase-js issues one
-- transaction per `.insert()`. `fn_enrol_from_form` is therefore its own
-- SECURITY DEFINER RPC, guarded by `auth.role() = 'service_role'` in
-- place of `fn_is_admin()` — the webhookAuth.ts/callerAuth.ts split, at
-- the database layer.
--
-- ── enrolment_submissions ───────────────────────────────────
-- One row per processed submission: the raw answers, the ids it
-- created/updated, and the outcome. The admin's audit + troubleshooting
-- view (the sheet's Status column is the at-a-glance one). Kept
-- indefinitely (requirements R13). Every column but `id`/`created_at`/
-- `status` is nullable on purpose — a submission that fails validation
-- must still be recordable with whatever partial data arrived (FE-5).
-- Admin reads it; only the service role writes it — the year_end_reports
-- (migration 005) split.
--
-- ── No explicit table GRANT ─────────────────────────────────
-- Migration 007's `alter default privileges … to anon, authenticated,
-- service_role` already covers new tables (the 020/021/022 note). The
-- function is `grant execute`-d explicitly, and to service_role only.
-- ============================================================

-- ---------- 1. table ----------
create table public.enrolment_submissions (
  id              uuid primary key default gen_random_uuid(),
  submitted_at    timestamptz,                     -- the form Timestamp
  verified_email  text,                            -- Google-verified respondent
  parent_name     text,
  student_name    text,
  date_of_birth   date,
  locale          locale,
  relation        text,
  student_email   text,                            -- "Email siswa (jika ada)"
  payment_answer  text,                            -- "Ya" / "Tidak", stored only
  consent         boolean,
  parent_user_id  uuid references public.users (id)    on delete set null,
  student_id      uuid references public.students (id) on delete set null,
  status          text not null
                    check (status in ('enrolled','updated','needs_attention','error')),
  error           text,
  created_at      timestamptz not null default now(),
  constraint enrolment_submissions_name_len
    check (parent_name  is null or char_length(parent_name)  between 1 and 120),
  constraint enrolment_submissions_student_name_len
    check (student_name is null or char_length(student_name) between 1 and 120)
);

create index idx_enrolment_submissions_created on public.enrolment_submissions (created_at desc);
create index idx_enrolment_submissions_student on public.enrolment_submissions (student_id);

comment on table public.enrolment_submissions is
  'One row per processed Google re-registration submission (ADR-043, FR-010): '
  'the raw answers, the accounts it created/updated, and the outcome. Admin '
  'audit + troubleshooting view; kept indefinitely (requirements R13). Can '
  'hold a child''s name + date of birth and a guardian email — DPIA. Written '
  'only by the enrol-from-form Function on the service role.';

alter table public.enrolment_submissions enable row level security;

-- ---------- 2. RLS policies ----------
-- SELECT: admin only. No parent/student/tutor branch at all — an
-- enrolment log is administrative data with no family stake in it, the
-- tutor_attendance (ADR-041(d)) reasoning.
create policy enrolment_submissions_admin_read on public.enrolment_submissions
  for select to authenticated
  using (public.fn_is_admin());

-- WRITE: the service role only (the Function). service_role bypasses RLS
-- anyway; these are stated for the same reason migration 005 states its
-- storage.objects ones — so "only the Function writes this" is legible
-- in the schema, and an `authenticated` INSERT is refused for having no
-- policy, not by accident.
create policy enrolment_submissions_service_write on public.enrolment_submissions
  for insert to service_role
  with check (true);

create policy enrolment_submissions_service_update on public.enrolment_submissions
  for update to service_role
  using (true) with check (true);

-- ---------- 3. fn_enrol_from_form ----------
-- Called by the enrol-from-form Function on the service-role client with
-- the parent's auth.users id already resolved (GoTrue has no SQL API, so
-- the Function does that half). Everything below is one transaction, so
-- the DEFERRABLE guardian invariant is satisfied by insert order.
create or replace function public.fn_enrol_from_form(
  p_parent_id     uuid,     -- auth.users id, already created by the Function
  p_parent_email  text,
  p_parent_name   text,
  p_locale        text,     -- 'id' | 'nl'
  p_student_name  text,
  p_dob           date,
  p_relation      text default null
) returns table (
  parent_user_id  uuid,
  student_id      uuid,
  parent_created  boolean,
  student_created boolean,
  status          text
)
language plpgsql security definer set search_path = public as $$
declare
  v_role        user_role;
  v_student     uuid;
  v_match_count int;
  v_status      text := null;
  v_parent_new  boolean := false;
  v_student_new boolean := false;
begin
  -- Callerless channel: only the service role may enrol (ADR-043).
  if auth.role() <> 'service_role' then
    raise exception 'service role only' using errcode = 'insufficient_privilege';
  end if;
  if p_locale not in ('id', 'nl') then
    raise exception 'locale must be id or nl' using errcode = 'check_violation';
  end if;
  if p_parent_id is null or p_parent_name is null or btrim(p_parent_name) = ''
     or p_student_name is null or btrim(p_student_name) = '' or p_dob is null then
    raise exception 'parent id, parent name, student name and date of birth are required'
      using errcode = 'check_violation';
  end if;

  -- ── parent profile ──────────────────────────────────────────
  select role into v_role from public.users where id = p_parent_id;
  if not found then
    insert into public.users (id, email, full_name, role, locale)
    values (p_parent_id, lower(p_parent_email), btrim(p_parent_name), 'parent', p_locale::locale);
    v_parent_new := true;
  elsif v_role = 'parent' then
    -- refresh name/locale from the latest submission
    update public.users
      set full_name = btrim(p_parent_name), locale = p_locale::locale
      where id = p_parent_id;
  elsif v_role = 'student' then
    -- a student-role account being used as another child's guardian is
    -- odd but not forbidden — link it, flag the row for an admin.
    v_status := 'needs_attention';
  end if;
  -- v_role in ('tutor','admin'): reuse as guardian, profile untouched (ADR-024).

  -- ── find the existing student (requirements FE-7) ────────────
  -- same verified parent + case-insensitive trimmed name + same DOB.
  -- The earliest match is the one updated; more than one is flagged.
  with matches as (
    select s.id, s.created_at
    from public.students s
    where lower(btrim(s.full_name)) = lower(btrim(p_student_name))
      and s.date_of_birth = p_dob
      and exists (
        select 1 from public.student_guardians g
        where g.student_id = s.id and g.user_id = p_parent_id
          and g.unlinked_at is null
      )
  )
  select count(*)::int,
         (select id from matches order by created_at, id limit 1)
    into v_match_count, v_student
  from matches;

  if v_match_count > 1 then
    v_status := 'needs_attention';   -- ambiguous; the earliest is updated
  end if;

  if v_student is null then
    -- class_id left null (admin assigns — R2); enrollment_date defaults
    -- to today; user_id null (the optional student email is not acted
    -- on — R9). Guardian inserted straight after, same txn.
    insert into public.students (full_name, date_of_birth)
    values (btrim(p_student_name), p_dob)
    returning id into v_student;

    insert into public.student_guardians (student_id, user_id, relation)
    values (v_student, p_parent_id, p_relation);

    v_student_new := true;
    v_status := coalesce(v_status, 'enrolled');
  else
    update public.students
      set full_name = btrim(p_student_name)
      where id = v_student;

    -- table aliased: `student_id` also names an OUT column of this function.
    update public.student_guardians g
      set relation = p_relation
      where g.student_id = v_student and g.user_id = p_parent_id
        and g.unlinked_at is null
        and g.relation is distinct from p_relation;

    v_status := coalesce(v_status, 'updated');
  end if;

  return query select p_parent_id, v_student, v_parent_new, v_student_new, v_status;
end $$;

revoke all on function
  public.fn_enrol_from_form(uuid, text, text, text, text, date, text)
  from public, anon, authenticated;
grant execute on function
  public.fn_enrol_from_form(uuid, text, text, text, text, date, text)
  to service_role;

comment on function public.fn_enrol_from_form(uuid, text, text, text, text, date, text) is
  'Upserts a parent profile + a student + its guardian link in one '
  'transaction for the enrol-from-form Function (ADR-043, FR-010). '
  'service_role only (auth.role() guard). Idempotent on '
  '(parent, lower(trim(student name)), date_of_birth): a repeat refreshes '
  'names in place and returns status=updated. A tutor/admin parent is '
  'reused as guardian with their profile untouched (ADR-024).';
