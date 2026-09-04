# ADR-038: Admin rejection of unapproved registration requests

**Status:** Proposed
**Date:** 2026-09-04

## Context

`fn_pending_registrations()` (migration `008_admin_registrations.sql`) surfaces
everyone who has signed in with Google but has no `public.users` row yet — it
diffs `auth.users` against `public.users` under `security definer`, since
`auth.users` itself lives in a schema PostgREST doesn't expose and no client
role can read directly. [src/features/admin/RegistrationsPage.tsx](../src/features/admin/RegistrationsPage.tsx)
renders that list and lets an admin **approve** an entry (insert the matching
`public.users` row via `registerUser`, [src/features/admin/api.ts](../src/features/admin/api.ts)).

There is no way to **reject** one. A wrong sign-in — a mistyped Google
account, someone outside the TPA, a duplicate of an already-invited person —
just sits in the pending list indefinitely with no admin action available
except to ignore it. ADR-037 already named this gap as a deliberate
follow-up it was leaving open: *"a 'declined' flow (admin deletes a request
without approving) ... isn't specified here as no UI for it is planned in
this change."*

The pending list is not backed by a normal table. Each entry **is** an
`auth.users` row with no matching `public.users` row — there is no RLS
policy to write, because RLS only governs `public` schema tables reachable
through PostgREST, and `auth.users` is neither. The only way to remove one
is GoTrue's Admin API (`auth.admin.deleteUser`), which requires the
service-role key — the same constraint `invite-user.mts` already works
under to *create* an `auth.users` row (`auth.admin.createUser`), and the
reason that Function verifies the caller's admin-ness in code rather than
relying on RLS.

`public.users.id references auth.users (id) on delete cascade` (migration
`002_tables.sql`). If the target id already has a `public.users` row — i.e.
the request was already approved — deleting `auth.users` would cascade and
destroy that person's whole profile. A reject action must refuse that case,
not just "work" on it.

## Decision

Add an admin-only Netlify Function, `netlify/functions/reject-registration.mts`,
that deletes the `auth.users` row for a still-pending registration via the
GoTrue Admin API. No new migration, table, or RLS policy — there is nothing
in the `public` schema for this action to touch.

### Backend — `netlify/functions/reject-registration.mts`

1. `POST` only; body `{ id: string }`.
2. Authenticate and authorize the caller with `authenticateCaller()` from
   [netlify/functions/lib/callerAuth.ts](../netlify/functions/lib/callerAuth.ts) —
   the shared helper `invite-user.mts` predates and the year-end-report
   Functions already use: validate the JWT against GoTrue, then look the
   caller's role up independently via the service-role client. Require
   `caller.role === 'admin'`, else `403`.
