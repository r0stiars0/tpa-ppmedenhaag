-- ============================================================
-- Migration 026 — multi-group enrolment, the tracking switch, archiving
-- (TAD ADR-045 (a0)–(d), PRD Feature 8 release 8a)
--
-- ── What changes ────────────────────────────────────────────
-- A student may belong to any number of groups (`class_members`), where
-- before `students.class_id` held exactly one. Each group gets
-- `tracks_progress` (may its tutors RECORD Yanbu'a/Quran/Murajaah) and
-- `archived_at` (a frozen, historical group). Every access rule that read
-- "the tutor's class's students" is re-derived for multiple groups.
--
-- ── Why this migration is ADDITIVE (ADR-045(a0)) ────────────
-- Migrations reach production by hand; the app deploys itself on merge.
-- Whichever lands first must not break the other, so:
--   * `students.class_id` is KEPT. A transitional trigger mirrors any
--     write to it (an old app bundle still open in a browser) into
--     `class_members`. A later contract migration drops both.
--   * `notifications` only gains a nullable `ref_id`. Swapping its unique
--     key would break the old notification Functions' upsert until the
--     new ones deploy; the swap belongs to the contract migration, and
--     the new Functions fall back to the old key until then.
--   * The old six-argument call of `fn_admin_save_student` still works.
-- Every table and column an old bundle reads still exists, and no row an
-- old query legitimately returned is withheld from it.
--
-- ── The helpers, and why every cross-table test goes through one ──
-- The new family rule on `sessions` looks at `attendance`, and
-- attendance's rules look at `sessions`. Written as plain subqueries in
-- policies, Postgres rejects that as infinite recursion. Each such test
-- is therefore a `security definer` helper, which reads the underlying
-- tables without re-entering their policies — the pattern migration 003
-- set with fn_my_classes()/fn_my_children().
--
--   fn_my_classes()            groups the caller teaches, archived included
--                              (unchanged; their own register stays readable)
--   fn_my_active_classes()     …not archived
--   fn_my_class_students()     members of my ACTIVE groups — "a current
--                              tutor of this student". Now gates only
--                              child-level reads: guardians, cross-group
--                              attendance. Archived groups no longer count
--                              (Resolved Decision 24).
--   fn_my_roster_students()    members of any of my groups, archived
--                              included — names on a register only
--   fn_my_progress_students()  who I may READ progress for: my active
--                              students; for a student assistant only
--                              those of my active tracking groups (RD 26)
--   fn_my_recordable_students() who I may RECORD progress for: members of
--                              my active tracking groups, minus myself
--   fn_my_report_students()    recordable, plus my students who are in no
--                              active tracking group at all
--   fn_my_family_classes()     groups my children (or I) belong to now
--   fn_my_family_history_classes() …plus groups they left but have
--                              attendance/homework in (labels history)
--   fn_my_tutor_readable_classes() my groups plus my students' other
--                              groups — empty second half for an assistant
-- ============================================================

-- ---------- 1. new columns on classes ----------
alter table public.classes
  add column tracks_progress boolean not null default true,
  add column archived_at timestamptz;

comment on column public.classes.tracks_progress is
  'Whether this group''s tutors may RECORD Yanbu''a/Quran/Murajaah (PRD '
  'Feature 8 FR-001). Off for an Aqidah group. Attendance, homework and '
  'the other base tools never read it. ADR-045(b).';
comment on column public.classes.archived_at is
  'Set when an admin archives the group (PRD FR-010): frozen for every role '
  'by trg_class_not_archived, hidden from pickers, and no longer counted '
  'as "teaching" its members for cross-group reads. ADR-045(a).';

-- ---------- 2. class_members ----------
-- A surrogate primary key, with the pair as a UNIQUE constraint, on
-- purpose. PostgREST treats a table as a many-to-many junction only when
-- both foreign keys make up its PRIMARY key. Had they, `students` ->
-- `classes` would have two relationships (this one and the transitional
-- `students.class_id`), and every old app bundle's `class:classes(...)`
-- embed on `students` would answer 300 PGRST201 "ambiguous" during the
-- expand window — found by replaying the old bundle's queries live
-- against this migration. The UNIQUE pair still backs upserts
-- (`on_conflict=class_id,student_id`).
create table public.class_members (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes (id) on delete cascade,
  student_id  uuid not null references public.students (id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  unique (class_id, student_id)
);
create index idx_class_members_student on public.class_members (student_id);

comment on table public.class_members is
  'Which groups a student belongs to — any number (PRD Feature 8 FR-002, '
  'ADR-045(a)). Replaces students.class_id. Enrolment is admin-only. '
  'Leaving a group deletes the row; the history of changes is '
  'class_member_changes.';

-- Backfill: every current single-group enrolment becomes a membership.
insert into public.class_members (class_id, student_id)
select class_id, id from public.students where class_id is not null;

-- ---------- 3. security definer helpers ----------
create or replace function public.fn_my_active_classes()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from public.classes
  where auth.uid() = any (tutor_ids) and archived_at is null
$$;

create or replace function public.fn_is_class_member(p_class uuid, p_student uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.class_members
                 where class_id = p_class and student_id = p_student)
$$;

-- "A current tutor of this student." Replaces the single-group version
-- (migration 003). Archived groups do not count (Resolved Decision 24).
create or replace function public.fn_my_class_students()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct m.student_id from public.class_members m
  where m.class_id in (select public.fn_my_active_classes())
$$;

create or replace function public.fn_my_roster_students()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct m.student_id from public.class_members m
  where m.class_id in (select public.fn_my_classes())
$$;

create or replace function public.fn_my_progress_students()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct m.student_id
  from public.class_members m
  join public.classes c on c.id = m.class_id
  where c.id in (select public.fn_my_active_classes())
    -- A caller with their own students row is a 16+ student assistant:
    -- they read progress only where they could record it (RD 26).
    and (public.fn_my_student_id() is null or c.tracks_progress)
$$;

-- Replaces migration 013's version: recording now needs a TRACKING group.
create or replace function public.fn_my_recordable_students()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct m.student_id
  from public.class_members m
  join public.classes c on c.id = m.class_id
  where c.id in (select public.fn_my_active_classes())
    and c.tracks_progress
    and m.student_id is distinct from public.fn_my_student_id()
$$;

comment on function public.fn_my_recordable_students() is
  'Students the caller may record an evaluation for: members of the caller''s '
  'active groups with tracks_progress on, minus their own record (ADR-023, ADR-045(c)).';

create or replace function public.fn_my_report_students()
returns setof uuid language sql stable security definer set search_path = public as $$
  select * from public.fn_my_recordable_students()
  union
  select m.student_id from public.class_members m
  where m.class_id in (select public.fn_my_active_classes())
    and m.student_id is distinct from public.fn_my_student_id()
    and not exists (
      select 1 from public.class_members m2
      join public.classes c2 on c2.id = m2.class_id
      where m2.student_id = m.student_id and c2.tracks_progress and c2.archived_at is null
    )
$$;

create or replace function public.fn_my_family_classes()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct m.class_id from public.class_members m
  where m.student_id in (select public.fn_my_children())
     or m.student_id = public.fn_my_student_id()
$$;

create or replace function public.fn_my_family_session_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct a.session_id from public.attendance a
  where a.student_id in (select public.fn_my_children())
     or a.student_id = public.fn_my_student_id()
$$;

create or replace function public.fn_my_family_assignment_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct s.assignment_id from public.assignment_status s
  where s.student_id in (select public.fn_my_children())
     or s.student_id = public.fn_my_student_id()
$$;

create or replace function public.fn_my_family_history_classes()
returns setof uuid language sql stable security definer set search_path = public as $$
  select * from public.fn_my_family_classes()
  union
  select se.class_id from public.sessions se
  where se.id in (select public.fn_my_family_session_ids())
  union
  select a.class_id from public.assignments a
  where a.id in (select public.fn_my_family_assignment_ids())
$$;

create or replace function public.fn_my_tutor_readable_classes()
returns setof uuid language sql stable security definer set search_path = public as $$
  select * from public.fn_my_classes()
  union
  select m.class_id from public.class_members m
  where public.fn_my_student_id() is null            -- not for assistants (RD 26)
    and m.student_id in (select public.fn_my_class_students())
$$;

create or replace function public.fn_my_class_session_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from public.sessions where class_id in (select public.fn_my_classes())
$$;

create or replace function public.fn_my_class_assignment_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from public.assignments where class_id in (select public.fn_my_classes())
$$;

create or replace function public.fn_session_class(p_session uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select class_id from public.sessions where id = p_session
$$;

create or replace function public.fn_assignment_class(p_assignment uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select class_id from public.assignments where id = p_assignment
$$;

-- ---------- 4. class_members RLS ----------
alter table public.class_members enable row level security;

create policy class_members_admin_all on public.class_members
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

create policy class_members_tutor_read on public.class_members
  for select to authenticated
  using (class_id in (select public.fn_my_classes()));

create policy class_members_family_read on public.class_members
  for select to authenticated
  using (student_id in (select public.fn_my_children())
         or student_id = public.fn_my_student_id());

-- ---------- 5. membership audit (PRD FR-009, Resolved Decision 25) ----------
create table public.class_member_changes (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes (id) on delete cascade,
  student_id  uuid references public.students (id) on delete cascade,
  action      text not null check (action in ('added','removed','archived','unarchived')),
  changed_by  uuid references public.users (id) on delete set null,
  changed_at  timestamptz not null default now(),
  check ((action in ('added','removed')) = (student_id is not null))
);
create index idx_class_member_changes_class on public.class_member_changes (class_id, changed_at desc);
create index idx_class_member_changes_student on public.class_member_changes (student_id);

comment on table public.class_member_changes is
  'Admin-only audit of every enrolment change and group archive/unarchive '
  '(PRD Feature 8 FR-009/FR-010, ADR-045(a)). Written only by triggers; no '
  'client write policy. Cascades with the student (GDPR art. 17).';

alter table public.class_member_changes enable row level security;

create policy class_member_changes_admin_read on public.class_member_changes
  for select to authenticated
  using (public.fn_is_admin());

create or replace function public.fn_log_class_member_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.class_member_changes (class_id, student_id, action, changed_by)
    values (new.class_id, new.student_id, 'added', auth.uid());
    return new;
  end if;
  -- A DELETE that is a cascade from erasing the student or deleting the
  -- group has nothing left to point at, and those audit rows would be
  -- cascaded away regardless. Only a real removal is logged.
  if exists (select 1 from public.students where id = old.student_id)
     and exists (select 1 from public.classes where id = old.class_id) then
    insert into public.class_member_changes (class_id, student_id, action, changed_by)
    values (old.class_id, old.student_id, 'removed', auth.uid());
  end if;
  return old;
end $$;

-- Created after the backfill on purpose: the log starts with this
-- migration, and the backfill is not an admin's action.
create trigger trg_log_class_member_change
  after insert or delete on public.class_members
  for each row execute function public.fn_log_class_member_change();

create or replace function public.fn_log_class_archive()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.class_member_changes (class_id, student_id, action, changed_by)
  values (new.id, null,
          case when new.archived_at is null then 'unarchived' else 'archived' end,
          auth.uid());
  return new;
end $$;

create trigger trg_log_class_archive
  after update of archived_at on public.classes
  for each row
  when (old.archived_at is distinct from new.archived_at)
  execute function public.fn_log_class_archive();

-- ---------- 6. transitional sync: students.class_id -> class_members ----------
-- Dropped with the column in the contract migration (ADR-045(a0)).
create or replace function public.fn_students_class_id_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.class_id is not null
     and old.class_id is distinct from new.class_id then
    delete from public.class_members
    where class_id = old.class_id and student_id = new.id;
  end if;
  if new.class_id is not null then
    insert into public.class_members (class_id, student_id)
    values (new.class_id, new.id)
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger trg_students_class_id_sync
  after insert or update of class_id on public.students
  for each row execute function public.fn_students_class_id_sync();

-- ---------- 7. a group with history can no longer be deleted ----------
-- Both were ON DELETE CASCADE since migration 002: deleting a group
-- silently erased its sessions, attendance and homework.
alter table public.sessions drop constraint sessions_class_id_fkey;
alter table public.sessions add constraint sessions_class_id_fkey
  foreign key (class_id) references public.classes (id) on delete restrict;
alter table public.assignments drop constraint assignments_class_id_fkey;
alter table public.assignments add constraint assignments_class_id_fkey
  foreign key (class_id) references public.classes (id) on delete restrict;

-- ---------- 8. archived groups are frozen, for every role ----------
-- INSERT and UPDATE only. DELETE is deliberately not blocked: it is
-- either a GDPR erasure cascade (a student's attendance, homework status
-- and memberships) or an admin takedown, and tutors hold no DELETE on
-- the register tables anyway. ADR-045(a).
create or replace function public.fn_class_not_archived()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new uuid;
  v_old uuid;
begin
  if tg_table_name in ('sessions', 'assignments', 'class_members') then
    v_new := new.class_id;
    if tg_op = 'UPDATE' then v_old := old.class_id; end if;
  elsif tg_table_name in ('attendance', 'tutor_attendance') then
    v_new := public.fn_session_class(new.session_id);
    if tg_op = 'UPDATE' then v_old := public.fn_session_class(old.session_id); end if;
  elsif tg_table_name = 'assignment_status' then
    v_new := public.fn_assignment_class(new.assignment_id);
    if tg_op = 'UPDATE' then v_old := public.fn_assignment_class(old.assignment_id); end if;
  end if;

  if exists (select 1 from public.classes
             where id in (v_new, v_old) and archived_at is not null) then
    raise exception 'group is archived'
      using errcode = 'check_violation',
            hint = 'Unarchive the group to change it (PRD Feature 8 FR-010).';
  end if;
  return new;
end $$;

create trigger trg_class_not_archived before insert or update on public.sessions
  for each row execute function public.fn_class_not_archived();
create trigger trg_class_not_archived before insert or update on public.attendance
  for each row execute function public.fn_class_not_archived();
create trigger trg_class_not_archived before insert or update on public.tutor_attendance
  for each row execute function public.fn_class_not_archived();
create trigger trg_class_not_archived before insert or update on public.assignments
  for each row execute function public.fn_class_not_archived();
create trigger trg_class_not_archived before insert or update on public.assignment_status
  for each row execute function public.fn_class_not_archived();
create trigger trg_class_not_archived before insert or update on public.class_members
  for each row execute function public.fn_class_not_archived();

-- ---------- 9. policies re-derived for multiple groups ----------
-- students: a tutor reads the names on any of their registers.
drop policy students_tutor_read on public.students;
create policy students_tutor_read on public.students
  for select to authenticated
  using (id in (select public.fn_my_roster_students()));

-- classes: tutors see their students' other groups by name; families see
-- their children's groups, including ones left but with history.
drop policy classes_read on public.classes;
create policy classes_read on public.classes
  for select to authenticated
  using (
    public.fn_is_admin()
    or auth.uid() = any (tutor_ids)
    or id in (select public.fn_my_tutor_readable_classes())
    or id in (select public.fn_my_family_history_classes())
  );

-- progress READ: any current tutor (narrowed for assistants).
drop policy yanbua_tutor_read on public.yanbua_progress;
create policy yanbua_tutor_read on public.yanbua_progress
  for select to authenticated
  using (student_id in (select public.fn_my_progress_students()));

drop policy quran_tutor_read on public.quran_progress;
create policy quran_tutor_read on public.quran_progress
  for select to authenticated
  using (student_id in (select public.fn_my_progress_students()));

drop policy mlog_tutor_read on public.murajaah_log;
create policy mlog_tutor_read on public.murajaah_log
  for select to authenticated
  using (assignment_id in (
    select ma.id from public.murajaah_assignments ma
    where ma.student_id in (select public.fn_my_progress_students())));

-- massign_tutor_rw is FOR ALL, so its USING also gates SELECT; without
-- this a non-tracking tutor could read the log but not the target.
create policy massign_tutor_read on public.murajaah_assignments
  for select to authenticated
  using (student_id in (select public.fn_my_progress_students()));

-- attendance: the TABLE is scoped to the session's group. A child's own
-- attendance crosses groups only through fn_student_attendance_history,
-- which withholds the reason (Resolved Decision 16).
drop policy attendance_tutor_read on public.attendance;
create policy attendance_tutor_read on public.attendance
  for select to authenticated
  using (session_id in (select public.fn_my_class_session_ids()));

drop policy attendance_tutor_update on public.attendance;
create policy attendance_tutor_update on public.attendance
  for update to authenticated
  using (session_id in (select public.fn_my_class_session_ids()))
  with check (session_id in (select public.fn_my_class_session_ids()));

drop policy attendance_tutor_insert on public.attendance;
create policy attendance_tutor_insert on public.attendance
  for insert to authenticated
  with check (
    session_id in (select public.fn_my_class_session_ids())
    and public.fn_is_class_member(public.fn_session_class(session_id), student_id)
  );

-- sessions: family reads current groups' sessions and any their child
-- has attendance in (history after leaving).
drop policy sessions_family_read on public.sessions;
create policy sessions_family_read on public.sessions
  for select to authenticated
  using (class_id in (select public.fn_my_family_classes())
         or id in (select public.fn_my_family_session_ids()));

-- assignments: family reads current groups' homework and any their child
-- has a status row on; tutors also read their students' other groups'
-- homework LIST (write stays assignments_tutor_rw).
drop policy assignments_family_read on public.assignments;
create policy assignments_family_read on public.assignments
  for select to authenticated
  using (class_id in (select public.fn_my_family_classes())
         or id in (select public.fn_my_family_assignment_ids()));

create policy assignments_tutor_cross_read on public.assignments
  for select to authenticated
  using (class_id in (select public.fn_my_tutor_readable_classes()));

-- assignment_status: scoped to the HOMEWORK's group (was: to the student),
-- a new row needs the student to be a member of it, and a student
-- assistant still cannot mark their own (ADR-023).
drop policy astatus_tutor_rw on public.assignment_status;
create policy astatus_tutor_rw on public.assignment_status
  for all to authenticated
  using (
    (assignment_id in (select public.fn_my_class_assignment_ids())
     and student_id is distinct from public.fn_my_student_id())
    or public.fn_is_admin()
  )
  with check (
    (assignment_id in (select public.fn_my_class_assignment_ids())
     and student_id is distinct from public.fn_my_student_id()
     and public.fn_is_class_member(public.fn_assignment_class(assignment_id), student_id))
    or public.fn_is_admin()
  );

-- year_end_reports: authorable for recordable students, and for a child
-- in no tracking group by a tutor of one of their groups (PRD FR-008).
drop policy yer_tutor_rw on public.year_end_reports;
create policy yer_tutor_rw on public.year_end_reports
  for all to authenticated
  using (student_id in (select public.fn_my_report_students()))
  with check (student_id in (select public.fn_my_report_students())
              and tutor_id = auth.uid());

-- ---------- 10. functions that read students.class_id ----------
create or replace function public.fn_class_tutors(p_class uuid)
returns table (user_id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select u.id, u.full_name
  from public.classes c
  join public.users u on u.id = any (c.tutor_ids)
  where c.id = p_class
    and (public.fn_is_admin() or p_class in (select public.fn_my_classes()))
    -- A student-assistant enrolled in this same group is recorded on the
    -- student roster, not listed a second time as a tutor (ADR-041(e)).
    and u.id not in (
      select s.user_id from public.students s
      join public.class_members m on m.student_id = s.id
      where m.class_id = p_class and s.user_id is not null
    )
  order by u.full_name
$$;

-- The six-argument version is replaced by one with a trailing
-- p_class_ids. Old callers (no p_class_ids) keep the single-group
-- behaviour, mirrored into class_members by the sync trigger.
drop function public.fn_admin_save_student(text, date, jsonb, uuid, uuid, uuid);

create or replace function public.fn_admin_save_student(
  p_full_name  text,
  p_dob        date,
  p_guardians  jsonb,
  p_id         uuid    default null,
  p_class_id   uuid    default null,
  p_user_id    uuid    default null,
  p_class_ids  uuid[]  default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_want uuid[];
begin
  if not public.fn_is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  if p_guardians is null or jsonb_typeof(p_guardians) <> 'array'
     or jsonb_array_length(p_guardians) = 0 then
    raise exception 'at least one guardian required' using errcode = 'check_violation';
  end if;

  if p_id is null then
    insert into public.students (full_name, date_of_birth, class_id, user_id)
    values (p_full_name, p_dob, case when p_class_ids is null then p_class_id end, p_user_id)
    returning id into v_id;
  elsif p_class_ids is null then
    update public.students
      set full_name = p_full_name, date_of_birth = p_dob,
          class_id = p_class_id, user_id = p_user_id
      where id = p_id
    returning id into v_id;
  else
    -- New callers own the group set through class_members; the legacy
    -- column is left alone so the sync trigger does not move anyone.
    update public.students
      set full_name = p_full_name, date_of_birth = p_dob, user_id = p_user_id
      where id = p_id
    returning id into v_id;
  end if;
  if v_id is null then
    raise exception 'no such student %', p_id using errcode = 'no_data_found';
  end if;

  if p_class_ids is not null then
    -- Only ACTIVE memberships are managed here: an archived group is
    -- history and is never offered by the form, so leaving it out of
    -- p_class_ids must not delete it.
    delete from public.class_members m
    using public.classes c
    where m.student_id = v_id and c.id = m.class_id
      and c.archived_at is null
      and not (m.class_id = any (p_class_ids));

    insert into public.class_members (class_id, student_id)
    select distinct unnest(p_class_ids), v_id
    on conflict do nothing;
  end if;

  v_want := array(
    select distinct (e->>'user_id')::uuid
    from jsonb_array_elements(p_guardians) e
  );

  -- (1) add wanted links that have no active row yet. A previously
  -- removed guardian being re-added gets a fresh row (ADR-040(a)).
  insert into public.student_guardians (student_id, user_id, relation)
  select v_id, w.user_id, w.relation
  from (
    select distinct on (uid) (e->>'user_id')::uuid as user_id,
           e->>'relation' as relation, (e->>'user_id')::uuid as uid
    from jsonb_array_elements(p_guardians) e
  ) w
  where not exists (
    select 1 from public.student_guardians g
    where g.student_id = v_id and g.user_id = w.user_id and g.unlinked_at is null
  );

  -- keep the relation label current on links that already exist active
  update public.student_guardians g
  set relation = w.relation
  from (
    select distinct on (uid) (e->>'user_id')::uuid as user_id,
           e->>'relation' as relation, (e->>'user_id')::uuid as uid
    from jsonb_array_elements(p_guardians) e
  ) w
  where g.student_id = v_id and g.user_id = w.user_id and g.unlinked_at is null
    and g.relation is distinct from w.relation;

  -- (2) deactivate active links no longer wanted. Done after (1) so the
  -- keep-one trigger never sees a transient zero when the set is swapped.
  update public.student_guardians
    set unlinked_at = now()
    where student_id = v_id and unlinked_at is null
      and not (user_id = any (v_want));

  return v_id;
end $$;

grant execute on function public.fn_admin_save_student(text, date, jsonb, uuid, uuid, uuid, uuid[]) to authenticated;

-- ---------- 11. a child's attendance across groups ----------
-- The one path by which attendance crosses groups (Resolved Decision 16).
-- Entitlement is folded into the WHERE clause (the fn_student_guardians
-- pattern): anyone not entitled gets zero rows, not an error. The reason
-- is returned only to the session's own group tutors, admins and the
-- child's family — it can carry health information (DPIA R4).
create or replace function public.fn_student_attendance_history(p_student uuid)
returns table (
  session_id   uuid,
  session_date date,
  class_id     uuid,
  class_name   text,
  status       attendance_status,
  reason       text
)
language sql stable security definer set search_path = public as $$
  select a.session_id, se.date, c.id, c.name, a.status,
         case
           when public.fn_is_admin()
             or p_student in (select public.fn_my_children())
             or p_student = public.fn_my_student_id()
             or se.class_id in (select public.fn_my_classes())
           then a.reason
         end
  from public.attendance a
  join public.sessions se on se.id = a.session_id
  join public.classes c on c.id = se.class_id
  where a.student_id = p_student
    and (
      public.fn_is_admin()
      or p_student in (select public.fn_my_children())
      or p_student = public.fn_my_student_id()
      or (
        p_student in (select public.fn_my_class_students())
        -- a student assistant sees only their own groups' sessions (RD 26)
        and (public.fn_my_student_id() is null
             or se.class_id in (select public.fn_my_classes()))
      )
    )
  order by se.date desc, c.name
$$;

grant execute on function public.fn_student_attendance_history(uuid) to authenticated;

-- ---------- 12. notifications: a per-source reference ----------
-- Lets two events of the same kind on the same day (an absence in each of
-- two groups) be told apart. The unique key moves to include it in the
-- contract migration; until then the Functions fall back to the old key.
alter table public.notifications add column ref_id uuid;
comment on column public.notifications.ref_id is
  'What the notification is about beyond the child and day — the session '
  'for an absence, the group for new homework (ADR-045(g)). Null for '
  'events that need no split.';
