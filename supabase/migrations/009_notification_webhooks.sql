-- 009_notification_webhooks.sql
--
-- Database webhooks: Supabase -> Netlify Functions (checklist §3).
--
-- Supabase's dashboard "Database Webhooks" feature creates exactly this
-- — a trigger calling pg_net — but creates it by hand, in one project,
-- with the target URL and secret baked into the trigger definition.
-- Written as a migration instead, the trigger is version-controlled,
-- reproduced by `supabase db reset`, and identical in CI, on a laptop
-- and in Frankfurt. What differs per environment is only the
-- configuration, which is read at fire time from Supabase Vault rather
-- than hardcoded:
--
--   select vault.create_secret('https://tpa.ppmedenhaag.nl/.netlify/functions',
--                              'notify_webhook_base_url');
--   select vault.create_secret('<same value as Netlify NOTIFY_WEBHOOK_SECRET>',
--                              'notify_webhook_secret');
--
-- With neither secret present the trigger does nothing at all, which is
-- what makes a fresh `db reset`, the pgTAP suite and CI silent: no
-- configuration, no outbound requests. See README "Database webhooks".

-- ---------------------------------------------------------------------
-- Config lookup
-- ---------------------------------------------------------------------
create or replace function public.fn_webhook_config()
returns table (base_url text, secret text)
language sql
security definer
set search_path = ''
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'notify_webhook_base_url'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'notify_webhook_secret');
$$;

comment on function public.fn_webhook_config() is
  'Per-environment webhook target, read from Vault. Returns NULLs when unconfigured, which makes every webhook trigger a no-op (fresh local stacks, CI, the pgTAP suite).';

-- Vault is readable by the postgres role only; nothing client-facing
-- should ever be able to read the shared secret back out.
revoke all on function public.fn_webhook_config() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Absence notification (PRD Feature 1 FR-005)
-- ---------------------------------------------------------------------
create or replace function public.fn_notify_absence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg record;
begin
  -- Only the transition *into* absent is an event. Attendance is saved
  -- with an upsert over the whole roster (`submitAttendance`), so every
  -- save re-writes every row; without this guard a tutor correcting one
  -- student would re-notify every absent family in the class.
  if new.status is distinct from 'absent'::public.attendance_status then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'absent'::public.attendance_status then
    return new;
  end if;

  select * into cfg from public.fn_webhook_config();
  if cfg.base_url is null or cfg.secret is null then
    return new;   -- unconfigured environment: nothing to call
  end if;

  -- Only the row id is sent. The Function re-reads the row itself, so
  -- the payload needs nothing else — and this way the absence `reason`,
  -- which can carry health data (DPIA R4), never leaves the database at
  -- all. `type`/`table`/`schema` mirror Supabase's own webhook envelope
  -- so a hand-configured dashboard webhook would be interchangeable.
  perform net.http_post(
    url     := cfg.base_url || '/notify-absence',
    body    := jsonb_build_object(
                 'type', tg_op,
                 'table', 'attendance',
                 'schema', 'public',
                 'record', jsonb_build_object('id', new.id)
               ),
    headers := jsonb_build_object(
                 'content-type', 'application/json',
                 'x-webhook-secret', cfg.secret
               ),
    timeout_milliseconds := 5000
  );

  return new;
exception
  when others then
    -- Recording attendance must never fail because a notification could
    -- not be queued (PRD 1.6: the tutor's save is the product; the push
    -- is a courtesy). Swallow, log, and let the write through.
    raise warning 'fn_notify_absence: % (%)', sqlerrm, sqlstate;
    return new;
end;
$$;

comment on function public.fn_notify_absence() is
  'Queues a /notify-absence webhook when an attendance row becomes absent. No-op when unconfigured; never blocks or fails the attendance write.';

revoke all on function public.fn_notify_absence() from public, anon, authenticated;

drop trigger if exists trg_notify_absence on public.attendance;
create trigger trg_notify_absence
  after insert or update of status on public.attendance
  for each row
  execute function public.fn_notify_absence();