3. Validate `id` is present, else `400`.
4. **Guard**: `admin.from('users').select('id').eq('id', id).maybeSingle()`.
   If a row comes back, the id is already an approved user, not a pending
   request — `409` ("This user is already registered and cannot be
   rejected"). This is the same defensive check ADR-037 puts in
   `registration_requests_self_insert`'s `not exists` clause, restated here
   in code because this path has no RLS layer to put it in.
5. `admin.auth.admin.deleteUser(id)` — surfaces any GoTrue error (e.g. id
   not found) as `400`.
6. `200` with `{ id }` on success.

No `config.path` export — same reasoning as `invite-user.mts`/`health.mts`:
served at the default `/.netlify/functions/reject-registration`, and an
explicit path breaks local `netlify dev` routing.

### Frontend

1. **`src/features/admin/api.ts`** — `rejectRegistration(id: string): Promise<void>`,
   same shape as `inviteUser`: read the session, `POST` to
   `/.netlify/functions/reject-registration` with a bearer token, throw the
   response body's `error` on a non-OK status.

2. **`src/features/admin/RegistrationsPage.tsx`** — a `rejectingId` state
   mirroring `savingId`; a `handleReject(user)` that confirms with
   `window.confirm(t('admin.confirmReject', { email: user.email }))` (the
   convention already used for `reports.confirmPublish` in
   `ReportEditor.tsx`), calls `rejectRegistration`, then removes the row
   from `pending` on success.

   Placement/styling, made explicit: the "Reject" button sits directly
   beside the existing "Register" button (`t('admin.register')` —
   "Daftarkan" / "Registreren") — the two currently sit in a
   `flex-col`/full-width single-button layout per `<li>`, so this changes
   that block to a `flex gap-2` row with "Register" (primary, filled,
   `bg-ppme-primary`) and "Reject" (danger, filled red —
   `bg-ppme-danger text-white hover:bg-ppme-danger/90`, not just an
   outline, so it reads unambiguously as destructive at a glance) side by
   side. `window.confirm` is a hard requirement, not optional, before the
   Function call ever fires — no destructive action here without it.
   Disabled while either action is in flight for that row
   (`savingId === user.id || rejectingId === user.id`).

3. **`docs/openapi.yaml`** — a `/reject-registration` entry next to the
   existing `/invite-user` entry: admin-only, JWT + `public.users` role
   check, service-role key, `200`/`401`/`403`/`409` responses. Keeps the
   spec describing the Functions that actually exist, matching how
   `/invite-user` itself is documented there.

4. **i18n** — two new keys in *both* `public/locales/id.json` and
   `public/locales/nl.json` (checked by `tests/unit/i18n-parity.test.ts`
   and `tests/unit/i18nHardcodedStrings.test.ts`): `admin.reject` and
   `admin.confirmReject` (interpolates `{{email}}`).

### Testing

- **Vitest** — Function-level coverage in the style of
  `tests/unit/functionAuth.test.ts`'s `authenticateCaller` cases: non-admin
  caller → `403`; missing `id` → `400`; id already present in
  `public.users` → `409`; `deleteUser` success → `200`; `deleteUser` error
  → `400`.
- **Vitest** — `rejectRegistration` in `src/features/admin/api.ts`, mirroring
  whatever existing test already covers `inviteUser`'s fetch/session
  handling.
- **Manual/E2E** — admin opens `admin/registrations`, clicks Reject on a
  pending entry, confirms, the entry disappears; the same Google account
  signing in again reappears as a fresh pending entry, since GoTrue
  re-creates `auth.users` on the next sign-in (documented as intended
  behaviour below, not a gap).

## Rationale

- Reuses the established pattern of a service-role Netlify Function owning
  its own authorization in code (`callerAuth.ts`, restated in
  `invite-user.mts`'s and the report Functions' own comments) instead of
  inventing a database-level mechanism for an action that structurally
  cannot live in Postgres/RLS — `auth.users` is outside both.
- The "already registered" guard query is the cheapest possible check that
  prevents this action from ever cascading into a real profile deletion,
  and keeps the failure mode a clear `409` rather than a successful delete
  of the wrong thing.
- No migration avoids growing the schema for a feature that has nothing to
  persist — the state being changed already lives entirely in GoTrue.

## Alternatives Considered

- **A `security definer` Postgres function that `delete`s from `auth.users`
  directly via SQL.** Rejected: Supabase's own guidance is to go through
  the Admin API (`auth.admin.deleteUser`) rather than a raw SQL delete, so
  associated identities/sessions/refresh tokens are cleaned up consistently
  rather than only the `auth.users` row itself.
- **Leave pending entries un-rejectable and let admins just ignore them.**
  Rejected — this is the exact gap ADR-037 flagged and the one driving this
  change; an unbounded, un-actionable pending list is the actual complaint.
- **"Soft" reject — hide the entry client-side without deleting anything.**
  Rejected: the entry is generated live from `fn_pending_registrations()`
  on every page load (it isn't stored client state), so a soft hide has no
  server-side effect and the entry would simply reappear on next load or
  for any other admin.

## Consequences / Follow-ups

- One new Netlify Function, one new `admin` API method, two new i18n keys
  per locale, one new UI button. No migration.
- Rejecting does not blacklist the email — it deletes the `auth.users` row
  the pending state was keyed on, but nothing stops that same Google
  account from signing in again, which makes GoTrue create a fresh
  `auth.users` row and the person reappears as a new pending entry. This is
  intended (there is no "banned list" concept in this app) but worth
  admins knowing rather than assuming reject is permanent.
- Forward-compatible with ADR-037: once `registration_requests` (proposed
  there, not yet implemented — no `019_...` migration exists) ships, that
  table's `id ... references auth.users (id) on delete cascade` means
  `reject-registration`'s `auth.admin.deleteUser` call will clean up any
  matching `registration_requests` row for free, with no change needed
  here.
