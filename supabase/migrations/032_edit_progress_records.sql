-- ============================================================
-- TPA PPME Den Haag — Migration 032: edit Yanbu'a / Quran entries
--
-- TAD ADR-049, PRD Yanbu'a FR-007 / Quran FR-006.
--
-- Until now both progress tables were insert-only for tutors, so a
-- mis-keyed page or rating could not be corrected from the app. This
-- migration lets the tutor who recorded an entry (and admin) edit its
-- content, and makes the recorder's and editor's names resolvable by
-- everyone who may see the entry.
--
-- ── Who ──────────────────────────────────────────────────────
-- `*_tutor_update`: the recorder only (`tutor_id = auth.uid()`), and only
-- for a student they may record for — `fn_my_recordable_students()`
-- (ADR-023), so a student assistant cannot edit the entry about
-- themselves and a tutor removed from a class loses the right with the
-- membership. A co-tutor matches no row. Admin already holds
-- `*_admin_all` (ADR-014).
--
-- ── What ─────────────────────────────────────────────────────
-- RLS is row-scoped, not column-scoped (ADR-034), so the content
-- columns are granted explicitly and `student_id`, `tutor_id`,
-- `recorded_at` and `client_ref` stay immutable for every role,
-- admin included. The revoke narrows UPDATE only; DELETE is untouched
-- (tutors have no DELETE policy; admin's `*_admin_all` is unchanged and
-- nothing in the app offers it).
--
-- ── The edit marker ──────────────────────────────────────────
-- `edited_at` / `edited_by` are written by a BEFORE UPDATE trigger from
-- now() and auth.uid(), and only when a content column really changed.
-- They are outside the grant, so a client cannot forge or clear them;
-- the trigger still assigns them because column privileges look at the
-- statement's target list, not at what a trigger sets (the same fact
-- migration 016 proved for `updated_at`). Only the latest edit is kept.
-- `edited_by` is ON DELETE SET NULL so it never adds to the `delete-user`
-- blocker that `tutor_id` already is.
--
-- ── No notification ──────────────────────────────────────────
-- `trg_notify_jilid_milestone` is AFTER INSERT only (migration 010), so
-- an edit never fires `notify-milestone`. Nothing to change here.
--
-- ── Names ────────────────────────────────────────────────────
-- `public.users` has no read policy for other people, so a parent or
-- student cannot resolve a `tutor_id`. `fn_progress_authors(student)` is
-- SECURITY DEFINER and returns (user_id, full_name) only — no e-mail, no
-- role — for the distinct recorders and editors of that student's
-- entries, after checking the caller may see that student — by the same
-- predicates as the progress READ policies (`fn_my_progress_students()`
-- for tutors, `fn_my_children()`, the student's own record, admin), so it
-- never names someone on a row the caller could not read. Anyone else
-- gets zero rows, so it cannot enumerate staff.
--
-- No data migration: existing rows get null `edited_*` (never edited).
-- ============================================================

alter table public.yanbua_progress
  add column edited_at timestamptz,
  add column edited_by uuid references public.users (id) on delete set null;

alter table public.quran_progress
  add column edited_at timestamptz,
  add column edited_by uuid references public.users (id) on delete set null;

-- ---------- UPDATE policies ----------
create policy yanbua_tutor_update on public.yanbua_progress
  for update to authenticated
  using      (tutor_id = auth.uid() and student_id in (select public.fn_my_recordable_students()))
  with check (tutor_id = auth.uid() and student_id in (select public.fn_my_recordable_students()));

create policy quran_tutor_update on public.quran_progress
  for update to authenticated
  using      (tutor_id = auth.uid() and student_id in (select public.fn_my_recordable_students()))
  with check (tutor_id = auth.uid() and student_id in (select public.fn_my_recordable_students()));

-- ---------- column grants ----------
revoke update on public.yanbua_progress from anon, authenticated;
revoke update on public.quran_progress  from anon, authenticated;

grant update (jilid, page, mastery, notes)
  on public.yanbua_progress to authenticated;
grant update (surah_num, ayah_from, ayah_to, quality, tajweed_notes)
  on public.quran_progress to authenticated;

-- ---------- edit marker ----------
create or replace function public.fn_yanbua_mark_edited()
returns trigger language plpgsql as $$
begin
  if (new.jilid, new.page, new.mastery, new.notes)
     is distinct from (old.jilid, old.page, old.mastery, old.notes) then
    new.edited_at := now();
    new.edited_by := auth.uid();
  end if;
  return new;
end;
$$;

create or replace function public.fn_quran_mark_edited()
returns trigger language plpgsql as $$
begin
  if (new.surah_num, new.ayah_from, new.ayah_to, new.quality, new.tajweed_notes)
     is distinct from (old.surah_num, old.ayah_from, old.ayah_to, old.quality, old.tajweed_notes) then
    new.edited_at := now();
    new.edited_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger trg_yanbua_mark_edited
  before update on public.yanbua_progress
  for each row execute function public.fn_yanbua_mark_edited();

create trigger trg_quran_mark_edited
  before update on public.quran_progress
  for each row execute function public.fn_quran_mark_edited();

-- ---------- names ----------
create or replace function public.fn_progress_authors(p_student uuid)
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
