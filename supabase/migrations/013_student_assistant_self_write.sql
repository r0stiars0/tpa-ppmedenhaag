-- ============================================================
-- 013 — a student assistant may not evaluate themselves (ADR-023)
--
-- ADR-020 decided that a 16+ santri who also tutors may record for the
-- class they teach, and the database already allowed it: no policy in
-- this schema consults `users.role` except `fn_is_admin()`, so being
-- read-only was always a consequence of holding no write-granting
-- relationship rather than a property of the role. RLS-35 pins that
-- decision, and states the boundary that was supposed to come with it —
-- the tutor grant "does not reach back to their own record, which stays
-- as read-only as any other student's".
--
-- That boundary was never enforced. It held in RLS-35 only because the
-- fixture puts the assistant's own record in a class they do not teach.
-- Assign them to their own class — which is the *likely* arrangement,
-- since a 16+ santri assists the group they already attend — and
-- `fn_my_class_students()` contains their own id, so the tutor grant
-- lets them record their own Yanbu'a mastery, set their own memorization
-- target, mark their own homework verified, and author their own
-- year-end report. RLS-37 found it; this migration closes it.
--
-- ---------- What is excluded, and what deliberately is not ----------
--
-- The rule here is **evaluation**, not every write. The five policies
-- below are the ones where the record is a judgement about a santri's
-- work, and a santri judging their own is the thing nobody intends.
--
-- `attendance` is deliberately NOT changed, and this is the one part of
-- the fix that is a trade rather than a strict improvement. The register
-- is submitted as a single upsert of the whole roster
-- (`submitAttendance` in `src/features/attendance/api.ts`), so a policy
-- that refuses one row refuses the save for the entire class — the
-- assistant could no longer mark anybody. That is a worse failure than
-- the hole it would close, and closing it properly needs the register
-- screen to leave their own record out of what it submits, which is a UI
-- change and a product question (who marks the assistant present?)
-- rather than a policy one. Marking yourself present is also a
-- materially weaker integrity problem than recording your own mastery.
-- See ADR-023(c); RLS-37 asserts the current behaviour explicitly so the
-- gap is visible rather than assumed closed.
--
-- No data migration: this narrows an existing grant and writes nothing.
-- ============================================================

-- The write-side counterpart of `fn_my_class_students()`. Same set,
-- minus the caller's own student record.
--
-- `is distinct from` rather than `<>`: `fn_my_student_id()` is null for
-- every tutor who is not also a santri, and `id <> null` is null, which
-- a WITH CHECK treats as a refusal. That spelling would have refused
-- every tutor write in the school.
create or replace function public.fn_my_recordable_students()
returns setof uuid language sql stable security definer set search_path = public as $$
  select s.id from public.students s
  where s.class_id in (select public.fn_my_classes())
    and s.id is distinct from public.fn_my_student_id()
$$;

comment on function public.fn_my_recordable_students() is
  'Students the caller may record an evaluation for: their class roster, minus their own record if they are also a santri (ADR-023).';

-- ---------- yanbua_progress ----------
-- INSERT-only policy, so only the write path changes. The tutor read
-- stays as it is: an assistant may see the roster''s progress, including
-- their own, exactly as they could before.
drop policy if exists yanbua_tutor_insert on public.yanbua_progress;
create policy yanbua_tutor_insert on public.yanbua_progress
  for insert to authenticated
  with check (student_id in (select public.fn_my_recordable_students()) and tutor_id = auth.uid());

-- ---------- quran_progress (mirror of yanbua) ----------
drop policy if exists quran_tutor_insert on public.quran_progress;
create policy quran_tutor_insert on public.quran_progress
  for insert to authenticated
  with check (student_id in (select public.fn_my_recordable_students()) and tutor_id = auth.uid());

-- ---------- assignment_status ----------
-- `for all`, so USING gates DELETE as well as SELECT and must narrow too
-- — a WITH CHECK alone would still let an assistant delete their own
-- homework verdict. The read they lose through this policy is returned
-- by `astatus_student_read`, which exists for exactly that.
drop policy if exists astatus_tutor_rw on public.assignment_status;
create policy astatus_tutor_rw on public.assignment_status
  for all to authenticated
  using (student_id in (select public.fn_my_recordable_students()) or public.fn_is_admin())
  with check (student_id in (select public.fn_my_recordable_students()) or public.fn_is_admin());

-- ---------- murajaah_assignments ----------
-- Same shape, same reason; `massign_student_read` returns the read.
drop policy if exists massign_tutor_rw on public.murajaah_assignments;
create policy massign_tutor_rw on public.murajaah_assignments
  for all to authenticated
  using (student_id in (select public.fn_my_recordable_students()) or public.fn_is_admin())
  with check ((student_id in (select public.fn_my_recordable_students()) and tutor_id = auth.uid())
              or public.fn_is_admin());

-- ---------- year_end_reports ----------
-- The sharpest of the five, and the one where narrowing USING is a
-- second fix rather than a side effect: `yer_tutor_rw` is what let an
-- assistant read their own **draft** report. RLS-16 forbids exactly that
-- for a parent — "drafts must never leak" — and `yer_student_read` is
-- published-only for the same reason. After this they see their own
-- report when it is published, and not before.
drop policy if exists yer_tutor_rw on public.year_end_reports;
create policy yer_tutor_rw on public.year_end_reports
  for all to authenticated
  using (student_id in (select public.fn_my_recordable_students()))
  with check (student_id in (select public.fn_my_recordable_students()) and tutor_id = auth.uid());
