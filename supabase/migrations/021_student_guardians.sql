-- ============================================================
-- TPA PPME Den Haag — Migration 021: multiple guardians per student
--
-- Retires `students.parent_id` (a single NOT NULL FK — one adult per
-- child) in favour of `public.student_guardians`, a symmetric many-to-many
-- between a child and their guardian accounts (TAD ADR-040).
--
-- Why this is a small change: every family-facing grant already flows
-- through `fn_my_children()` (11 policies) or one of three inline
-- `parent_id = auth.uid()` sub-selects. So the data-layer delta is one
-- new table + its policies + two invariant triggers, one function body,
-- three `alter policy`, one policy re-created under a new name, four new
-- read/write functions, a backfill, and the column drop.
--
-- ── The "at least one guardian" invariant ───────────────────
-- `parent_id NOT NULL` made a guardian-less child impossible for free.
-- Two triggers keep that guarantee at the database, not app-only:
--   trg_guardian_keep_one  — refuses removing/unlinking the last active
--                            link (lets an ON DELETE CASCADE through)
--   trg_student_has_guardian — a DEFERRABLE constraint trigger: a
--                            `students` row with no active guardian
--                            fails at COMMIT
--
-- ── RLS (Q1 at sign-off) ────────────────────────────────────
-- A guardian reads their own active links; a tutor reads the active
-- links of students in their own classes; an admin reads all, unlinked
-- rows included. Writes are admin-only. Guardian names/emails for the
-- admin & tutor UI come through `fn_student_guardians()` because
-- `users_self_read` does not expose other users to a tutor.
--
-- ── Backfill ────────────────────────────────────────────────
-- One active link per existing student, from `students.parent_id`, then
-- the column (and its index, and the fkey the PostgREST embed used) is
-- dropped. Every RLS-01…RLS-64 assertion must still pass; new cases run
-- from RLS-65 (test-plan.md §3.5).
--
-- No explicit table GRANT — migration 007's `alter default privileges
-- ... to anon, authenticated, service_role` already covers new tables.
-- ============================================================

-- ---------- 1. table ----------
create table public.student_guardians (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students (id) on delete cascade,
  user_id     uuid not null references public.users (id)    on delete restrict,
  relation    text,
  created_at  timestamptz not null default now(),
  unlinked_at timestamptz,
  constraint student_guardians_relation_len
    check (relation is null or char_length(relation) between 1 and 40)
);

comment on table public.student_guardians is
  'Symmetric many-to-many between a child and their guardian accounts '
  '(ADR-040). Replaces students.parent_id. A child always has >=1 row '
  'with unlinked_at IS NULL (trigger-enforced); every active guardian '
  'gets the full family grant. A removed link keeps its row with '
  'unlinked_at set, for audit.';

alter table public.student_guardians enable row level security;

-- ---------- 2. RLS policies ----------
-- SELECT: a guardian sees their own active links.
create policy sguard_self_read on public.student_guardians
  for select to authenticated
  using (user_id = auth.uid() and unlinked_at is null);

-- SELECT: a tutor sees the active links of students in their classes
-- (so the admin/tutor UI can show a child's contacts). Q1, ADR-040(d).
create policy sguard_tutor_read on public.student_guardians
  for select to authenticated
  using (unlinked_at is null and student_id in (select public.fn_my_class_students()));

-- ALL: admin, including unlinked rows (the audit trail).
create policy sguard_admin_all on public.student_guardians
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

-- ---------- 3. invariant triggers ----------
-- B1: cannot remove or unlink the last active guardian of a live student.
create or replace function public.fn_guardian_keep_one()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Only act when a link is actually leaving the active set.
  if tg_op = 'UPDATE'
     and not (old.unlinked_at is null and new.unlinked_at is not null) then
    return new;
  end if;

  -- Student row already gone → this is an ON DELETE CASCADE; allow it.
  if not exists (select 1 from public.students where id = old.student_id) then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if (select count(*) from public.student_guardians
      where student_id = old.student_id
        and unlinked_at is null
        and id <> old.id) = 0 then
    raise exception
      'student % must keep at least one active guardian', old.student_id
      using errcode = 'check_violation';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end $$;

create trigger trg_guardian_keep_one
  before update or delete on public.student_guardians
  for each row execute function public.fn_guardian_keep_one();

-- B2: a student must have an active guardian by commit time. DEFERRABLE
-- so "insert student, then insert its guardians" in one txn is fine.
create or replace function public.fn_student_has_guardian()
returns trigger language plpgsql set search_path = public as $$
begin
  -- The row may have been deleted before commit (a mistaken enrolment
  -- undone in the same transaction) — a student that no longer exists
  -- needs no guardian.
  if not exists (select 1 from public.students where id = new.id) then
    return new;
  end if;
  if not exists (select 1 from public.student_guardians
                 where student_id = new.id and unlinked_at is null) then
    raise exception
      'student % must have at least one active guardian', new.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create constraint trigger trg_student_has_guardian
  after insert on public.students
  deferrable initially deferred
  for each row execute function public.fn_student_has_guardian();

-- ---------- 4. backfill ----------
insert into public.student_guardians (student_id, user_id)
select id, parent_id from public.students;

-- ---------- 5. indexes ----------
create unique index student_guardians_active_uq
  on public.student_guardians (student_id, user_id) where unlinked_at is null;
create index student_guardians_user_active
  on public.student_guardians (user_id) where unlinked_at is null;
create index student_guardians_student
  on public.student_guardians (student_id);

-- ---------- 6. the linchpin: fn_my_children() ----------
create or replace function public.fn_my_children()
returns setof uuid language sql stable security definer set search_path = public as $$
  select student_id from public.student_guardians
  where user_id = auth.uid() and unlinked_at is null
$$;

comment on function public.fn_my_children() is
  'student_ids the caller is an active guardian of (student_guardians, '
  'ADR-040). Body rewritten from `where parent_id = auth.uid()`; the 11 '
  'policies that call it are unchanged.';

-- ---------- 7. students_parent_read → students_guardian_read ----------
drop policy students_parent_read on public.students;
create policy students_guardian_read on public.students
  for select to authenticated
  using (id in (select public.fn_my_children()));

-- ---------- 8. the three inline family branches ----------
alter policy classes_read on public.classes using (
  public.fn_is_admin()
  or auth.uid() = any (tutor_ids)
  or id in (select class_id from public.students where id in (select public.fn_my_children()))
  or id in (select class_id from public.students where user_id = auth.uid())
);

alter policy sessions_family_read on public.sessions using (
  class_id in (select class_id from public.students where id in (select public.fn_my_children()))
  or class_id in (select class_id from public.students where user_id = auth.uid())
);

alter policy assignments_family_read on public.assignments using (
  class_id in (select class_id from public.students where id in (select public.fn_my_children()))
  or class_id in (select class_id from public.students where user_id = auth.uid())
);

-- ---------- 9. read/write functions ----------
-- Guardian names/emails for the admin & tutor enrolment UI. security
-- definer with the caller check folded into WHERE (the
-- fn_pending_registrations pattern): a non-entitled caller gets zero
-- rows, not an error.
create or replace function public.fn_student_guardians(p_student uuid)
returns table (user_id uuid, full_name text, email text, relation text)
language sql stable security definer set search_path = public as $$
  select g.user_id, u.full_name, u.email, g.relation
  from public.student_guardians g
  join public.users u on u.id = g.user_id
  where g.student_id = p_student
    and g.unlinked_at is null
    and (
      public.fn_is_admin()
      or p_student in (select public.fn_my_class_students())
    )
  order by u.full_name
$$;

grant execute on function public.fn_student_guardians(uuid) to authenticated;

-- The app's "my children" query (replaces the PostgREST
-- `or=(parent_id.eq.<uid>,user_id.eq.<uid>)` string in capabilities.ts).
create or replace function public.fn_my_family_students()
returns table (id uuid, full_name text, user_id uuid, is_guardian boolean, is_self boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.full_name, s.user_id,
    exists (select 1 from public.student_guardians g
            where g.student_id = s.id and g.user_id = auth.uid()
              and g.unlinked_at is null)               as is_guardian,
    coalesce(s.user_id = auth.uid(), false)            as is_self
  from public.students s
  where s.id in (select public.fn_my_children())
     or s.user_id = auth.uid()
$$;

grant execute on function public.fn_my_family_students() to authenticated;

-- The data-minimising half: push-subscribe / the settings screen answer
-- "may this account receive notifications" without loading child names
-- (ADR-022(c), ADR-040(e)).
--
-- `p_user` defaults to `auth.uid()` for the browser. `push-subscribe` is
-- a Netlify Function on the service-role client — it has no `auth.uid()`
-- — so it passes the caller's id explicitly. The result is two booleans
-- about that account and no child data, so an authenticated caller
-- passing someone else's id learns nothing sensitive.
create or replace function public.fn_my_family_flags(p_user uuid default null)
returns table (is_parent boolean, is_self boolean)
language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from public.student_guardians
            where user_id = coalesce(p_user, auth.uid()) and unlinked_at is null),
    exists (select 1 from public.students where user_id = coalesce(p_user, auth.uid()))
$$;

grant execute on function public.fn_my_family_flags(uuid) to authenticated;

-- One admin RPC for the whole student save — the students row and its
-- guardian set written in a single transaction, so trigger B2 always has
-- a consistent state to check and a half-written student cannot exist
-- between two HTTP calls (ADR-040(g)). Replaces createStudent/updateStudent.
create or replace function public.fn_admin_save_student(
  p_full_name  text,
  p_dob        date,
  p_guardians  jsonb,               -- [{ "user_id": "...", "relation": "moeder" }, …], >=1
  p_id         uuid default null,   -- null → insert
  p_class_id   uuid default null,
  p_user_id    uuid default null    -- 16+ self-login link
) returns uuid
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
    values (p_full_name, p_dob, p_class_id, p_user_id)
    returning id into v_id;
  else
    update public.students
      set full_name = p_full_name, date_of_birth = p_dob,
          class_id = p_class_id, user_id = p_user_id
      where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'no such student %', p_id using errcode = 'no_data_found';
    end if;
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

grant execute on function public.fn_admin_save_student(text, date, jsonb, uuid, uuid, uuid) to authenticated;

-- ---------- 10. drop the retired column ----------
drop index if exists public.idx_students_parent;
alter table public.students drop column parent_id;
