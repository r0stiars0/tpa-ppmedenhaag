-- 010_notification_triggers.sql
--
-- The remaining event-driven notifications (TAD ADR-015 part 2a):
-- jilid completed, surah memorized, new homework assigned, year-end
-- report published.
--
-- Migration 009 established the pattern with a single trigger. Four more
-- of them is the point at which the pg_net call, the Vault lookup, the
-- envelope shape and the "never fail the write" guarantee should exist
-- once rather than five times, so this migration extracts
-- `fn_post_webhook()` and rewrites 009's function to use it too.
--
-- Configuration is unchanged: both Vault secrets absent means every
-- trigger here is a no-op. See README "Database webhooks".

-- ---------------------------------------------------------------------
-- Shared sender
-- ---------------------------------------------------------------------
create or replace function public.fn_post_webhook(
  fn_path   text,
  tbl       text,
  op        text,
  record_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg record;
begin
  select * into cfg from public.fn_webhook_config();
  if cfg.base_url is null or cfg.secret is null then
    return;   -- unconfigured environment: nothing to call
  end if;

  -- Only the row id is sent, for every one of these. The Function
  -- re-reads the row itself, so the payload needs nothing more — and
  -- nothing that could be sensitive (an absence reason, a tutor's
  -- notes, a grade) ever leaves the database in a webhook body.
  -- `type`/`table`/`schema` mirror Supabase's own webhook envelope.
  perform net.http_post(
    url     := cfg.base_url || '/' || fn_path,
    body    := jsonb_build_object(
                 'type', op,
                 'table', tbl,
                 'schema', 'public',
                 'record', jsonb_build_object('id', record_id)
               ),
    headers := jsonb_build_object(
                 'content-type', 'application/json',
                 'x-webhook-secret', cfg.secret
               ),
    timeout_milliseconds := 5000
  );
end;
$$;

comment on function public.fn_post_webhook(text, text, text, uuid) is
  'Queues a notification webhook via pg_net. No-op when Vault holds no configuration. Callers must swallow their own errors — see the trigger functions below.';

revoke all on function public.fn_post_webhook(text, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Absence (migration 009) — rewritten onto the shared sender
-- ---------------------------------------------------------------------
create or replace function public.fn_notify_absence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only the transition *into* absent is an event. Attendance is saved
  -- with an upsert over the whole roster, so every save re-writes every
  -- row; without this guard a tutor correcting one student would
  -- re-notify every absent family in the class.
  if new.status is distinct from 'absent'::public.attendance_status then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'absent'::public.attendance_status then
    return new;
  end if;

  perform public.fn_post_webhook('notify-absence', 'attendance', tg_op, new.id);
  return new;
exception
  when others then
    raise warning 'fn_notify_absence: % (%)', sqlerrm, sqlstate;
    return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Jilid completed (PRD Feature 3 FR-006)
-- ---------------------------------------------------------------------
--
-- **This trigger is deliberately not selective.** It fires for every
-- Yanbu'a progress entry and lets `notify-milestone` decide whether the
-- entry completed a jilid.
--
-- The obvious optimization — filtering here on `mastery = 'lancar' and
-- page >= (select page_count ...)` — would put a second copy of the
-- completion rule in SQL, where it would silently disagree with
-- `src/lib/yanbua.ts#isJilidComplete` the first time that rule changes
-- (say, if PPME decides a repeated last page still counts). The rule is
-- curriculum policy and lives in exactly one place; this trigger only
-- knows that *something* was recorded.
--
-- The cost is invocations, not correctness: ~200 students at a few
-- entries a month each is under a thousand calls, against Netlify's
-- 125K free allowance, and the Function's "not a jilid completion" exit
-- is two queries and no push. See the TAD's Billing section.
create or replace function public.fn_notify_jilid_milestone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.fn_post_webhook('notify-milestone', 'yanbua_progress', tg_op, new.id);
  return new;
exception
  when others then
    raise warning 'fn_notify_jilid_milestone: % (%)', sqlerrm, sqlstate;
    return new;
end;
$$;

drop trigger if exists trg_notify_jilid_milestone on public.yanbua_progress;
create trigger trg_notify_jilid_milestone
  after insert on public.yanbua_progress
  for each row
  execute function public.fn_notify_jilid_milestone();

-- ---------------------------------------------------------------------
-- Surah memorized (PRD Feature 5 FR-005)
-- ---------------------------------------------------------------------
--
-- Unlike the jilid rule, this one is not curriculum policy at all: it is
-- an explicit tutor action. "Tandai Sudah Hafal" flips `active` to false
-- (checklist §13 resolved FR-005 that way rather than adding an
-- assessment column), so the state transition *is* the event and can be
-- matched here without duplicating any rule.
create or replace function public.fn_notify_surah_memorized()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (old.active and not new.active) then
    return new;   -- re-activating, or any other edit, is not a milestone
  end if;

  perform public.fn_post_webhook('notify-milestone', 'murajaah_assignments', tg_op, new.id);
  return new;
exception
  when others then
    raise warning 'fn_notify_surah_memorized: % (%)', sqlerrm, sqlstate;
    return new;
end;
$$;

drop trigger if exists trg_notify_surah_memorized on public.murajaah_assignments;
create trigger trg_notify_surah_memorized
  after update of active on public.murajaah_assignments
  for each row
  execute function public.fn_notify_surah_memorized();

-- ---------------------------------------------------------------------
-- New homework assigned (PRD Feature 2)
-- ---------------------------------------------------------------------
create or replace function public.fn_notify_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.fn_post_webhook('notify-assignment', 'assignments', tg_op, new.id);
  return new;
exception
  when others then
    raise warning 'fn_notify_assignment: % (%)', sqlerrm, sqlstate;
    return new;
end;
$$;

drop trigger if exists trg_notify_assignment on public.assignments;
create trigger trg_notify_assignment
  after insert on public.assignments
  for each row
  execute function public.fn_notify_assignment();

-- ---------------------------------------------------------------------
-- Year-end report published (PRD Feature 6 FR-007)
-- ---------------------------------------------------------------------
--
-- Fires on the transition into `published` only. A re-publish after a
-- correction (FR-006) leaves `status` at `published` and preserves the
-- original `published_at`, so there is no second publish event; and an
-- admin may edit a published report *without* the PDF being regenerated
-- (ADR-014(e)), which is exactly the case where a second "your report is
-- ready" would be untrue. See `notify-report-ready.mts`.
create or replace function public.fn_notify_report_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from 'published'::public.report_status then
    return new;
  end if;
  if old.status is not distinct from 'published'::public.report_status then
    return new;
  end if;

  perform public.fn_post_webhook('notify-report-ready', 'year_end_reports', tg_op, new.id);
  return new;
exception
  when others then
    raise warning 'fn_notify_report_published: % (%)', sqlerrm, sqlstate;
    return new;
end;
$$;

drop trigger if exists trg_notify_report_published on public.year_end_reports;
create trigger trg_notify_report_published
  after update of status on public.year_end_reports
  for each row
  execute function public.fn_notify_report_published();

revoke all on function public.fn_notify_jilid_milestone()    from public, anon, authenticated;
revoke all on function public.fn_notify_surah_memorized()    from public, anon, authenticated;
revoke all on function public.fn_notify_assignment()         from public, anon, authenticated;
revoke all on function public.fn_notify_report_published()   from public, anon, authenticated;
