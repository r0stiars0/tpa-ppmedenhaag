-- ============================================================
-- TPA PPME Den Haag — Local dev fixture (NOT a migration)
--
-- Seeds a small realistic dataset into a local `supabase start` stack so
-- the dev-only fixture sign-in panel (src/dev/DevAuthSwitcher.tsx, shown
-- on the sign-in screen in `npm run dev`) has real accounts to sign in
-- as, without real Google OAuth. Intentionally kept out of
-- supabase/migrations/ (never applied to the linked Frankfurt project)
-- and out of supabase/seed.sql (not auto-applied by `db reset`) — this
-- is opt-in, run manually against the local stack only:
--
--   supabase start
--   supabase migration up --local   # applies 001-008 if not already
--   docker exec -i supabase_db_tpa-ppme-denhaag \
--     psql -U postgres -v ON_ERROR_STOP=1 < supabase/dev-fixture.sql
--
-- Seeds: 2 tutors + 1 admin + 2 parents (one with 3 children, one with 1
-- child who's also a 16+ self-login) + 4 multi-role accounts (a tutor who
-- is also a parent, a parent who is also a tutor, an admin who is both
-- — TAD ADR-019 — and a 16+ student who assists in a class, ADR-020) +
-- 2 classes + 8 students + 1 pending (unregistered) sign-in for the
-- Registrations page to show.
-- No attendance/yanbua_progress rows — left empty so the record/create
-- flows can be exercised from scratch.
-- ============================================================

