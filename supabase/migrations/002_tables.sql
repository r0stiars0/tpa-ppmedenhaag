-- ============================================================
-- TPA PPME Den Haag — Migration 002: Core tables
-- 11 domain entities + 2 reference tables (surahs, yanbua_jilid).
-- Supabase convention: public.users extends auth.users (1:1).
-- ============================================================

-- ---------- users (application profile over Supabase Auth) ----------
create table public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  full_name   text not null,
  role        user_role not null default 'parent',
  locale      locale not null default 'id',
  push_sub    jsonb,                    -- Web Push subscription object
  created_at  timestamptz not null default now()
);
comment on table public.users is
  'App profile; id mirrors auth.users. google_id lives in auth.identities, not duplicated here.';

-- ---------- reference: Yanbu''a jilid ----------
create table public.yanbua_jilid (
  jilid       smallint primary key check (jilid between 1 and 7),
  page_count  smallint not null check (page_count > 0),
  label_id    text not null,   -- Bahasa Indonesia label
  label_nl    text not null    -- Dutch label
);

-- ---------- reference: surahs ----------
create table public.surahs (
  surah_num        smallint primary key check (surah_num between 1 and 114),
  name_arabic      text not null,
  transliteration  text not null,
  ayah_count       smallint not null check (ayah_count > 0)
);

-- ---------- classes ----------
create table public.classes (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  schedule    text,                     -- e.g. 'Sabtu 10:00-12:00'
  tutor_ids   uuid[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index idx_classes_tutor_ids on public.classes using gin (tutor_ids);

-- ---------- students (hybrid account model) ----------
create table public.students (
  id              uuid primary key default gen_random_uuid(),
  parent_id       uuid not null references public.users (id) on delete restrict,
  user_id         uuid unique references public.users (id) on delete set null,
    -- NULL for under-16 (majority). Set only when a 16+ student
    -- self-registers with their own Google account (role=student).
  full_name       text not null,
  class_id        uuid references public.classes (id) on delete set null,
  date_of_birth   date not null,
  enrollment_date date not null default current_date,
  current_jilid   smallint references public.yanbua_jilid (jilid),
  current_surah   smallint references public.surahs (surah_num),
  current_ayah    smallint check (current_ayah >= 1),
  created_at      timestamptz not null default now()
);
create index idx_students_parent on public.students (parent_id);
create index idx_students_class  on public.students (class_id);

-- ---------- sessions ----------
create table public.sessions (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes (id) on delete cascade,
  date        date not null,
  tutor_id    uuid not null references public.users (id),
  created_at  timestamptz not null default now(),
  unique (class_id, date)
);

-- ---------- attendance ----------
create table public.attendance (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions (id) on delete cascade,
  student_id  uuid not null references public.students (id) on delete cascade,
  status      attendance_status not null,
  reason      text,
  created_at  timestamptz not null default now(),
  unique (session_id, student_id)      -- one record per student per session
);
create index idx_attendance_student on public.attendance (student_id);

-- ---------- assignments ----------
create table public.assignments (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes (id) on delete cascade,
  tutor_id    uuid not null references public.users (id),
  title       text not null check (char_length(title) <= 200),
  description text,                     -- text-only in MVP per PRD constraint
  due_date    date not null,
  created_at  timestamptz not null default now()
);
create index idx_assignments_class on public.assignments (class_id);

-- ---------- assignment_status (per student) ----------
create table public.assignment_status (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id    uuid not null references public.students (id) on delete cascade,
  status        assignment_status_enum not null default 'pending',
  notes         text,
  updated_at    timestamptz not null default now(),
  unique (assignment_id, student_id)
);

-- ---------- yanbua_progress ----------
create table public.yanbua_progress (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students (id) on delete cascade,
  tutor_id    uuid not null references public.users (id),
  jilid       smallint not null references public.yanbua_jilid (jilid),
  page        smallint not null check (page >= 1),
  mastery     yanbuah_mastery not null,
  notes       text,
  recorded_at timestamptz not null default now()
);
create index idx_yanbua_student on public.yanbua_progress (student_id, recorded_at desc);

-- ---------- quran_progress ----------
create table public.quran_progress (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.students (id) on delete cascade,
  tutor_id      uuid not null references public.users (id),
  surah_num     smallint not null references public.surahs (surah_num),
  ayah_from     smallint not null check (ayah_from >= 1),
  ayah_to       smallint not null,
  quality       quran_quality not null,
  tajweed_notes text,
  recorded_at   timestamptz not null default now(),
  check (ayah_to >= ayah_from)
);
create index idx_quran_student on public.quran_progress (student_id, recorded_at desc);

-- ---------- murajaah_assignments ----------
create table public.murajaah_assignments (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students (id) on delete cascade,
  tutor_id    uuid not null references public.users (id),
  surah_num   smallint not null references public.surahs (surah_num),
  ayah_from   smallint not null check (ayah_from >= 1),
  ayah_to     smallint not null,
  frequency   murajaah_frequency not null default 'daily',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  check (ayah_to >= ayah_from)
);
create index idx_murajaah_assign_student on public.murajaah_assignments (student_id) where active;

-- ---------- murajaah_log ----------
create table public.murajaah_log (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.murajaah_assignments (id) on delete cascade,
  confirmed_by  uuid not null references public.users (id),
  quality       murajaah_quality not null,
  date          date not null default current_date,
  streak_count  integer not null default 1,   -- set by trigger below
  created_at    timestamptz not null default now(),
  unique (assignment_id, date)                -- one confirmation per day
);

-- ---------- streak trigger ----------
-- streak_count = previous day's streak + 1 if yesterday was confirmed,
-- otherwise resets to 1. (Simplified daily model; '3x_week' and 'weekly'
-- frequencies count consecutive *scheduled* periods — refine in function
-- layer if per-frequency streaks are required. See test plan §4.3.)
create or replace function public.fn_set_streak_count()
returns trigger language plpgsql as $$
declare
  prev integer;
begin
  select streak_count into prev
  from public.murajaah_log
  where assignment_id = new.assignment_id
    and date = new.date - 1;
  new.streak_count := coalesce(prev, 0) + 1;
  return new;
end $$;

create trigger trg_murajaah_streak
  before insert on public.murajaah_log
  for each row execute function public.fn_set_streak_count();

-- ---------- updated_at maintenance ----------
create or replace function public.fn_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger trg_assignment_status_touch
  before update on public.assignment_status
  for each row execute function public.fn_touch_updated_at();
