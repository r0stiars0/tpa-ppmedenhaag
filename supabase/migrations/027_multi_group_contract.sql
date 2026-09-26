-- ============================================================
-- Migration 027 — the contract step of multi-group enrolment
-- (TAD ADR-045(a0), PRD Feature 8 release 8a)
--
-- ── Why now ─────────────────────────────────────────────────
-- Migration 026 was additive so that the old app and the new one could
-- both run against it while the database and the app went live at
-- different moments. The 8a app has been live in production since, and
-- nothing in it reads or writes what this migration removes:
--   * `students.class_id` — `class_members` is the record of who is in
--     which group; the column was kept only for old app bundles, and a
--     trigger mirrored their writes into `class_members`. Both go, with
--     the column's index and foreign key.
--   * the legacy single-group path of `fn_admin_save_student`
--     (`p_class_id`). The app calls it with `p_class_ids` only, so the
--     function is re-created without the parameter; the named-argument
--     call the app makes is unchanged.
--   * `notifications`' four-column unique key. It is replaced by
--     `(user_id, student_id, event, event_date, ref_id)`, nulls not
--     distinct, so two same-day events of one kind (two absences in two
--     groups) get two in-app rows (AC-011), while a re-run of a scheduled
--     Function still refreshes its row instead of adding one. Adding a
--     column to a key cannot create duplicates among existing rows, and
--     `student_id` is never null, so the swap needs no clean-up. The
--     Functions already upsert on the new key and fell back to the old
--     one on 42P10; the fallback is removed in the same PR.
--
-- ── Order in production ─────────────────────────────────────
-- Apply this migration BEFORE merging its PR. The app now in production
-- works against it unchanged (its notification upsert takes the new key
-- at the first attempt). After this migration, a Netlify rollback can go
-- back only as far as the 8a deploy: a pre-8a bundle reads
-- `students.class_id`.
-- ============================================================

-- ---------- 1. students.class_id, its sync trigger and its index ----------
drop trigger trg_students_class_id_sync on public.students;
drop function public.fn_students_class_id_sync();
drop index if exists public.idx_students_class;
-- Fails loudly, rather than cascading, if anything still depends on it.
alter table public.students drop column class_id;

-- ---------- 2. fn_admin_save_student without p_class_id ----------
drop function public.fn_admin_save_student(text, date, jsonb, uuid, uuid, uuid, uuid[]);

create or replace function public.fn_admin_save_student(
  p_full_name  text,
  p_dob        date,
  p_guardians  jsonb,
  p_id         uuid    default null,
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
    insert into public.students (full_name, date_of_birth, user_id)
    values (p_full_name, p_dob, p_user_id)
    returning id into v_id;
  else
    update public.students
      set full_name = p_full_name, date_of_birth = p_dob, user_id = p_user_id
      where id = p_id
    returning id into v_id;
  end if;
  if v_id is null then
    raise exception 'no such student %', p_id using errcode = 'no_data_found';
  end if;

  -- p_class_ids null leaves the group set as it is (an edit of name,
  -- birth date, login or guardians only).
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

grant execute on function public.fn_admin_save_student(text, date, jsonb, uuid, uuid, uuid[]) to authenticated;

-- ---------- 3. notifications: the key that includes ref_id ----------
alter table public.notifications
  add constraint notifications_user_student_event_date_ref_key
  unique nulls not distinct (user_id, student_id, event, event_date, ref_id);
alter table public.notifications
  drop constraint notifications_user_id_student_id_event_event_date_key;

