-- ============================================================
-- TPA PPME Den Haag — Migration 007: Base table privileges
--
-- Grants baseline table-level privileges to anon/authenticated/
-- service_role on every application table in the public schema.
-- GRANT is a separate, prerequisite gate in front of RLS — a role
-- with no GRANT gets "permission denied" before RLS policies are
-- ever evaluated, no matter how correct those policies are. This
-- was missing from migrations 002/003/005, which defined RLS
-- policies without ever granting the underlying table access they
-- depend on — the API was completely inaccessible to every role,
-- including service_role, until this migration (found while
-- building the RLS pgTAP suite: information_schema.role_table_grants
-- and pg_default_acl were both empty for the public schema).
--
-- Row-level access control is still enforced entirely by the RLS
-- policies from migrations 003/005 (`to authenticated` only) — this
-- migration does not loosen anything, it only unblocks the gate
-- those policies sit behind. `anon` gets the same blanket grant,
-- matching Supabase's own default project convention; since no
-- policy grants `anon` anything, it is still filtered/denied by RLS
-- exactly as intended, just with a clean empty result instead of a
-- raw permission error.
-- ============================================================

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;

-- So future migrations' new tables inherit the same grants
-- automatically, without needing to repeat this per-migration.
alter default privileges in schema public
  grant select, insert, update, delete on tables
  to anon, authenticated, service_role;
