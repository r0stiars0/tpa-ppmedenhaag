-- ============================================================
-- TPA PPME Den Haag — Migration 012: In-app notification centre
--
-- ADR-015 part 3, and TAD ADR-017.
--
-- ── What this table is, and what it deliberately is not ──────
-- It records **domain events addressed to a person**: this
-- recipient was told this thing about this child on this day.
-- Nothing in it describes how a screen shows that — no ordering
-- key, no grouping, no category, no icon, no pinned flag, no
-- rendered string.
--
-- That is a direct response to the reason part 3 was held back:
-- the notification centre screen has never been through the
-- prototype design review (PRD §71 still lists it as an open
-- follow-up), and shipping a migration alongside an unreviewed
-- screen is how a schema gets locked around a design nobody
-- agreed to. A table of events survives any design; a table
-- shaped like a particular list does not. Every string the
-- screen renders is built at read time from `event` + `context`
-- against the i18n copy, so re-designing the centre — or
-- rewording it, or grouping it by child, or splitting it into
-- tabs — needs no migration.
--
-- ── Why rows are written even with push switched off ─────────
-- The centre's main audience is families who declined push
-- notifications, or whose browser never supported them. So a
-- row here is *not* a log of what was pushed: `notifyStudents`
-- records for every recipient in the audience and pushes only to
-- the subset with a usable subscription. The two counts differ
-- on purpose.
--
-- ── The unique key is the dedup tag ──────────────────────────
-- (user_id, student_id, event, event_date) is exactly the tuple
-- `dedupTag()` builds for the lock screen (ADR-016(f)). One
-- concept of "the same notification", enforced in both places:
-- the browser replaces rather than stacks, and the table takes
-- `on conflict do update`. That is what makes the hourly
-- scheduled Functions safe to re-run here too — the second run
-- of `homework-due-reminders` must not leave a family with two
-- identical entries.
-- ============================================================

-- Labels match `NOTIFICATION_EVENTS` in
-- `netlify/functions/lib/notifications.ts` character for character,
-- and therefore the i18n keys under `notifications.*` too. camelCase
-- is not this schema's convention elsewhere, and it is used here
-- deliberately: the alternative is a snake_case enum plus a mapping
-- table in TypeScript, and a mapping is one more place for the two
-- lists to drift apart. `tests/unit/notificationEvents.test.ts`
-- asserts the enum and the TypeScript union stay identical.
do $$ begin
  create type notification_event as enum (
    'absence',
    'newAssignment',
    'assignmentDueTomorrow',
    'jilidMilestone',
    'surahMemorized',
    'murajaahReminder',
    'reportReady',
    'weeklyDigest'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  -- The recipient. Cascade on delete: a removed account's
  -- notifications have nobody to read them.
  user_id     uuid not null references public.users (id) on delete cascade,
  -- The child it is about. Cascade is what carries the notification
  -- centre into the right-to-erasure path (GDPR art. 17) without a
  -- second cleanup step — deleting a student removes their rows from
  -- every family's list, same as every other student-scoped table.
  student_id  uuid not null references public.students (id) on delete cascade,
  event       notification_event not null,
  -- Everything the in-app copy interpolates beyond the child's name:
  -- the jilid number, the surah, the assignment title and due date.
  -- The child's name is *not* in here — it is read through
  -- `student_id`, so a corrected name corrects the whole history and
  -- the name is not duplicated across hundreds of rows.
  --
  -- DPIA R6 limits the *push payload*, not this. R6's threat model is
  -- a lock screen; these rows are only ever read by an authenticated
  -- recipient, which is the whole point of the two-tier copy split
  -- (ADR-015(b)) — the richer wording the Notification Spec drafted
  -- lives here.
  context     jsonb not null default '{}'::jsonb,
  -- The family's own calendar date in Europe/Amsterdam, supplied by
  -- the sender rather than derived from now(): the sender already
  -- computed it for the dedup tag, and a row written at 23:30 CEST
  -- must belong to the day the family is living in, not UTC's.
  event_date  date not null,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  unique (user_id, student_id, event, event_date)
);

-- The centre's only query: this user's notifications, newest first.
create index if not exists idx_notifications_user
  on public.notifications (user_id, created_at desc);

-- The badge's query, and the retention job's scan.
create index if not exists idx_notifications_unread
  on public.notifications (user_id) where read_at is null;
create index if not exists idx_notifications_created
  on public.notifications (created_at);

alter table public.notifications enable row level security;

-- ---------- RLS ----------
-- A notification is addressed to one person, and only that person
-- reads it.
create policy notifications_own_read on public.notifications
  for select to authenticated using (user_id = auth.uid());

-- Marking as read is the only thing a client may change, and the
-- column grant below is what actually restricts it to `read_at` —
-- RLS has no column granularity, so a policy alone would let a
-- recipient rewrite `event` or `context` on their own rows and make
-- the app render something that never happened.
create policy notifications_own_mark_read on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- **No insert policy, for anyone.** Rows are written only by the
-- notification Functions, which hold the service-role key and bypass
-- RLS. A client that could insert here could put words in the TPA's
-- mouth on another parent's screen.
--
-- **No delete policy**, either: retention is handled centrally by
-- `prune-notifications` rather than per-user, so there is no path by
-- which a record of what a family was told disappears early.
--
-- **No admin policy.** This is a deliberate exception to ADR-014's
-- super admin, and the one place that decision does not extend.
-- ADR-014 gave admin the *operational* screens — attendance,
-- progress, reports — because running the TPA needs them. A
-- notification is a message addressed to a named parent; letting an
-- admin read every family's inbox is a different kind of access,
-- adds nothing to running the TPA, and is not defensible under data
-- minimisation. Admin also receives none, by ADR-015(a).

-- ---------- privileges ----------
-- Migration 007's default privileges hand every new table blanket
-- insert/update/delete to anon and authenticated, filtered afterwards
-- by RLS. For this table that is too coarse in one specific way, so
-- the write grants are narrowed to exactly what the app needs.
revoke insert, update, delete on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------- TRUNCATE / TRIGGER, on every table ----------
-- Found while checking the grants above, and not specific to this
-- table: `anon` and `authenticated` hold TRUNCATE and TRIGGER on every
-- table in `public`. Those come from Supabase's own role bootstrap
-- (`grant all ... to anon, authenticated`), not from migration 007,
-- which grants only select/insert/update/delete.
--
-- **TRUNCATE is not filtered by RLS.** Verified directly: `set role
-- authenticated; truncate public.attendance;` succeeds, emptying a
-- table that RLS otherwise restricts to one class's tutor. TRIGGER
-- likewise allows attaching a trigger to a table the role cannot
-- otherwise write.
--
-- It is not reachable through this app today: PostgREST exposes no
-- TRUNCATE, and no `security invoker` function here executes dynamic
-- SQL, so there is no path from a signed-in session to either verb.
-- It is removed anyway, because nothing legitimate uses them and the
-- gap between "no route to it today" and "catastrophic if a route
-- appears" is the whole argument for least privilege. Revoking costs
-- nothing: the app has never truncated a table, and migrations run as
-- `postgres`, which is unaffected.
revoke truncate, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public
  revoke truncate, trigger on tables from anon, authenticated;
