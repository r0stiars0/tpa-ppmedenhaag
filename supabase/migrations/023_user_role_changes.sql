-- ============================================================
-- TPA PPME Den Haag — Migration 023: admin user directory + role audit
--
-- The TPA head asked for one screen that lists every user and lets an
-- admin correct someone's display name or role (TAD ADR-042, PRD FR-009).
-- The write path already exists — `users_admin_all` (migration 003) grants
-- an admin `ALL` on `public.users`, `role` column included — so a plain
-- PostgREST `update` would work. It is not used, for two reasons this
-- migration encodes as a `security definer` RPC instead:
--
--   1. A role change must not be able to lock the TPA out of its own
--      admin surface (demoting the last admin) or let an admin quietly
--      demote themselves (`users_self_update` blocks that for the *self*
--      path, but `users_admin_all` is a second permissive policy that
--      does not).
--   2. A role change is staff-record-relevant and needs an audit row
--      (DPIA R15 / R11) — `users` keeps no history of its own.
--
-- ── The two functions ───────────────────────────────────────
--   fn_admin_user_role_impact(user, new_role)  — read. Returns the
--     consequences of a prospective change so the UI can warn (groups the
--     user would be unassigned from, children they remain a guardian of,
--     the santri they stay a login for) or refuse (`would_block`).
--   fn_admin_update_user(user, full_name, new_role)  — write. Admin-only.
--     Enforces the two hard blocks, strips a downgraded tutor from every
--     group's `tutor_ids` in the same transaction, writes an audit row
--     only when the role actually changes, then updates the profile.
--
-- ── user_role_changes ───────────────────────────────────────
-- Append-only in practice: rows are written only by the RPC (which is
-- `security definer` and so bypasses RLS). The policy is admin-only `ALL`,
-- matching every other admin table, so a later review UI can read it; no
-- part of the app writes it directly.
--
-- No explicit table GRANT — migration 007's `alter default privileges …
-- to anon, authenticated, service_role` already covers new tables (the
-- migration 020/021/022 note). The functions are `grant execute`-d.
-- ============================================================

-- ---------- 1. audit table ----------
create table public.user_role_changes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  old_role    user_role not null,
  new_role    user_role not null,
  changed_by  uuid not null references public.users (id),
  changed_at  timestamptz not null default now()
);
create index idx_user_role_changes_user on public.user_role_changes (user_id);

comment on table public.user_role_changes is
  'One row per role change applied through fn_admin_update_user (ADR-042). '
  'Staff-record data (DPIA R15): who changed whose role, from what to what, '
  'when. Written only by the RPC; read by admin only. A name-only edit '
  'writes no row.';

alter table public.user_role_changes enable row level security;

create policy user_role_changes_admin_all on public.user_role_changes
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

-- ---------- 2. fn_admin_user_role_impact ----------
-- Read-only. One row, every field gated on `fn_is_admin()` so a
-- non-entitled caller gets an empty summary rather than an error (the
-- fn_pending_registrations pattern). The UI is `RequireAdmin`, so this is
-- defence in depth, and what the RLS suite asserts.
--
--   tutor_groups      — names of groups the user is a tutor of, iff this
--                       is a tutor → non-tutor change (they get removed).
--   guardian_children — names of children they actively guard, iff this
--                       is a parent → non-parent change. The links are
--                       LEFT INTACT (guardianship is student_guardians-
--                       based, not role-based — ADR-024/040); the warning
--                       is so the admin knows family access is unaffected.
--   linked_student    — the santri whose self-login this account is, iff
--                       a student → non-student change. Link left intact
--                       (a 16+ santri may also tutor — ADR-020).
--   would_block       — 'self'      : an admin changing their own role
--                       'last_admin': demoting the only remaining admin
--                       null        : the change is allowed
create or replace function public.fn_admin_user_role_impact(
  p_user uuid, p_new_role user_role
)
returns table (
  tutor_groups      text[],
  guardian_children text[],
  linked_student    text,
  would_block       text
)
language sql stable security definer set search_path = public as $$
  with cur as (
    select role from public.users where id = p_user
  )
  select
    case
      when public.fn_is_admin()
       and (select role from cur) = 'tutor' and p_new_role <> 'tutor'
      then coalesce(
        (select array_agg(c.name order by c.name)
           from public.classes c
          where p_user = any (c.tutor_ids)),
        '{}')
      else '{}'
    end,
    case
      when public.fn_is_admin()
       and (select role from cur) = 'parent' and p_new_role <> 'parent'
      then coalesce(
        (select array_agg(s.full_name order by s.full_name)
           from public.student_guardians g
           join public.students s on s.id = g.student_id
          where g.user_id = p_user and g.unlinked_at is null),
        '{}')
      else '{}'
    end,
    case
      when public.fn_is_admin()
       and (select role from cur) = 'student' and p_new_role <> 'student'
      then (select s.full_name from public.students s where s.user_id = p_user limit 1)
      else null
    end,
    case
      when not public.fn_is_admin() then null
      when (select role from cur) <> 'admin' or p_new_role = 'admin' then null
      -- last_admin is checked before self: when the sole admin tries to
      -- demote themselves both are true, and "promote someone else first"
      -- is the more actionable message.
      when (select count(*) from public.users where role = 'admin') <= 1 then 'last_admin'
      when p_user = auth.uid() then 'self'
      else null
    end
$$;

grant execute on function public.fn_admin_user_role_impact(uuid, user_role) to authenticated;

comment on function public.fn_admin_user_role_impact(uuid, user_role) is
  'Consequences of changing p_user to p_new_role, for the admin directory''s '
  'confirm dialog (ADR-042): groups a downgraded tutor loses, children a '
  'downgraded parent still guards, the santri a downgraded student stays a '
  'login for, and would_block (self | last_admin | null). Empty for a '
  'non-admin caller.';

-- ---------- 3. fn_admin_update_user ----------
create or replace function public.fn_admin_update_user(
  p_user uuid, p_full_name text, p_new_role user_role
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_old_role user_role;
  v_name     text := btrim(p_full_name);
begin
  if not public.fn_is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'full_name must be 1 to 120 characters' using errcode = '22023';
  end if;

  select role into v_old_role from public.users where id = p_user;
  if v_old_role is null then
    raise exception 'no such user %', p_user using errcode = 'P0002';
  end if;

  if p_new_role <> v_old_role then
    if v_old_role = 'admin' and p_new_role <> 'admin' then
      -- Hard block: never demote the last remaining admin (checked first,
      -- so the sole admin demoting themselves gets this message).
      if (select count(*) from public.users where role = 'admin') <= 1 then
        raise exception 'at least one admin must remain' using errcode = 'P0001';
      end if;
      -- Hard block: an admin cannot change their own role.
      -- `users_self_update` already pins the self path; this covers the
      -- admin-acting-on-self path that `users_admin_all` would allow.
      if p_user = auth.uid() then
        raise exception 'an admin cannot change their own role' using errcode = 'P0001';
      end if;
    end if;

    -- A tutor being downgraded is removed from every group that names
    -- them, in this same transaction, so no `classes.tutor_ids` entry
    -- dangles to a non-tutor. The UI has already shown the group list and
    -- taken a confirmation (ADR-042); this is the apply step.
    if v_old_role = 'tutor' and p_new_role <> 'tutor' then
      update public.classes
         set tutor_ids = array_remove(tutor_ids, p_user)
       where p_user = any (tutor_ids);
    end if;

    insert into public.user_role_changes (user_id, old_role, new_role, changed_by)
      values (p_user, v_old_role, p_new_role, auth.uid());
  end if;

  update public.users
     set full_name = v_name, role = p_new_role
   where id = p_user;
end;
$$;

grant execute on function public.fn_admin_update_user(uuid, text, user_role) to authenticated;

comment on function public.fn_admin_update_user(uuid, text, user_role) is
  'Admin-only (ADR-042). Sets a user''s full_name and role. Refuses to '
  'demote the last admin or to let an admin change their own role; strips '
  'a downgraded tutor from every classes.tutor_ids in the same '
  'transaction; writes a user_role_changes row iff the role actually '
  'changes. Name-only edits are audited nowhere, by design.';
