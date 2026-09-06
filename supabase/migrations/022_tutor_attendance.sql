-- ============================================================
-- TPA PPME Den Haag — Migration 022: tutor attendance
--
-- Lets a session's register record whether the *tutors* turned up, next
-- to the students, so the TPA head can review tutor attendance
-- periodically (TAD ADR-041, PRD FR-008).
--
-- `attendance.student_id` is `NOT NULL` and FKs `students`; a tutor is a
-- `public.users` row with no `students` record, so tutor attendance
-- cannot reuse that table. `public.tutor_attendance` mirrors it column
-- for column with `tutor_id → users` in place of `student_id → students`,
-- keyed on the same `sessions` row (ADR-041(a)). Student-attendance
-- semantics, its five policies and every RLS-01…RLS-77 assertion are
-- therefore untouched.
--
-- ── Read side is deliberately tighter than `attendance` (ADR-041(d)) ──
-- `attendance` has `attendance_parent_read` and `attendance_student_read`.
-- Tutor attendance is staff personal data with no family stake in it, so
-- it gets **no parent and no student policy at all** — a guardian or a
-- 16+ santri reading `public.tutor_attendance` sees zero rows. Reads are
-- admin (any class) plus a tutor of the session's own class, the set that
-- has to see current statuses to fill the register in (ADR-041(d),
-- Q-D16).
--
-- ── No explicit table GRANT ──────────────────────────────────
-- Migration 007's `alter default privileges … to anon, authenticated,
-- service_role` already covers new tables (the migration 020/021 note).
-- The function below is `grant execute`-d explicitly.
-- ============================================================

-- ---------- 1. table ----------
create table public.tutor_attendance (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions (id) on delete cascade,
  tutor_id    uuid not null references public.users (id)    on delete cascade,
  status      attendance_status not null,
  reason      text,
  created_at  timestamptz not null default now(),
  unique (session_id, tutor_id)        -- one record per tutor per session
);
create index idx_tutor_attendance_tutor on public.tutor_attendance (tutor_id);

comment on table public.tutor_attendance is
  'Per-session attendance for the tutors of a class (ADR-041). Mirrors '
  'public.attendance with tutor_id→users. Read by admin and by a tutor '
  'of the session''s class only — never a guardian or a 16+ student. '
  'The reason column can carry health info, exactly like attendance.reason '
  '(DPIA R4/R6): shown in-app to authorised eyes, never in a notification '
  'or an export.';

alter table public.tutor_attendance enable row level security;

-- ---------- 2. RLS policies ----------
-- INSERT: a tutor of the session's class, or admin. The subject tutor
-- must actually be a tutor of that class — the register does not record
-- attendance for someone `classes.tutor_ids` does not name (ADR-041,
-- scope boundary; an unassigned substitute is added in Beheer first).
create policy tutor_attendance_tutor_insert on public.tutor_attendance
  for insert to authenticated
  with check (
    session_id in (
      select s.id from public.sessions s
      where s.class_id in (select public.fn_my_classes())
    )
    and tutor_id in (
      select unnest(c.tutor_ids)
      from public.classes c
      join public.sessions s on s.class_id = c.id
      where s.id = session_id
    )
  );

-- SELECT: a tutor of the session's class (they open the register and
-- must see the statuses already recorded). No parent/student branch —
-- that omission is the privacy boundary, not an oversight.
create policy tutor_attendance_tutor_read on public.tutor_attendance
  for select to authenticated
  using (
    session_id in (
      select id from public.sessions
      where class_id in (select public.fn_my_classes())
    )
  );

-- UPDATE: same set as read (correcting a status later).
create policy tutor_attendance_tutor_update on public.tutor_attendance
  for update to authenticated
  using (
    session_id in (
      select id from public.sessions
      where class_id in (select public.fn_my_classes())
    )
  )
  with check (
    session_id in (
      select id from public.sessions
      where class_id in (select public.fn_my_classes())
    )
  );

-- ALL: admin — every class, read and write, mirroring attendance_admin_all.
create policy tutor_attendance_admin_all on public.tutor_attendance
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

-- ---------- 3. fn_class_tutors ----------
-- The register needs each tutor's name to label a row, and the timeline
-- (PR 2) needs it too. `users_self_read` does not expose other users to
-- a tutor, so — exactly like `fn_student_guardians` for a child's
-- guardians — the names come through a `security definer` function with
-- the entitlement check folded into the WHERE, so a caller who is
-- neither admin nor a tutor of the class gets zero rows rather than an
-- error.
create or replace function public.fn_class_tutors(p_class uuid)
returns table (user_id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select u.id, u.full_name
  from public.classes c
  join public.users u on u.id = any (c.tutor_ids)
  where c.id = p_class
    and (public.fn_is_admin() or p_class in (select public.fn_my_classes()))
  order by u.full_name
$$;

grant execute on function public.fn_class_tutors(uuid) to authenticated;

comment on function public.fn_class_tutors(uuid) is
  'user_id + full_name of each tutor named in a class''s tutor_ids, for '
  'the attendance register''s tutor section and the admin review timeline '
  '(ADR-041). Entitlement (admin, or a tutor of the class) is folded into '
  'the WHERE: a non-entitled caller gets zero rows, the fn_student_guardians '
  'pattern.';
