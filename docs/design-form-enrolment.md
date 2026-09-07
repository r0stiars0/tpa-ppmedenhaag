# Design — Automatic enrolment from the Google re-registration form

**Requirements:** `docs/requirements-form-enrolment.md` (signed off)
**Branch:** `feature/form-enrolment` (off `origin/main`, worktree)
**Permanent record:** ADR-043 in `docs/TAD-PPME-TPA.md` (written with the code)
**Next free numbers:** migration **024**, ADR **043**, pgTAP **RLS-98…**, PRD **FR-010**

---

## 1. Shape of the solution

```
Parent (signed into Google, verified email)
        │  submits the form once per child
        ▼
Google Form ──► Response Sheet (Form_Responses tab)
                      │  installable onFormSubmit trigger
                      ▼
        Apps Script  (apps-script/enrol-from-form.gs)
          • reads the row by question title
          • POST {json} + header X-Webhook-Secret
          ▼
POST /.netlify/functions/enrol-from-form           ← new
        │  netlify/functions/enrol-from-form.mts (thin handler)
        │  netlify/functions/lib/enrolFromForm.ts (core, unit-tested)
        │
        │  1. verify shared secret (ENROL_FORM_SECRET), fail closed
        │  2. parse + validate payload
        │  3. resolve parent auth.users id:
        │       a. public.users by email → reuse id  (re-submission path)
        │       b. else adminClient.auth.admin.createUser({email, email_confirm:true})
        │       c. createUser → email_exists but no profile → needs_attention
        │  4. supabase.rpc('fn_enrol_from_form', {...})   ← one transaction
        │  5. on a newly created parent: send branded invitation email (ADR-018),
        │     non-fatal
        │  6. insert enrolment_submissions row (status, ids, error)
        │  7. return { status, parent_user_id, student_id, invitation_email? }
        ▼
Apps Script writes Status / Error back into the sheet row
```

Nothing reads *from* Google. The app and Supabase are push targets only.

## 2. Why a new RPC (`fn_enrol_from_form`) and not `fn_admin_save_student`

- `fn_admin_save_student` opens with `if not public.fn_is_admin() then raise`.
  The Function holds the **service-role** key: `auth.uid()` is null, so
  `fn_is_admin()` is false and that RPC always throws for us.
- The student + guardian rows **must** be written in one transaction. Migration
  021's `trg_student_has_guardian` is `AFTER INSERT ON students DEFERRABLE
  INITIALLY DEFERRED` — a student with no active guardian fails at `COMMIT`.
  supabase-js issues one HTTP request (= one transaction) per `.insert()`, so
  "insert student, then insert guardian" as two calls cannot satisfy it.
- Therefore: a new `SECURITY DEFINER` RPC that does the whole upsert in its own
  transaction, guarded by `auth.role() = 'service_role'` instead of
  `fn_is_admin()` (this is the ADR-040(g) "one RPC for the whole student save"
  pattern, re-guarded for a callerless channel — the `webhookAuth.ts` split of
  `callerAuth.ts`, at the database layer).

## 3. Migration 024 — `supabase/migrations/024_enrol_from_form.sql`

### 3.1 `public.enrolment_submissions`

```sql
create table public.enrolment_submissions (
  id                uuid primary key default gen_random_uuid(),
  submitted_at      timestamptz not null,          -- the form Timestamp
  verified_email    text not null,                 -- Google-verified respondent
  parent_name       text not null,
  student_name      text not null,
  date_of_birth     date not null,
  locale            text not null check (locale in ('id','nl')),
  relation          text,
  student_email     text,                          -- "Email siswa (jika ada)"
  payment_answer    text,                          -- "Ya" / "Tidak", stored only
  consent           boolean not null,
  parent_user_id    uuid references public.users (id) on delete set null,
  student_id        uuid references public.students (id) on delete set null,
  status            text not null
                      check (status in ('enrolled','updated','needs_attention','error')),
  error             text,
  created_at        timestamptz not null default now(),
  constraint enrolment_submissions_names_len
    check (char_length(parent_name) between 1 and 120
       and char_length(student_name) between 1 and 120)
);

