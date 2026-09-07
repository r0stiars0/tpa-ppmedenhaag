# Requirements — Automatic enrolment from the Google re-registration form

**Status:** DRAFT — awaiting sign-off
**Feature branch (to be cut from `main`):** `feature/form-enrolment`
**Proposed ADR:** ADR-043 (`docs/TAD-PPME-TPA.md`)
**Related existing decisions:** ADR-018 (branded invite email), ADR-024 (a tutor/admin may also be a parent), ADR-026 (invite without GoTrue's own email), ADR-032 (link a self-login account to a student created earlier), ADR-038/039 (registration requests + admin reject), ADR-040 (`student_guardians`, `fn_admin_save_student`)

---

## 1. Goal

Let PPME Den Haag collect the 2026–2027 TPA re-registration ("Daftar Ulang")
through an existing Google Form and have each submission **create the parent
account, the student record, and the guardian link automatically**, so an admin
does not re-type every family by hand. The families are **not yet in the app** —
this is a first-time bulk load, then a trickle.

## 2. Scope

**In scope**

- A Google Apps Script bound to the form's response sheet, firing on each
  submission.
- A new Netlify Function `enrol-from-form` that provisions the accounts and
  records the outcome.
- A new `enrolment_submissions` table: one row per processed submission, its
  status, and the ids it created — the admin's audit/troubleshooting view.
- Reuse of the existing branded bilingual invite email (ADR-018) for the parent.
- Documentation updates in the same PR (ADR-043, PRD FR entry, `openapi.yaml`,
  `test-plan.md`, `dpia-draft.md`, `privacy-policy-draft.md`).

**Out of scope**

- Class ("Grup") assignment — left null; an admin assigns it afterwards in the
  existing admin UI.
- Payment. The form's payment question is **not forwarded or stored** by the
  automation (payment/fee management is out of PRD Phase 1 scope); the treasurer
  reconciles €40/student against the ING account separately.
- Any change to the sign-in / OAuth flow itself.
- A CSV bulk-import screen (possible future; not this feature).

## 3. Actors

| Actor | Role in this feature |
|---|---|
| Parent / guardian | Fills the form once per child, signed in to Google (verified email). |
| Apps Script (service identity) | Bound to the sheet; posts each new row to the Function. |
| `enrol-from-form` Function | Provisions parent + student + guardian; sends the invite email; writes the log row. |
| Admin | Reviews `enrolment_submissions`, assigns Grup, fixes flagged rows, links 16+ logins. |
| Treasurer | Reconciles payments outside the app. |

## 4. The Google Form

### 4.1 Final field inventory

| Sheet column | Question (verbatim title required) | Type | Required | Used for |
|---|---|---|---|---|
| Timestamp | — | auto | — | log |
| Email Address | — (verified collection) | auto | — | **parent identity**; becomes `users.email` |
| Nama siswa | `Nama siswa` | Short answer | Yes | `students.full_name` |
| Tanggal lahir | `Tanggal lahir` | Date | Yes | `students.date_of_birth` |
| Email siswa (jika ada) | `Email siswa (jika ada)` | Short answer | No | links/provisions the student self-login (FE-7a) + stored in log |
| Nama Orang Tua | `Nama Orang Tua` | Short answer | Yes | parent `users.full_name` |
| *(payment)* | short, stable title — e.g. `Sudah melakukan pembayaran?` | Multiple choice `Ya` / `Tidak` | Yes | **not forwarded or stored** — payment is out of scope (PRD) |
| *(new)* language | e.g. `Bahasa / Taal` | Multiple choice `Bahasa Indonesia` / `Nederlands` | Yes | `users.locale` = `id` / `nl` |
| *(new)* relationship | e.g. `Hubungan dengan siswa` | Multiple choice `Ayah` / `Ibu` / `Wali` / `Lainnya` | **No** (optional) | `student_guardians.relation` (nullable) |
| *(new)* consent | e.g. `Saya telah membaca kebijakan privasi` | Checkbox (single) | Yes | stored in log; **plain text, no link** (policy not yet published) |

### 4.2 Form changes required before go-live

1. **Settings → Responses:** Collect email addresses = **Verified** (done),
   Allow response editing = On (done), Limit to 1 response = Off (done).
2. **Move the payment amount and both ING links into the section description**;
   give the payment question a short, stable title. The full current title
   (label + links) would become an unwieldy, fragile sheet-column header.
3. **Add** the three new questions above.
4. **Remove the `Email Orang Tua` question** — the verified email (Email Address)
   is the parent identity, so a typed parent-email field is redundant.
5. **Add a form description:** "Isi formulir ini satu kali untuk setiap anak /
   Vul dit formulier één keer in per kind."
6. **Settings → Presentation:** custom confirmation message telling the parent an
   invitation email will follow; "Show link to submit another response" = On.
7. **Responses → Link to Sheets:** done — sheet `… (Responses)` exists,
   `Form_Responses` tab.
8. **Ownership:** the form *and* the response sheet must be owned by an
   org-controlled Google account (not a volunteer's personal account) — the
   Apps Script, its trigger, and the shared secret live there.
9. **Do not rename questions after go-live** — the Apps Script matches by title.

## 5. Functional requirements

- **FE-1** On each new form submission, the system SHALL create (or update — see
  FE-7) exactly one parent account and one student record, linked as guardian.
- **FE-2** The parent account SHALL be provisioned exactly as `invite-user` does
  it: `auth.users` row with `email_confirm: true`, then a `public.users` row with
  `role = 'parent'`, `full_name` from *Nama Orang Tua*, `locale` from the
  language answer. A later Google sign-in with the **verified** email links to
  this row by email match.
- **FE-3** The student SHALL be created via a dedicated definer RPC (see §7):
  `full_name`, `date_of_birth`, `class_id = null`, one guardian = the parent
  account with `relation` from the relationship answer. `user_id` stays null
  unless "Email siswa" provisions a self-login (FE-7a).
- **FE-4** When the parent account is **newly created**, the system SHALL send
  the existing branded parent invitation email (ADR-018) in the chosen locale.
  It SHALL NOT resend on a repeat/updated submission or when the parent account
  already existed.
- **FE-5** Every submission — success or failure — SHALL write one
  `enrolment_submissions` row capturing the raw answers, the verified email, the
  created `parent_user_id` / `student_id`, a status (`enrolled` / `updated` /
  `needs_attention` / `error`), and any error message. `needs_attention` is for
  processed-but-review cases (e.g. the verified email already belongs to a
  `student`-role account, or more than one existing student matched).
- **FE-6** The Apps Script SHALL write the outcome back to the sheet row (a
  `Status` column and, on failure, an `Error` column), so the admin can see
  progress in the sheet itself.
- **FE-7 (matching a submission to a student record)** The automation SHALL
  resolve the student record in this order:
  1. **Guardian + name + DOB** — the submitting guardian already actively guards
     a student with the same trimmed case-insensitive name and the same date of
     birth: update that student in place, keeping the ids. `status = updated`.
  2. **Name + DOB only** — a student with that name and DOB exists but (1) does
     not hold (typically a second guardian, or a child linked to the other
     parent). The automation SHALL create **nothing** and set
     `status = needs_attention`; a TPA admin links the guardian from Beheer, or
     confirms it is a different child. The outcome shows only on the sheet's
     Status/Error columns (R4).
  3. **No match** — create the student and the guardian link. `status = enrolled`.
  A repeat SHALL NOT create duplicates or resend the invite. Auto-linking on
  name + DOB alone is deliberately not done. `users.full_name` / `users.locale`
  are still refreshed from the latest submission when the guardian account
  already exists.
- **FE-7a (student self-login, PRD #10)** When "Email siswa" is filled and is not
  the guardian's own address, the automation SHALL, in addition to FE-7:
  - if the address is a registered account whose `role` is not `student` (a
    parent/tutor/admin address) → `status = needs_attention`, and that account
    SHALL NOT be modified;
  - if it is a registered `role = student` account already linked to a student
    whose name matches the submission → add the submitting guardian to *that*
    student (`status = updated`); name differs → `status = needs_attention`;
  - if it is a registered `role = student` account **not** yet linked to any
    student, and its profile name matches the submission → link it to the
    student record from FE-7; name differs → `status = needs_attention`;
  - if it is an `auth.users` row with no profile (a prior sign-in) or a fresh
    address → create a `role = student` profile, set `students.user_id`, and send
    the **student** the branded `role = student` invitation.
  There SHALL be **no age gate** (ADR-021 — `date_of_birth` is never gated on;
  Google's sign-in age check is the only threshold). The form's required consent
  tick is the guardian's basis (PRD #10). A mistyped address that only leaves an
  unregistered `auth.users` row is the `invite-user` partial-failure shape
  (FE-10).
- **FE-8** A parent whose verified email already belongs to a `tutor` or `admin`
  account SHALL be reused as the guardian (ADR-024); the automation SHALL NOT
  change that account's role.
- **FE-9** The parent email is the **verified** email (Email Address) only —
  there is no typed parent-email field to reconcile.
- **FE-10** Processing SHALL be resilient to partial failure in the same spirit
  as `invite-user`: a created `auth.users` row with no profile falls back to the
  existing `fn_pending_registrations()` path rather than becoming a stuck or
  duplicate account.
- **FE-11** The admin SHALL be able to re-process a sheet row manually (an Apps
  Script menu item) after fixing data or a transient outage.
- **FE-12** The `enrol-from-form` endpoint SHALL reject any request without the
  correct shared secret (reuse `lib/webhookAuth.ts`), and SHALL be rate-limited
  (reuse `lib/rateLimit.ts`).

## 6. Data-model impact

- **New table `enrolment_submissions`** (migration on `main`): admin-only
  `select`, service-role `insert`/`update`; mirrors `registration_requests`
  RLS shape. Columns: `id`, `submitted_at`, `verified_email`, `student_name`,
  `date_of_birth`, `parent_name`, `locale`, `relation`, `student_email`,
  `consent bool`, `parent_user_id`, `student_id`, `status`,
  `error`, `created_at`.
- **No change** to `users`, `students`, `student_guardians`, `classes`.
- Possibly **one new SECURITY DEFINER RPC** (`fn_enrol_from_form` or an
  extension of `fn_admin_save_student`) — see §7 / Open Decision handled in
  design.

## 7. Component sketch (for the design phase, not for sign-off detail)

1. **Apps Script** (bound to the sheet): installable `onFormSubmit` trigger →
   builds a JSON payload keyed by question title → `UrlFetchApp` POST to
   `/.netlify/functions/enrol-from-form` with `X-Webhook-Secret` → writes
   `Status`/`Error` back to the row. Plus a custom menu "Re-process selected
   rows".
2. **`enrol-from-form.mts`** (Netlify Function, service-role, branched from
   `main`): validate secret + payload → resolve/create parent `auth.users` via
   the GoTrue admin API → call a definer RPC that does the profile insert +
   student upsert + guardian link **in one transaction** (needed because the
   `student_guardians` "at least one guardian" trigger is `DEFERRABLE` and a
   two-HTTP-call insert cannot satisfy it) → send invite email on first creation
   → insert the `enrolment_submissions` row → return `{ status, parent_user_id,
   student_id, error? }`.
3. **Migration** on `main`: `enrolment_submissions` + the definer RPC + its
   pgTAP coverage.

## 8. Security & privacy

- New external ingestion path into children's data → **DPIA update required**
  (`dpia-draft.md`): the Google Form + response sheet as a processing location,
  the Apps Script as a component, **indefinite retention** of
  `enrolment_submissions` (R13), and the consent record. Google is already a
  listed processor (OAuth); no *new* third-party processor is introduced (Apps
  Script runs in the org's Google Workspace).
- **Privacy policy** (`privacy-policy-draft.md`, both language halves): describe
  that enrolment data is collected via a Google Form and used to create the
  account.
- Shared secret in Netlify env + Apps Script Script Properties; rotatable.
- The Function is the trust boundary — the Apps Script is treated as untrusted
  input; all validation happens server-side.
- Cross-family isolation is unaffected (no RLS policy changes to family-facing
  tables) but MUST still be re-confirmed live per project convention.

## 9. Resolved decisions (from requirements discussion)

| # | Decision |
|---|---|
| R1 | Create-only load; families are not yet in the app. |
| R2 | Grup/class assignment is left to the admin; automation sets `class_id = null`. |
| R3 | The parent invite email is sent **immediately** on account creation. |
| R4 | A per-submission `enrolment_submissions` log + sheet write-back is included (not silent auto-create). |
| R5 | Re-submission of the same (verified email + student name + DOB) **updates in place, keeps ids**. |
| R6 | Payment is out of scope (PRD Scope Boundaries). The form asks a confirmation question with a bank link; the Apps Script does **not** forward it and nothing is stored. The treasurer reconciles against the bank. |
| R7 | Deploy path: a new Netlify Function on a branch off `main`, shipped by merge (Netlify auto-deploys from `main`). |
| R8 | Transport: Google Apps Script `onFormSubmit`, authenticated to the Function with a shared secret. |
| R9 | The optional student email links or provisions the student's own `role=student` self-login from the form (FE-7a) — no age gate (ADR-021), the form's required consent tick is the guardian's basis (PRD #10). It is also stored in the log. |
| R10 | Consent question: keep the checkbox, **plain text, no hyperlink** (the privacy policy is not published publicly yet). |
| R11 | Relationship question: **optional**, options `Ayah` / `Ibu` / `Wali` / `Lainnya`, maps to `student_guardians.relation` (nullable). |
| R12 | On a failed submission the sheet `Status`/`Error` column is sufficient — **no admin email**. |
| R13 | `enrolment_submissions` rows are **kept indefinitely** as the enrolment audit record (recorded in the DPIA). |

## 10. Open decisions

All resolved — see R10–R13 above. Ready for sign-off.

## 11. Verification (per project convention)

- Vitest unit tests for the payload parser / idempotency-key logic / email-match
  check.
- pgTAP: `enrolment_submissions` RLS (admin-only read, service-role write; no
  family leakage), the definer RPC's admin/service-role guard, the
  "guardian-less student impossible" invariant still holds.
- i18n parity for any new strings (invite email already covers `id`/`nl`).
- Typecheck + build.
- Live: local Supabase stack + `netlify dev`, POST real payloads with the shared
  secret — new family, repeat submission, typed/verified email mismatch, bad
  secret, malformed payload — and confirm the created rows and the invite email.
- Cross-family isolation re-confirmed live.
- E2E: written into `test-plan.md` as specified-but-pending (no authenticated
  Playwright harness in this repo).
- Manual click-through of the Apps Script against the real form in a test
  environment.

---

*Sign-off:* reply "signed off" (with any changes to §10) to proceed to design +
test cases.
