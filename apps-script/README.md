# Apps Script — "Daftar Ulang" enrolment bridge

`enrol-from-form.gs` is a container-bound Google Apps Script that lives on the
re-registration form's **response spreadsheet**. On each submission it POSTs the
row to the `enrol-from-form` Netlify Function, which creates the family's
accounts (TAD ADR-043, PRD FR-010).

This file is version-controlled here as the source of truth. It is **installed
by hand** — nothing in CI or the Netlify build touches it.

## Prerequisites

1. The `enrol-from-form` Function is deployed (merge to `main` → Netlify
   auto-deploy).
2. `ENROL_FORM_SECRET` is set in **Netlify → Site settings → Environment
   variables** to a long random value. Generate one with e.g.
   `openssl rand -hex 32`.
3. The form has "Collect email addresses → **Verified**" on, and the question
   titles match the `Q` constants at the top of `enrol-from-form.gs`. If a
   question is renamed on the form, update that constant in the same change.

## Ownership

The form **and** its response spreadsheet must be owned by an
organisation-controlled Google account, not a volunteer's personal one — the
script, its trigger and the stored secret all live on the spreadsheet and must
survive someone leaving (requirements §4.2.8).

## Install

1. Open the response spreadsheet → **Extensions ▸ Apps Script**.
2. Replace the contents of `Code.gs` with `enrol-from-form.gs` from this folder.
   Save.
3. **Project Settings ▸ Script properties** → add:
   | Property | Value |
   |---|---|
   | `ENROL_ENDPOINT_URL` | `https://tpa.ppmedenhaag.nl/.netlify/functions/enrol-from-form` |
   | `ENROL_FORM_SECRET` | the same value set in Netlify |
4. **Triggers** (clock icon) → **Add trigger**:
   - Function: `onFormSubmitInstallable`
   - Event source: **From spreadsheet**
   - Event type: **On form submit**
   - Save, and complete the Google authorisation prompt (it needs
     "Connect to an external service" for `UrlFetchApp`).
5. Reload the spreadsheet once so the **Enrolment** menu appears (from
   `onOpen`).

## Verify

Submit one test response (a throwaway name + a real address you control). Within
a few seconds the sheet row should show `Enrolment status = enrolled` and an
invitation e-mail should arrive. Check the new rows in the app's admin area
(`enrolment_submissions`, and the student under Beheer). Delete the test student,
guardian, `enrolment_submissions` row and the auth account afterwards.

## Day-to-day

- **A row shows `error` / `needs_attention`:** read the `Enrolment error`
  column. Fix the data in the row (or the account), then **Enrolment ▸
  Re-process selected rows**.
- **Rotating the secret:** set the new value in Netlify env first, redeploy,
  then update the `ENROL_FORM_SECRET` script property. A mismatch returns
  `HTTP 401` on every row until both sides agree.
- **`class_id` is deliberately left empty.** An admin assigns the Grup in Beheer
  after enrolment (requirements R2).
- **Payment is out of scope.** The `Sudah melakukan pembayaran?` answer is **not
  forwarded** by this script and nothing is stored — the form asks families to
  pay via the ING link and the treasurer reconciles it separately (PRD Scope
  Boundaries, requirements R6). The `Q` map above intentionally has no payment
  entry.
- **Student self-login.** If a row's `Email siswa (jika ada)` is filled, the
  Function links the student's existing `role=student` account (adding this
  guardian) or, for a new/unregistered address, creates the account and e-mails
  the student (PRD #10). A `needs_attention` on such a row usually means the
  address belongs to a non-student account, or the name does not match — an
  admin resolves it in Beheer.