comment on table public.enrolment_submissions is
  'One row per processed Google re-registration submission (ADR-043): the raw '
  'answers, the accounts it created/updated, and the outcome. Admin audit + '
  'troubleshooting view; kept indefinitely (requirements R13). Written only by '
  'the enrol-from-form Function on the service role.';

alter table public.enrolment_submissions enable row level security;

-- Admin reads all; nobody else sees anything. Writes are service-role only
-- (the Function) — same split as year_end_reports (migration 005): an admin
-- `all` policy for reads, `service_role` for writes.
create policy enrolment_submissions_admin_read on public.enrolment_submissions
  for select to authenticated using (public.fn_is_admin());

create policy enrolment_submissions_service_write on public.enrolment_submissions
  for insert to service_role with check (true);
create policy enrolment_submissions_service_update on public.enrolment_submissions
  for update to service_role using (true) with check (true);
```

No explicit table `grant` — migration 007's `alter default privileges … to anon,
authenticated, service_role` already covers new tables (the 020/021/022 note).

### 3.2 `public.fn_enrol_from_form(...)`

```sql
create or replace function public.fn_enrol_from_form(
  p_parent_id     uuid,     -- auth.users id, already created by the Function
  p_parent_email  text,
  p_parent_name   text,
  p_locale        text,     -- 'id' | 'nl'
  p_student_name  text,
  p_dob           date,
  p_relation      text default null
) returns table (
  parent_user_id  uuid,
  student_id      uuid,
  parent_created  boolean,
  student_created boolean,
  status          text
)
language plpgsql security definer set search_path = public as $$
declare
  v_role        user_role;
  v_student     uuid;
  v_match_count int;
  v_status      text := null;
  v_parent_new  boolean := false;
  v_student_new boolean := false;
begin
  -- Callerless channel: only the service role may enrol.
  if auth.role() <> 'service_role' then
    raise exception 'service role only' using errcode = 'insufficient_privilege';
  end if;
  if p_locale not in ('id','nl') then
    raise exception 'locale must be id or nl' using errcode = 'check_violation';
  end if;

  -- ── parent profile ────────────────────────────────────────────
  select role into v_role from public.users where id = p_parent_id;
  if not found then
    insert into public.users (id, email, full_name, role, locale)
    values (p_parent_id, lower(p_parent_email), p_parent_name, 'parent', p_locale);
    v_parent_new := true;
    v_role := 'parent';
  elsif v_role = 'parent' then
    -- refresh name/locale from the latest submission; never touch a
    -- tutor's/admin's profile (ADR-024) or a student account.
    update public.users
      set full_name = p_parent_name, locale = p_locale
      where id = p_parent_id;
  elsif v_role = 'student' then
    v_status := 'needs_attention';   -- a student-role account as a guardian
  end if;
  -- v_role in ('tutor','admin'): reuse as guardian, profile untouched.

  -- ── match a submission to a student (requirements FE-7) ───────
  -- The function signature also takes `p_student_email text default null`.
  --
  -- Step 1: exact student-email match against students.user_id → users.email
  --   → link this parent as a guardian of that student; status=updated.
  -- Step 2: this parent already actively guards a student with the same
  --   lower(btrim(name)) + DOB → update in place; status=updated.
  -- Step 3: a student with that name + DOB exists but neither (1) nor (2)
  --   holds → create NOTHING, status=needs_attention (student_id null);
  --   an admin links the guardian from Beheer.
  -- Step 4: no match → insert the student, then its guardian (same txn,
  --   the DEFERRABLE trigger order); status=enrolled.
  --
  -- See supabase/migrations/024_enrol_from_form.sql for the full body.

  return query select p_parent_id, v_student, v_parent_new, v_student_new, v_status;
end $$;

