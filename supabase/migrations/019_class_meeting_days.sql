-- ============================================================
-- TPA PPME Den Haag — Migration 019: class meeting days
--
-- Adds `classes.meeting_days`: which weekday(s) a group meets, as
-- `dow` integers — 0 = Sunday … 6 = Saturday. That is the numbering
-- `Date#getDay()` and Postgres `extract(dow from …)` already share,
-- and the one `src/lib/murajaah.ts` uses ("0 = Sunday"); it is chosen
-- over ISO-8601 1–7 precisely so no code needs a conversion layer
-- between the browser, this column and the trigger below (TAD ADR-037).
--
-- The free-text `classes.schedule` column is unchanged and still
-- carries the human-readable time range ("Sabtu 10:00-12:00"). This
-- column carries the days, so the attendance register can be driven by
-- the schedule instead of by raw "today".
--
-- ── trg_sessions_meeting_day ─────────────────────────────────
-- A BEFORE INSERT trigger on `public.sessions` refuses a row whose
-- `date` falls on a weekday the class does not meet. It is INSERT-only
-- on purpose: UPDATE and DELETE of an existing session stay exactly as
-- they were (migration 017), so a mistake in a recorded session is
-- still correctable. It binds every caller, admin included — a genuine
-- one-off extra class is expressed by widening `meeting_days` first,
-- not by an override path (ADR-037). Sibling policies on `sessions`
-- and `attendance` are untouched.
--
-- ── Existing data ───────────────────────────────────────────
-- Every current group meets on Saturday only, and no `sessions` or
-- `students` rows exist yet (classes have not started). So the
-- backfill is a uniform `'{6}'` and there is nothing to reconcile
-- between historic sessions and the new schedule.
--
-- ── Ordering ────────────────────────────────────────────────
-- ADD COLUMN … NOT NULL DEFAULT fills every existing row atomically,
-- so the CHECK that follows validates against populated data. The
-- explicit UPDATE is redundant with the DEFAULT and kept only to state
-- intent. The trigger function is created before the trigger.
--
-- No data migration beyond the backfill; writes nothing to sessions
-- or attendance.
-- ============================================================

alter table public.classes
  add column meeting_days smallint[] not null default '{6}';

update public.classes
  set meeting_days = '{6}'
  where meeting_days is null;

-- A CHECK constraint cannot contain a subquery, and the "no duplicates"
-- rule needs one (unnest + count distinct). Wrapping it in an IMMUTABLE
-- function is the standard way round that — the constraint calls the
-- function, the subquery lives inside it.
create or replace function public.fn_valid_dow_set(days smallint[])
returns boolean
language sql
immutable
as $$
  select days is not null
     and cardinality(days) between 1 and 7
     and days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
     and cardinality(days) = (select count(distinct d) from unnest(days) as d)
$$;

alter table public.classes
  add constraint classes_meeting_days_valid
  check (public.fn_valid_dow_set(meeting_days));

comment on column public.classes.meeting_days is
  'Weekday(s) the group meets, as dow integers (0=Sunday … 6=Saturday). '
  'Non-empty, no duplicates. Gates session creation via trg_sessions_meeting_day (ADR-037).';

create or replace function public.fn_sessions_meeting_day()
returns trigger
language plpgsql
as $$
declare
  v_days smallint[];
begin
  select meeting_days into v_days
    from public.classes
    where id = new.class_id;

  if v_days is null then
    -- The FK on sessions.class_id will reject this too; raising here
    -- keeps the message specific if the trigger somehow runs first.
    raise exception 'class % not found', new.class_id
      using errcode = 'foreign_key_violation';
  end if;

  if not (extract(dow from new.date)::smallint = any (v_days)) then
    raise exception
      'session date % (weekday %) is not a meeting day for class % (meeting_days %)',
      new.date, extract(dow from new.date)::int, new.class_id, v_days
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_sessions_meeting_day
  before insert on public.sessions
  for each row
  execute function public.fn_sessions_meeting_day();
