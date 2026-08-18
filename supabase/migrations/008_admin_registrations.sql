-- ============================================================
-- TPA PPME Den Haag — Migration 008: Admin pending-registration lookup
--
-- The signup model (TAD "Questions" #2, AuthContext.tsx) is: anyone can
-- sign in with Google, which creates an auth.users row via GoTrue, but
-- they see "Unauthorized — contact admin" until an admin creates a
-- matching public.users row with a role. There was previously no way for
-- an admin to discover *who* has signed in and is waiting — auth.users
-- lives in a schema PostgREST doesn't expose, and clients have no direct
-- read access to it (nor should they).
--
-- This function is the narrow, admin-only bridge: it reads auth.users
-- under security definer (the only way to reach that schema from a
-- client role) but the `and public.fn_is_admin()` term folded into the
-- WHERE clause means a non-admin caller gets an empty result rather than
-- a permission error — same convention as migration 007's table grants.
-- Only id/email/created_at are exposed, never password hashes or other
-- auth.users columns.
-- ============================================================

create or replace function public.fn_pending_registrations()
returns table(id uuid, email text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select au.id, au.email, au.created_at
  from auth.users au
  left join public.users pu on pu.id = au.id
  where pu.id is null
    and public.fn_is_admin()
  order by au.created_at
$$;

-- Postgres grants EXECUTE to PUBLIC by default on new functions, which is
-- how fn_is_admin/fn_my_children/etc. already work without an explicit
-- grant — stated here anyway for clarity, matching migration 007's
-- explicit-over-implicit style.
grant execute on function public.fn_pending_registrations() to authenticated;