revoke all on function public.fn_enrol_from_form(uuid,text,text,text,text,date,text,text) from public, anon, authenticated;
grant execute on function public.fn_enrol_from_form(uuid,text,text,text,text,date,text,text) to service_role;
```

Notes:
- New students get `class_id = null` (R2) and `enrollment_date = current_date`
  (column default). `user_id` stays null — the optional student email is a
  **match key** (step 1), never written as a self-login link (requirements R9).
- The insert order (student, then its guardian, same txn) is exactly what the
  `DEFERRABLE` trigger is built to allow.
- `parent_created` in the result is what tells the Function whether to send the
  invitation email (FE-4).
- The RPC never calls GoTrue — `p_parent_id` is resolved by the Function first.

### 3.3 `dev-fixture.sql`

No change required — the fixture ships no enrolment data and the new table is
empty by default. pgTAP builds its own rows.

## 4. Function — `netlify/functions/enrol-from-form.mts` + `lib/enrolFromForm.ts`

### 4.1 Handler (`.mts`, thin — matches `reject-registration.mts`)

```ts
export default async (req: Request) => {
  if (req.method !== 'POST') return jsonError('Method not allowed', 405)

  const secretCheck = verifyWebhookSecret(req, 'ENROL_FORM_SECRET')   // see §4.3
  if (secretCheck) return secretCheck.error

  const svc = serviceClient()
  if ('error' in svc) return svc.error

  let body: unknown
  try { body = await req.json() } catch { return jsonError('Invalid JSON body', 400) }

  const result = await enrolFromForm(svc.client, body)
  if (!result.ok) return jsonError(result.error, result.status)
  return jsonOk(result.data, 201)
}
```

No `config.path` export (same reason as `invite-user.mts` / `health.mts`).

### 4.2 Core (`lib/enrolFromForm.ts`, unit-tested — the split every `.mts` uses)

Responsibilities:

1. **Validate** the payload → a typed `EnrolPayload`:
   `verified_email` (required, `EMAIL_RE`, lower-cased),
   `submitted_at` (ISO string → Date; default `new Date()`),
   `parent_name` (1–120, trimmed),
   `student_name` (1–120, trimmed),
   `date_of_birth` (`YYYY-MM-DD`, a real past date),
   `locale` (`'Bahasa Indonesia' | 'Nederlands' | 'id' | 'nl'` → `'id' | 'nl'`,
   default `'id'`),
   `relation` (optional, ≤40, else null),
   `student_email` (optional; passed to the RPC as a match key, and stored),
   `payment_answer` (optional, stored only),
   `consent` (accepts the checkbox's option text or boolean; **required truthy**
   — a missing/false consent is `400`, it is a form-level required question).
   A validation failure still writes an `enrolment_submissions` row with
   `status = 'error'` and the message, then returns `{ ok:false, status:400 }`
   (FE-5 — every submission is logged, success or failure).

2. **Resolve the parent `auth.users` id**:
   - `client.from('users').select('id, role').eq('email', email).maybeSingle()`
     → hit ⇒ use that id (the re-submission path; no GoTrue call).
   - miss ⇒ `client.auth.admin.createUser({ email, email_confirm: true })`.
     - success ⇒ new id, `parentAuthCreated = true`.
     - error `email_exists` ⇒ an `auth.users` row exists with no profile
       (a prior Google sign-in, or a past partial failure). We cannot look an
       auth user up by email with supabase-js. Log `status = 'needs_attention'`
       with a clear message ("account exists but is not registered — finish from
       Registrations") and return `{ ok:true, status:200 }` — mirrors
       `invite-user`'s own 409 and FE-10. Rare given R1 (families are new).
     - other error ⇒ `status = 'error'`, `{ ok:false, status:502 }`.

3. **`client.rpc('fn_enrol_from_form', { p_parent_id, p_parent_email,
   p_parent_name, p_locale, p_student_name, p_dob, p_relation })`**.
   RPC error ⇒ log `status = 'error'`, return `{ ok:false, status:500 }`.
   On success it returns one row `{ parent_user_id, student_id, parent_created,
   student_created, status }`.

4. **Invitation email** — only when `parent_created` **and** `parentAuthCreated`
   (a first-ever account): `invitationEmail({ role:'parent', locale, fullName:
   parent_name, email })` → `sendEmail(...)`. Never throws, never blocks; the
   result string goes into the response. Not sent on `updated` / on an
   already-existing account (FE-4).

5. **Log** the `enrolment_submissions` row with the final `status`
   (`enrolled` / `updated` / `needs_attention`), the two ids, `error = null`.

6. Return `{ ok:true, data: { status, parent_user_id, student_id,
   invitation_email } }`.

`RESULT` type: `{ ok:true; status:number; data:{…} } | { ok:false; status:number;
error:string }`.

### 4.3 One change to `lib/webhookAuth.ts`

`verifyWebhookSecret` currently hard-codes `process.env.NOTIFY_WEBHOOK_SECRET`.
Add an optional second parameter:

```ts
export function verifyWebhookSecret(
  req: Request,
  envVar: 'NOTIFY_WEBHOOK_SECRET' | 'ENROL_FORM_SECRET' = 'NOTIFY_WEBHOOK_SECRET',
): { error: Response } | null {
  const expected = process.env[envVar]
  if (!expected) {
    return { error: jsonError(`Server misconfigured: ${envVar} is not set`, 500) }
  }
  …unchanged (timing-safe compare)…
}
```

The existing five callers keep the default and are untouched. A **dedicated**
secret (not a reuse of `NOTIFY_WEBHOOK_SECRET`) so the Apps Script's key can be
rotated without touching the DB-webhook channel, and so a leak of one is not a
leak of both. Both are set in Netlify env; `ENROL_FORM_SECRET` is also stored in
the Apps Script's Script Properties.

## 5. Apps Script — `apps-script/enrol-from-form.gs` + `apps-script/README.md`

Committed as the reference implementation (version-controlled); installed
manually on the response sheet after the Function is deployed.

```
CONFIG (Script Properties): ENROL_ENDPOINT_URL, ENROL_FORM_SECRET
onFormSubmit(e):
  row = e.namedValues              // keyed by exact question title
  payload = {
    submitted_at:   e.namedValues['Timestamp']?.[0] || new Date().toISOString(),
    verified_email: e.namedValues['Email Address']?.[0],
    parent_name:    pick('Nama Orang Tua'),
    student_name:   pick('Nama siswa'),
    date_of_birth:  toISODate(pick('Tanggal lahir')),
    locale:         pick('Bahasa / Taal'),
    relation:       pick('Hubungan dengan siswa'),
    student_email:  pick('Email siswa (jika ada)'),
    payment_answer: pick(PAYMENT_Q_TITLE),
    consent:        pick(CONSENT_Q_TITLE),
  }
  res = UrlFetchApp.fetch(ENROL_ENDPOINT_URL, {
    method:'post', contentType:'application/json',
    headers:{ 'X-Webhook-Secret': ENROL_FORM_SECRET },
    payload: JSON.stringify(payload), muteHttpExceptions:true,
  })
  writeBack(e.range, res.getResponseCode(), parse(res).status, parse(res).error)

