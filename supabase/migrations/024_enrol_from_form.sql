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
-- indefinitely by design. Every column but `id`/`created_at`/
-- `status` is nullable on purpose — a submission that fails validation
-- must still be recordable with whatever partial data arrived.
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
  'audit + troubleshooting view; kept indefinitely by design. Can '
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
--
-- Matching a submission to a student RECORD:
--   A. this parent already actively guards a student with lower(trim(name))
--      + DOB → update in place. status=updated.
--   B. a student with that name + DOB exists but this parent does not
--      guard them — usually a second guardian submitting for a child the
--      first already enrolled. Create nothing; status=needs_attention for
--      an admin (the sheet's Status/Error columns are the surface — no
--      in-app queue, no admin e-mail).
--   C. no match → create the student + guardian link. status=enrolled.
--
-- STUDENT SELF-LOGIN (ADR-043, PRD #10). When "Email siswa" is given the
-- form can also create/link the student's own account. No age gate
-- (ADR-021 — the app never gates on DOB; Google's own sign-in age check
-- is the only threshold). The guardian's form-consent tick is the basis
-- (PRD #10 — parental consent is retained regardless of student age). The
-- address resolves to one of:
--   * a registered role<>student account (a parent/tutor/admin address) →
--     never repurpose it. status=needs_attention.
--   * a registered role=student account already linked to a student whose
--     name matches → add this parent as a guardian of that student
--     (status=updated); name differs → status=needs_attention.
--   * a registered role=student account not yet linked (the ADR-032
--     window) whose profile name matches → link it to the record resolved
--     by A/C; name differs → status=needs_attention.
--   * an auth.users row with no profile (a prior sign-in) OR a row the
--     Function just created → provision a role=student profile, link it,
--     and the Function e-mails the student. `student_account_created` says
--     a profile was written so the Function knows to send that invite.
--   * the parent's own verified e-mail (same inbox typed twice) → ignore
--     the field, enrol parent-only.
create or replace function public.fn_enrol_from_form(
  p_parent_id      uuid,     -- auth.users id, already created by the Function
  p_parent_email   text,
  p_parent_name    text,
  p_locale         text,     -- 'id' | 'nl'
  p_student_name   text,
  p_dob            date,
  p_relation       text default null,
  p_student_email  text default null,   -- optional; match key + self-login provisioning
  p_student_auth_id uuid default null   -- set by the Function when it just createUser'd the student
) returns table (
  parent_user_id          uuid,
  student_id              uuid,
  parent_created          boolean,
  student_created         boolean,
  student_account_created boolean,
  status                  text
)
language plpgsql security definer set search_path = public as $$
declare
  v_role         user_role;
  v_student      uuid;
  v_match_count  int;
  v_status       text := null;
  v_parent_new   boolean := false;
  v_student_new  boolean := false;
  -- student self-login
  v_stu_email        text := nullif(lower(btrim(coalesce(p_student_email, ''))), '');
  v_stu_auth         uuid;
  v_stu_role         user_role;
  v_stu_pname        text;
  v_stu_linked_id    uuid;
  v_stu_linked_name  text;
  v_link_stu_auth    uuid;
  v_make_stu_profile boolean := false;
  v_stu_created      boolean := false;
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
    update public.users
      set full_name = btrim(p_parent_name), locale = p_locale::locale
      where id = p_parent_id;
  elsif v_role = 'student' then
    -- a student-role account used as another child's guardian is odd but
    -- not forbidden — link it, flag the row for an admin.
    v_status := 'needs_attention';
  end if;
  -- v_role in ('tutor','admin'): reuse as guardian, profile untouched (ADR-024).

  -- ── student self-login resolution (may return early) ─────────
  if v_stu_email is not null and v_stu_email <> lower(p_parent_email) then
    select id into v_stu_auth from auth.users where lower(email) = v_stu_email limit 1;
    if v_stu_auth is null then
      v_stu_auth := p_student_auth_id;
    end if;

    if v_stu_auth is not null then
      select role, full_name into v_stu_role, v_stu_pname
        from public.users where id = v_stu_auth;
      select s.id, s.full_name into v_stu_linked_id, v_stu_linked_name
        from public.students s where s.user_id = v_stu_auth;
    end if;

    if v_stu_auth is null then
      return query select p_parent_id, null::uuid, v_parent_new, false, false, 'needs_attention'::text;
      return;

    elsif v_stu_role is not null and v_stu_role <> 'student' then
      -- a parent/tutor/admin address — never repurpose it.
      return query select p_parent_id, null::uuid, v_parent_new, false, false, 'needs_attention'::text;
      return;

    elsif v_stu_role = 'student' and v_stu_linked_id is not null then
      if lower(btrim(v_stu_linked_name)) = lower(btrim(p_student_name)) then
        if not exists (
          select 1 from public.student_guardians g
          where g.student_id = v_stu_linked_id and g.user_id = p_parent_id
            and g.unlinked_at is null
        ) then
          insert into public.student_guardians (student_id, user_id, relation)
          values (v_stu_linked_id, p_parent_id, p_relation);
        else
          update public.student_guardians g set relation = p_relation
            where g.student_id = v_stu_linked_id and g.user_id = p_parent_id
              and g.unlinked_at is null and g.relation is distinct from p_relation;
        end if;
        return query select p_parent_id, v_stu_linked_id, v_parent_new, false, false,
                            coalesce(v_status, 'updated');
        return;
      else
        return query select p_parent_id, null::uuid, v_parent_new, false, false, 'needs_attention'::text;
        return;
      end if;

    elsif v_stu_role = 'student' and v_stu_linked_id is null then
      -- a registered self-login not yet attached to a record (ADR-032 window)
      if lower(btrim(v_stu_pname)) = lower(btrim(p_student_name)) then
        v_link_stu_auth := v_stu_auth;
      else
        return query select p_parent_id, null::uuid, v_parent_new, false, false, 'needs_attention'::text;
        return;
      end if;

    else
      -- v_stu_role is null: an unregistered auth row, or one the Function
      -- just created — provision the profile below and send the invite.
      v_link_stu_auth := v_stu_auth;
      v_make_stu_profile := true;
    end if;
  end if;

  -- ── match the student record (A / B / C) ────────────────────
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

  if v_student is not null then
    -- A: update in place.
    update public.students set full_name = btrim(p_student_name) where id = v_student;
    update public.student_guardians g set relation = p_relation
      where g.student_id = v_student and g.user_id = p_parent_id
        and g.unlinked_at is null and g.relation is distinct from p_relation;

  elsif exists (
    select 1 from public.students s
    where lower(btrim(s.full_name)) = lower(btrim(p_student_name))
      and s.date_of_birth = p_dob
  ) then
    -- B: name+DOB exists, this parent does not guard them — needs a human.
    -- Any student auth row the Function pre-created is left unregistered
    -- for an admin to finish (the invite-user partial-failure shape).
    return query select p_parent_id, null::uuid, v_parent_new, false, false, 'needs_attention'::text;
    return;

  else
    -- C: genuinely new. class_id null (admin assigns — R2); enrollment_date
    -- defaults to today. Guardian inserted straight after, same txn.
    insert into public.students (full_name, date_of_birth)
    values (btrim(p_student_name), p_dob)
    returning id into v_student;
    insert into public.student_guardians (student_id, user_id, relation)
    values (v_student, p_parent_id, p_relation);
    v_student_new := true;
    v_status := coalesce(v_status, 'enrolled');
  end if;

  -- ── attach the student self-login to the record ─────────────
  if v_link_stu_auth is not null then
    if exists (
      select 1 from public.students
      where id = v_student and user_id is not null and user_id <> v_link_stu_auth
    ) then
      -- the record already has a different self-login — an admin decides.
      return query select p_parent_id, v_student, v_parent_new, v_student_new, false,
                          'needs_attention'::text;
      return;
    end if;
    -- profile first: students.user_id FKs public.users (id).
    if v_make_stu_profile then
      insert into public.users (id, email, full_name, role, locale)
      values (v_link_stu_auth, v_stu_email, btrim(p_student_name), 'student', p_locale::locale)
      on conflict (id) do nothing;
      v_stu_created := true;
    end if;
    update public.students set user_id = v_link_stu_auth
      where id = v_student and user_id is distinct from v_link_stu_auth;
  end if;

  return query select p_parent_id, v_student, v_parent_new, v_student_new, v_stu_created,
                      coalesce(v_status, 'updated');
end $$;

revoke all on function
  public.fn_enrol_from_form(uuid, text, text, text, text, date, text, text, uuid)
  from public, anon, authenticated;
grant execute on function
  public.fn_enrol_from_form(uuid, text, text, text, text, date, text, text, uuid)
  to service_role;

comment on function public.fn_enrol_from_form(uuid, text, text, text, text, date, text, text, uuid) is
  'Upserts a parent profile + a student + its guardian link in one '
  'transaction for the enrol-from-form Function (ADR-043, FR-010). '
  'service_role only (auth.role() guard). Matches the student record by '
  '(A) this parent + lower(trim(name)) + DOB, then (B) name + DOB alone '
  '-> needs_attention, else (C) creates it. When p_student_email is given '
  'it also links or provisions the student self-login (PRD #10); '
  'student_account_created signals the Function to e-mail the student. A '
  'tutor/admin parent is reused as guardian with their profile untouched '
  '(ADR-024).';
