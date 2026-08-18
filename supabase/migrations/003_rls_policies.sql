-- ============================================================
-- TPA PPME Den Haag — Migration 003: Row Level Security
--
-- Roles: admin (all), tutor (own classes), parent (own children),
--        student 16+ self-login (own data, read-only).
-- HIGHEST-RISK MIGRATION: children's data isolation lives here.
-- Every policy below must be covered by the automated RLS tests
-- (see test-plan.md §3) before real student data is entered.
-- ============================================================

-- ---------- helper functions (security definer, stable) ----------

create or replace function public.fn_current_role()
returns user_role language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid()
$$;

create or replace function public.fn_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.fn_current_role() = 'admin'
$$;

-- student_ids belonging to the calling parent
create or replace function public.fn_my_children()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from public.students where parent_id = auth.uid()
$$;

-- the single student_id linked to a 16+ self-login student account
create or replace function public.fn_my_student_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.students where user_id = auth.uid()
$$;

-- class_ids where the caller is an assigned tutor
create or replace function public.fn_my_classes()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from public.classes where auth.uid() = any (tutor_ids)
$$;

-- student_ids in the caller's (tutor's) classes
create or replace function public.fn_my_class_students()
returns setof uuid language sql stable security definer set search_path = public as $$
  select s.id from public.students s
  where s.class_id in (select public.fn_my_classes())
$$;

-- ---------- enable RLS everywhere ----------
alter table public.users                enable row level security;
alter table public.students             enable row level security;
alter table public.classes              enable row level security;
alter table public.sessions             enable row level security;
alter table public.attendance           enable row level security;
alter table public.assignments          enable row level security;
alter table public.assignment_status    enable row level security;
alter table public.yanbua_progress      enable row level security;
alter table public.quran_progress       enable row level security;
alter table public.murajaah_assignments enable row level security;
alter table public.murajaah_log         enable row level security;
alter table public.surahs               enable row level security;
alter table public.yanbua_jilid         enable row level security;

-- ---------- reference tables: readable by any authenticated user ----------
create policy ref_surahs_read on public.surahs
  for select to authenticated using (true);
create policy ref_jilid_read on public.yanbua_jilid
  for select to authenticated using (true);

-- ---------- users ----------
create policy users_self_read on public.users
  for select to authenticated using (id = auth.uid() or public.fn_is_admin());
create policy users_self_update on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.users where id = auth.uid()));
  -- users may edit their own profile but NOT change their own role
create policy users_admin_all on public.users
  for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());

-- ---------- students ----------
create policy students_parent_read on public.students
  for select to authenticated using (parent_id = auth.uid());
create policy students_self_read on public.students
  for select to authenticated using (user_id = auth.uid());
create policy students_tutor_read on public.students
  for select to authenticated using (class_id in (select public.fn_my_classes()));
create policy students_admin_all on public.students
  for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());
-- Enrollment (INSERT/UPDATE/DELETE of students) is admin-only by design.

-- ---------- classes ----------
create policy classes_read on public.classes
  for select to authenticated using (
    public.fn_is_admin()
    or auth.uid() = any (tutor_ids)
    or id in (select class_id from public.students where parent_id = auth.uid())
    or id in (select class_id from public.students where user_id = auth.uid())
  );
create policy classes_admin_write on public.classes
  for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());

-- ---------- sessions ----------
create policy sessions_tutor_rw on public.sessions
  for all to authenticated
  using (class_id in (select public.fn_my_classes()) or public.fn_is_admin())
  with check (class_id in (select public.fn_my_classes()) or public.fn_is_admin());
create policy sessions_family_read on public.sessions
  for select to authenticated using (
    class_id in (select class_id from public.students where parent_id = auth.uid())
    or class_id in (select class_id from public.students where user_id = auth.uid())
  );

-- ---------- attendance ----------
create policy attendance_tutor_insert on public.attendance
  for insert to authenticated
  with check (
    student_id in (select public.fn_my_class_students())
    and session_id in (select id from public.sessions
                       where class_id in (select public.fn_my_classes()))
  );
create policy attendance_tutor_read on public.attendance
  for select to authenticated
  using (student_id in (select public.fn_my_class_students()));
create policy attendance_tutor_update on public.attendance
  for update to authenticated
  using (student_id in (select public.fn_my_class_students()))
  with check (student_id in (select public.fn_my_class_students()));
