-- ============================================================
-- TPA PPME Den Haag — ROLLBACK for migration 033 (TAD ADR-050(d))
--
-- NOT a migration (never applied by `db push` / `db reset`). Restores
-- ADR-049's two-column `fn_progress_authors`, which names every recorder
-- — including a student assistant — to everyone who may see the entry.
-- Revert the frontend together with this: the new UI reads the
-- `is_assistant` column dropped here.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollback/033_progress_authors_assistant.down.sql
-- ============================================================

begin;

drop function if exists public.fn_progress_authors(uuid);

create function public.fn_progress_authors(p_student uuid)
returns table (user_id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select u.id, u.full_name
  from public.users u
  where (
        p_student in (select public.fn_my_progress_students())
     or p_student in (select public.fn_my_children())
     or p_student = public.fn_my_student_id()
     or public.fn_is_admin()
  )
  and u.id in (
    select tutor_id  from public.yanbua_progress where student_id = p_student
    union select edited_by from public.yanbua_progress where student_id = p_student and edited_by is not null
    union select tutor_id  from public.quran_progress  where student_id = p_student
    union select edited_by from public.quran_progress  where student_id = p_student and edited_by is not null
  )
$$;

comment on function public.fn_progress_authors(uuid) is
  'Names (only) of the people who recorded or edited a student''s Yanbu''a/Quran entries, for a caller who may see that student (ADR-049).';

revoke execute on function public.fn_progress_authors(uuid) from public, anon;
grant  execute on function public.fn_progress_authors(uuid) to authenticated;

commit;
