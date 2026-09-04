# ADR-037: Unregistered users submit name + context before admin approval

**Status:** Proposed
**Date:** 2026-09-04

## Context

When someone signs in with Google for the first time, `Gate()` in
[src/App.tsx](../src/App.tsx) checks `unregistered || !profile` and renders
[src/pages/Unauthorized.tsx](../src/pages/Unauthorized.tsx) — a bare "contact
admin" screen with just the signed-in email and a sign-out button. The admin
discovers these people via `fn_pending_registrations()`
(`supabase/migrations/008_admin_registrations.sql`), which diffs `auth.users`
against `public.users`, and approves them in
[src/features/admin/RegistrationsPage.tsx](../src/features/admin/RegistrationsPage.tsx).
That screen only ever shows the email and sign-in date — the admin types the
new user's full name blind and has no context for which role (parent, tutor,
student, admin) to assign.

The goal is to let the still-unregistered, already-authenticated user submit
their own full name plus free-text context (who they are / which child /
why they need access) from the Unauthorized screen, so the admin has that
information when approving.

This cannot be done by writing directly into `public.users`: inserting a row
there *is* what "registered" means (`AuthContext.tsx`,
`setUnregistered(!data)`), so a self-insert would bypass admin approval
entirely rather than request it. It needs its own staging table.

## Decision

Add a `public.registration_requests` staging table that a signed-in but
not-yet-registered user may write to (their own row only), surfaced to
admins through the existing pending-registration flow.

### Backend — new migration `supabase/migrations/019_registration_requests.sql`

1. **Table**, 1:1 with `auth.users` like `public.users` already is:
   ```sql
   create table public.registration_requests (
     id          uuid primary key references auth.users (id) on delete cascade,
     full_name   text not null,
     description text,
     created_at  timestamptz not null default now(),
     updated_at  timestamptz not null default now()
   );
   ```
   Reuses `public.fn_touch_updated_at()` (already defined in `002_tables.sql`)
   via `trg_registration_requests_touch`, the same pattern `assignment_status`
   and `year_end_reports` already use.

2. **RLS**, mirroring the exact 3-policy shape `public.users` already uses
   (`users_self_read` / `users_self_update` / `users_admin_all` in
   `003_rls_policies.sql`):
   - `registration_requests_self_read` — `using (id = auth.uid() or public.fn_is_admin())`
   - `registration_requests_self_insert` — `with check (id = auth.uid() and not exists (select 1 from public.users where id = auth.uid()))`. The `not exists` guard is defence in depth: the UI never lets an already-registered user reach this form, but the policy shouldn't rely on that alone.
   - `registration_requests_self_update` — `using (id = auth.uid()) with check (id = auth.uid())`, letting the user revise their submission before an admin acts on it.
   - `registration_requests_admin_all` — `using (public.fn_is_admin()) with check (public.fn_is_admin())`

3. **Cleanup trigger.** Once an admin approves (inserts the `public.users`
   row), the request row's job is done, and its free-text `description` is
   exactly the kind of incidental personal data that shouldn't linger:
   ```sql
   create or replace function public.fn_cleanup_registration_request()
   returns trigger language plpgsql as $$
   begin
     delete from public.registration_requests where id = new.id;
     return new;
   end $$;

   create trigger trg_cleanup_registration_request
     after insert on public.users
     for each row execute function public.fn_cleanup_registration_request();
   ```
   This guarantees cleanup regardless of which path creates the
   `public.users` row (`registerUser`, the `invite-user` Netlify Function, or
   a future path), rather than relying on the frontend to remember.

4. **Extend `fn_pending_registrations()`** to surface the submitted info.
   Because its return-table shape changes, and Postgres won't let
   `create or replace function` alter a table function's return columns,
   this needs `drop function` first:
   ```sql
   drop function public.fn_pending_registrations();

   create function public.fn_pending_registrations()
   returns table(id uuid, email text, created_at timestamptz, full_name text, description text)
   language sql stable security definer set search_path = public as $$
     select au.id, au.email, au.created_at, rr.full_name, rr.description
     from auth.users au
     left join public.users pu on pu.id = au.id
     left join public.registration_requests rr on rr.id = au.id
     where pu.id is null
       and public.fn_is_admin()
     order by au.created_at
   $$;

   grant execute on function public.fn_pending_registrations() to authenticated;
   ```
   `full_name`/`description` come back `null` for anyone who reached the
   pending state before this feature existed (e.g. via `invite-user`, which
   pre-creates nothing in `registration_requests`) — the frontend must treat
   both as optional.

No explicit `grant` statement is needed for the new table: migration 007's
`alter default privileges ... to anon, authenticated, service_role` already
covers new tables.

### Types — `src/lib/database.types.ts`

CLI-generated (`supabase gen types typescript`), but there is no `gen types`
script in `package.json` and no CI step for it, so it must be regenerated
manually (`supabase gen types typescript --local > src/lib/database.types.ts`)
or hand-edited:
- Add a `registration_requests` entry under `Tables`, mirroring the `users`
  entry (`Row`/`Insert`/`Update` with `id`, `full_name`,
  `description: string | null`, `created_at`, `updated_at`;
  `Relationships: []`, same as `users`, since the FK target is in `auth`).