create policy attendance_parent_read on public.attendance
  for select to authenticated using (student_id in (select public.fn_my_children()));
create policy attendance_student_read on public.attendance
  for select to authenticated using (student_id = public.fn_my_student_id());
create policy attendance_admin_all on public.attendance
  for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());

-- ---------- assignments ----------
create policy assignments_tutor_rw on public.assignments
  for all to authenticated
  using (class_id in (select public.fn_my_classes()) or public.fn_is_admin())
  with check ((class_id in (select public.fn_my_classes()) and tutor_id = auth.uid())
              or public.fn_is_admin());
create policy assignments_family_read on public.assignments
  for select to authenticated using (
    class_id in (select class_id from public.students where parent_id = auth.uid())
    or class_id in (select class_id from public.students where user_id = auth.uid())
  );

-- ---------- assignment_status ----------
create policy astatus_tutor_rw on public.assignment_status
  for all to authenticated
  using (student_id in (select public.fn_my_class_students()) or public.fn_is_admin())
  with check (student_id in (select public.fn_my_class_students()) or public.fn_is_admin());
create policy astatus_parent_read on public.assignment_status
  for select to authenticated using (student_id in (select public.fn_my_children()));
create policy astatus_student_read on public.assignment_status
  for select to authenticated using (student_id = public.fn_my_student_id());

-- ---------- yanbua_progress ----------
create policy yanbua_tutor_insert on public.yanbua_progress
  for insert to authenticated
  with check (student_id in (select public.fn_my_class_students()) and tutor_id = auth.uid());
create policy yanbua_tutor_read on public.yanbua_progress
  for select to authenticated using (student_id in (select public.fn_my_class_students()));
create policy yanbua_parent_read on public.yanbua_progress
  for select to authenticated using (student_id in (select public.fn_my_children()));
create policy yanbua_student_read on public.yanbua_progress
  for select to authenticated using (student_id = public.fn_my_student_id());
create policy yanbua_admin_all on public.yanbua_progress
  for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());

-- ---------- quran_progress (mirror of yanbua) ----------
create policy quran_tutor_insert on public.quran_progress
  for insert to authenticated
  with check (student_id in (select public.fn_my_class_students()) and tutor_id = auth.uid());
create policy quran_tutor_read on public.quran_progress
  for select to authenticated using (student_id in (select public.fn_my_class_students()));
create policy quran_parent_read on public.quran_progress
  for select to authenticated using (student_id in (select public.fn_my_children()));
create policy quran_student_read on public.quran_progress
  for select to authenticated using (student_id = public.fn_my_student_id());
create policy quran_admin_all on public.quran_progress
  for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());

-- ---------- murajaah_assignments ----------
create policy massign_tutor_rw on public.murajaah_assignments
  for all to authenticated
  using (student_id in (select public.fn_my_class_students()) or public.fn_is_admin())
  with check ((student_id in (select public.fn_my_class_students()) and tutor_id = auth.uid())
              or public.fn_is_admin());
create policy massign_parent_read on public.murajaah_assignments
  for select to authenticated using (student_id in (select public.fn_my_children()));
create policy massign_student_read on public.murajaah_assignments
  for select to authenticated using (student_id = public.fn_my_student_id());

-- ---------- murajaah_log ----------
-- Parents confirm practice for their own children only.
create policy mlog_parent_insert on public.murajaah_log
  for insert to authenticated
  with check (
    confirmed_by = auth.uid()
    and assignment_id in (
      select ma.id from public.murajaah_assignments ma
      where ma.student_id in (select public.fn_my_children())
    )
  );
create policy mlog_parent_read on public.murajaah_log
  for select to authenticated using (
    assignment_id in (
      select ma.id from public.murajaah_assignments ma
      where ma.student_id in (select public.fn_my_children())
    )
  );
create policy mlog_tutor_read on public.murajaah_log
  for select to authenticated using (
    assignment_id in (
      select ma.id from public.murajaah_assignments ma
      where ma.student_id in (select public.fn_my_class_students())
    )
  );
create policy mlog_student_read on public.murajaah_log
  for select to authenticated using (
    assignment_id in (
      select ma.id from public.murajaah_assignments ma
      where ma.student_id = public.fn_my_student_id()
    )
  );
create policy mlog_admin_all on public.murajaah_log
  for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());
