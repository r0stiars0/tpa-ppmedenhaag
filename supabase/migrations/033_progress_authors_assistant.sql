-- ============================================================
-- TPA PPME Den Haag — Migration 033: a student assistant's name is
-- staff-only in the Yanbu'a/Quran attribution
--
-- TAD ADR-050(d), PRD Feature 8 FR-011.
--
-- ADR-049(e)'s `fn_progress_authors` returned every recorder's and
-- editor's name to everyone who may see the entry. When the recorder is a
-- 16+ student assistant (ADR-020), that named one child to other
-- families — which migration 028 (`fn_group_tutor_names`) and the privacy
-- policy explicitly avoid for group content.
--
-- The function now returns a third column, `is_assistant`: true for a
-- person who has their own `students` row (the same test
-- `fn_group_tutor_names` uses). For such a person `full_name` is NULL
-- unless the caller is an admin or reads this student's progress as a
-- tutor (`fn_my_progress_students()`), so the name never leaves the
-- database for a family. Access to the function is otherwise unchanged.
--
-- The return type changes, so the function is dropped and recreated;
-- grants are restated. The running (older) frontend ignores the extra
-- column and shows a NULL name as "recorder unavailable" until the new
-- frontend deploys — degraded for assistant-recorded entries only.
-- ============================================================

drop function if exists public.fn_progress_authors(uuid);

create function public.fn_progress_authors(p_student uuid)
returns table (user_id uuid, full_name text, is_assistant boolean)
language sql stable security definer set search_path = public as $$
  with people as (
    select tutor_id as id from public.yanbua_progress where student_id = p_student
    union select edited_by from public.yanbua_progress where student_id = p_student and edited_by is not null
    union select tutor_id from public.quran_progress where student_id = p_student
    union select edited_by from public.quran_progress where student_id = p_student and edited_by is not null
  ),
  caller as (
    select public.fn_is_admin()
        or p_student in (select public.fn_my_progress_students()) as is_staff
  )
  select u.id,
         case when a.is_assistant and not caller.is_staff then null else u.full_name end,
         a.is_assistant
  from public.users u
  join people on people.id = u.id
  cross join caller
  cross join lateral (
    select exists (select 1 from public.students s where s.user_id = u.id) as is_assistant
  ) a
  where (
        caller.is_staff
     or p_student in (select public.fn_my_children())
     or p_student = public.fn_my_student_id()
  )
$$;

comment on function public.fn_progress_authors(uuid) is
  'Names (only) of the people who recorded or edited a student''s Yanbu''a/Quran entries, for a caller who may see that student (ADR-049); a student assistant''s name only for staff (ADR-050).';

revoke execute on function public.fn_progress_authors(uuid) from public, anon;
grant  execute on function public.fn_progress_authors(uuid) to authenticated;
