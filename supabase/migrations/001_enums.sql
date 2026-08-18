-- ============================================================
-- TPA PPME Den Haag — Migration 001: Enum types
-- Matches TAD "Enums" table exactly.
--
-- Wrapped in DO blocks with exception handling so this file is
-- safe to re-run (e.g. if pasted into the SQL Editor twice) --
-- Postgres has no native `CREATE TYPE ... IF NOT EXISTS`.
-- ============================================================

do $$ begin
  create type user_role as enum ('admin', 'tutor', 'parent', 'student');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type locale as enum ('id', 'nl');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type attendance_status as enum ('present', 'absent', 'late');
exception when duplicate_object then null;
end $$;

-- Named assignment_status_enum, not assignment_status — a table of that
-- exact name is created in migration 002, and Postgres tables implicitly
-- register a composite type with the table's name, which would otherwise
-- collide with this enum type.
do $$ begin
  create type assignment_status_enum as enum ('pending', 'completed', 'incomplete', 'partial');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type yanbuah_mastery as enum ('lancar', 'kurang_lancar', 'ulang');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type quran_quality as enum (
    'mumtaz',          -- ممتاز (excellent)
    'jayyid_jiddan',   -- جيد جدا (very good)
    'jayyid',          -- جيد (good)
    'maqbul',          -- مقبول (acceptable)
    'perlu_perbaikan'  -- needs improvement
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type murajaah_quality as enum ('hafal_lancar', 'hafal_kurang_lancar', 'belum_hafal');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type murajaah_frequency as enum ('daily', '3x_week', 'weekly');
exception when duplicate_object then null;
end $$;
