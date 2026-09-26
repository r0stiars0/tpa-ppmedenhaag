-- ============================================================
-- TPA PPME Den Haag — multi-group demo seed (NOT a migration)
-- PRD Feature 8 release 8a, TAD ADR-045
--
-- Opt-in, local only. Load AFTER supabase/dev-fixture.sql:
--
--   docker exec -i supabase_db_tpa-ppme-denhaag \
--     psql -U postgres -v ON_ERROR_STOP=1 < supabase/dev-seed-multigroup.sql
--
-- The fixture deliberately ships no activity rows (empty screens are
-- where the record/create flows are exercised from scratch). This file
-- adds the activity that makes the multi-group screens show something:
--   * Hana — an Aqidah-only child of Ibu Siti (the "no tracking group"
--     explanation on Yanbu'a / Al-Quran / Murajaah).
--   * Three weeks of registers for Grup A (Sat), Grup B (Wed + Sat) and
--     the Aqidah group (Sun), on each group's real meeting days, relative
--     to today — so the per-group rates, the group-labelled history and
--     the tutor's cross-group history have data. Ali misses one Aqidah
--     session with a reason: a Yanbu'a tutor sees it as "absent" with the
--     reason withheld, his parents see the reason.
--   * Homework from Grup A and from the Aqidah group, labelled by group.
--   * Yanbu'a progress and Murajaah targets — Umar's target (Grup B) is
--     the one the close-or-keep prompt offers if he leaves Grup B.
--   * "Grup Lama 2025/2026", archived, with history (read-only, and
--     "delete" refused).
--   * Rafi — a student in no group (the Beheer "no group" strip).
--
-- Re-running: not idempotent; reload the fixture first
-- (`supabase db reset --local`, then the fixture, then this file).
-- ============================================================

begin;

-- ---------- students without a Yanbu'a/Quran group ----------
insert into public.students (id, full_name, date_of_birth) values
  ('a5000000-0000-0000-0000-0000000000a1', 'Hana', '2016-04-04'),   -- Aqidah only
  ('a5000000-0000-0000-0000-0000000000a2', 'Rafi', '2014-10-10');   -- no group at all
insert into public.student_guardians (student_id, user_id, relation) values
  ('a5000000-0000-0000-0000-0000000000a1', 'a2000000-0000-0000-0000-000000000001', 'ibu'),
  ('a5000000-0000-0000-0000-0000000000a2', 'a2000000-0000-0000-0000-000000000002', 'ayah');
insert into public.class_members (class_id, student_id) values
  ('a4000000-0000-0000-0000-000000000003', 'a5000000-0000-0000-0000-0000000000a1');

commit;

-- ---------- registers: the last three weeks of each group's meeting days ----------
-- `d` walks back day by day; a session is created only where the day is
-- one of the group's meeting days, so trg_sessions_meeting_day agrees.
insert into public.sessions (class_id, date, tutor_id)
select c.id, d::date,
       case when c.id = 'a4000000-0000-0000-0000-000000000003'
            then 'e1000000-0000-0000-0000-000000000001'::uuid    -- Ustadzah Maryam
            else 'a1000000-0000-0000-0000-000000000001'::uuid end -- Ustadz Ahmad
from public.classes c
cross join generate_series(current_date - 20, current_date - 1, interval '1 day') d
where c.id in ('a4000000-0000-0000-0000-000000000001',
               'a4000000-0000-0000-0000-000000000002',
               'a4000000-0000-0000-0000-000000000003')
  and extract(dow from d)::int = any (c.meeting_days);

-- Everyone present by default…
insert into public.attendance (session_id, student_id, status)
select s.id, m.student_id, 'present'
from public.sessions s
join public.class_members m on m.class_id = s.class_id;

-- …with a few realistic exceptions.
-- Ali misses the most recent Aqidah session (reason visible only to that
-- group's tutor, admins and his family).
update public.attendance a set status = 'absent', reason = 'Sakit'
where a.student_id = 'a5000000-0000-0000-0000-000000000001'
  and a.session_id = (select id from public.sessions
                      where class_id = 'a4000000-0000-0000-0000-000000000003'
                      order by date desc limit 1);
-- Yusuf misses the earliest Grup B session.
update public.attendance a set status = 'absent', reason = 'Izin'
where a.student_id = 'a5000000-0000-0000-0000-000000000005'
  and a.session_id = (select id from public.sessions
                      where class_id = 'a4000000-0000-0000-0000-000000000002'
                      order by date asc limit 1);
-- Umar is late to the most recent Aqidah session.
update public.attendance a set status = 'late'
where a.student_id = 'a5000000-0000-0000-0000-000000000004'
  and a.session_id = (select id from public.sessions
                      where class_id = 'a4000000-0000-0000-0000-000000000003'
                      order by date desc limit 1);

-- ---------- homework from two groups ----------
insert into public.assignments (id, class_id, tutor_id, title, description, due_date) values
  ('a6000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-000000000001', 'Membaca Jilid 3 hal. 10–12',
   'Latihan membaca di rumah, 10 menit sehari', current_date + 7),
  ('a6000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000003',
   'e1000000-0000-0000-0000-000000000001', 'Menghafal rukun iman',
   'Hafalkan enam rukun iman beserta artinya', current_date + 8);
insert into public.assignment_status (assignment_id, student_id, status)
select a.id, m.student_id, 'pending'
from public.assignments a
join public.class_members m on m.class_id = a.class_id
where a.id in ('a6000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000002');
update public.assignment_status set status = 'completed'
where assignment_id = 'a6000000-0000-0000-0000-000000000001'
  and student_id = 'a5000000-0000-0000-0000-000000000001';

-- ---------- Yanbu'a progress and Murajaah targets ----------
insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery, recorded_at) values
  ('a5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 3, 8,  'lancar',        now() - interval '14 days'),
  ('a5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 3, 12, 'kurang_lancar', now() - interval '7 days'),
  ('a5000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 1, 20, 'lancar',        now() - interval '10 days');
insert into public.murajaah_assignments (student_id, tutor_id, surah_num, ayah_from, ayah_to) values
  ('a5000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 114, 1, 6),  -- Umar (Grup B)
  ('a5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 112, 1, 4);  -- Ali (Grup A)

-- ---------- an archived group with history ----------
insert into public.classes (id, name, schedule, meeting_days, tutor_ids, tracks_progress) values
  ('a4000000-0000-0000-0000-0000000000f1', 'Grup Lama 2025/2026', 'Sabtu 10:00-12:00', '{0,1,2,3,4,5,6}',
   array['b1000000-0000-0000-0000-000000000001']::uuid[], true);   -- Ustadz Baru
insert into public.class_members (class_id, student_id) values
  ('a4000000-0000-0000-0000-0000000000f1', 'a5000000-0000-0000-0000-000000000002');  -- Zainab
insert into public.sessions (id, class_id, date, tutor_id) values
  ('a7000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-0000000000f1', current_date - 90,
   'b1000000-0000-0000-0000-000000000001');
insert into public.attendance (session_id, student_id, status) values
  ('a7000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000002', 'present');
-- Archived last: from here on the group is frozen for every role.
update public.classes set archived_at = now() where id = 'a4000000-0000-0000-0000-0000000000f1';
