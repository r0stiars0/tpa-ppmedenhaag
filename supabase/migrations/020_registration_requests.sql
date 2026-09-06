-- ============================================================
-- TPA PPME Den Haag — Migration 020: registration requests
--
-- Lets a signed-in-but-unregistered user (an auth.users row with no
-- matching public.users row) submit their own full name plus free-text
-- context before an admin approves them, so the admin has something to
-- go on beyond an email address (TAD ADR-038).
--
-- A row in public.users *is* "registered" — AuthContext derives
-- `unregistered` from the absence of one — so this cannot be a write
-- into that table without turning a request into self-approval. It gets
-- its own staging table, 1:1 with auth.users like public.users is.
--
-- ── RLS ─────────────────────────────────────────────────────
-- Mirrors public.users' own self-read / self-update / admin-all shape
-- (migration 003), plus the self-insert that table never needed. The
-- self-insert WITH CHECK also refuses an already-registered caller —
-- defence in depth: no UI path reaches the form once registered, but
-- the policy does not rely on that.
--
-- ── Cleanup ─────────────────────────────────────────────────
-- fn_cleanup_registration_request() deletes the request row once the
-- matching public.users row is inserted, by AFTER INSERT trigger — so
-- no write path (registerUser, invite-user, any future one) has to
-- remember. SECURITY DEFINER on purpose: only registration_requests_
-- admin_all grants DELETE, and a non-admin / non-service-role insert
-- path would otherwise have the delete silently filtered to 0 rows,
-- leaving the free-text description behind. A never-approved request is
-- left in place — ADR-039's admin reject flow removes those.
--
-- ── fn_pending_registrations() ──────────────────────────────
-- Widened to carry full_name/description. A table function's return
-- columns cannot be changed by CREATE OR REPLACE, so it is dropped and
-- recreated. Both columns come back NULL for any pending entry with no
-- request row (invite-created, or predating this migration).
--
-- No explicit table GRANT: migration 007's `alter default privileges
-- ... to anon, authenticated, service_role` already covers new tables.
-- ============================================================

create table public.registration_requests (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint registration_requests_full_name_len
    check (char_length(full_name) between 1 and 120),
  constraint registration_requests_description_len
    check (description is null or char_length(description) <= 2000)
);

comment on table public.registration_requests is
  'Self-service submission by an authenticated-but-unregistered user: '
  'their full name + free-text context, surfaced to admins via '
  'fn_pending_registrations() and deleted by trigger on approval (ADR-038).';

alter table public.registration_requests enable row level security;

-- updated_at maintenance — same helper and pattern as assignment_status
-- / year_end_reports (migration 002).
create trigger trg_registration_requests_touch
  before update on public.registration_requests
  for each row execute function public.fn_touch_updated_at();

-- ---------- RLS policies ----------

create policy registration_requests_self_read on public.registration_requests
  for select to authenticated
  using (id = auth.uid() or public.fn_is_admin());

create policy registration_requests_self_insert on public.registration_requests
  for insert to authenticated
  with check (
    id = auth.uid()
    and not exists (select 1 from public.users where id = auth.uid())
  );

create policy registration_requests_self_update on public.registration_requests
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy registration_requests_admin_all on public.registration_requests
  for all to authenticated
  using (public.fn_is_admin())
  with check (public.fn_is_admin());

-- ---------- cleanup on approval ----------

create or replace function public.fn_cleanup_registration_request()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.registration_requests where id = new.id;
  return new;
end $$;

create trigger trg_cleanup_registration_request
  after insert on public.users
  for each row execute function public.fn_cleanup_registration_request();

-- ---------- widen the admin pending-list function ----------

drop function public.fn_pending_registrations();

create function public.fn_pending_registrations()
returns table(id uuid, email text, created_at timestamptz, full_name text, description text)
language sql stable security definer set search_path = public as $$
  select au.id, au.email, au.created_at, rr.full_name, rr.description
  from auth.users au
  left join public.users pu on pu.id = au.id
  left join public.registration_requests rr on rr.id = au.id
  where pu.id is null
    and public.fn_is_admin()
  order by au.created_at
$$;

grant execute on function public.fn_pending_registrations() to authenticated;