onOpen(): custom menu "Enrolment ▸ Re-process selected rows" → replays
          the selected sheet rows through the same POST (FE-11).
```

Question-title constants sit at the top of the file with a comment: **renaming a
form question breaks this** (requirements §4.2.9).

The README covers: create the script from `Extensions ▸ Apps Script` on the
sheet, set the two Script Properties, add an **installable** `onFormSubmit`
trigger (not the simple trigger — `UrlFetchApp` needs the auth scope), authorise,
and the ownership rule (org account, requirements §4.2.8).

## 6. `database.types.ts`

Regenerate with `supabase gen types typescript --local` after the migration, or
hand-add the two entries (`Tables.enrolment_submissions`,
`Functions.fn_enrol_from_form`). The Function's `serviceClient()` is
`createClient<Database>`, so the RPC name and args must be in the type for
`typecheck:functions` to pass.

## 7. Documentation changes (same PR — pr-conventions)

| File | Change |
|---|---|
| `docs/TAD-PPME-TPA.md` | **ADR-043** — full entry in the house style: the Form→Sheet→Apps Script→Function→RPC chain; (a) new RPC vs `fn_admin_save_student` and the `service_role` guard; (b) `enrolment_submissions` + its RLS; (c) idempotency key = verified email + name + DOB; (d) dedicated `ENROL_FORM_SECRET`; (e) email on first creation only; (f) class left null, payment ignored, student-email stored only; alternatives column (Zapier/Make rejected — new US processor; direct PostgREST writes rejected — the `DEFERRABLE` trigger; reusing `NOTIFY_WEBHOOK_SECRET` rejected). DPIA pointer. |
| `docs/PRD-PPME-TPA.md` | **FR-010: Form-Driven Enrolment** in §1.3 (the admin/attendance domain, after FR-009). |
| `docs/openapi.yaml` | `/enrol-from-form` path (POST, `X-Webhook-Secret`, request/response schema, `201` / `400` / `401` / `500`). `fn_enrol_from_form` noted as service-role-only, not a PostgREST route families use. |
| `docs/test-plan.md` | RLS-98… (see §8); a Function-level section for `enrol-from-form` mirroring the `invite-user` / `reject-registration` cases; E2E row as specified-but-pending (no auth Playwright harness). |
| `docs/dpia-draft.md` | Google Form + response sheet as a processing location; Apps Script as a component (runs in the org Workspace — no new processor); `enrolment_submissions` indefinite retention (R13) + it can hold a child's name + DOB + a guardian email; the consent checkbox as the consent record; `[IT TEAM]` note to add the form to the processing register. |
| `docs/privacy-policy-draft.md` | Both halves (nl + id): a short paragraph that enrolment data is collected via a Google Form and used to create the family's account; renumber if a new section. |
| `docs/PPME-TPA-Development-Checklist.md` | Suggested Build Order status note updated. |
| `README.md` | `ENROL_FORM_SECRET` in the env var list; pointer to `apps-script/README.md`. |
| `docs/requirements-form-enrolment.md` | already present; mark "design complete". |

## 8. Test cases (full list in `docs/test-plan.md`; implemented this PR)

### 8.1 pgTAP — appended to `supabase/tests/database/rls.test.sql` (RLS-98…)

- **RLS-98** a non-service caller (`authenticated` admin) calling
  `fn_enrol_from_form` gets `insufficient_privilege` — the `auth.role()` guard.
- **RLS-99** `enrolment_submissions` is invisible to a tutor, a parent, a
  student and `anon` (0 rows), visible in full to an admin.
- **RLS-100** `enrolment_submissions` insert/update by `authenticated` is
  refused (service-role-only write policy).
- **RLS-101** `fn_enrol_from_form` as `service_role`, new family: creates the
  `users` row (`role = 'parent'`), the `students` row (`class_id` null,
  `enrollment_date = today`), one active `student_guardians` link;
  `status = 'enrolled'`, `parent_created`, `student_created` all true.
- **RLS-102** same call again (idempotency): no new rows, `students.full_name`
  refreshed in place, same ids, `status = 'updated'`, both `*_created` false.
- **RLS-103** a second child for the same parent: new `students` row, second
  active link for that parent, parent `users` row untouched, `parent_created`
  false / `student_created` true.
- **RLS-104** `p_parent_id` already a `tutor`: reused as guardian, `users.role`
  stays `tutor`, name/locale **not** overwritten (ADR-024).
- **RLS-105** the "at least one guardian" invariant still holds — the RPC's
  student insert without a following guardian insert would fail at commit
  (proved by a direct `insert into students` in a sub-transaction throwing).
- **RLS-106** cross-family isolation re-proven: the parent from RLS-101 cannot
  read another family's `students` / `attendance` rows (the ADR-040 negative,
  with a form-created family).
- **RLS-107** a submission carrying an existing student's login email
  (`p_student_email`) links the submitting parent as a guardian of that student —
  `status = updated`, no duplicate `students` row.
- **RLS-108** a submitter matching only name + DOB (not a guardian, no email
  match) → `status = needs_attention`, no guardian link and no student row
  created.

### 8.2 Vitest — `tests/unit/enrolFromForm.test.ts` (mocked Supabase client)

- payload parser: locale mapping (`'Nederlands'` → `'nl'`, missing → `'id'`);
  DOB rejects non-dates and future dates; names trimmed + length-capped;
  consent falsy → `400`; email normalised to lower-case.
- new family → `createUser` called, `rpc` called with mapped args, invitation
  email sent, `enrolment_submissions` row `status = 'enrolled'`.
- existing `public.users` by email → `createUser` **not** called, no invite
  email, `status` from the RPC.
- `createUser` returns `email_exists`, no profile → `status = 'needs_attention'`,
  `{ ok:true }`, no throw.
- RPC error → `status = 'error'` row written, `{ ok:false, status:500 }`.
- `sendEmail` failure → still `{ ok:true }`, `invitation_email` reflects it.

### 8.3 Vitest — `verifyWebhookSecret` (extend `tests/unit/functionAuth.test.ts`)

- `ENROL_FORM_SECRET` unset → `500`; wrong secret → `401`; length mismatch →
  `401` (no throw); correct → `null`. Existing `NOTIFY_WEBHOOK_SECRET` cases
  unchanged.

### 8.4 Live (per pr-conventions — real Postgres + `netlify dev`)

Local Supabase + `netlify dev`, POST real payloads with the secret:
new family; exact re-submission; second child; typed locale `Nederlands`;
missing consent; bad secret; malformed JSON. Confirm the `users` / `students` /
`student_guardians` / `enrolment_submissions` rows and the invitation email in
the Resend dashboard (or the mailpit stub). Re-confirm cross-family isolation
live with a form-created family. Zero unexpected console errors / failed
requests.

### 8.5 E2E

`test-plan.md` gets an `E2E-…` row for "form submission → account usable" marked
**specified, pending** — no authenticated Playwright harness in this repo.

## 9. Scope

One PR: migration + Function + lib + Apps Script (reference) + unit + pgTAP +
all docs. It is large but cohesive — every piece is the one enrolment path and
nothing here is independently shippable. The only part that cannot be
CI-verified is the Apps Script install itself (manual, in Google, after deploy);
that is an ops step on the go-live checklist, not a code deliverable, and the
`.gs` is in the repo as the source of truth for it.

**Post-merge ops (not in the PR):** set `ENROL_FORM_SECRET` in Netlify env;
after deploy, create the bound Apps Script on the sheet, set its Script
Properties, add the installable trigger, submit one test row, delete it.

## 10. Risks / accepted limitations

- **A second guardian submitting, or a corrected student name** — where the
  submitter neither supplied the child's login email nor already guards a
  name+DOB match — is **not** auto-linked; it returns `needs_attention` and an
  admin links the guardian (or creates the student) from Beheer. Deliberate:
  auto-linking on name+DOB alone could attach a stranger to another family's
  identically-named child. Visible only on the sheet's Status/Error columns (R4).
- **`email_exists` with no profile** is not auto-resolved (§4.2 step 2).
  Accepted for v1 (rare under R1); admin finishes via Registrations.
- **Apps Script fragility on question rename** — mitigated by the title
  constants + comment + the README, not by code.
- **Self-reported consent** — the checkbox is required at the form level; the
  Function also rejects a falsy value. No stronger proof is attempted.
- **Rate limiting** — `RateLimiter` guards a warm instance only (its own ADR-015
  caveat). Adequate for a form that submits a few dozen times a year.
