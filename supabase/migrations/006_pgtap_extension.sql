-- ============================================================
-- TPA PPME Den Haag — Migration 006: pgTAP (testing only)
--
-- Enables the pgTAP unit-testing extension used by the automated RLS
-- test suite (supabase/tests/database/rls.test.sql, test-plan.md §3).
-- Adds only test-helper functions in the `extensions` schema — no
-- impact on application tables, data, or the public API surface.
-- ============================================================

create extension if not exists pgtap with schema extensions;
