-- ============================================================
-- TPA PPME Den Haag — RLS automated test suite (pgTAP)
--
-- Implements RLS-01 through RLS-21 from docs/test-plan.md §3, using
-- the "standard fixture set" described in test-plan.md §2:
--   1 admin, 2 tutors (T1, T2), 3 parents (P1, P2, P3), 1 student
--   account (S16, linked to P3's child); 2 classes (A: T1, B: T2);
--   P1 has 2 children in Class A; P2 has 1 child in Class B; P3 has
--   1 child (16+, user_id set) in Class B.
--
-- Runs entirely inside one transaction that is rolled back at the end
-- (see ROLLBACK at the bottom), so it never leaves fixture data behind.
--
--   supabase test db --local supabase/tests/database
--
-- **Local and CI only.** This header used to say the suite was "safe to
-- run against `--linked` (the live project) or `--local`", and neither
-- half of that was right.
--
-- It does not run there: migration 006 installs pgTAP into the
-- `extensions` schema, and the transient login role a linked run
-- connects as cannot resolve functions in it, so the script dies on
-- `select no_plan()` before a single assertion. Setting `search_path`
-- does not help — the role lacks schema USAGE, not the name.
--
-- And it should not run there. This file inserts fixture parents,
-- children, classes and notifications, plus rows in `auth.users`.
-- Rolling them back makes that survivable, not appropriate: test-plan
-- §2 gives production "smoke tests post-deploy" and states the rule "no
-- real student data in any test environment, ever", whose converse is
-- what applies here. Granting the linked role rights on `extensions`
-- would be a standing widening of production access to enable something
-- §2 already rules out.
--
-- What to run against production instead is `supabase db diff --linked
-- --schema public`, which is read-only, writes nothing, and answers the
-- question a linked run was reaching for: does the deployed schema still
-- match the migrations these assertions were proven against. See
-- test-plan §2. For behaviour on real hosted infrastructure, use a
-- Supabase branch — §2's E2E environment — never the live project.
--
-- Connects as the `postgres` role (table owner), which is exempt from
-- RLS by default — used only for fixture setup. Every assertion below
-- explicitly switches to the `authenticated` or `anon` Postgres role
-- plus the relevant `request.jwt.claim.sub`/`role` GUCs to impersonate
-- a specific persona, matching how PostgREST evaluates RLS in
-- production (see auth.uid()/auth.role() definitions).
-- ============================================================

begin;

select no_plan();

create temp table _tap_log(id serial primary key, line text);
grant all on _tap_log to anon, authenticated, service_role;
grant all on _tap_log_id_seq to anon, authenticated, service_role;

-- ---------- Fixtures ----------
-- (as postgres — bypasses RLS by table ownership)

-- auth.users (minimal valid rows; only `id` is NOT NULL)
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('a0000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local',   '', now(), '{}', '{}', false, false, now(), now()),
  ('70000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 't1@test.local',      '', now(), '{}', '{}', false, false, now(), now()),
  ('70000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 't2@test.local',      '', now(), '{}', '{}', false, false, now(), now()),
  ('90000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'p1@test.local',      '', now(), '{}', '{}', false, false, now(), now()),
  ('90000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'p2@test.local',      '', now(), '{}', '{}', false, false, now(), now()),
  ('90000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'p3@test.local',      '', now(), '{}', '{}', false, false, now(), now()),
  ('50000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 's16@test.local',     '', now(), '{}', '{}', false, false, now(), now());

-- public.users profiles
insert into public.users (id, email, full_name, role, locale)
values
  ('a0000000-0000-0000-0000-000000000000', 'admin@test.local', 'Admin Test',   'admin',   'id'),
  ('70000000-0000-0000-0000-000000000001', 't1@test.local',    'Tutor One',    'tutor',   'id'),
  ('70000000-0000-0000-0000-000000000002', 't2@test.local',    'Tutor Two',    'tutor',   'id'),
  ('90000000-0000-0000-0000-000000000001', 'p1@test.local',    'Parent One',   'parent',  'id'),
  ('90000000-0000-0000-0000-000000000002', 'p2@test.local',    'Parent Two',   'parent',  'id'),
  ('90000000-0000-0000-0000-000000000003', 'p3@test.local',    'Parent Three', 'parent',  'id'),
  ('50000000-0000-0000-0000-000000000001', 's16@test.local',   'Santri 16',    'student', 'id');

-- classes
insert into public.classes (id, name, schedule, tutor_ids)
values
  ('c0000000-0000-0000-0000-00000000000a', 'Class A (RLS test)', 'Sabtu 10:00', array['70000000-0000-0000-0000-000000000001']::uuid[]),
  ('c0000000-0000-0000-0000-00000000000b', 'Class B (RLS test)', 'Minggu 10:00', array['70000000-0000-0000-0000-000000000002']::uuid[]);

-- students: P1 has 2 in Class A; P2 has 1 in Class B; P3 has 1 (16+, S16) in Class B
insert into public.students (id, parent_id, user_id, full_name, class_id, date_of_birth)
values
  ('d0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', null, 'P1 Child A', 'c0000000-0000-0000-0000-00000000000a', '2015-01-01'),
  ('d0000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', null, 'P1 Child B', 'c0000000-0000-0000-0000-00000000000a', '2016-01-01'),
  ('d0000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000002', null, 'P2 Child',   'c0000000-0000-0000-0000-00000000000b', '2014-01-01'),
  ('d0000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', 'P3 Child (S16)', 'c0000000-0000-0000-0000-00000000000b', '2009-01-01');

-- sessions
insert into public.sessions (id, class_id, date, tutor_id)
values
  ('e0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000a', current_date, '70000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000b', current_date, '70000000-0000-0000-0000-000000000002');

-- attendance
insert into public.attendance (session_id, student_id, status)
values
  ('e0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000001', 'present'),
  ('e0000000-0000-0000-0000-00000000000a', 'd0000000-0000-0000-0000-000000000002', 'present'),
  ('e0000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-000000000003', 'present'),
  ('e0000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-000000000004', 'present');

-- yanbua/quran progress (one for P1's child, one for P2's child, for the
-- RLS-02 cross-family negative checks to be meaningful — a row exists,
-- it's just invisible to the wrong parent)
insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
values
  ('d0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 1, 1, 'lancar'),
  ('d0000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000002', 1, 1, 'lancar');

insert into public.quran_progress (student_id, tutor_id, surah_num, ayah_from, ayah_to, quality)
values
  ('d0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 1, 1, 5, 'mumtaz'),
  ('d0000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000002', 1, 1, 5, 'mumtaz');

-- murajaah assignments (one per family) + one pre-existing log for P2's
-- child (used by RLS-02's cross-family check)
insert into public.murajaah_assignments (id, student_id, tutor_id, surah_num, ayah_from, ayah_to, frequency)
values
  ('f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 1, 1, 3, 'daily'),
  ('f0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000002', 1, 1, 3, 'daily');

insert into public.murajaah_log (assignment_id, confirmed_by, quality, date)
values
  ('f0000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000002', 'hafal_lancar', current_date);

-- year_end_reports: draft + published rows across both families/classes
-- so the tutor/parent/student visibility rules all have something real
-- to filter (test-plan.md RLS-15..21)
insert into public.year_end_reports (student_id, academic_year, tutor_id, status)
values
  ('d0000000-0000-0000-0000-000000000001', '2025/2026', '70000000-0000-0000-0000-000000000001', 'draft'),      -- P1 child A: draft, class A / T1
  ('d0000000-0000-0000-0000-000000000002', '2025/2026', '70000000-0000-0000-0000-000000000001', 'published'),  -- P1 child B: published, class A / T1
  ('d0000000-0000-0000-0000-000000000003', '2025/2026', '70000000-0000-0000-0000-000000000002', 'published'),  -- P2 child: published, class B / T2
  ('d0000000-0000-0000-0000-000000000004', '2025/2026', '70000000-0000-0000-0000-000000000002', 'published'),  -- S16: published, class B / T2
  ('d0000000-0000-0000-0000-000000000004', '2024/2025', '70000000-0000-0000-0000-000000000002', 'draft');      -- S16: draft (different year), class B / T2

-- ============================================================
-- RLS-01: P1 SELECT students → sees exactly their 2 children;
--         P2's child absent from results
-- ============================================================
set local role authenticated;
set local request.jwt.claim.sub to '90000000-0000-0000-0000-000000000001';
set local request.jwt.claim.role to 'authenticated';

insert into _tap_log(line) select set_eq(
  'select id from public.students',
  array['d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002']::uuid[],
  'RLS-01: P1 sees exactly their 2 children, P2''s child excluded'
);

-- ============================================================
-- RLS-02: P1 SELECT attendance/yanbua/quran/murajaah rows of P2's
--         child → 0 rows (P1 is still impersonated from RLS-01)
-- ============================================================
insert into _tap_log(line) select is(
  (select count(*) from public.attendance where student_id = 'd0000000-0000-0000-0000-000000000003'),
  0::bigint, 'RLS-02: P1 sees 0 attendance rows for P2''s child'
);
insert into _tap_log(line) select is(
  (select count(*) from public.yanbua_progress where student_id = 'd0000000-0000-0000-0000-000000000003'),
  0::bigint, 'RLS-02: P1 sees 0 yanbua_progress rows for P2''s child'
);
insert into _tap_log(line) select is(
  (select count(*) from public.quran_progress where student_id = 'd0000000-0000-0000-0000-000000000003'),
  0::bigint, 'RLS-02: P1 sees 0 quran_progress rows for P2''s child'
);
insert into _tap_log(line) select is(
  (select count(*) from public.murajaah_log ml join public.murajaah_assignments ma on ma.id = ml.assignment_id
   where ma.student_id = 'd0000000-0000-0000-0000-000000000003'),
  0::bigint, 'RLS-02: P1 sees 0 murajaah_log rows for P2''s child'
);

-- ============================================================
-- RLS-03: T1 SELECT students → Class A only; Class B invisible
-- ============================================================
set local request.jwt.claim.sub to '70000000-0000-0000-0000-000000000001';

insert into _tap_log(line) select set_eq(
  'select id from public.students',
  array['d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002']::uuid[],
  'RLS-03: T1 sees only Class A students'
);

-- ============================================================
-- RLS-04: T1 INSERT attendance for Class B student → rejected
-- ============================================================
insert into _tap_log(line) select throws_ok(
  $$ insert into public.attendance (session_id, student_id, status)
     values ('e0000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-000000000003', 'present') $$,
  '42501', null,
  'RLS-04: T1 cannot insert attendance for a Class B student'
);

-- ============================================================
-- RLS-05: T1 INSERT yanbua_progress with tutor_id ≠ auth.uid() → rejected
-- ============================================================
insert into _tap_log(line) select throws_ok(
  $$ insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
     values ('d0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', 1, 2, 'lancar') $$,
  '42501', null,
  'RLS-05: T1 cannot insert yanbua_progress with someone else''s tutor_id'
);

-- ============================================================
-- RLS-06: S16 SELECT own attendance/progress → rows returned;
--         sibling/classmate rows → 0
-- ============================================================
set local request.jwt.claim.sub to '50000000-0000-0000-0000-000000000001';

insert into _tap_log(line) select ok(
  (select count(*) from public.attendance where student_id = 'd0000000-0000-0000-0000-000000000004') > 0,
  'RLS-06: S16 sees their own attendance rows'
);
insert into _tap_log(line) select is(
  (select count(*) from public.attendance where student_id = 'd0000000-0000-0000-0000-000000000003'),
  0::bigint, 'RLS-06: S16 sees 0 attendance rows for a classmate'
);
insert into _tap_log(line) select is(
  (select count(*) from public.yanbua_progress where student_id = 'd0000000-0000-0000-0000-000000000001'),
  0::bigint, 'RLS-06: S16 sees 0 yanbua_progress rows for a non-sibling student'
);

-- ============================================================
-- RLS-07: S16 INSERT/UPDATE on any table → rejected (read-only role)
-- ============================================================
insert into _tap_log(line) select throws_ok(
  $$ insert into public.attendance (session_id, student_id, status)
     values ('e0000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-000000000004', 'present') $$,
  '42501', null,
  'RLS-07: S16 cannot INSERT attendance'
);
-- No UPDATE policy exists for the student role at all (only SELECT
-- policies), so this silently matches 0 rows rather than raising an
-- error — same "outer USING clause filters, no exception" behavior as
-- RLS-10/11/20, so it needs the row-count pattern, not throws_ok.
do $$
declare affected int;
begin
  update public.students set full_name = 'Hacked' where id = 'd0000000-0000-0000-0000-000000000004';
  get diagnostics affected = row_count;
  drop table if exists _rls_check;
  create temp table _rls_check(n int);
  insert into _rls_check values (affected);
end $$;
insert into _tap_log(line) select is((select n from _rls_check), 0, 'RLS-07: S16 cannot UPDATE their own student row (0 rows affected)');
drop table _rls_check;

-- ============================================================
-- RLS-08: P1 INSERT murajaah_log for own child's assignment → allowed;
--         for P2's child → rejected
-- ============================================================
set local request.jwt.claim.sub to '90000000-0000-0000-0000-000000000001';

insert into _tap_log(line) select lives_ok(
  $$ insert into public.murajaah_log (assignment_id, confirmed_by, quality, date)
     values ('f0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'hafal_lancar', current_date) $$,
  'RLS-08: P1 can confirm murajaah for their own child'
);
insert into _tap_log(line) select throws_ok(
  $$ insert into public.murajaah_log (assignment_id, confirmed_by, quality, date)
     values ('f0000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000001', 'hafal_lancar', current_date + 1) $$,
  '42501', null,
  'RLS-08: P1 cannot confirm murajaah for P2''s child'
);

-- ============================================================
-- RLS-09: P1 INSERT murajaah_log with confirmed_by ≠ auth.uid() → rejected
-- ============================================================
insert into _tap_log(line) select throws_ok(
  $$ insert into public.murajaah_log (assignment_id, confirmed_by, quality, date)
     values ('f0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 'hafal_lancar', current_date + 2) $$,
  '42501', null,
  'RLS-09: P1 cannot insert a murajaah_log with confirmed_by set to someone else'
);

-- ============================================================
-- RLS-10: Any non-admin UPDATE users.role (own or others) → rejected
-- ============================================================
insert into _tap_log(line) select throws_ok(
  $$ update public.users set role = 'admin' where id = '90000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'RLS-10: P1 cannot change their own role'
);
-- (RLS's USING clause silently filters non-matching rows rather than
-- raising an error, so we capture the affected row count via
-- GET DIAGNOSTICS instead of throws_ok — a data-modifying CTE isn't
-- allowed as a nested subquery, hence the DO block.)
do $$
declare affected int;
begin
  update public.users set full_name = 'Should Not Apply' where id = '90000000-0000-0000-0000-000000000002';
  get diagnostics affected = row_count;
  drop table if exists _rls_check;
  create temp table _rls_check(n int);
  insert into _rls_check values (affected);
end $$;
insert into _tap_log(line) select is((select n from _rls_check), 0, 'RLS-10: P1 cannot update another user''s row at all (0 rows affected)');
drop table _rls_check;

-- ============================================================
-- RLS-11: Non-admin INSERT/DELETE on students → rejected
--         (enrollment is admin-only)
-- ============================================================
insert into _tap_log(line) select throws_ok(
  $$ insert into public.students (parent_id, full_name, class_id, date_of_birth)
     values ('90000000-0000-0000-0000-000000000001', 'Illegit Child', 'c0000000-0000-0000-0000-00000000000a', '2018-01-01') $$,
  '42501', null,
  'RLS-11: P1 cannot INSERT a new student'
);
do $$
declare affected int;
begin
  delete from public.students where id = 'd0000000-0000-0000-0000-000000000001';
  get diagnostics affected = row_count;
  drop table if exists _rls_check;
  create temp table _rls_check(n int);
  insert into _rls_check values (affected);
end $$;
insert into _tap_log(line) select is((select n from _rls_check), 0, 'RLS-11: P1 cannot DELETE their own child''s enrollment row');
drop table _rls_check;

-- ============================================================
-- RLS-12: Anonymous (no JWT) SELECT on every table → 0 rows
-- ============================================================
set local role anon;
set local request.jwt.claim.sub to '';
set local request.jwt.claim.role to 'anon';

insert into _tap_log(line) select is((select count(*) from public.students), 0::bigint, 'RLS-12: anon sees 0 students');
insert into _tap_log(line) select is((select count(*) from public.attendance), 0::bigint, 'RLS-12: anon sees 0 attendance rows');
insert into _tap_log(line) select is((select count(*) from public.yanbua_progress), 0::bigint, 'RLS-12: anon sees 0 yanbua_progress rows');
insert into _tap_log(line) select is((select count(*) from public.murajaah_log), 0::bigint, 'RLS-12: anon sees 0 murajaah_log rows');
insert into _tap_log(line) select is((select count(*) from public.year_end_reports), 0::bigint, 'RLS-12: anon sees 0 year_end_reports rows');

-- ============================================================
-- RLS-13: Duplicate murajaah_log (same assignment_id + date) →
--         unique violation
-- ============================================================
set local role authenticated;
set local request.jwt.claim.sub to '90000000-0000-0000-0000-000000000001';
set local request.jwt.claim.role to 'authenticated';

insert into _tap_log(line) select throws_ok(
  $$ insert into public.murajaah_log (assignment_id, confirmed_by, quality, date)
     values ('f0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'hafal_lancar', current_date) $$,
  '23505', null,
  'RLS-13: duplicate (assignment_id, date) murajaah_log raises a unique violation'
);

-- ============================================================
-- RLS-14: Admin can SELECT/modify all tables
-- ============================================================
set local request.jwt.claim.sub to 'a0000000-0000-0000-0000-000000000000';

insert into _tap_log(line) select is((select count(*) from public.students), 4::bigint, 'RLS-14: admin sees all 4 fixture students');
insert into _tap_log(line) select is((select count(*) from public.year_end_reports), 5::bigint, 'RLS-14: admin sees all 5 fixture year_end_reports');

-- ============================================================
-- RLS-15: T1 SELECT year_end_reports for Class A student,
--         status=draft → row returned
-- ============================================================
set local request.jwt.claim.sub to '70000000-0000-0000-0000-000000000001';

insert into _tap_log(line) select is(
  (select count(*) from public.year_end_reports
   where student_id = 'd0000000-0000-0000-0000-000000000001' and status = 'draft'),
  1::bigint, 'RLS-15: T1 (authoring tutor) can see their own class''s draft report'
);

-- ============================================================
-- RLS-16 / RLS-17: P1 SELECT year_end_reports for own children →
--         draft invisible, published visible
-- ============================================================
set local request.jwt.claim.sub to '90000000-0000-0000-0000-000000000001';

insert into _tap_log(line) select is(
  (select count(*) from public.year_end_reports
   where student_id = 'd0000000-0000-0000-0000-000000000001' and status = 'draft'),
  0::bigint, 'RLS-16: P1 cannot see their own child''s draft report'
);
insert into _tap_log(line) select is(
  (select count(*) from public.year_end_reports
   where student_id = 'd0000000-0000-0000-0000-000000000002' and status = 'published'),
  1::bigint, 'RLS-17: P1 can see their own child''s published report'
);

-- ============================================================
-- RLS-18: P1 SELECT year_end_reports for P2's child, any status → 0 rows
-- ============================================================
insert into _tap_log(line) select is(
  (select count(*) from public.year_end_reports where student_id = 'd0000000-0000-0000-0000-000000000003'),
  0::bigint, 'RLS-18: P1 sees 0 year_end_reports for P2''s child'
);

-- ============================================================
-- RLS-19: S16 SELECT own year_end_reports, status=published → row
--         returned; status=draft → 0 rows
-- ============================================================
set local request.jwt.claim.sub to '50000000-0000-0000-0000-000000000001';

insert into _tap_log(line) select is(
  (select count(*) from public.year_end_reports
   where student_id = 'd0000000-0000-0000-0000-000000000004' and status = 'published'),
  1::bigint, 'RLS-19: S16 can see their own published report'
);
insert into _tap_log(line) select is(
  (select count(*) from public.year_end_reports
   where student_id = 'd0000000-0000-0000-0000-000000000004' and status = 'draft'),
  0::bigint, 'RLS-19: S16 cannot see their own draft report'
);

-- ============================================================
-- RLS-20: T2 (not the authoring tutor, different class) SELECT/PATCH
--         a Class A report → rejected
-- ============================================================
set local request.jwt.claim.sub to '70000000-0000-0000-0000-000000000002';

insert into _tap_log(line) select is(
  (select count(*) from public.year_end_reports where student_id = 'd0000000-0000-0000-0000-000000000001'),
  0::bigint, 'RLS-20: T2 cannot SELECT a Class A (T1-authored) report'
);
do $$
declare affected int;
begin
  update public.year_end_reports set narrative = 'tampered'
  where student_id = 'd0000000-0000-0000-0000-000000000001';
  get diagnostics affected = row_count;
  drop table if exists _rls_check;
  create temp table _rls_check(n int);
  insert into _rls_check values (affected);
end $$;
insert into _tap_log(line) select is((select n from _rls_check), 0, 'RLS-20: T2 cannot UPDATE a Class A (T1-authored) report');
drop table _rls_check;

-- ============================================================
-- RLS-21: Non-service-role client attempts to read/write
--         storage.objects in the `reports` bucket directly → rejected
-- ============================================================
set local request.jwt.claim.sub to '90000000-0000-0000-0000-000000000001';

insert into _tap_log(line) select is(
  (select count(*) from storage.objects where bucket_id = 'reports'),
  0::bigint, 'RLS-21: authenticated client cannot SELECT storage.objects in the reports bucket'
);
insert into _tap_log(line) select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
     values ('reports', 'd0000000-0000-0000-0000-000000000001/2025-2026.pdf', '90000000-0000-0000-0000-000000000001') $$,
  '42501', null,
  'RLS-21: authenticated client cannot INSERT into storage.objects in the reports bucket'
);

-- ============================================================
-- RLS-22 … RLS-27: super admin writes (TAD ADR-014)
--
-- Everything below already passed before ADR-014 — no migration was
-- needed to make admin a super admin, because migration 003/005 always
-- granted admin `ALL` on every table (`*_admin_all`, plus the
-- `or fn_is_admin()` branches on the tutor policies). What changed is
-- that the *application* stopped blocking those writes, so the suite now
-- asserts them explicitly: if a future migration ever narrows an admin
-- policy, the app would start 403-ing on screens that look writable
-- rather than failing here first.
--
-- Two properties are being tested at once, and the second matters more:
--   1. an admin INSERT/UPDATE actually lands on each operational table;
--   2. those new rows widen *nobody* else's visibility (RLS-26/27) —
--      admin gaining access must not leak sideways into a parent, tutor
--      or student scope.
--
-- Deliberately placed after RLS-14, which asserts exact fixture row
-- counts for admin and would fail if these inserts ran first.
-- ============================================================
set local role authenticated;
set local request.jwt.claim.sub to 'a0000000-0000-0000-0000-000000000000';
set local request.jwt.claim.role to 'authenticated';

-- ============================================================
-- RLS-22: admin INSERT lands on every operational table, for a class
--         it is not a tutor of (Class B / T2), with its own id in the
--         `tutor_id` "who recorded this" column
-- ============================================================
insert into _tap_log(line) select lives_ok(
  $$ insert into public.sessions (id, class_id, date, tutor_id)
     values ('e0000000-0000-0000-0000-0000000000ad', 'c0000000-0000-0000-0000-00000000000b',
             current_date - 7, 'a0000000-0000-0000-0000-000000000000') $$,
  'RLS-22: admin can INSERT a session for a class it does not tutor'
);
insert into _tap_log(line) select lives_ok(
  $$ insert into public.attendance (session_id, student_id, status)
     values ('e0000000-0000-0000-0000-0000000000ad', 'd0000000-0000-0000-0000-000000000003', 'late') $$,
  'RLS-22: admin can INSERT attendance for another tutor''s student'
);
insert into _tap_log(line) select lives_ok(
  $$ insert into public.assignments (id, class_id, tutor_id, title, due_date)
     values ('b0000000-0000-0000-0000-0000000000ad', 'c0000000-0000-0000-0000-00000000000b',
             'a0000000-0000-0000-0000-000000000000', 'Admin-set homework', current_date + 3) $$,
  'RLS-22: admin can INSERT an assignment for a class it does not tutor'
);
insert into _tap_log(line) select lives_ok(
  $$ insert into public.assignment_status (assignment_id, student_id, status)
     values ('b0000000-0000-0000-0000-0000000000ad', 'd0000000-0000-0000-0000-000000000003', 'completed') $$,
  'RLS-22: admin can INSERT an assignment_status verdict'
);
insert into _tap_log(line) select lives_ok(
  $$ insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
     values ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000000', 2, 5, 'lancar') $$,
  'RLS-22: admin can INSERT yanbua_progress with its own id as tutor_id'
);
insert into _tap_log(line) select lives_ok(
  $$ insert into public.quran_progress (student_id, tutor_id, surah_num, ayah_from, ayah_to, quality)
     values ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000000', 2, 1, 10, 'jayyid') $$,
  'RLS-22: admin can INSERT quran_progress with its own id as tutor_id'
);
insert into _tap_log(line) select lives_ok(
  $$ insert into public.murajaah_assignments (id, student_id, tutor_id, surah_num, ayah_from, ayah_to, frequency)
     values ('f0000000-0000-0000-0000-0000000000ad', 'd0000000-0000-0000-0000-000000000003',
             'a0000000-0000-0000-0000-000000000000', 3, 1, 5, 'weekly') $$,
  'RLS-22: admin can INSERT a murajaah target with its own id as tutor_id'
);
insert into _tap_log(line) select lives_ok(
  $$ insert into public.year_end_reports (student_id, academic_year, tutor_id, status)
     values ('d0000000-0000-0000-0000-000000000003', '2023/2024',
             '70000000-0000-0000-0000-000000000002', 'draft') $$,
  'RLS-22: admin can INSERT a year_end_report for another tutor''s student'
);

-- ============================================================
-- RLS-23: admin UPDATE lands on operational rows it did not create,
--         including another tutor's report narrative/grades — the
--         `yer_tutor_rw` WITH CHECK pin (`tutor_id = auth.uid()`) that
--         makes a co-tutor read-only does not apply to `yer_admin_all`
-- ============================================================
do $$
declare affected int;
begin
  update public.attendance set status = 'present'
  where session_id = 'e0000000-0000-0000-0000-00000000000b'
    and student_id = 'd0000000-0000-0000-0000-000000000003';
  get diagnostics affected = row_count;
  drop table if exists _rls_check;
  create temp table _rls_check(n int);
  insert into _rls_check values (affected);
end $$;
insert into _tap_log(line) select is((select n from _rls_check), 1, 'RLS-23: admin UPDATE of a tutor-recorded attendance row affects the row');
drop table _rls_check;

do $$
declare affected int;
begin
  update public.year_end_reports
  set narrative = 'Edited by admin', overall_grade = 'jayyid'
  where student_id = 'd0000000-0000-0000-0000-000000000001' and academic_year = '2025/2026';
  get diagnostics affected = row_count;
  drop table if exists _rls_check;
  create temp table _rls_check(n int);
  insert into _rls_check values (affected);
end $$;
insert into _tap_log(line) select is((select n from _rls_check), 1, 'RLS-23: admin UPDATE of T1''s report narrative/grades affects the row');
drop table _rls_check;

-- ============================================================
-- RLS-24: `tutor_id` on an admin-recorded row is the admin's own id,
--         and that id is in nobody's `classes.tutor_ids` — the column
--         means "who recorded this", not "a tutor of this class", and
--         nothing downstream may assume otherwise (ADR-014 decision 1a)
-- ============================================================
insert into _tap_log(line) select is(
  (select tutor_id from public.yanbua_progress
   where student_id = 'd0000000-0000-0000-0000-000000000003' and page = 5),
  'a0000000-0000-0000-0000-000000000000'::uuid,
  'RLS-24: an admin-recorded yanbua row carries the admin''s own id in tutor_id'
);
insert into _tap_log(line) select is(
  (select count(*) from public.classes
   where 'a0000000-0000-0000-0000-000000000000'::uuid = any (tutor_ids)),
  0::bigint,
  'RLS-24: that id is not a member of any class''s tutor_ids'
);

-- ============================================================
-- RLS-25: RLS *permits* an admin murajaah_log insert (`mlog_admin_all`),
--         which is exactly why the app has to be the thing that declines
--         it. `confirmed_by` means "the parent who watched the child
--         recite" — home practice nobody witnessed is not something an
--         administrator can attest to, so ADR-014 leaves that one action
--         with parents at the application layer, the same shape the old
--         admin fence had. Asserted rather than assumed so the split
--         between "the database allows this" and "the app does not offer
--         it" stays visible.
-- ============================================================
insert into _tap_log(line) select lives_ok(
  $$ insert into public.murajaah_log (assignment_id, confirmed_by, quality, date)
     values ('f0000000-0000-0000-0000-0000000000ad', 'a0000000-0000-0000-0000-000000000000',
             'hafal_lancar', current_date) $$,
  'RLS-25: RLS permits an admin murajaah_log insert (the parent-only rule is application-layer)'
);

-- ============================================================
-- RLS-26: admin's new rows are invisible to everyone they should be —
--         admin gaining write access must not widen any other scope
-- ============================================================
set local request.jwt.claim.sub to '90000000-0000-0000-0000-000000000001';  -- P1 (Class A family)
insert into _tap_log(line) select is(
  (select count(*) from public.attendance where session_id = 'e0000000-0000-0000-0000-0000000000ad'),
  0::bigint, 'RLS-26: P1 sees 0 of the admin-created attendance rows for P2''s child'
);
insert into _tap_log(line) select is(
  (select count(*) from public.yanbua_progress where student_id = 'd0000000-0000-0000-0000-000000000003'),
  0::bigint, 'RLS-26: P1 still sees 0 yanbua rows for P2''s child after the admin write'
);
insert into _tap_log(line) select is(
  (select count(*) from public.quran_progress where student_id = 'd0000000-0000-0000-0000-000000000003'),
  0::bigint, 'RLS-26: P1 still sees 0 quran rows for P2''s child after the admin write'
);
insert into _tap_log(line) select is(
  (select count(*) from public.year_end_reports where student_id = 'd0000000-0000-0000-0000-000000000003'),
  0::bigint, 'RLS-26: P1 still sees 0 year_end_reports for P2''s child after the admin write'
);

set local request.jwt.claim.sub to '70000000-0000-0000-0000-000000000001';  -- T1 (Class A tutor)
insert into _tap_log(line) select is(
  (select count(*) from public.attendance where session_id = 'e0000000-0000-0000-0000-0000000000ad'),
  0::bigint, 'RLS-26: T1 sees 0 of the admin-created Class B attendance rows'
);
insert into _tap_log(line) select is(
  (select count(*) from public.assignments where id = 'b0000000-0000-0000-0000-0000000000ad'),
  0::bigint, 'RLS-26: T1 sees 0 of the admin-created Class B assignments'
);

set local request.jwt.claim.sub to '50000000-0000-0000-0000-000000000001';  -- S16 (Class B, but P3's child)
insert into _tap_log(line) select is(
  (select count(*) from public.yanbua_progress where student_id = 'd0000000-0000-0000-0000-000000000003'),
  0::bigint, 'RLS-26: S16 sees 0 of the admin-created rows for a classmate'
);

set local role anon;
set local request.jwt.claim.sub to '';
set local request.jwt.claim.role to 'anon';
insert into _tap_log(line) select is(
  (select count(*) from public.attendance), 0::bigint,
  'RLS-26: anon still sees 0 attendance rows after the admin writes'
);
insert into _tap_log(line) select is(
  (select count(*) from public.year_end_reports), 0::bigint,
  'RLS-26: anon still sees 0 year_end_reports after the admin writes'
);

-- ============================================================
-- RLS-27: the non-admin write boundaries are unchanged — a tutor still
--         cannot reach into another class, a parent still cannot write
--         operational data, a 16+ student is still read-only
-- ============================================================
set local role authenticated;
set local request.jwt.claim.role to 'authenticated';

set local request.jwt.claim.sub to '70000000-0000-0000-0000-000000000001';  -- T1
do $$
declare affected int;
begin
  update public.attendance set status = 'absent'
  where session_id = 'e0000000-0000-0000-0000-0000000000ad';
  get diagnostics affected = row_count;
  drop table if exists _rls_check;
  create temp table _rls_check(n int);
  insert into _rls_check values (affected);
end $$;
insert into _tap_log(line) select is((select n from _rls_check), 0, 'RLS-27: T1 cannot UPDATE an admin-created Class B attendance row');
drop table _rls_check;

set local request.jwt.claim.sub to '90000000-0000-0000-0000-000000000002';  -- P2 (the affected family)
insert into _tap_log(line) select throws_ok(
  $$ insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
     values ('d0000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000002', 1, 9, 'lancar') $$,
  '42501', null,
  'RLS-27: a parent still cannot INSERT yanbua_progress for their own child'
);
insert into _tap_log(line) select ok(
  (select count(*) from public.yanbua_progress where student_id = 'd0000000-0000-0000-0000-000000000003') > 0,
  'RLS-27: …but P2 does see the admin-recorded row for their own child'
);

set local request.jwt.claim.sub to '50000000-0000-0000-0000-000000000001';  -- S16
insert into _tap_log(line) select throws_ok(
  $$ insert into public.quran_progress (student_id, tutor_id, surah_num, ayah_from, ayah_to, quality)
     values ('d0000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000001', 1, 1, 3, 'jayyid') $$,
  '42501', null,
  'RLS-27: a 16+ student is still read-only after admin gained write access'
);

-- ============================================================
-- WH-01…WH-06: notification webhooks (migration 009)
--
-- Not RLS assertions, but they belong to the same "what does the
-- database do on its own" suite: the absence webhook is a trigger that
-- fires on every attendance write in the product, including admin's,
-- and it reaches outside the database. Two things need pinning — that
-- it fires on exactly the right transition and nothing else, and that
-- the shared secret it carries is not reachable from a client role.
--
-- pg_net queues into net.http_request_queue inside the calling
-- transaction, so a rolled-back test can assert on what *would* be sent
-- without a network, a listener, or anything left behind.
-- ============================================================
reset role;

insert into _tap_log(line) select has_function('public', 'fn_notify_absence', 'WH-01: fn_notify_absence() exists');
insert into _tap_log(line) select ok(
  exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'attendance'
      and t.tgname = 'trg_notify_absence' and not t.tgisinternal
  ),
  'WH-01: trg_notify_absence is attached to public.attendance'
);

-- Unconfigured (a fresh db reset, CI, this suite): silent.
insert into _tap_log(line) select ok(
  (select base_url from public.fn_webhook_config()) is null,
  'WH-02: fn_webhook_config() returns NULL when Vault holds no configuration'
);
create temp table _wh_mark(n bigint);
insert into _wh_mark select coalesce(max(id), 0) from net.http_request_queue;

update public.attendance set status = 'absent'
where session_id = 'e0000000-0000-0000-0000-00000000000a'
  and student_id = 'd0000000-0000-0000-0000-000000000001';
insert into _tap_log(line) select is(
  (select count(*) from net.http_request_queue where id > (select n from _wh_mark)),
  0::bigint,
  'WH-02: an absence recorded in an unconfigured environment queues no request'
);
update public.attendance set status = 'present'
where session_id = 'e0000000-0000-0000-0000-00000000000a'
  and student_id = 'd0000000-0000-0000-0000-000000000001';

-- Configured: the trigger fires on the transition into absent, once.
select vault.create_secret('https://webhook.test.local/.netlify/functions', 'notify_webhook_base_url');
select vault.create_secret('test-shared-secret', 'notify_webhook_secret');

-- Give the row a reason *before* the absence fires, so WH-06 is a real
-- assertion about a row that has one rather than about an empty column.
update public.attendance set reason = 'koorts'
where session_id = 'e0000000-0000-0000-0000-00000000000a'
  and student_id = 'd0000000-0000-0000-0000-000000000001';

delete from _wh_mark;
insert into _wh_mark select coalesce(max(id), 0) from net.http_request_queue;

update public.attendance set status = 'present'
where session_id = 'e0000000-0000-0000-0000-00000000000a'
  and student_id = 'd0000000-0000-0000-0000-000000000002';
insert into _tap_log(line) select is(
  (select count(*) from net.http_request_queue where id > (select n from _wh_mark)),
  0::bigint,
  'WH-03: recording a student as present queues nothing'
);

update public.attendance set status = 'absent'
where session_id = 'e0000000-0000-0000-0000-00000000000a'
  and student_id = 'd0000000-0000-0000-0000-000000000001';
insert into _tap_log(line) select is(
  (select count(*) from net.http_request_queue where id > (select n from _wh_mark)),
  1::bigint,
  'WH-03: present -> absent queues exactly one request'
);

-- Re-saving the roster (the upsert `submitAttendance` performs) must not
-- re-notify a family that was already marked absent.
update public.attendance set status = 'absent'
where session_id = 'e0000000-0000-0000-0000-00000000000a'
  and student_id = 'd0000000-0000-0000-0000-000000000001';
insert into _tap_log(line) select is(
  (select count(*) from net.http_request_queue where id > (select n from _wh_mark)),
  1::bigint,
  'WH-04: re-saving an already-absent row queues nothing further'
);

insert into _tap_log(line) select is(
  (select url from net.http_request_queue where id > (select n from _wh_mark) order by id limit 1),
  'https://webhook.test.local/.netlify/functions/notify-absence',
  'WH-05: the request targets the configured base URL'
);
insert into _tap_log(line) select is(
  (select headers ->> 'x-webhook-secret' from net.http_request_queue where id > (select n from _wh_mark) order by id limit 1),
  'test-shared-secret',
  'WH-05: the request carries the configured shared secret'
);

-- The absence `reason` can carry health data (DPIA R4/R6). The webhook
-- body must carry the row id and nothing else, so the reason never
-- leaves the database at all.
insert into _tap_log(line) select ok(
  (select (convert_from(body, 'utf8')::jsonb -> 'record') - 'id'
   from net.http_request_queue where id > (select n from _wh_mark) order by id limit 1) = '{}'::jsonb,
  'WH-06: the webhook body''s record carries the row id and nothing else'
);
insert into _tap_log(line) select ok(
  (select convert_from(body, 'utf8') from net.http_request_queue where id > (select n from _wh_mark) order by id limit 1)
    not like '%koorts%',
  'WH-06: the absence reason does not appear anywhere in the webhook body'
);

-- ============================================================
-- WH-07…WH-12: the four event triggers added in migration 010
-- ============================================================

-- WH-07: the jilid trigger is deliberately *not* selective — it fires
-- for every Yanbu'a entry and lets the Function apply
-- `isJilidComplete`, so that rule has exactly one implementation. Both
-- a mid-jilid entry and a completing one must queue a request.
delete from _wh_mark;
insert into _wh_mark select coalesce(max(id), 0) from net.http_request_queue;
insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
values ('d0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 1, 5, 'kurang_lancar');
insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
values ('d0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 1, 44, 'lancar');
insert into _tap_log(line) select is(
  (select count(*) from net.http_request_queue where id > (select n from _wh_mark)),
  2::bigint,
  'WH-07: every yanbua_progress entry queues a milestone check, completing or not'
);
insert into _tap_log(line) select is(
  (select count(distinct url) from net.http_request_queue where id > (select n from _wh_mark)),
  1::bigint,
  'WH-07: …all of them to the same notify-milestone endpoint'
);
insert into _tap_log(line) select is(
  (select url from net.http_request_queue where id > (select n from _wh_mark) order by id limit 1),
  'https://webhook.test.local/.netlify/functions/notify-milestone',
  'WH-07: the jilid webhook targets notify-milestone'
);
insert into _tap_log(line) select is(
  (select convert_from(body, 'utf8')::jsonb ->> 'table' from net.http_request_queue where id > (select n from _wh_mark) order by id limit 1),
  'yanbua_progress',
  'WH-07: …and names the table, so one Function can serve both milestone kinds'
);

-- WH-08: "surah memorized" is a state transition, not a curriculum rule
-- — active true -> false, and nothing else.
delete from _wh_mark;
insert into _wh_mark select coalesce(max(id), 0) from net.http_request_queue;
update public.murajaah_assignments set active = false
where id = 'f0000000-0000-0000-0000-000000000001';
insert into _tap_log(line) select is(
  (select count(*) from net.http_request_queue where id > (select n from _wh_mark)),
  1::bigint,
  'WH-08: marking a murajaah target memorized queues one request'
);
insert into _tap_log(line) select is(
  (select convert_from(body, 'utf8')::jsonb ->> 'table' from net.http_request_queue where id > (select n from _wh_mark) order by id limit 1),
  'murajaah_assignments',
  'WH-08: …identified as the murajaah_assignments milestone'
);
update public.murajaah_assignments set active = true
where id = 'f0000000-0000-0000-0000-000000000001';
update public.murajaah_assignments set ayah_to = 5
where id = 'f0000000-0000-0000-0000-000000000001';
insert into _tap_log(line) select is(
  (select count(*) from net.http_request_queue where id > (select n from _wh_mark)),
  1::bigint,
  'WH-08: re-activating a target, or editing it, queues nothing'
);

-- WH-09: new homework.
delete from _wh_mark;
insert into _wh_mark select coalesce(max(id), 0) from net.http_request_queue;
insert into public.assignments (id, class_id, tutor_id, title, due_date)
values ('b0000000-0000-0000-0000-0000000000e1', 'c0000000-0000-0000-0000-00000000000a',
        '70000000-0000-0000-0000-000000000001', 'Hafalan Surah An-Nas', current_date + 2);
insert into _tap_log(line) select is(
  (select count(*) from net.http_request_queue where id > (select n from _wh_mark)),
  1::bigint,
  'WH-09: creating an assignment queues one request'
);
insert into _tap_log(line) select is(
  (select url from net.http_request_queue where id > (select n from _wh_mark) order by id limit 1),
  'https://webhook.test.local/.netlify/functions/notify-assignment',
  'WH-09: …to notify-assignment'
);
-- The assignment title is not lock-screen content (DPIA R6) and, as with
-- the absence reason, never leaves the database in the webhook at all.
insert into _tap_log(line) select ok(
  (select convert_from(body, 'utf8') from net.http_request_queue where id > (select n from _wh_mark) order by id limit 1)
    not like '%An-Nas%',
  'WH-09: the assignment title does not appear in the webhook body'
);
insert into _tap_log(line) select ok(
  (select (convert_from(body, 'utf8')::jsonb -> 'record') - 'id'
   from net.http_request_queue where id > (select n from _wh_mark) order by id limit 1) = '{}'::jsonb,
  'WH-09: the body carries the row id and nothing else'
);

-- WH-10: a report notifies on the transition into published, once.
delete from _wh_mark;
insert into _wh_mark select coalesce(max(id), 0) from net.http_request_queue;
update public.year_end_reports set status = 'published'
where student_id = 'd0000000-0000-0000-0000-000000000001' and academic_year = '2025/2026';
insert into _tap_log(line) select is(
  (select count(*) from net.http_request_queue where id > (select n from _wh_mark)),
  1::bigint,
  'WH-10: publishing a draft report queues one request'
);
insert into _tap_log(line) select is(
  (select url from net.http_request_queue where id > (select n from _wh_mark) order by id limit 1),
  'https://webhook.test.local/.netlify/functions/notify-report-ready',
  'WH-10: …to notify-report-ready'
);
-- Re-publishing after a correction (FR-006) leaves status at published,
-- so there is no second publish event to announce — and an admin edit to
-- a published report does not regenerate the PDF (ADR-014(e)), which is
-- exactly when a second "your report is ready" would be untrue.
update public.year_end_reports set status = 'published'
where student_id = 'd0000000-0000-0000-0000-000000000001' and academic_year = '2025/2026';
update public.year_end_reports set narrative = 'corrected text'
where student_id = 'd0000000-0000-0000-0000-000000000001' and academic_year = '2025/2026';
insert into _tap_log(line) select is(
  (select count(*) from net.http_request_queue where id > (select n from _wh_mark)),
  1::bigint,
  'WH-10: re-publishing or editing an already-published report queues nothing'
);

-- WH-11: every trigger in migration 010, like 009's, is silent in an
-- unconfigured environment. This is what keeps CI and a fresh local
-- stack from making outbound requests.
delete from vault.secrets where name in ('notify_webhook_base_url', 'notify_webhook_secret');
delete from _wh_mark;
insert into _wh_mark select coalesce(max(id), 0) from net.http_request_queue;
insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
values ('d0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 2, 44, 'lancar');
insert into public.assignments (class_id, tutor_id, title, due_date)
values ('c0000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-000000000001', 'Unconfigured', current_date + 1);
update public.murajaah_assignments set active = false
where id = 'f0000000-0000-0000-0000-000000000002';
insert into _tap_log(line) select is(
  (select count(*) from net.http_request_queue where id > (select n from _wh_mark)),
  0::bigint,
  'WH-11: with no Vault configuration, none of the migration 010 triggers queue anything'
);

-- WH-12: a trigger must never be able to fail the write it observes.
-- `fn_post_webhook` is dropped out from under them; the writes must
-- still succeed.
alter function public.fn_post_webhook(text, text, text, uuid) rename to fn_post_webhook_moved;
insert into _tap_log(line) select lives_ok(
  $$ insert into public.assignments (class_id, tutor_id, title, due_date)
     values ('c0000000-0000-0000-0000-00000000000a', '70000000-0000-0000-0000-000000000001',
             'Broken webhook', current_date + 1) $$,
  'WH-12: a broken webhook path does not fail the assignment write'
);
insert into _tap_log(line) select lives_ok(
  $$ update public.attendance set status = 'absent'
     where session_id = 'e0000000-0000-0000-0000-00000000000b'
       and student_id = 'd0000000-0000-0000-0000-000000000004' $$,
  'WH-12: …nor the attendance write'
);
alter function public.fn_post_webhook_moved(text, text, text, uuid) rename to fn_post_webhook;

-- The shared secret must not be reachable from a client role.
set local role authenticated;
set local request.jwt.claim.role to 'authenticated';
set local request.jwt.claim.sub to '90000000-0000-0000-0000-000000000001';  -- P1
insert into _tap_log(line) select throws_ok(
  $$ select * from public.fn_webhook_config() $$,
  '42501', null,
  'WH-06: a signed-in user cannot execute fn_webhook_config() to read the secret'
);
reset role;
drop table _wh_mark;


-- ======================================================================
-- NC-01…NC-10 — the in-app notification centre (migration 012, ADR-017)
--
-- A notification is a message addressed to one named person. The whole
-- table is therefore one access-control question, asked from every
-- direction below: can anyone read someone else's, and can anyone write
-- one at all.
-- ======================================================================
insert into public.notifications (user_id, student_id, event, context, event_date)
values
  -- P1, about their own two children
  ('90000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'absence', '{}'::jsonb, current_date),
  ('90000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002',
   'jilidMilestone', '{"number": 3}'::jsonb, current_date),
  -- P2, about theirs
  ('90000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000003',
   'absence', '{}'::jsonb, current_date),
  -- The 16+ student, about themselves
  ('50000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000004',
   'reportReady', '{}'::jsonb, current_date);

set local role authenticated;
set local request.jwt.claim.role to 'authenticated';
set local request.jwt.claim.sub to '90000000-0000-0000-0000-000000000001';  -- P1

insert into _tap_log(line) select is(
  (select count(*) from public.notifications),
  2::bigint,
  'NC-01: a parent sees exactly their own notifications, and no others'
);

insert into _tap_log(line) select is(
  (select count(*) from public.notifications
   where user_id <> '90000000-0000-0000-0000-000000000001'),
  0::bigint,
  'NC-02: CROSS-FAMILY — another parent''s notifications are invisible, not merely filtered by the app'
);

-- The one write a client is allowed.
update public.notifications set read_at = now()
where user_id = '90000000-0000-0000-0000-000000000001';
insert into _tap_log(line) select is(
  (select count(*) from public.notifications where read_at is not null),
  2::bigint,
  'NC-03: a recipient can mark their own notifications read'
);

-- …and the only one. RLS has no column granularity, so this is enforced
-- by the column-level GRANT in migration 012 rather than by a policy:
-- without it, a recipient could rewrite the event on their own row and
-- make the app render something that never happened.
insert into _tap_log(line) select throws_ok(
  $$ update public.notifications set event = 'reportReady'
     where user_id = '90000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'NC-04: a recipient cannot rewrite the event on their own notification'
);
insert into _tap_log(line) select throws_ok(
  $$ update public.notifications set context = '{"number": 99}'::jsonb
     where user_id = '90000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'NC-05: …nor its context'
);

-- Nobody may invent a notification. A client that could insert here
-- could put words in the TPA's mouth on another parent's screen.
insert into _tap_log(line) select throws_ok(
  $$ insert into public.notifications (user_id, student_id, event, event_date)
     values ('90000000-0000-0000-0000-000000000001',
             'd0000000-0000-0000-0000-000000000001', 'absence', current_date) $$,
  '42501', null,
  'NC-06: a signed-in user cannot insert a notification, even addressed to themselves'
);

-- No delete either: retention is central (`prune-notifications`), so
-- there is no path by which a record of what a family was told is
-- removed early.
insert into _tap_log(line) select throws_ok(
  $$ delete from public.notifications
     where user_id = '90000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'NC-07: a recipient cannot delete their own notifications'
);

-- The 16+ student reads their own, and only their own.
set local request.jwt.claim.sub to '50000000-0000-0000-0000-000000000001';
insert into _tap_log(line) select is(
  (select count(*) from public.notifications),
  1::bigint,
  'NC-08: a 16+ student sees their own notification'
);

-- Admin is the deliberate exception to ADR-014's super admin. Admin can
-- read every operational table on every class, because running the TPA
-- needs that; an inbox of every family's personal messages is a
-- different kind of access and adds nothing to running the TPA.
--
-- This admin is nobody's parent, which is why the count is flatly zero.
-- The policy that produces it — `notifications_own_read`, `user_id =
-- auth.uid()` — was never a role test, so an admin whose own child
-- attends the TPA reads that child's notifications and still nobody
-- else's. NC-12 asserts exactly that, and it is the boundary rather
-- than an exception to this one.
set local request.jwt.claim.sub to 'a0000000-0000-0000-0000-000000000000';
insert into _tap_log(line) select is(
  (select count(*) from public.notifications),
  0::bigint,
  'NC-09: an admin reads no notifications at all — the one place ADR-014 does not extend'
);

-- A tutor likewise.
set local request.jwt.claim.sub to '70000000-0000-0000-0000-000000000001';
insert into _tap_log(line) select is(
  (select count(*) from public.notifications),
  0::bigint,
  'NC-10: a tutor reads none either, including for their own class'
);

reset role;

-- NC-11: TRUNCATE is not filtered by RLS, and `anon`/`authenticated`
-- held it on every table in `public` from Supabase's own role
-- bootstrap. Migration 012 revokes it. Asserted on `attendance` rather
-- than on `notifications`, because the point is that the revoke covers
-- the whole schema and not just the table that prompted it.
set local role authenticated;
insert into _tap_log(line) select throws_ok(
  $$ truncate public.attendance $$,
  '42501', null,
  'NC-11: a signed-in user cannot TRUNCATE a table RLS otherwise protects'
);
reset role;

-- ======================================================================
-- RLS-28…RLS-33 — the dual-role person (TAD ADR-019)
--
-- `users.role` holds exactly one value, but a real person can be more
-- than one thing at once: a tutor whose own child attends, an admin who
-- also teaches. Nothing stops that state existing — `students.parent_id`
-- is a plain FK to `users(id)` with no role constraint — so the question
-- is not whether it can happen but what the database does when it does.
--
-- The claim these cases exist to prove, before any application code is
-- written on top of it, is that the answer is already correct: every
-- family/tutor policy in migration 003 is written against a
-- *relationship* (`parent_id = auth.uid()`, `auth.uid() = any(tutor_ids)`,
-- `user_id = auth.uid()`), not against `users.role`. `fn_is_admin()` is
-- the single exception in the whole file. Postgres ORs permissive
-- policies, so a person holding two relationships should get the union of
-- the two grants — no more, and no less.
--
-- "No more" is the half that matters for a GDPR incident, so it is
-- asserted hardest: a dual-role user must not see a child who is neither
-- theirs nor in their class, and must not gain a *write* they only ever
-- held on the other side of the union.
--
-- Placed last, after NC-11, for the same reason RLS-22 is placed after
-- RLS-14: this block adds students, classes and reports, and RLS-14
-- asserts exact fixture row counts for admin.
-- ======================================================================
reset role;

-- Two people with identical relationships and *different* `users.role`
-- values. If RLS were role-based they would see different things; the
-- point of the pair is that they do not.
--   TP — role 'parent', but a tutor of Class C, and parent of a child in Class D
--   TT — role 'tutor',  same shape: tutor of Class C, parent of a child in Class D
--   P4 — an ordinary parent, owning the two children that must stay invisible
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('b0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'tp@test.local', '', now(), '{}', '{}', false, false, now(), now()),
  ('b0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'tt@test.local', '', now(), '{}', '{}', false, false, now(), now()),
  ('b0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'p4@test.local', '', now(), '{}', '{}', false, false, now(), now());

insert into public.users (id, email, full_name, role, locale)
values
  ('b0000000-0000-0000-0000-000000000001', 'tp@test.local', 'Tutor-Parent (role=parent)', 'parent', 'id'),
  ('b0000000-0000-0000-0000-000000000002', 'tt@test.local', 'Tutor-Parent (role=tutor)',  'tutor',  'id'),
  ('b0000000-0000-0000-0000-000000000003', 'p4@test.local', 'Parent Four',                'parent', 'id');

-- Class C is taught by both dual-role users. Class D is taught by T2 and
-- is where both of their own children are enrolled — so each of them is
-- a *parent* in a class they do not teach, which is precisely the case
-- where a role-based policy and a relationship-based one diverge.
insert into public.classes (id, name, schedule, tutor_ids)
values
  ('c0000000-0000-0000-0000-00000000000c', 'Class C (dual-role test)', 'Sabtu 13:00',
   array['b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002']::uuid[]),
  ('c0000000-0000-0000-0000-00000000000d', 'Class D (dual-role test)', 'Minggu 13:00',
   array['70000000-0000-0000-0000-000000000002']::uuid[]);

insert into public.students (id, parent_id, user_id, full_name, class_id, date_of_birth)
values
  -- taught by TP and TT, child of neither
  ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000003', null, 'C Kid',  'c0000000-0000-0000-0000-00000000000c', '2015-05-01'),
  -- TP's own child, in a class TP does not teach
  ('d0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000001', null, 'TP Kid', 'c0000000-0000-0000-0000-00000000000d', '2016-05-01'),
  -- TT's own child, likewise
  ('d0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000002', null, 'TT Kid', 'c0000000-0000-0000-0000-00000000000d', '2016-06-01'),
  -- the hard negative: a classmate of their own children, in a class
  -- neither of them teaches, belonging to neither of them
  ('d0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000003', null, 'D Kid',  'c0000000-0000-0000-0000-00000000000d', '2015-07-01');

insert into public.sessions (id, class_id, date, tutor_id)
values
  ('e0000000-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-00000000000c', current_date, 'b0000000-0000-0000-0000-000000000001'),
  ('e0000000-0000-0000-0000-00000000000d', 'c0000000-0000-0000-0000-00000000000d', current_date, '70000000-0000-0000-0000-000000000002');

insert into public.attendance (session_id, student_id, status)
values
  ('e0000000-0000-0000-0000-00000000000c', 'd0000000-0000-0000-0000-000000000005', 'present'),
  ('e0000000-0000-0000-0000-00000000000d', 'd0000000-0000-0000-0000-000000000006', 'present'),
  ('e0000000-0000-0000-0000-00000000000d', 'd0000000-0000-0000-0000-000000000007', 'present'),
  ('e0000000-0000-0000-0000-00000000000d', 'd0000000-0000-0000-0000-000000000008', 'present');

insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
values
  ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 1, 1, 'lancar'),
  ('d0000000-0000-0000-0000-000000000006', '70000000-0000-0000-0000-000000000002', 1, 1, 'lancar'),
  ('d0000000-0000-0000-0000-000000000008', '70000000-0000-0000-0000-000000000002', 1, 1, 'lancar');

insert into public.quran_progress (student_id, tutor_id, surah_num, ayah_from, ayah_to, quality)
values
  ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 1, 1, 5, 'mumtaz'),
  ('d0000000-0000-0000-0000-000000000006', '70000000-0000-0000-0000-000000000002', 1, 1, 5, 'mumtaz'),
  ('d0000000-0000-0000-0000-000000000008', '70000000-0000-0000-0000-000000000002', 1, 1, 5, 'mumtaz');

insert into public.murajaah_assignments (id, student_id, tutor_id, surah_num, ayah_from, ayah_to, frequency)
values
  ('f0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 1, 1, 3, 'daily'),
  ('f0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000006', '70000000-0000-0000-0000-000000000002', 1, 1, 3, 'daily'),
  ('f0000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000008', '70000000-0000-0000-0000-000000000002', 1, 1, 3, 'daily');

insert into public.murajaah_log (assignment_id, confirmed_by, quality, date)
values
  ('f0000000-0000-0000-0000-000000000008', 'b0000000-0000-0000-0000-000000000003', 'hafal_lancar', current_date);

-- One draft and one published report on each side of the union, so
-- "each half keeps its own limits" is testable (RLS-32).
insert into public.year_end_reports (student_id, academic_year, tutor_id, status)
values
  ('d0000000-0000-0000-0000-000000000005', '2025/2026', 'b0000000-0000-0000-0000-000000000001', 'draft'),      -- C Kid: TP's own class, draft
  ('d0000000-0000-0000-0000-000000000006', '2025/2026', '70000000-0000-0000-0000-000000000002', 'draft'),      -- TP Kid: TP's own child, draft
  ('d0000000-0000-0000-0000-000000000006', '2024/2025', '70000000-0000-0000-0000-000000000002', 'published'),  -- TP Kid: published
  ('d0000000-0000-0000-0000-000000000008', '2025/2026', '70000000-0000-0000-0000-000000000002', 'published');  -- D Kid: published, and none of TP's business

-- ============================================================
-- RLS-28: TP (users.role = 'parent', tutor of C, parent of a child in D)
--         SELECT students → exactly the union of both grants, and
--         nothing more
-- ============================================================
set local role authenticated;
set local request.jwt.claim.role to 'authenticated';
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-000000000001';

-- The row-level claim, stated as an exact set rather than a count: this
-- is the assertion that would fail if the union leaked. `D Kid` is the
-- one to watch — a classmate of TP's own child, so a policy written as
-- "the classes my children are in" instead of "the classes I teach"
-- would hand TP that whole roster.
insert into _tap_log(line) select set_eq(
  'select id from public.students',
  array[
    'd0000000-0000-0000-0000-000000000005',   -- C Kid  — via the tutor grant
    'd0000000-0000-0000-0000-000000000006'    -- TP Kid — via the parent grant
  ]::uuid[],
  'RLS-28: a tutor-parent sees exactly their class plus their own child — not their child''s classmates, not another family'
);

-- …and the role column really is 'parent' while that tutor grant applies.
insert into _tap_log(line) select is(
  (select public.fn_current_role())::text, 'parent',
  'RLS-28: …and their users.role is still ''parent'' — the tutor grant came from the relationship, not the column'
);
insert into _tap_log(line) select is(
  public.fn_is_admin(), false,
  'RLS-28: …and they are not an admin — nothing here is coming from the one policy that does check role'
);

-- Classes and sessions follow the same union: Class C because they teach
-- it, Class D because their child is in it. Classes A and B are neither.
-- This is correct at the data layer and is also why `useMyClasses` has
-- to filter on `tutor_ids` rather than take what RLS returns: a class
-- picker on a recording screen means "classes I may record against",
-- and Class D is not one of them (RLS-31).
insert into _tap_log(line) select set_eq(
  'select id from public.classes',
  array[
    'c0000000-0000-0000-0000-00000000000c',
    'c0000000-0000-0000-0000-00000000000d'
  ]::uuid[],
  'RLS-28: classes are the union too — the one they teach and the one their child attends'
);
insert into _tap_log(line) select set_eq(
  'select id from public.sessions',
  array[
    'e0000000-0000-0000-0000-00000000000c',
    'e0000000-0000-0000-0000-00000000000d'
  ]::uuid[],
  'RLS-28: sessions likewise, via sessions_tutor_rw on one side and sessions_family_read on the other'
);

-- ============================================================
-- RLS-29: TT — identical relationships, users.role = 'tutor' —
--         sees the identically-shaped set. Two rows of the same
--         column value cannot be what is granting either of them
--         anything.
-- ============================================================
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-000000000002';

insert into _tap_log(line) select set_eq(
  'select id from public.students',
  array[
    'd0000000-0000-0000-0000-000000000005',   -- C Kid  — via the tutor grant
    'd0000000-0000-0000-0000-000000000007'    -- TT Kid — via the parent grant
  ]::uuid[],
  'RLS-29: the same shape for a dual-role user whose users.role is ''tutor'' — RLS is relationship-based, not role-based'
);
insert into _tap_log(line) select is(
  (select public.fn_current_role())::text, 'tutor',
  'RLS-29: …with the opposite role column value to RLS-28, and the same result'
);
-- The specific cross-check: TT's own child is in the same class as TP's,
-- and neither can see the other's.
insert into _tap_log(line) select is(
  (select count(*) from public.students where id = 'd0000000-0000-0000-0000-000000000006'),
  0::bigint,
  'RLS-29: CROSS-FAMILY — one tutor-parent cannot see the other tutor-parent''s child, though both children share a class'
);

-- ============================================================
-- RLS-30: the union holds per operational table, not just on
--         `students` — and stops at the same boundary on each
-- ============================================================
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-000000000001';

insert into _tap_log(line) select is(
  (select count(*) from public.attendance where student_id = 'd0000000-0000-0000-0000-000000000005'),
  1::bigint, 'RLS-30: TP reads attendance for a student in the class they teach');
insert into _tap_log(line) select is(
  (select count(*) from public.attendance where student_id = 'd0000000-0000-0000-0000-000000000006'),
  1::bigint, 'RLS-30: TP reads attendance for their own child, in a class they do not teach');
insert into _tap_log(line) select is(
  (select count(*) from public.attendance where student_id = 'd0000000-0000-0000-0000-000000000008'),
  0::bigint, 'RLS-30: TP reads 0 attendance rows for their child''s classmate — the union does not widen to the whole class');
insert into _tap_log(line) select is(
  (select count(*) from public.attendance where student_id = 'd0000000-0000-0000-0000-000000000003'),
  0::bigint, 'RLS-30: …nor for an unrelated family''s child elsewhere in the school');

insert into _tap_log(line) select set_eq(
  'select student_id from public.yanbua_progress',
  array[
    'd0000000-0000-0000-0000-000000000005',
    'd0000000-0000-0000-0000-000000000006'
  ]::uuid[],
  'RLS-30: yanbua_progress is exactly the union — the classmate''s row exists and is invisible');
insert into _tap_log(line) select set_eq(
  'select student_id from public.quran_progress',
  array[
    'd0000000-0000-0000-0000-000000000005',
    'd0000000-0000-0000-0000-000000000006'
  ]::uuid[],
  'RLS-30: quran_progress likewise');
insert into _tap_log(line) select set_eq(
  'select student_id from public.murajaah_assignments',
  array[
    'd0000000-0000-0000-0000-000000000005',
    'd0000000-0000-0000-0000-000000000006'
  ]::uuid[],
  'RLS-30: murajaah_assignments likewise');
insert into _tap_log(line) select is(
  (select count(*) from public.murajaah_log ml
   join public.murajaah_assignments ma on ma.id = ml.assignment_id
   where ma.student_id = 'd0000000-0000-0000-0000-000000000008'),
  0::bigint,
  'RLS-30: the classmate''s home-practice log is invisible, though a log row for it exists');

-- ============================================================
-- RLS-31: the union is not a promotion — each grant keeps the
--         write boundary it had on its own
-- ============================================================

-- Tutor half: writes on the class they teach, as any tutor would.
insert into _tap_log(line) select lives_ok(
  $$ insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
     values ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 1, 2, 'lancar') $$,
  'RLS-31: TP records Yanbu''a for a student in the class they teach'
);
-- Parent half stays read-only: being a tutor somewhere does not let
-- anyone grade their own child. `yanbua_tutor_insert` is scoped to
-- fn_my_class_students(), and TP Kid is not in it.
insert into _tap_log(line) select throws_ok(
  $$ insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
     values ('d0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000001', 1, 2, 'lancar') $$,
  '42501', null,
  'RLS-31: …but cannot record Yanbu''a for their OWN child — the parent half of the union is read-only'
);

-- Parent half: confirms home practice for their own child, as any
-- parent would.
insert into _tap_log(line) select lives_ok(
  $$ insert into public.murajaah_log (assignment_id, confirmed_by, quality, date)
     values ('f0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000001', 'hafal_lancar', current_date) $$,
  'RLS-31: TP confirms home practice for their own child'
);
-- Tutor half does not confer it: `mlog_parent_insert` is the only INSERT
-- policy on murajaah_log for a non-admin, and it is fn_my_children()-scoped.
insert into _tap_log(line) select throws_ok(
  $$ insert into public.murajaah_log (assignment_id, confirmed_by, quality, date)
     values ('f0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 'hafal_lancar', current_date) $$,
  '42501', null,
  'RLS-31: …but cannot confirm it for a student in their class — home practice is a parent''s confirmation, and teaching does not grant it'
);

-- ============================================================
-- RLS-32: year_end_reports — the sharpest form of "each half keeps
--         its own limits". Drafts are visible through the tutor
--         grant and invisible through the parent grant, and holding
--         both does not merge those two rules.
-- ============================================================
insert into _tap_log(line) select is(
  (select count(*) from public.year_end_reports
   where student_id = 'd0000000-0000-0000-0000-000000000005' and status = 'draft'),
  1::bigint,
  'RLS-32: TP sees the draft report for a student in the class they teach'
);
insert into _tap_log(line) select is(
  (select count(*) from public.year_end_reports
   where student_id = 'd0000000-0000-0000-0000-000000000006' and status = 'draft'),
  0::bigint,
  'RLS-32: …and still cannot see the draft for their OWN child — being a tutor elsewhere does not lift yer_parent_read''s published-only rule'
);
insert into _tap_log(line) select is(
  (select count(*) from public.year_end_reports
   where student_id = 'd0000000-0000-0000-0000-000000000006' and status = 'published'),
  1::bigint,
  'RLS-32: …but does see their own child''s published report, exactly as a parent would'
);
insert into _tap_log(line) select is(
  (select count(*) from public.year_end_reports
   where student_id = 'd0000000-0000-0000-0000-000000000008'),
  0::bigint,
  'RLS-32: …and none of the classmate''s, published or not'
);

-- ============================================================
-- RLS-33: the dual-role user widens nobody else, and gains nothing
--         from the pre-existing fixture
-- ============================================================

-- Nothing from the original fixture reaches TP.
insert into _tap_log(line) select is(
  (select count(*) from public.students
   where id in ('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002',
                'd0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000004')),
  0::bigint,
  'RLS-33: TP sees none of the four original fixture students'
);

-- And TP's own two are invisible to everyone who came before.
set local request.jwt.claim.sub to '90000000-0000-0000-0000-000000000001';   -- P1
insert into _tap_log(line) select is(
  (select count(*) from public.students
   where id in ('d0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000006')),
  0::bigint, 'RLS-33: P1 sees none of the dual-role classes'' students');
set local request.jwt.claim.sub to '70000000-0000-0000-0000-000000000001';   -- T1
insert into _tap_log(line) select is(
  (select count(*) from public.students
   where id in ('d0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000006')),
  0::bigint, 'RLS-33: T1 sees none of them either — Class C is not theirs');
set local request.jwt.claim.sub to '50000000-0000-0000-0000-000000000001';   -- S16
insert into _tap_log(line) select is(
  (select count(*) from public.students where id <> 'd0000000-0000-0000-0000-000000000004'),
  0::bigint, 'RLS-33: the 16+ student still sees exactly one student row — their own');

set local role anon;
set local request.jwt.claim.sub to '';
set local request.jwt.claim.role to 'anon';
insert into _tap_log(line) select is(
  (select count(*) from public.students), 0::bigint,
  'RLS-33: anon still sees 0 students after the dual-role rows exist');
reset role;

-- ======================================================================
-- RLS-34 — the triple-role person: admin *and* tutor *and* parent
--
-- Two relationships was the shape ADR-019 was written for, but nothing
-- in the schema caps the number at two, and the capability derivation is
-- four independent booleans rather than a pair. This case exists so that
-- "the model is n-ary" is a tested claim rather than an inference from
-- the absence of a constraint.
--
-- It also marks the one boundary the rest of this block does not: for
-- everybody above, the union is bounded by the relationships they hold.
-- Add `admin` to the union and that stops being true — `fn_is_admin()`
-- is an unconditional `ALL` on every table (ADR-014), so it swallows both
-- other grants whole. **RLS-28's "nothing more" and RLS-31/RLS-32's "the
-- union is not a promotion" do not survive an admin in the mix, and the
-- assertions below are deliberately the mirror image of those.** The
-- restraint that keeps an admin out of the parent-only actions is
-- application-layer, exactly as RLS-25 records for home practice.
--
-- Placed after RLS-33 rather than beside RLS-28 because it adds a fifth
-- student and a fourth tutor to Class C, which RLS-28's and RLS-29's
-- exact-set assertions would otherwise have to account for.
-- ======================================================================

-- TAP — users.role 'admin', tutor of Class C, parent of a child in Class D.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous, created_at, updated_at)
values ('b0000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'tap@test.local', '', now(), '{}', '{}', false, false, now(), now());

insert into public.users (id, email, full_name, role, locale)
values ('b0000000-0000-0000-0000-000000000004', 'tap@test.local', 'Tutor-Parent-Admin (role=admin)', 'admin', 'id');

update public.classes
   set tutor_ids = tutor_ids || 'b0000000-0000-0000-0000-000000000004'::uuid
 where id = 'c0000000-0000-0000-0000-00000000000c';

-- Their own child sits in Class D, which they do not teach — the same
-- shape as TP and TT, so the comparison with RLS-31/RLS-32 is like for like.
insert into public.students (id, parent_id, user_id, full_name, class_id, date_of_birth)
values ('d0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000004', null, 'TAP Kid', 'c0000000-0000-0000-0000-00000000000d', '2016-08-01');

insert into public.murajaah_assignments (id, student_id, tutor_id, surah_num, ayah_from, ayah_to, frequency)
values ('f0000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-000000000009', '70000000-0000-0000-0000-000000000002', 1, 1, 3, 'daily');

-- A draft on their own child, authored by that child's actual tutor —
-- the row RLS-32 proved a non-admin tutor-parent cannot see.
insert into public.year_end_reports (student_id, academic_year, tutor_id, status)
values ('d0000000-0000-0000-0000-000000000009', '2025/2026', '70000000-0000-0000-0000-000000000002', 'draft');

set local role authenticated;
set local request.jwt.claim.role to 'authenticated';
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-000000000004';

-- ---- the three relationships coexist, each still derived its own way.
-- This is the ground truth the application's capability derivation
-- mirrors: `isAdmin` from the role column because fn_is_admin() reads it,
-- the other two from relationships, and no pair of them exclusive.
insert into _tap_log(line) select is(
  public.fn_is_admin(), true,
  'RLS-34: the triple-role user is an admin — the one grant that comes from users.role'
);
insert into _tap_log(line) select set_eq(
  'select public.fn_my_classes()',
  array['c0000000-0000-0000-0000-00000000000c']::uuid[],
  'RLS-34: …and a tutor of exactly the one class they are named in — being admin does not enlarge the *relationship*, only the grant'
);
insert into _tap_log(line) select set_eq(
  'select public.fn_my_children()',
  array['d0000000-0000-0000-0000-000000000009']::uuid[],
  'RLS-34: …and the parent of exactly their own child'
);
insert into _tap_log(line) select ok(
  public.fn_my_student_id() is null,
  'RLS-34: …and not a 16+ self-login student — the fourth capability is independently false'
);

-- ---- reads: the union collapses, and that is the point of the case.
-- The mirror of RLS-33's first assertion, where TP sees none of these.
insert into _tap_log(line) select is(
  (select count(*) from public.students
   where id in ('d0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002',
                'd0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000004')),
  4::bigint,
  'RLS-34: they see all four original fixture students — children they neither teach nor parent. With admin in the union, "nothing more" no longer holds'
);

-- ---- writes: each of RLS-31/RLS-32's refusals, now allowed.
insert into _tap_log(line) select lives_ok(
  $$ insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
     values ('d0000000-0000-0000-0000-000000000009', 'b0000000-0000-0000-0000-000000000004', 1, 3, 'lancar') $$,
  'RLS-34: they CAN record Yanbu''a for their own child, which RLS-31 refused a non-admin tutor-parent — yanbua_admin_all outranks the parent half being read-only'
);
insert into _tap_log(line) select lives_ok(
  $$ insert into public.murajaah_log (assignment_id, confirmed_by, quality, date)
     values ('f0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000004', 'hafal_lancar', current_date) $$,
  'RLS-34: …and CAN confirm home practice for a student in their class, which RLS-31 refused. The parent-only rule for confirmations is application-layer (ADR-014(c), RLS-25), not RLS'
);
insert into _tap_log(line) select is(
  (select count(*) from public.year_end_reports
   where student_id = 'd0000000-0000-0000-0000-000000000009' and status = 'draft'),
  1::bigint,
  'RLS-34: …and DO see their own child''s draft report, which RLS-32 refused. yer_admin_all has no published-only clause'
);

-- ---- and they widen nobody: the extra relationships are theirs alone.
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-000000000001';   -- TP
insert into _tap_log(line) select is(
  (select count(*) from public.students where id = 'd0000000-0000-0000-0000-000000000009'),
  0::bigint,
  'RLS-34: TP still cannot see the admin''s child — sharing a class with an admin grants nothing'
);
set local role anon;
set local request.jwt.claim.sub to '';
set local request.jwt.claim.role to 'anon';
insert into _tap_log(line) select is(
  (select count(*) from public.students), 0::bigint,
  'RLS-34: anon still sees 0 students after the triple-role rows exist');
reset role;

-- ======================================================================
-- RLS-35 — the student assistant: a 16+ self-login student who also
--          tutors a class
--
-- Every other document in this project said "a 16+ student is
-- read-only", and RLS-07 asserts it. What RLS-07 actually tests is a
-- student who holds *no other relationship*: `fn_current_role()` is
-- consulted in exactly one place in the whole schema — inside
-- `fn_is_admin()` — so nothing anywhere refuses a write because the
-- caller's role column says `student`. Being read-only was a
-- consequence of holding no write-granting relationship, never a
-- property of the role, and the two are indistinguishable until
-- somebody holds both.
--
-- PPME's decision is that a student assistant **should** be able to
-- record for the class they teach (ADR-020). So this case is not a
-- guard against an accident; it pins behaviour that is now wanted, and
-- pins the boundary that comes with it — the tutor grant reaches their
-- class and stops there, and it does not reach back to their own record,
-- which stays as read-only as any other student's.
-- ======================================================================

-- SA — users.role 'student', their own record in Class D (which they do
-- not teach), and a tutor of Class C. The two halves are deliberately
-- disjoint, so no assertion below can pass by accident through the other
-- grant.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous, created_at, updated_at)
values ('b0000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'sa@test.local', '', now(), '{}', '{}', false, false, now(), now());

insert into public.users (id, email, full_name, role, locale)
values ('b0000000-0000-0000-0000-000000000005', 'sa@test.local', 'Student Assistant (role=student)', 'student', 'id');

-- The hybrid account model holds: a student record is always linked to a
-- parent (P4 here) even when the student has their own login.
insert into public.students (id, parent_id, user_id, full_name, class_id, date_of_birth)
values ('d0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000005', 'SA Own Record', 'c0000000-0000-0000-0000-00000000000d', '2008-04-01');

update public.classes
   set tutor_ids = tutor_ids || 'b0000000-0000-0000-0000-000000000005'::uuid
 where id = 'c0000000-0000-0000-0000-00000000000c';

set local role authenticated;
set local request.jwt.claim.role to 'authenticated';
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-000000000005';

-- ---- ground truth: a student and a tutor at the same time.
insert into _tap_log(line) select is(
  (select public.fn_current_role())::text, 'student',
  'RLS-35: the student assistant''s users.role really is ''student'''
);
insert into _tap_log(line) select is(
  public.fn_my_student_id(), 'd0000000-0000-0000-0000-00000000000a'::uuid,
  'RLS-35: …with their own student record, the 16+ self-login link'
);
insert into _tap_log(line) select set_eq(
  'select public.fn_my_classes()',
  array['c0000000-0000-0000-0000-00000000000c']::uuid[],
  'RLS-35: …and a tutor of Class C, which is a relationship and owes nothing to the role column'
);
insert into _tap_log(line) select is(
  public.fn_is_admin(), false,
  'RLS-35: …and not an admin — none of what follows comes from the one policy that reads role'
);

-- ---- reads: their own record plus the class they teach, and no more.
insert into _tap_log(line) select set_eq(
  'select id from public.students',
  array[
    'd0000000-0000-0000-0000-000000000005',   -- C Kid — via the tutor grant
    'd0000000-0000-0000-0000-00000000000a'    -- their own record — via students_self_read
  ]::uuid[],
  'RLS-35: they see exactly their own record and the roster of the class they teach'
);
-- The sharp negative: they sit in Class D as a student, and that buys
-- them nothing. `students_self_read` is `user_id = auth.uid()`, not
-- "my classmates" — being enrolled somewhere never was a grant.
insert into _tap_log(line) select is(
  (select count(*) from public.students
   where class_id = 'c0000000-0000-0000-0000-00000000000d'
     and id <> 'd0000000-0000-0000-0000-00000000000a'),
  0::bigint,
  'RLS-35: …and none of their own classmates in Class D, though they sit in that class every week'
);

-- ---- writes they SHOULD have (ADR-020), on the class they teach.
insert into _tap_log(line) select lives_ok(
  $$ insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
     values ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000005', 1, 4, 'lancar') $$,
  'RLS-35: they CAN record Yanbu''a for a student in the class they teach — read-only was never enforced by the role'
);
insert into _tap_log(line) select lives_ok(
  $$ insert into public.murajaah_assignments (student_id, tutor_id, surah_num, ayah_from, ayah_to, frequency)
     values ('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000005', 112, 1, 4, 'daily') $$,
  'RLS-35: …and CAN set a murajaah target for that student'
);
-- Attendance is an UPDATE rather than an INSERT because the roster row
-- already exists, and because RLS filters an UPDATE rather than
-- refusing it: a policy failure here is silently zero rows, so the
-- assertion has to read the value back.
update public.attendance set status = 'late'
 where student_id = 'd0000000-0000-0000-0000-000000000005';
insert into _tap_log(line) select is(
  (select status from public.attendance
   where student_id = 'd0000000-0000-0000-0000-000000000005')::text,
  'late',
  'RLS-35: …and CAN correct the attendance of a student in their class'
);

-- ---- and the boundary that comes with it.
insert into _tap_log(line) select throws_ok(
  $$ insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
     values ('d0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000005', 1, 4, 'lancar') $$,
  '42501', null,
  'RLS-35: …but CANNOT record progress for their OWN record — teaching one class does not let a student grade themselves'
);
-- The same statement aimed at a class they do not teach. RLS filters an
-- UPDATE rather than refusing it, so this raises nothing and matches
-- nothing; it cannot even be read back from inside this session, which
-- is itself the first half of the assertion.
update public.attendance set status = 'late'
 where student_id = 'd0000000-0000-0000-0000-000000000008';    -- D Kid
insert into _tap_log(line) select is(
  (select count(*) from public.attendance
   where student_id = 'd0000000-0000-0000-0000-000000000008'),
  0::bigint,
  'RLS-35: …and cannot even see the attendance of a student in a class they do not teach, so the update above matched nothing'
);

-- ---- they widen nobody, and nobody widens them.
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-000000000001';   -- TP
insert into _tap_log(line) select is(
  (select count(*) from public.students where id = 'd0000000-0000-0000-0000-00000000000a'),
  0::bigint,
  'RLS-35: TP cannot see the student assistant''s own record — sharing Class C as co-tutors grants nothing about each other'
);
set local role anon;
set local request.jwt.claim.sub to '';
set local request.jwt.claim.role to 'anon';
insert into _tap_log(line) select is(
  (select count(*) from public.students), 0::bigint,
  'RLS-35: anon still sees 0 students after the student-assistant rows exist');
reset role;

-- …and confirmed from outside any policy: the row the student assistant
-- aimed at is untouched. Read as the table owner, because the point of
-- the previous assertion is that they cannot read it themselves.
insert into _tap_log(line) select is(
  (select status from public.attendance
   where student_id = 'd0000000-0000-0000-0000-000000000008')::text,
  'present',
  'RLS-35: …and the row really is unchanged, seen from outside RLS — a filtered UPDATE is silent, so this is the half that proves it did nothing'
);

-- ======================================================================
-- NC-12…NC-16 — the notification centre for a person who is more than
--               one thing (TAD ADR-022)
--
-- NC-01…NC-11 asked the access-control question of accounts that were
-- exactly one thing each. The recipient rule was a *role* test at the
-- time — `role in ('parent','student')` — and the consequence was that a
-- tutor whose own child attends the TPA received nothing about their own
-- child: no push, no email, no row here, and `push-subscribe` 403'd them
-- so they could not even store a subscription. Silent, and
-- indistinguishable from a quiet week.
--
-- The database needed no change for that, and this block is the evidence
-- rather than the assertion of it: `notifications_own_read` is
-- `user_id = auth.uid()`, which is a relationship and always was. What
-- changed is the application-layer rule that decides which `user_id` a
-- row is written for, so what these cases pin is the boundary that rule
-- now has to respect — stated from both sides, because "a tutor-parent
-- hears about their own child" and "a tutor hears nothing about their
-- class" are one decision and it is possible to satisfy either alone.
--
-- Placed last, after RLS-35, because it addresses notifications to the
-- dual-role people those blocks create.
-- ======================================================================
reset role;

insert into public.notifications (user_id, student_id, event, context, event_date)
values
  -- TP (users.role 'parent', tutor of Class C) about their OWN child,
  -- who is in Class D and taught by somebody else.
  ('b0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000006',
   'absence', '{}'::jsonb, current_date),
  -- TT (users.role 'tutor', same shape) about theirs.
  ('b0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000007',
   'absence', '{}'::jsonb, current_date),
  -- TAP (users.role 'admin', tutor of Class C) about theirs.
  ('b0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000009',
   'jilidMilestone', '{"number": 2}'::jsonb, current_date),
  -- The student assistant, about their own record.
  ('b0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-00000000000a',
   'reportReady', '{}'::jsonb, current_date),
  -- P4 — the ordinary parent of C Kid, who sits in the class TP, TT, TAP
  -- and the student assistant all teach. This row is the one none of
  -- them may read, and the reason it exists.
  ('b0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000005',
   'absence', '{}'::jsonb, current_date);

set local role authenticated;
set local request.jwt.claim.role to 'authenticated';

-- ============================================================
-- NC-12: the tutor-parent reads their own child's notification —
--        and only ever their own
-- ============================================================
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-000000000001';   -- TP

insert into _tap_log(line) select set_eq(
  'select student_id from public.notifications',
  array['d0000000-0000-0000-0000-000000000006']::uuid[],
  'NC-12: a tutor-parent reads the notification about their OWN child — the case the role-based rule silently dropped'
);
-- The half of ADR-015(a) that survives ADR-022, stated where it would
-- fail loudest: C Kid is in the class TP teaches, a notification about
-- C Kid exists, and TP cannot read it. A tutor learns about an absence
-- by recording it.
insert into _tap_log(line) select is(
  (select count(*) from public.notifications
   where student_id = 'd0000000-0000-0000-0000-000000000005'),
  0::bigint,
  'NC-12: …and none about a child in the class they TEACH, though a row for that child exists'
);
insert into _tap_log(line) select is(
  (select count(*) from public.notifications
   where user_id <> 'b0000000-0000-0000-0000-000000000001'),
  0::bigint,
  'NC-12: CROSS-FAMILY — no notification addressed to anyone else is visible, including the co-tutor''s'
);

-- ============================================================
-- NC-13: identical relationships, users.role = 'tutor' — the same
--        answer. Two rows differing only in the role column cannot
--        be what grants either of them anything.
-- ============================================================
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-000000000002';   -- TT

insert into _tap_log(line) select set_eq(
  'select student_id from public.notifications',
  array['d0000000-0000-0000-0000-000000000007']::uuid[],
  'NC-13: a tutor-parent whose users.role really is ''tutor'' reads their own child''s notification too'
);
insert into _tap_log(line) select is(
  (select count(*) from public.notifications
   where student_id = 'd0000000-0000-0000-0000-000000000006'),
  0::bigint,
  'NC-13: …and cannot read the other tutor-parent''s, though their children share Class D'
);

-- ============================================================
-- NC-14: the admin-parent — ADR-017(d) refined, not reversed
--
-- NC-09 said "an admin reads no notifications at all", which is true of
-- an admin who is nobody's parent, and that is every admin the fixture
-- had. The policy behind it is `user_id = auth.uid()`, so what it
-- actually says is "no notification addressed to somebody else" — and
-- that is the sentence that survives ADR-022. `fn_is_admin()` is an
-- unconditional ALL on every other table (RLS-34); `public.notifications`
-- is the one table with no admin policy at all, which is why adding a
-- parent relationship widens an admin here by exactly one child and not
-- by the school.
-- ============================================================
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-000000000004';   -- TAP

insert into _tap_log(line) select is(
  public.fn_is_admin(), true,
  'NC-14: the account under test really is an admin'
);
insert into _tap_log(line) select set_eq(
  'select student_id from public.notifications',
  array['d0000000-0000-0000-0000-000000000009']::uuid[],
  'NC-14: an admin who is also a parent reads the notification about their OWN child'
);
insert into _tap_log(line) select is(
  (select count(*) from public.notifications
   where user_id <> 'b0000000-0000-0000-0000-000000000004'),
  0::bigint,
  'NC-14: …and STILL reads nobody else''s — the one place ADR-014''s super admin does not reach (ADR-017(d))'
);
-- Said again against the specific rows an admin can read everything else
-- about. TAP reads C Kid's attendance, progress and draft report through
-- `fn_is_admin()`; C Kid's parent's notification is not among them.
insert into _tap_log(line) select is(
  (select count(*) from public.students where id = 'd0000000-0000-0000-0000-000000000005'),
  1::bigint,
  'NC-14: …while the same admin does read that child''s student row, so the refusal above is the notification policy and not a missing row'
);

-- ============================================================
-- NC-15: the student assistant reads their own, and none of the
--        class they teach
-- ============================================================
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-000000000005';   -- SA

insert into _tap_log(line) select set_eq(
  'select student_id from public.notifications',
  array['d0000000-0000-0000-0000-00000000000a']::uuid[],
  'NC-15: a student assistant reads the notification about their own record'
);
insert into _tap_log(line) select is(
  (select count(*) from public.notifications
   where student_id = 'd0000000-0000-0000-0000-000000000005'),
  0::bigint,
  'NC-15: …and none about the class they teach, exactly as any other tutor (ADR-020 grants a write, never an inbox)'
);

-- ============================================================
-- NC-16: nobody's inbox widened, and the ordinary parent still has
--        exactly one
-- ============================================================
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-000000000003';   -- P4
insert into _tap_log(line) select set_eq(
  'select student_id from public.notifications',
  array['d0000000-0000-0000-0000-000000000005']::uuid[],
  'NC-16: the ordinary parent still reads exactly their own child''s — four co-tutors of that class changed nothing'
);

set local request.jwt.claim.sub to '90000000-0000-0000-0000-000000000001';   -- P1
insert into _tap_log(line) select is(
  (select count(*) from public.notifications
   where user_id <> '90000000-0000-0000-0000-000000000001'),
  0::bigint,
  'NC-16: P1 from the original fixture is unaffected by every row above'
);

set local role anon;
set local request.jwt.claim.sub to '';
set local request.jwt.claim.role to 'anon';
insert into _tap_log(line) select is(
  (select count(*) from public.notifications), 0::bigint,
  'NC-16: anon still reads 0 notifications after all of the above'
);
reset role;

-- ======================================================================
-- RLS-36…RLS-41, NC-17…NC-18 — the combinations the matrix left open
--
-- Everything from RLS-28 to NC-16 varies *which* relationships a person
-- holds. None of it varies the one thing that decides whether two
-- relationships even meet: **which class**. Every dual-role fixture
-- above deliberately pushes the two halves apart — "each one's own child
-- sits in the class the other teaches", "the two halves are deliberately
-- disjoint classes, so no assertion about one can pass through the
-- other". That is the right way to prove a *union* exists, and it is why
-- those cases are trustworthy.
--
-- It also means the most ordinary configuration at a small TPA has never
-- been tested at all: the ustadzah who teaches the class her own son sits
-- in. When the two halves overlap, the union stops being a union — the
-- tutor grant already contains the child — and three assertions above
-- inevitably invert. RLS-36 and RLS-37 are those inversions, and PPME
-- has since answered both — in opposite directions, which is the reason
-- they are worth reading together.
--
-- **RLS-36 is a decision: a tutor may record for their own child, and
-- write that child's year-end report** (ADR-024). At a small TPA an
-- ustadz or ustadzah teaches their own children, and a rule against it
-- would be a rule against how the school runs.
--
-- **RLS-37 was a defect**: a santri assigned to their own class could
-- grade themselves, contradicting a boundary ADR-020 had already stated
-- in prose. Migration 013 (ADR-023) closes it. The two look structurally
-- identical and are different in kind — one is a person assessing their
-- own work, the other a teacher assessing a pupil who happens to be
-- theirs — which is why `fn_my_recordable_students()` excludes the
-- caller's own record and never their children.
--
-- The rest of the block fills the empty cells of the capability lattice.
-- `deriveCapabilities` is four independent booleans — admin, tutor,
-- parent, self-student — so there are sixteen combinations. Above, six
-- are covered (parent, tutor, self-student, admin, tutor+parent ×2 role
-- values, tutor+self-student, admin+tutor+parent). RLS-38…RLS-41 add the
-- four that can really occur and were missing: admin+parent with no
-- class, admin+tutor with no child, a tutor of more than one class, and
-- the account that holds nothing at all — the state every person passes
-- through between `invite-user` and enrolment, and the one a capability
-- bug is most likely to hand somebody else's data to.
--
-- Placed last for the same reason RLS-34 is placed after RLS-33: it adds
-- classes, students and notifications that earlier exact-set assertions
-- would otherwise have to account for.
-- ======================================================================
reset role;

-- OV  — role 'parent', tutor of Class E, **own child in Class E**, and a
--       second child in Class D, which they do not teach. One account,
--       two children, two different answers.
-- OSA — role 'student', own 16+ record in Class E, and a tutor of Class E:
--       the student assistant assigned to their own class.
-- AP  — role 'admin', parent of a child in Class E, named in no
--       `tutor_ids` anywhere. NC-14's admin-parent is also a tutor, so
--       the plain shape has never been asserted on its own.
-- AT  — role 'admin', tutor of Class E, nobody's parent.
-- MC  — role 'tutor' of **two** classes (E and F). Every tutor persona
--       above holds exactly one.
-- NONE— role 'tutor', in no `tutor_ids`, with no child and no record.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous, created_at, updated_at)
values
  ('b0000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'ov@test.local',   '', now(), '{}', '{}', false, false, now(), now()),
  ('b0000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'osa@test.local',  '', now(), '{}', '{}', false, false, now(), now()),
  ('b0000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'ap@test.local',   '', now(), '{}', '{}', false, false, now(), now()),
  ('b0000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'at@test.local',   '', now(), '{}', '{}', false, false, now(), now()),
  ('b0000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', 'mc@test.local',   '', now(), '{}', '{}', false, false, now(), now()),
  ('b0000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 'none@test.local', '', now(), '{}', '{}', false, false, now(), now());

insert into public.users (id, email, full_name, role, locale)
values
  ('b0000000-0000-0000-0000-000000000006', 'ov@test.local',   'Overlap Tutor-Parent (role=parent)',  'parent',  'id'),
  ('b0000000-0000-0000-0000-000000000007', 'osa@test.local',  'Overlap Student Assistant',           'student', 'id'),
  ('b0000000-0000-0000-0000-000000000008', 'ap@test.local',   'Admin-Parent, teaches nothing',       'admin',   'id'),
  ('b0000000-0000-0000-0000-000000000009', 'at@test.local',   'Admin-Tutor, nobody''s parent',       'admin',   'id'),
  ('b0000000-0000-0000-0000-00000000000a', 'mc@test.local',   'Tutor of two classes',                'tutor',   'id'),
  ('b0000000-0000-0000-0000-00000000000b', 'none@test.local', 'Invited, not yet anything',           'tutor',   'id');

insert into public.classes (id, name, schedule, tutor_ids)
values
  ('c0000000-0000-0000-0000-00000000000e', 'Class E (overlap test)', 'Sabtu 15:00',
   array['b0000000-0000-0000-0000-000000000006',   -- OV
         'b0000000-0000-0000-0000-000000000007',   -- OSA
         'b0000000-0000-0000-0000-000000000009',   -- AT
         'b0000000-0000-0000-0000-00000000000a']::uuid[]),  -- MC
  ('c0000000-0000-0000-0000-00000000000f', 'Class F (second class)', 'Minggu 15:00',
   array['b0000000-0000-0000-0000-00000000000a']::uuid[]);  -- MC only

insert into public.students (id, parent_id, user_id, full_name, class_id, date_of_birth)
values
  -- The overlap itself: OV teaches this class and this is their child.
  ('d0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-000000000006', null,
   'OV Kid E', 'c0000000-0000-0000-0000-00000000000e', '2015-01-01'),
  -- The same parent's other child, in a class they do not teach. The
  -- control: whatever the overlap grants, it must not reach here.
  ('d0000000-0000-0000-0000-00000000000c', 'b0000000-0000-0000-0000-000000000006', null,
   'OV Kid D', 'c0000000-0000-0000-0000-00000000000d', '2017-01-01'),
  -- The student assistant's own record, in the class they assist.
  ('d0000000-0000-0000-0000-00000000000d', 'b0000000-0000-0000-0000-000000000003',
   'b0000000-0000-0000-0000-000000000007',
   'OSA Own Record', 'c0000000-0000-0000-0000-00000000000e', '2008-01-01'),
  -- The plain admin-parent's child.
  ('d0000000-0000-0000-0000-00000000000e', 'b0000000-0000-0000-0000-000000000008', null,
   'AP Kid', 'c0000000-0000-0000-0000-00000000000e', '2016-01-01'),
  -- An unrelated family in Class E: the child every persona here can
  -- *teach* and none of them may be told about.
  ('d0000000-0000-0000-0000-00000000000f', 'b0000000-0000-0000-0000-000000000003', null,
   'Plain Kid E', 'c0000000-0000-0000-0000-00000000000e', '2015-02-02'),
  -- Class F exists to give MC a second roster, and everyone else a class
  -- they must not reach.
  ('d0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000003', null,
   'F Kid', 'c0000000-0000-0000-0000-00000000000f', '2015-03-03');

insert into public.sessions (id, class_id, date, tutor_id)
values ('e0000000-0000-0000-0000-00000000000e', 'c0000000-0000-0000-0000-00000000000e', current_date,
        'b0000000-0000-0000-0000-000000000006');

insert into public.attendance (session_id, student_id, status)
values
  ('e0000000-0000-0000-0000-00000000000e', 'd0000000-0000-0000-0000-00000000000b', 'present'),
  ('e0000000-0000-0000-0000-00000000000e', 'd0000000-0000-0000-0000-00000000000d', 'present'),
  ('e0000000-0000-0000-0000-00000000000e', 'd0000000-0000-0000-0000-00000000000f', 'present');

-- A murajaah target on the *non-taught* child, so the parent half of OV
-- has something of its own to act on.
insert into public.murajaah_assignments (id, student_id, tutor_id, surah_num, ayah_from, ayah_to, frequency)
values ('f0000000-0000-0000-0000-00000000000c', 'd0000000-0000-0000-0000-00000000000c',
        '70000000-0000-0000-0000-000000000002', 1, 1, 3, 'daily');

-- One draft on each side of the overlap, plus a published report on the
-- non-taught child. RLS-32 is the case these are the mirror of.
insert into public.year_end_reports (student_id, academic_year, tutor_id, status)
values
  ('d0000000-0000-0000-0000-00000000000b', '2025/2026', 'b0000000-0000-0000-0000-000000000006', 'draft'),
  ('d0000000-0000-0000-0000-00000000000c', '2025/2026', '70000000-0000-0000-0000-000000000002', 'draft'),
  ('d0000000-0000-0000-0000-00000000000c', '2024/2025', '70000000-0000-0000-0000-000000000002', 'published');

set local role authenticated;
set local request.jwt.claim.role to 'authenticated';

-- ============================================================
-- RLS-36: the overlap — a tutor of the class their own child is in.
--         The union collapses on one child and not on the other, so
--         the same account gets two different answers about two of
--         its own children.
-- ============================================================
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-000000000006';   -- OV

insert into _tap_log(line) select is(
  (select public.fn_current_role())::text, 'parent',
  'RLS-36: the overlap persona''s users.role is ''parent'' — as in RLS-28, nothing below comes from the column'
);
insert into _tap_log(line) select is(
  public.fn_is_admin(), false,
  'RLS-36: …and they are not an admin, so nothing below comes from the one policy that reads role either'
);
insert into _tap_log(line) select set_eq(
  'select public.fn_my_classes()',
  array['c0000000-0000-0000-0000-00000000000e']::uuid[],
  'RLS-36: …they teach exactly Class E'
);
insert into _tap_log(line) select set_eq(
  'select public.fn_my_children()',
  array['d0000000-0000-0000-0000-00000000000b',
        'd0000000-0000-0000-0000-00000000000c']::uuid[],
  'RLS-36: …and parent exactly two children, one of them in that same class'
);

-- The union is a *set*. Their own child is reachable by both grants and
-- must still appear once — an implementation that concatenated the two
-- would double every overlapping row on every screen.
insert into _tap_log(line) select set_eq(
  'select id from public.students',
  array[
    'd0000000-0000-0000-0000-00000000000b',   -- own child, and taught
    'd0000000-0000-0000-0000-00000000000c',   -- own child, not taught
    'd0000000-0000-0000-0000-00000000000d',   -- taught (OSA''s own record)
    'd0000000-0000-0000-0000-00000000000e',   -- taught (AP''s child)
    'd0000000-0000-0000-0000-00000000000f'    -- taught (an unrelated family)
  ]::uuid[],
  'RLS-36: they see the Class E roster and both their own children, each exactly once — two grants reaching the same row is not two rows'
);
insert into _tap_log(line) select is(
  (select count(*) from public.students where id = 'd0000000-0000-0000-0000-00000000000b'),
  1::bigint,
  'RLS-36: …the overlapping child in particular is returned once, not once per policy'
);
insert into _tap_log(line) select is(
  (select count(*) from public.students where class_id = 'c0000000-0000-0000-0000-00000000000f'),
  0::bigint,
  'RLS-36: …and Class F, which they neither teach nor have a child in, is invisible'
);

-- ---- writes: RLS-31's refusal inverts, on one child only.
--
-- RLS-31 asserts a tutor-parent CANNOT record Yanbu'a for their own
-- child. That holds because their child is in a class they do not teach.
-- Here the child is in the class they DO teach, so
-- `yanbua_tutor_insert`'s `student_id in (select fn_my_class_students())`
-- is satisfied and the write lands. The tutor grant is per class, and it
-- does not ask who the child belongs to.
--
-- Whether an ustadzah should be the one recording her own son's
-- progress is a question about conflict of interest, not about RLS.
-- **PPME has answered it: she may** (ADR-024). At a school of ~200 with
-- a handful of volunteer teachers, an ustadz or ustadzah teaches their
-- own children, and a rule against it would be a rule against the way
-- the TPA runs. So this assertion pins a decision rather than
-- characterising an accident — and the refusal two assertions below,
-- for the same parent's other child in a class they do not teach, is
-- what keeps it a decision about *teaching* rather than about
-- parenthood.
insert into _tap_log(line) select lives_ok(
  $$ insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
     values ('d0000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-000000000006', 1, 5, 'lancar') $$,
  'RLS-36: they CAN record Yanbu''a for their own child when that child is in the class they teach — RLS-31''s refusal was a property of the disjoint fixture, not of the rule'
);
-- …and the control, one child over. Same account, same parenthood,
-- different class: the tutor grant does not follow the parent.
insert into _tap_log(line) select throws_ok(
  $$ insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
     values ('d0000000-0000-0000-0000-00000000000c', 'b0000000-0000-0000-0000-000000000006', 1, 5, 'lancar') $$,
  '42501', null,
  'RLS-36: …and CANNOT for their other child, in a class they do not teach. The boundary is per class, not per person'
);
-- The parent half is intact on the child the tutor half never reached.
insert into _tap_log(line) select lives_ok(
  $$ insert into public.murajaah_log (assignment_id, confirmed_by, quality, date)
     values ('f0000000-0000-0000-0000-00000000000c', 'b0000000-0000-0000-0000-000000000006', 'hafal_lancar', current_date) $$,
  'RLS-36: …while the parent half still confirms home practice for that same non-taught child — neither half is swallowed by the other'
);

-- ---- reports: RLS-32's sharpest assertion inverts too, and only for
-- the overlapping child. A draft is meant to be invisible to parents;
-- for this child the account is also the class's tutor, and
-- `yer_tutor_rw` has no published-only clause.
--
-- ADR-024(b) includes this deliberately. Narrowing `yer_tutor_rw` to
-- exclude the caller's own children — the shape ADR-023 used for their
-- own *record* — was offered to PPME and declined: for this child that
-- account is the teacher, and writing the report is part of teaching
-- them. RLS-16 is unchanged and still correct for every parent who does
-- not teach the class, which is every parent the app has today.
insert into _tap_log(line) select is(
  (select count(*) from public.year_end_reports
   where student_id = 'd0000000-0000-0000-0000-00000000000b' and status = 'draft'),
  1::bigint,
  'RLS-36: they DO see their own child''s draft report when they teach that child''s class — the mirror of RLS-32, and the sharpest form of the overlap'
);
insert into _tap_log(line) select is(
  (select count(*) from public.year_end_reports
   where student_id = 'd0000000-0000-0000-0000-00000000000c' and status = 'draft'),
  0::bigint,
  'RLS-36: …and still do NOT see the other child''s draft, exactly as RLS-32 says. One account, one academic year, two different answers'
);
insert into _tap_log(line) select is(
  (select count(*) from public.year_end_reports
   where student_id = 'd0000000-0000-0000-0000-00000000000c' and status = 'published'),
  1::bigint,
  'RLS-36: …and do see that child''s published report, so the refusal above is the draft rule and not a missing row'
);

-- ============================================================
-- RLS-37: the student assistant assigned to their own class —
--         a santri who can record their own progress
-- ============================================================
-- RLS-35 asserts a student assistant CANNOT record progress for their
-- own record, and reads as though that were a property of the rule. It
-- was not: it held because the fixture puts their record in a class they
-- do not teach. Assign them to their own class — the *likely*
-- arrangement, since a 16+ santri assists the group they already attend
-- — and `fn_my_class_students()` contained their own id, so the tutor
-- grant let them grade their own Yanbu'a, set their own memorization
-- target, mark their own homework verified and author their own year-end
-- report.
--
-- Migration 013 (ADR-023) closes that, and the cases below are what it
-- is asserted by. The rule is **evaluation**, not every write:
-- `attendance` is deliberately still reachable, because the register is
-- submitted as one upsert of the whole roster and a policy refusing one
-- row would stop the assistant marking anybody. That half is asserted
-- too, as current behaviour with a reason, so the remaining gap is
-- visible rather than assumed closed (ADR-023(c)).
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-000000000007';   -- OSA

insert into _tap_log(line) select is(
  (select public.fn_current_role())::text, 'student',
  'RLS-37: the overlap student assistant''s role really is ''student'''
);
insert into _tap_log(line) select is(
  public.fn_my_student_id(), 'd0000000-0000-0000-0000-00000000000d'::uuid,
  'RLS-37: …their own 16+ record'
);
insert into _tap_log(line) select set_eq(
  'select public.fn_my_classes()',
  array['c0000000-0000-0000-0000-00000000000e']::uuid[],
  'RLS-37: …and they teach the very class that record sits in'
);

-- RLS-35's negative — "none of their own classmates" — inverts, because
-- there the class they sat in was not the class they taught.
insert into _tap_log(line) select is(
  (select count(*) from public.students
   where class_id = 'c0000000-0000-0000-0000-00000000000e'),
  4::bigint,
  'RLS-37: they now see all of their own classmates — not because they are enrolled, but because they teach the class those classmates are in'
);

-- ---- the evaluations they may not make about themselves (ADR-023).
-- Each of these was permitted before migration 013, through the tutor
-- grant and nothing else.
insert into _tap_log(line) select throws_ok(
  $$ insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
     values ('d0000000-0000-0000-0000-00000000000d', 'b0000000-0000-0000-0000-000000000007', 2, 1, 'lancar') $$,
  '42501', null,
  'RLS-37: a student assistant assigned to their own class CANNOT record their own Yanbu''a progress — the boundary ADR-020 stated in prose, now enforced'
);
insert into _tap_log(line) select throws_ok(
  $$ insert into public.quran_progress (student_id, tutor_id, surah_num, ayah_from, ayah_to, quality)
     values ('d0000000-0000-0000-0000-00000000000d', 'b0000000-0000-0000-0000-000000000007', 3, 1, 5, 'mumtaz') $$,
  '42501', null,
  'RLS-37: …nor their own Quran recitation'
);
insert into _tap_log(line) select throws_ok(
  $$ insert into public.murajaah_assignments (student_id, tutor_id, surah_num, ayah_from, ayah_to, frequency)
     values ('d0000000-0000-0000-0000-00000000000d', 'b0000000-0000-0000-0000-000000000007', 114, 1, 6, 'daily') $$,
  '42501', null,
  'RLS-37: …nor set their own memorization target'
);
insert into _tap_log(line) select throws_ok(
  $$ insert into public.year_end_reports (student_id, academic_year, tutor_id, status)
     values ('d0000000-0000-0000-0000-00000000000d', '2025/2026', 'b0000000-0000-0000-0000-000000000007', 'draft') $$,
  '42501', null,
  'RLS-37: …nor author their own year-end report'
);
-- …and the read that went with it. `yer_student_read` is published-only,
-- for the same reason RLS-16 keeps a draft from a parent.
insert into _tap_log(line) select is(
  (select count(*) from public.year_end_reports
   where student_id = 'd0000000-0000-0000-0000-00000000000d' and status = 'draft'),
  0::bigint,
  'RLS-37: …and cannot read a draft report about themselves either — `yer_tutor_rw` was what made that visible'
);
-- The grant is intact in the direction it is meant to work.
insert into _tap_log(line) select lives_ok(
  $$ insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
     values ('d0000000-0000-0000-0000-00000000000f', 'b0000000-0000-0000-0000-000000000007', 2, 1, 'lancar') $$,
  'RLS-37: …while still recording for a classmate in the class they teach, which is the whole point of ADR-020'
);

-- ---- the half deliberately left open, asserted rather than assumed.
-- The register is one upsert of the whole roster, so refusing this row
-- would stop the assistant marking anybody in the class (ADR-023(c)).
update public.attendance set status = 'present'
 where student_id = 'd0000000-0000-0000-0000-00000000000d';
insert into _tap_log(line) select is(
  (select count(*) from public.attendance
   where student_id = 'd0000000-0000-0000-0000-00000000000d'),
  1::bigint,
  'RLS-37: …but CAN still reach their own attendance row — deliberately, and the one part of this the migration does not close'
);
-- The one thing the overlap does not buy them: another class.
insert into _tap_log(line) select is(
  (select count(*) from public.students where class_id = 'c0000000-0000-0000-0000-00000000000f'),
  0::bigint,
  'RLS-37: …and Class F is still invisible — the overlap widens one class, not the school'
);

-- ---- and the regression migration 013 could most easily have caused.
-- `fn_my_student_id()` is null for every tutor who is not also a santri,
-- and `id <> null` is null, which a WITH CHECK reads as a refusal — the
-- obvious spelling of this rule would have refused every tutor write in
-- the school. RLS-01…RLS-35 passing above is the broad evidence; this is
-- the assertion that names the trap.
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-00000000000a';   -- MC, a tutor and nothing else
insert into _tap_log(line) select is(
  public.fn_my_student_id(), null::uuid,
  'RLS-37: an ordinary tutor has no student record of their own'
);
insert into _tap_log(line) select set_eq(
  'select public.fn_my_recordable_students()',
  array[
    'd0000000-0000-0000-0000-00000000000b',
    'd0000000-0000-0000-0000-00000000000d',
    'd0000000-0000-0000-0000-00000000000e',
    'd0000000-0000-0000-0000-00000000000f',
    'd0000000-0000-0000-0000-000000000010'
  ]::uuid[],
  'RLS-37: …and their recordable set is their whole roster, not the empty set a null comparison would have produced'
);
insert into _tap_log(line) select lives_ok(
  $$ insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
     values ('d0000000-0000-0000-0000-00000000000d', 'b0000000-0000-0000-0000-00000000000a', 3, 1, 'lancar') $$,
  'RLS-37: …including the assistant''s own record, which somebody else has to be able to assess'
);

-- ============================================================
-- RLS-38: the plain admin-parent — admin, a parent, and a tutor of
--         nothing at all
-- ============================================================
-- NC-14's admin-parent (TAP) is also a tutor of Class C, so every
-- admin-parent assertion in this suite has so far been made against an
-- account that also holds a tutor relationship. This persona separates
-- the two: any grant they have is `fn_is_admin()` or parenthood, and
-- nothing else can be supplying it.
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-000000000008';   -- AP

insert into _tap_log(line) select is(
  public.fn_is_admin(), true,
  'RLS-38: the plain admin-parent is an admin'
);
insert into _tap_log(line) select set_eq(
  'select public.fn_my_children()',
  array['d0000000-0000-0000-0000-00000000000e']::uuid[],
  'RLS-38: …and the parent of exactly their own child'
);
insert into _tap_log(line) select is(
  (select count(*) from public.fn_my_classes()), 0::bigint,
  'RLS-38: …and a tutor of NOTHING — `fn_my_classes()` is empty, which is the state `useMyClasses` hands every class to on the admin branch (ADR-014). The relationship and the grant disagree, and only the grant is RLS'
);
insert into _tap_log(line) select ok(
  (select count(*) from public.students) >= 10,
  'RLS-38: they read every student in the school through the admin grant alone, holding no tutor relationship anywhere'
);
insert into _tap_log(line) select lives_ok(
  $$ insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
     values ('d0000000-0000-0000-0000-00000000000f', 'b0000000-0000-0000-0000-000000000008', 1, 1, 'lancar') $$,
  'RLS-38: …and can record for a class they are not named in, which is ADR-014(a) and not a tutor relationship'
);

-- ============================================================
-- RLS-39: the admin who teaches, and is nobody's parent —
--         the mirror of RLS-24
-- ============================================================
-- RLS-24 asserts that `tutor_id` on an admin-recorded row is the admin's
-- own id and that this id is in no class's `tutor_ids`, so nothing may
-- read the column as "a tutor of this class". This persona is the case
-- that keeps the second half from being generalised the wrong way: for
-- an admin who *is* named in `tutor_ids`, the same id is in the array.
-- "Recorded by an admin" and "recorded by a tutor of the class" are not
-- distinguishable from that column in either direction.
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-000000000009';   -- AT

insert into _tap_log(line) select is(
  public.fn_is_admin(), true,
  'RLS-39: the admin-tutor is an admin'
);
insert into _tap_log(line) select set_eq(
  'select public.fn_my_classes()',
  array['c0000000-0000-0000-0000-00000000000e']::uuid[],
  'RLS-39: …and holds a real tutor relationship as well — being admin does not put them in every `tutor_ids`, only in every grant'
);
insert into _tap_log(line) select is(
  (select count(*) from public.fn_my_children()), 0::bigint,
  'RLS-39: …and is nobody''s parent, so the parent capability is independently false'
);
insert into _tap_log(line) select lives_ok(
  $$ insert into public.quran_progress (student_id, tutor_id, surah_num, ayah_from, ayah_to, quality)
     values ('d0000000-0000-0000-0000-00000000000f', 'b0000000-0000-0000-0000-000000000009', 2, 1, 5, 'mumtaz') $$,
  'RLS-39: they record against their own class'
);
insert into _tap_log(line) select ok(
  (select 'b0000000-0000-0000-0000-000000000009'::uuid = any (tutor_ids)
     from public.classes where id = 'c0000000-0000-0000-0000-00000000000e'),
  'RLS-39: …and unlike RLS-24''s admin, that same id IS in the class''s tutor_ids — so `tutor_id` cannot be read as "an admin recorded this" either'
);

-- ============================================================
-- RLS-40: a tutor of more than one class
-- ============================================================
-- Every tutor persona in this suite holds exactly one class, so
-- `fn_my_classes()` has never returned more than one row under RLS, and
-- the `in (select …)` in every tutor policy has never been exercised
-- against a set. The dev fixture has such a tutor; the automated suite
-- did not.
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-00000000000a';   -- MC

insert into _tap_log(line) select set_eq(
  'select public.fn_my_classes()',
  array['c0000000-0000-0000-0000-00000000000e',
        'c0000000-0000-0000-0000-00000000000f']::uuid[],
  'RLS-40: a tutor named in two classes gets both'
);
insert into _tap_log(line) select set_eq(
  'select id from public.students',
  array[
    'd0000000-0000-0000-0000-00000000000b',   -- Class E
    'd0000000-0000-0000-0000-00000000000d',   -- Class E
    'd0000000-0000-0000-0000-00000000000e',   -- Class E
    'd0000000-0000-0000-0000-00000000000f',   -- Class E
    'd0000000-0000-0000-0000-000000000010'    -- Class F
  ]::uuid[],
  'RLS-40: …and both rosters unioned, and only those. `fn_my_classes()` returning a set is the case every tutor policy''s `in (select …)` had never been given'
);
-- The negative that makes the union meaningful: OV Kid D sits in Class D,
-- one class over from a roster they do see, and is a sibling of a child
-- they do teach. Neither buys them the row.
insert into _tap_log(line) select is(
  (select count(*) from public.students where id = 'd0000000-0000-0000-0000-00000000000c'),
  0::bigint,
  'RLS-40: …and not the Class D sibling of a child on one of those rosters — two classes is two grants, not a wider one'
);

-- ============================================================
-- RLS-41: the account that holds nothing at all
-- ============================================================
-- The state between `invite-user` and the first enrolment, and the one
-- every capability bug lands on first: four booleans that are all false,
-- with a `users` row and a valid JWT behind them. `NO_CAPABILITIES` is
-- the application-layer mirror, and `tests/unit/capabilities.test.ts`
-- asserts the derivation; this is the half that says the database agrees.
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-00000000000b';   -- NONE

insert into _tap_log(line) select is(
  public.fn_is_admin(), false,
  'RLS-41: an invited account with no relationships is not an admin'
);
insert into _tap_log(line) select is(
  (select count(*) from public.fn_my_classes()), 0::bigint,
  'RLS-41: …teaches nothing'
);
insert into _tap_log(line) select is(
  (select count(*) from public.fn_my_children()), 0::bigint,
  'RLS-41: …parents nobody'
);
insert into _tap_log(line) select ok(
  public.fn_my_student_id() is null,
  'RLS-41: …and is nobody''s student record'
);
insert into _tap_log(line) select is(
  (select count(*) from public.students), 0::bigint,
  'RLS-41: they read 0 students — a signed-in account is not, by itself, a grant'
);
insert into _tap_log(line) select is(
  (select count(*) from public.classes), 0::bigint,
  'RLS-41: …0 classes, though `classes_read` has four OR-ed branches and they satisfy none'
);
insert into _tap_log(line) select is(
  (select count(*) from public.attendance), 0::bigint,
  'RLS-41: …and 0 attendance rows'
);
insert into _tap_log(line) select throws_ok(
  $$ insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
     values ('d0000000-0000-0000-0000-00000000000f', 'b0000000-0000-0000-0000-00000000000b', 1, 1, 'lancar') $$,
  '42501', null,
  'RLS-41: …and can write nothing, though users.role says ''tutor'''
);

-- ============================================================
-- NC-17: the notification centre for the overlap persona
-- ============================================================
-- NC-12 states the two halves of ADR-022 against a tutor-parent whose
-- child is elsewhere: "reads their own child's" and "reads none about
-- the class they teach". When the child IS in the class they teach,
-- those two sentences point at the same child, and only the first may
-- win. The rows below are the test: two addressed to OV, one addressed
-- to another family about a child OV teaches.
reset role;
insert into public.notifications (user_id, student_id, event, context, event_date)
values
  ('b0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-00000000000b',
   'absence', '{}'::jsonb, current_date),
  ('b0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-00000000000c',
   'absence', '{}'::jsonb, current_date),
  ('b0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-00000000000f',
   'absence', '{}'::jsonb, current_date);

set local role authenticated;
set local request.jwt.claim.role to 'authenticated';
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-000000000006';   -- OV

insert into _tap_log(line) select set_eq(
  'select student_id from public.notifications',
  array['d0000000-0000-0000-0000-00000000000b',
        'd0000000-0000-0000-0000-00000000000c']::uuid[],
  'NC-17: the overlap parent reads about both their own children and nothing else — teaching the class one of them is in adds nobody'
);
insert into _tap_log(line) select is(
  (select count(*) from public.notifications
   where student_id = 'd0000000-0000-0000-0000-00000000000b'),
  1::bigint,
  'NC-17: …and about the overlapping child exactly once, though both halves of ADR-022 have something to say about that child'
);
insert into _tap_log(line) select is(
  (select count(*) from public.notifications
   where student_id = 'd0000000-0000-0000-0000-00000000000f'),
  0::bigint,
  'NC-17: …and nothing addressed to the family of a child they teach'
);
insert into _tap_log(line) select is(
  (select count(*) from public.students
   where id = 'd0000000-0000-0000-0000-00000000000f'),
  1::bigint,
  'NC-17: …while reading that same child''s student row without difficulty, so the refusal above is the notification policy and not a missing row'
);

-- ============================================================
-- NC-18: an account with no relationships has no inbox
-- ============================================================
-- The other end of the same rule: `canReceiveNotifications` answers
-- false for this account, `push-subscribe` refuses to store an endpoint
-- for it, and — asserted here — `notifications_own_read` returns nothing
-- even though rows exist and the account is signed in.
set local request.jwt.claim.sub to 'b0000000-0000-0000-0000-00000000000b';   -- NONE
insert into _tap_log(line) select is(
  (select count(*) from public.notifications), 0::bigint,
  'NC-18: an invited account with no relationships reads no notifications at all'
);

set local role anon;
set local request.jwt.claim.sub to '';
set local request.jwt.claim.role to 'anon';
insert into _tap_log(line) select is(
  (select count(*) from public.notifications), 0::bigint,
  'NC-18: …and anon still reads 0 after every row this block added'
);
insert into _tap_log(line) select is(
  (select count(*) from public.students), 0::bigint,
  'NC-18: …and 0 students'
);
reset role;

-- ---------- RLS-42 — schema privileges, not row privileges ----------
--
-- Everything above this line asks what a role may *see*. This asks what
-- it may *make*. The two are separate gates in Postgres and only the
-- first has 42 policies watching it: a schema grant nobody intended
-- simply sits there, which is how `GRANT ALL ON SCHEMA public TO anon`
-- survived in production from the day the project was provisioned until
-- `supabase db diff --linked` was run against it (ADR-027, migration
-- 014).
--
-- Both halves are asserted because they fail identically — with no rows
-- and no error — in a migration that only revokes. "We revoked too
-- much" would take PostgREST down for every signed-in parent; "we
-- revoked nothing" would leave the grant exactly where it was found.
insert into _tap_log(line) select ok(
  not has_schema_privilege('anon', 'public', 'CREATE'),
  'RLS-42: anon cannot create objects in the public schema — it is the role behind the key that ships in the app bundle'
);
insert into _tap_log(line) select ok(
  not has_schema_privilege('authenticated', 'public', 'CREATE'),
  'RLS-42: …nor can any signed-in account'
);
insert into _tap_log(line) select ok(
  has_schema_privilege('anon', 'public', 'USAGE'),
  'RLS-42: …and USAGE survives, which migration 007 grants and PostgREST needs to resolve any table at all'
);
insert into _tap_log(line) select ok(
  has_schema_privilege('authenticated', 'public', 'USAGE'),
  'RLS-42: …for both of them'
);
-- `service_role` is deliberately *not* asserted either way, and that is
-- itself worth stating. Migration 014 does not touch it — its key never
-- leaves the server, it already bypasses RLS, and CREATE adds nothing
-- to an account that can read and write every row (ADR-027) — so
-- whether it holds CREATE depends on which Supabase image provisioned
-- the database rather than on anything in this repo. Frankfurt was
-- provisioned by an older one and grants it; a fresh `supabase start`
-- does not. An assertion here would pass in one and fail in the other
-- while saying nothing about the migration under test.

-- ---------- done ----------
reset role;
insert into _tap_log(line) select * from finish();

select line from _tap_log order by id;

rollback;