-- instance_id and the *_token/*_change columns are set explicitly (not
-- left NULL) — PostgREST/RLS never look at them (it only validates the
-- JWT signature and trusts the claims), but GoTrue's own /user endpoint
-- does a real row lookup + scan into a non-nullable-string Go struct, and
-- both `supabase.auth.setSession()` (used by DevAuthSwitcher) and the
-- Admin API go through that path. A NULL instance_id makes GoTrue's
-- lookup silently match nothing ("User from sub claim in JWT does not
-- exist"); a NULL *_token/*_change column makes it find the row but then
-- fail with "sql: Scan error ... converting NULL to string is
-- unsupported". A real Google-OAuth-created row never has this problem
-- because GoTrue itself sets these — only a hand-written SQL fixture
-- can hit it. Learned the hard way: earlier fixture inserts (omitting
-- these columns) passed every RLS/PostgREST-level test in this repo
-- without issue, since none of those go through GoTrue — only the
-- browser sign-in flow surfaced it.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
)
values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ustadz.ahmad@dev.local', '', now(), '{}', '{}', false, false, now(), now(), '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ibu.siti@dev.local', '', now(), '{}', '{}', false, false, now(), now(), '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'bapak.rudi@dev.local', '', now(), '{}', '{}', false, false, now(), now(), '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'fatimah@dev.local', '', now(), '{}', '{}', false, false, now(), now(), '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'new.tutor@dev.local', '', now(), '{}', '{}', false, false, now(), now(), '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin.dev@dev.local', '', now(), '{}', '{}', false, false, now(), now(), '', '', '', '', '', '', '', ''),
  -- The two dual-role accounts (TAD ADR-019). See the note under
  -- public.users below for why there are two of them.
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ustadzah.aminah@dev.local', '', now(), '{}', '{}', false, false, now(), now(), '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'bapak.hasan@dev.local', '', now(), '{}', '{}', false, false, now(), now(), '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'ustadzah.laila@dev.local', '', now(), '{}', '{}', false, false, now(), now(), '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'd1000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'aisyah@dev.local', '', now(), '{}', '{}', false, false, now(), now(), '', '', '', '', '', '', '', ''),
  -- Deliberately no matching public.users row — this is what the
  -- Registrations page (admin-only) is for.
  ('00000000-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'calon.ustadz@dev.local', '', now(), '{}', '{}', false, false, now(), now(), '', '', '', '', '', '', '', '');

insert into public.users (id, email, full_name, role, locale)
values
  ('a1000000-0000-0000-0000-000000000001', 'ustadz.ahmad@dev.local', 'Ustadz Ahmad', 'tutor', 'id'),
  ('a2000000-0000-0000-0000-000000000001', 'ibu.siti@dev.local', 'Ibu Siti', 'parent', 'id'),
  ('a2000000-0000-0000-0000-000000000002', 'bapak.rudi@dev.local', 'Bapak Rudi', 'parent', 'id'),
  ('a3000000-0000-0000-0000-000000000001', 'fatimah@dev.local', 'Fatimah', 'student', 'id'),
  ('b1000000-0000-0000-0000-000000000001', 'new.tutor@dev.local', 'Ustadz Baru', 'tutor', 'id'),
  ('c1000000-0000-0000-0000-000000000001', 'admin.dev@dev.local', 'Admin Dev', 'admin', 'id'),
  -- ---- dual-role accounts (TAD ADR-019) ----
  -- One person can be more than one thing at the TPA, and the database
  -- has always allowed it (`students.parent_id` is a plain FK to
  -- `users(id)` with no role constraint) even though the admin UI has no
  -- way to set it up yet. Both directions are seeded, because they land
  -- on opposite halves of the app:
  --
  --   Ustadzah Aminah — role 'tutor', teaches Grup A, her own son Yusuf
  --     is in Grup B. Since ADR-025 she lands on the *class* scope, as
  --     before, and the switch is what gets her to Yusuf — a route she
  --     did not have at all until then. She is the account to sign in as
  --     when a change touches the family screens' "am I looking at my
  --     own record" question: her role column says `tutor` while
  --     `fn_my_children()` holds her son, so a gate written against the
  --     role would deny her the control to confirm his home practice.
  --   Bapak Hasan — role 'parent', teaches Grup B **and Grup A**, and
  --     his own daughter Khadijah is in Grup A. Before ADR-025 every
  --     page routed him to the *family* views on the strength of that
  --     role column — which is where the unfiltered "my children" query
  --     used to hand him Grup B's whole roster in the ChildPicker. He
  --     now lands on the class scope like any other tutor and reaches
  --     the family views through the switch.
  --     Grup B is the disjoint half; Grup A makes him the **overlap
  --     tutor-parent** of RLS-36 — a tutor of the class his own child
  --     sits in. Unlike Aisyah's, his overlap is *not* closed by
  --     migration 013: he can record Khadijah's progress and write her
  --     year-end report, seeing it in draft, through the tutor grant.
  --     That is PPME's decision (ADR-024) and not an oversight — at a
  --     small TPA a teacher teaches their own children. He is the account
  --     to sign in as when a change touches the report editor or a
  --     "drafts are invisible to parents" assumption, because for him
  --     that assumption does not hold.
  --   Ustadzah Laila — role 'admin', teaches Grup A, her own daughter
  --     Salma is in Grup B: all three relationships at once, the shape
  --     RLS-34 asserts. She is the one to click through when a change
  --     touches the admin branch of a query, because for her the admin
  --     grant and the tutor relationship disagree — `useMyClasses`
  --     hands her every class (ADR-014) while `fn_my_classes()` holds
  --     only Grup A.
  --   Aisyah — role 'student', a 16+ self-login santri enrolled in
  --     Grup A who *assists* in Grup B **and in Grup A** (ADR-020,
  --     ADR-023). The combination the phrase "students are read-only"
  --     was hiding: read-only is what you get when you hold no
  --     write-granting relationship, and she holds one. Grup B is the
  --     disjoint half — a class she teaches and does not sit in. Grup A
  --     is the **overlap**, and the reason it was added: assisting the
  --     group you already attend is the likely arrangement, and it is
  --     the one that put her own record inside her own tutor grant.
  --     Until migration 013 that let her grade herself. Until ADR-025
  --     no screen took her to a roster at all, so the entitlement
  --     ADR-020 records was unreachable in the product; she now lands on
  --     the class scope and the exclusion is visible rather than
  --     theoretical. Her own name is off the roster on the five
  --     evaluative screens (`fetchRecordableRoster`, mirroring
  --     `fn_my_recordable_students()`), and on the attendance register
  --     it is *shown* but left out of what the upsert submits — the
  --     ADR-023(c) gap, closed in the interface because the register is
  --     one statement for the whole class. Sign in as her whenever a
  --     change touches a roster query or the register's payload.
  ('d1000000-0000-0000-0000-000000000001', 'ustadzah.aminah@dev.local', 'Ustadzah Aminah', 'tutor', 'id'),
  ('d1000000-0000-0000-0000-000000000002', 'bapak.hasan@dev.local', 'Bapak Hasan', 'parent', 'id'),
  ('d1000000-0000-0000-0000-000000000003', 'ustadzah.laila@dev.local', 'Ustadzah Laila', 'admin', 'id'),
  ('d1000000-0000-0000-0000-000000000004', 'aisyah@dev.local', 'Aisyah', 'student', 'id');

-- The two overlap personas are seeded by naming an existing account in an
-- existing class, so this fixture gains **no rows** for them: no student,
-- no class, no session. That is deliberate. `scripts/verify-push.mjs`
-- asserts exact roster sizes and class fan-out counts, and it has twice
-- been broken by fixture rows added for an unrelated reason — so the
-- overlap is expressed as two extra uuids in `tutor_ids`, which changes
-- no count, no audience (a tutor is never a notification recipient) and
-- nothing the harness reads.
insert into public.classes (id, name, schedule, tutor_ids)
values
  ('a4000000-0000-0000-0000-000000000001', 'Grup A', 'Sabtu 10:00-12:00', array[
    'a1000000-0000-0000-0000-000000000001',   -- Ustadz Ahmad
    'd1000000-0000-0000-0000-000000000001',   -- Ustadzah Aminah (her own son is in Grup B)
    'd1000000-0000-0000-0000-000000000003',   -- Ustadzah Laila, admin (her own daughter is in Grup B)
    'd1000000-0000-0000-0000-000000000002',   -- Bapak Hasan — OVERLAP: his own daughter Khadijah is in this class (RLS-36)
    'd1000000-0000-0000-0000-000000000004'    -- Aisyah — OVERLAP: her own 16+ record is in this class (RLS-37, ADR-023)
  ]::uuid[]),
  ('a4000000-0000-0000-0000-000000000002', 'Grup B', 'Minggu 09:00-11:00', array[
    'a1000000-0000-0000-0000-000000000001',   -- Ustadz Ahmad
    'b1000000-0000-0000-0000-000000000001',   -- Ustadz Baru
    'd1000000-0000-0000-0000-000000000002',   -- Bapak Hasan (the disjoint half: he teaches here, his child is in Grup A)
    'd1000000-0000-0000-0000-000000000004'    -- Aisyah (the disjoint half: she teaches here, she sits in Grup A)
  ]::uuid[]);

insert into public.students (id, parent_id, user_id, full_name, class_id, date_of_birth)
values
  ('a5000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', null, 'Ali', 'a4000000-0000-0000-0000-000000000001', '2015-03-10'),
  ('a5000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', null, 'Zainab', 'a4000000-0000-0000-0000-000000000001', '2016-07-22'),
  ('a5000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000001', 'Fatimah', 'a4000000-0000-0000-0000-000000000001', '2009-11-02'),
  ('a5000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000001', null, 'Umar', 'a4000000-0000-0000-0000-000000000002', '2017-05-05'),
  -- Each dual-role tutor's own child sits in the class the *other* one
  -- teaches, so neither can reach their own child through their tutor
  -- grant — the union of the two grants is the only way either of them
  -- sees everything they are entitled to.
  ('a5000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-000000000001', null, 'Yusuf', 'a4000000-0000-0000-0000-000000000002', '2016-02-14'),
  ('a5000000-0000-0000-0000-000000000006', 'd1000000-0000-0000-0000-000000000002', null, 'Khadijah', 'a4000000-0000-0000-0000-000000000001', '2015-09-30'),
  -- The triple-role account's own child, likewise in the class she does
  -- not teach.
  ('a5000000-0000-0000-0000-000000000007', 'd1000000-0000-0000-0000-000000000003', null, 'Salma', 'a4000000-0000-0000-0000-000000000002', '2017-01-19'),
  -- The student assistant's own record: a santri in Grup A with her own
  -- login, who assists in Grup B. Still linked to a parent, as every
  -- student record is (the hybrid account model).
  ('a5000000-0000-0000-0000-000000000008', 'a2000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000004', 'Aisyah', 'a4000000-0000-0000-0000-000000000001', '2008-06-12');