- Update the `fn_pending_registrations` entry under `Functions` to
  `Returns: { id: string; email: string; created_at: string; full_name: string | null; description: string | null }[]`.

### Frontend

1. **New `src/features/auth/api.ts`**, following the shape of
   [src/features/admin/api.ts](../src/features/admin/api.ts):
   - `fetchMyRegistrationRequest(userId): Promise<{ full_name: string; description: string | null } | null>`
   - `submitRegistrationRequest(params: { id: string; full_name: string; description: string | null }): Promise<void>` — an upsert into `registration_requests`.

2. **[src/pages/Unauthorized.tsx](../src/pages/Unauthorized.tsx)** — add a
   form below the existing message: on mount, load any existing request to
   prefill (so a user who already submitted can revise it); controlled
   `full_name` (required) and `description` (optional textarea); submit
   disabled while empty/saving; on success, show a distinct "request sent,
   waiting for admin" state instead of the static message. Reuse the input
   styling already established in `RegistrationsPage.tsx`.

3. **`src/features/admin/api.ts`** — extend `PendingRegistration` with
   `full_name: string | null` and `description: string | null`.

4. **`src/features/admin/RegistrationsPage.tsx`** — prefill instead of
   blind entry: seed `draftFor`'s fallback from the fetched row
   (`pending.find((p) => p.id === userId)?.full_name ?? ''`) so the admin
   sees the user's own submitted name and can still edit it; render
   `user.description`, when present, as read-only context above the
   editable full-name field.

5. **i18n** — new keys in *both* `public/locales/id.json` and
   `public/locales/nl.json` (checked by `tests/unit/i18n-parity.test.ts`;
   every UI string must go through `t()`, checked by
   `tests/unit/i18nHardcodedStrings.test.ts`):
   `auth.registrationIntro`, `auth.registrationFullName`,
   `auth.registrationDescription`, `auth.registrationSubmit`,
   `auth.registrationSubmitted`, and `admin.registrationDescription`.

### Testing

- **pgTAP** (`supabase/tests/database/rls.test.sql`, next free IDs RLS-60+;
  catalogue in `docs/test-plan.md` §3), following the existing
  `lives_ok`/`throws_ok` + fixture-transaction convention:
  - RLS-60: an authenticated user with no `public.users` row can INSERT
    their own `registration_requests` row; inserting with someone else's
    `id` is rejected.
  - RLS-61: an already-registered user's INSERT is rejected (`not exists`
    guard).
  - RLS-62: a user can SELECT/UPDATE only their own request row.
  - RLS-63: `fn_pending_registrations()` returns `full_name`/`description`
    to an admin caller; a non-admin caller gets an empty result.
  - RLS-64: after an admin INSERTs the matching `public.users` row, the
    `registration_requests` row is gone — proving the cleanup trigger
    fired, not assuming it.
- **Vitest** — new `tests/unit/registrationRequests.test.ts` covering
  `fetchMyRegistrationRequest`/`submitRegistrationRequest` and the extended
  `fetchPendingRegistrations` shape.
- **E2E** (`docs/test-plan.md`) — extend the E2E-08 case or add a new one:
  unregistered user submits name + description → admin sees it prefilled in
  `RegistrationsPage.tsx` → approves → request row is cleaned up.

## Rationale

- A separate staging table preserves the existing approval gate
  (`public.users` row presence = registered) instead of weakening it.
- Mirroring `public.users`'s own self-read/self-update/admin-all RLS shape
  keeps the new policies consistent with an already-reviewed pattern rather
  than inventing a new one.
- A database trigger (not an app-layer delete call) guarantees the request
  row's personal-data cleanup regardless of which code path creates the
  `public.users` row — consistent with this codebase's general preference
  for DB-enforced invariants (e.g. `fn_touch_updated_at`,
  `fn_set_streak_count`).
- `full_name`/`description` are optional/nullable throughout the read path
  so existing invite-created pending entries (which never touch this table)
  keep working unchanged.

## Alternatives Considered

- **Let the user insert directly into `public.users`, pre-filled with a
  default role.** Rejected: this *is* registration — RLS would need a
  parallel "provisional" status concept bolted onto the one table that
  currently means "approved", touching every other policy that reads
  `public.users.role`.
- **Store the submission as a JSON blob on `auth.users` metadata via the
  GoTrue admin API.** Rejected: requires a service-role Netlify Function for
  a plain self-service write that Postgres RLS already handles natively,
  and keeps the data outside the schema the rest of the app queries.
- **Skip the cleanup trigger and rely on `registerUser()` to delete the
  request row after insert.** Rejected: leaves a gap for the `invite-user`
  path and any future admin action that creates a `public.users` row
  without going through `registerUser()`.

## Consequences / Follow-ups

- One new migration, one new table, one new frontend feature folder
  (`src/features/auth/`), and five new i18n keys per locale.
- Admins reviewing very old pending entries (created before this ADR ships)
  will still see a blank name/description, since no `registration_requests`
  row exists for them — the UI must treat both fields as optional, not
  assume they're always populated.
- Follow-up worth considering later: a "declined" flow (admin deletes a
  request without approving) is naturally supported by
  `registration_requests_admin_all`'s DELETE verb, but isn't specified here
  as no UI for it is planned in this change.
