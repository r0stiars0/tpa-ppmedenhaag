-- ============================================================
-- Migration 025 — weekly push-subscriber count
-- (TAD ADR-045, preliminary change shipped ahead of release 8a;
--  PRD Feature 8 KPI 10, the push opt-out guardrail)
--
-- ── Why ─────────────────────────────────────────────────────
-- Release 8a lets a child be in more than one group, which means more
-- notifications per family. The PRD guards against that with KPI 10:
-- the share of push-subscribed families who switch push off in the 8
-- weeks after each release, compared with the 8 weeks before.
--
-- The app keeps no history to measure that from. Switching push off
-- clears `users.push_sub` (the `push-subscribe` Function's DELETE), and
-- nothing records that it was ever set. So this migration starts a
-- baseline: one number per week, recorded by the Friday
-- weekly-progress-digest scheduled Function. It has to ship before 8a
-- so the "8 weeks before" exist.
--
-- ── What is counted ─────────────────────────────────────────
-- Accounts with a non-null `push_sub` that are a family recipient — an
-- ACTIVE guardian of any child (`student_guardians.unlinked_at is
-- null`, ADR-040) or a 16+ student's own self-login
-- (`students.user_id`). That is exactly the set every notification is
-- addressed to (`notifyStudent.ts`). A tutor with no child of their own
-- has no reason to subscribe and is left out; so is a removed guardian.
-- An account guarding several children counts once.
--
-- ── No personal data ────────────────────────────────────────
-- A week and a count. Nothing identifies who subscribed or who opted
-- out, so this needs no DPIA entry beyond "aggregate usage metric".
--
-- ── Access ──────────────────────────────────────────────────
-- Admin SELECT only (the enrolment_submissions / user_role_changes
-- pattern). No client may write it — not even an admin, who could
-- otherwise rewrite the baseline the KPI is judged against. The only
-- writer is `fn_record_push_subscriber_count`, `security definer`,
-- callable by the service role alone (REVOKE + in-body auth.role()
-- guard, as fn_enrol_from_form in migration 024).
--
-- No explicit table GRANT — migration 007's `alter default privileges`
-- already covers new tables (the 020–024 note).
-- ============================================================

-- ---------- 1. table ----------
create table public.push_subscriber_counts (
  week_start   date primary key,
  subscribed   integer not null check (subscribed >= 0),
  recorded_at  timestamptz not null default now()
);

comment on table public.push_subscriber_counts is
  'One row per week: how many family recipients (active guardians and '
  '16+ self-login students) had Web Push switched on. Baseline for the '
  'push opt-out guardrail, PRD Feature 8 KPI 10 (TAD ADR-045). Aggregate '
  'only, no personal data. Admin-read; written only by '
  'fn_record_push_subscriber_count on the service role.';

alter table public.push_subscriber_counts enable row level security;

-- ---------- 2. RLS ----------
-- SELECT: admin only. No write policy for any client role, so an
-- authenticated INSERT is refused for having no policy, and an UPDATE or
-- DELETE matches no rows.
create policy push_subscriber_counts_admin_read on public.push_subscriber_counts
  for select to authenticated
  using (public.fn_is_admin());

-- ---------- 3. recorder ----------
-- Idempotent per week: the scheduler may run the job twice (the autumn
-- clock change, or a manual re-run during verification), and a re-run
-- must correct the number, not add a second row.
create or replace function public.fn_record_push_subscriber_count(p_week_start date)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'fn_record_push_subscriber_count is service_role only'
      using errcode = '42501';
  end if;

  select count(*) into v_count
  from public.users u
  where u.push_sub is not null
    and (
      exists (select 1 from public.student_guardians g
              where g.user_id = u.id and g.unlinked_at is null)
      or exists (select 1 from public.students s where s.user_id = u.id)
    );

  insert into public.push_subscriber_counts (week_start, subscribed, recorded_at)
  values (p_week_start, v_count, now())
  on conflict (week_start)
    do update set subscribed = excluded.subscribed, recorded_at = excluded.recorded_at;

  return v_count;
end $$;

revoke all on function public.fn_record_push_subscriber_count(date)
  from public, anon, authenticated;
grant execute on function public.fn_record_push_subscriber_count(date)
  to service_role;

comment on function public.fn_record_push_subscriber_count(date) is
  'Counts family recipients with Web Push on and upserts the count for the '
  'given week (PRD Feature 8 KPI 10, TAD ADR-045). service_role only '
  '(REVOKE + auth.role() guard). Called by weekly-progress-digest.';
