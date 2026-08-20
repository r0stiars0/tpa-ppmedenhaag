-- ============================================================
-- TPA PPME Den Haag — Migration 017: session write boundaries
--
-- Two independent defects in the same policy set, fixed in one rewrite
-- because they touch the same statements:
--
--   * DELETE, which the attendance policies deliberately withhold and
--     the sessions policy accidentally handed back (TAD ADR-035);
--   * `tutor_id`, which every sibling recording policy pins to the
--     caller and this one did not (TAD ADR-036).
--
-- ── The mechanism ─────────────────────────────────────────────
-- `attendance` (migration 003) has policies for INSERT, SELECT and
-- UPDATE and — deliberately — none for DELETE: only `attendance_admin_all`
-- reaches that verb. Correcting a register is a tutor's job; destroying
-- one is not. That intent is real and it holds when tested directly: a
-- tutor's `delete from attendance` matches 0 rows.
--
-- But `attendance.session_id` is declared `on delete cascade`, and
-- `sessions_tutor_rw` is a `for all` policy — which includes DELETE. A
-- referential action is **not** filtered by the policies on the child
-- table: Postgres runs the cascade as an internal system operation, not
-- as a DML statement the deleting session's grants are re-checked
-- against. So the tutor reaches the rows through the parent, and the
-- register goes with the session.
--
-- Verified before this migration: as the tutor of Class A,
--   delete from attendance where session_id = '<class A session>';  -- DELETE 0
--   delete from sessions   where id         = '<class A session>';  -- DELETE 1
--   select count(*) from attendance where session_id = '<same>';    -- 0
--
-- The general lesson, and the reason this is worth a migration rather
-- than a note: **a `for all` policy on a parent table silently grants
-- whatever its children cascade.** `sessions` is not the only such edge
-- in this schema (see ADR-035 for the audit), it is the one where the
-- child's DELETE was explicitly withheld, which makes it the one where
-- the gap is a contradiction rather than a coincidence.
--
-- ── Why the fix is a policy split, not `on delete restrict` ───
-- Changing the FK to `restrict` would make a session undeletable by
-- anyone, admin included, until its register were cleared row by row —
-- which trades a privilege bug for an operational dead end, and breaks
-- the GDPR art. 17 erasure path that the cascade from `students` relies
-- on. The boundary belongs where the privilege is granted.
--
-- ── What a tutor keeps ────────────────────────────────────────
-- SELECT, INSERT and UPDATE on their own classes' sessions — which is
-- everything the app actually does. `getOrCreateTodaySession`
-- (`src/features/attendance/api.ts`) selects and inserts; nothing in
-- `src/` or `netlify/` issues a DELETE against `sessions` at all (the
-- only `.delete()` in the codebase is `prune-notifications`, on
-- `notifications`, as `service_role`). So this narrows a privilege that
-- no client code has ever used.
--
-- `sessions_family_read` (migration 003) is untouched: it is already a
-- SELECT-only policy and grants a parent nothing this changes.
--
-- No data migration: this narrows an existing grant and writes nothing.
-- ============================================================

drop policy if exists sessions_tutor_rw on public.sessions;

-- The three verbs a tutor genuinely needs, split out of the `for all`
-- policy so DELETE is simply absent rather than implied. Predicates are
-- unchanged from `sessions_tutor_rw` — this migration removes a verb,
-- it does not re-scope a row.
create policy sessions_tutor_read on public.sessions
  for select to authenticated
  using (class_id in (select public.fn_my_classes()));

-- `tutor_id = auth.uid()` pins the actor, matching every sibling
-- recording policy (`yanbua_tutor_insert`, `quran_tutor_insert`, which
-- RLS-05 asserts) and enforcing the meaning ADR-014(b) already gives the
-- column: "who recorded this". Without it a tutor could attribute a
-- session of their own class to a colleague — the one table where that
-- meaning was documented but not enforced. See ADR-036.
--
-- This is safe to add only because the admin term moved out of this
-- policy above: while `or public.fn_is_admin()` sat in the same clause,
-- pinning the actor here would have constrained admin too and broken
-- ADR-014(b)'s "records for a class it does not teach".
create policy sessions_tutor_insert on public.sessions
  for insert to authenticated
  with check (class_id in (select public.fn_my_classes())
              and tutor_id = auth.uid());

create policy sessions_tutor_update on public.sessions
  for update to authenticated
  using (class_id in (select public.fn_my_classes()))
  with check (class_id in (select public.fn_my_classes()));

-- Admin keeps every verb, DELETE included — removing a session that was
-- created in error is an administrative correction, and ADR-014 already
-- makes admin the super admin over every operational table. The
-- `or public.fn_is_admin()` term that used to sit inside each of
-- `sessions_tutor_rw`'s clauses lives here instead; permissive policies
-- OR together, so admin's reach is unchanged by the split.
create policy sessions_admin_all on public.sessions
  for all to authenticated
  using (public.fn_is_admin())
  with check (public.fn_is_admin());
