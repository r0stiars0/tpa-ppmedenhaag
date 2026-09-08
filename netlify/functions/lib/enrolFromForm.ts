import type { Database } from '../../../src/lib/database.types'
import type { ServiceClient } from './callerAuth'
import { sendEmail } from './email'
import { invitationEmail } from './emailTemplates'

type EnrolSubmissionInsert = Database['public']['Tables']['enrolment_submissions']['Insert']

/**
 * Enrolling a family from the "Daftar Ulang" Google Form (TAD ADR-043,
 * PRD FR-010) — the core, split out of `enrol-from-form.mts` for the
 * reason every `.mts` handler in this repo is a thin shell: nothing
 * unit-tests a handler directly, so the logic that matters lives here.
 *
 * The chain is Form → response sheet → a bound Apps Script → this. The
 * Apps Script proves the channel with `ENROL_FORM_SECRET` (handled in
 * `enrol-from-form.mts` via `verifyWebhookSecret`); everything here runs
 * on the service-role client and owns its own decisions.
 *
 * Two halves, because GoTrue has no SQL API:
 *
 *   1. resolve or create the **parent's** `auth.users` row — by e-mail
 *      lookup on `public.users` first (the re-submission path, no GoTrue
 *      call), else `auth.admin.createUser` exactly as `invite-user` does.
 *      When "Email siswa" is given, the same two-step is done for the
 *      **student** (PRD #10 self-login): look it up, else createUser; a
 *      brand-new id is passed to the RPC as `p_student_auth_id`.
 *   2. `fn_enrol_from_form` (migration 024) writes the profile(s), the
 *      student and the guardian link in one transaction — one call,
 *      because migration 021's `DEFERRABLE` guardian invariant needs the
 *      student and its first guardian in the same transaction. It also
 *      decides what the student e-mail resolves to and returns
 *      `student_account_created` so this half knows whether to send the
 *      student their invitation.
 *
 * Every submission is logged to `enrolment_submissions` — success,
 * `needs_attention`, or a validation/processing failure. The branded
 * invitation e-mail (ADR-018) goes out only when a brand-new account was
 * created; a mail failure never fails the enrolment, the `sendEmail`
 * contract.
 *
 * The form's payment question is deliberately neither sent nor stored —
 * payment/fee management is out of scope (PRD Scope Boundaries). The
 * privacy-policy consent tick is **recorded** on the log row when given
 * but is **not required** — a submission without it still enrols
 * (TAD ADR-044).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export type EnrolStatus = 'enrolled' | 'updated' | 'needs_attention' | 'error'

export interface EnrolResponseData {
  status: EnrolStatus
  parent_user_id: string | null
  student_id: string | null
  /** parent `EmailResult['status']`, or null when no invitation was due. */
  invitation_email: string | null
  /** student `EmailResult['status']`, or null when no self-login was provisioned. */
  student_invitation_email: string | null
}

export type EnrolResult =
  | { ok: true; status: number; data: EnrolResponseData }
  | { ok: false; status: number; error: string }

/** The shape the Apps Script POSTs — every field a string or absent. */
interface RawPayload {
  submitted_at?: unknown
  verified_email?: unknown
  parent_name?: unknown
  student_name?: unknown
  date_of_birth?: unknown
  locale?: unknown
  relation?: unknown
  student_email?: unknown
  consent?: unknown
}

interface Parsed {
  submitted_at: string | null
  verified_email: string
  parent_name: string
  student_name: string
  date_of_birth: string
  locale: 'id' | 'nl'
  relation: string | null
  student_email: string | null
  consent: boolean
}

function str(v: unknown): string {
  if (typeof v === 'string') return v
  // Apps Script `e.namedValues` values are arrays; the Script flattens
  // them, but tolerate an array here too.
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0]
  return ''
}

function truthyConsent(v: unknown): boolean {
  if (v === true) return true
  const s = str(v).trim().toLowerCase()
  return s !== '' && s !== 'false' && s !== 'no' && s !== 'tidak' && s !== 'nee' && s !== '0'
}

function normaliseLocale(v: unknown): 'id' | 'nl' {
  const s = str(v).trim().toLowerCase()
  if (s === 'nl' || s.startsWith('neder') || s.startsWith('dutch')) return 'nl'
  return 'id'
}

/** `YYYY-MM-DD` for a real, non-future date, or null. */
function normaliseDob(v: unknown): string | null {
  const s = str(v).trim()
  if (!s) return null
  let iso: string
  if (ISO_DATE_RE.test(s)) {
    iso = s
  } else {
    // A locale-formatted fallback (the Apps Script normally sends ISO).
    // Read the *calendar* parts the parser landed on — never via
    // toISOString(), which would shift "3/4/2016" across a day boundary
    // in any timezone ahead of UTC.
    const d = new Date(s)
    if (Number.isNaN(d.getTime())) return null
    iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  if (d.getUTCFullYear() < 1900) return null
  if (d.getTime() > Date.now()) return null
  return iso
}

type ParseOutcome = { ok: true; value: Parsed } | { ok: false; error: string; partial: Partial<Parsed> }

export function parseEnrolPayload(body: unknown): ParseOutcome {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Body must be a JSON object', partial: {} }
  }
  const raw = body as RawPayload

  const verified_email = str(raw.verified_email).trim().toLowerCase()
  const parent_name = str(raw.parent_name).trim()
  const student_name = str(raw.student_name).trim()
  const dob = normaliseDob(raw.date_of_birth)
  const submitted_at = (() => {
    const s = str(raw.submitted_at).trim()
    if (!s) return null
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  })()
  const locale = normaliseLocale(raw.locale)
  const relationRaw = str(raw.relation).trim()
  const relation = relationRaw && relationRaw.length <= 40 ? relationRaw : null
  // "Email siswa" is optional and free text — a guardian may type "-" /
  // "tidak ada" there. A non-empty value that is not e-mail-shaped is
  // treated as absent (enrol guardian-only) rather than failing the whole
  // enrolment when `createUser` later rejects it.
  const studentEmailRaw = str(raw.student_email).trim().toLowerCase()
  const student_email = studentEmailRaw && EMAIL_RE.test(studentEmailRaw) ? studentEmailRaw : null
  const consent = truthyConsent(raw.consent)

  const partial: Partial<Parsed> = {
    submitted_at,
    verified_email: verified_email || undefined,
    parent_name: parent_name || undefined,
    student_name: student_name || undefined,
    date_of_birth: dob ?? undefined,
    locale,
    relation,
    student_email,
    consent,
  }

  if (!EMAIL_RE.test(verified_email)) {
    return { ok: false, error: 'A valid verified_email is required', partial }
  }
  if (!parent_name || parent_name.length > 120) {
    return { ok: false, error: 'parent_name is required (1–120 chars)', partial }
  }
  if (!student_name || student_name.length > 120) {
    return { ok: false, error: 'student_name is required (1–120 chars)', partial }
  }
  if (!dob) {
    return { ok: false, error: 'date_of_birth must be a real, non-future date', partial }
  }
  // `consent` is recorded, not required (TAD ADR-044): the enrolment's
  // lawful basis is the educational relationship / legitimate interest,
  // and the form tick is a signal captured when given, not a gate.

  return {
    ok: true,
    value: {
      submitted_at,
      verified_email,
      parent_name,
      student_name,
      date_of_birth: dob,
      locale,
      relation,
      student_email,
      consent,
    },
  }
}

/** Best-effort audit write — a failed log must not fail an enrolment. */
async function writeLog(client: ServiceClient, row: EnrolSubmissionInsert): Promise<void> {
  const { error } = await client.from('enrolment_submissions').insert(row)
  if (error) {
    console.error(`enrol-from-form: could not write enrolment_submissions row (${error.message})`)
  }
}

type LogFields = Pick<
  EnrolSubmissionInsert,
  | 'submitted_at'
  | 'verified_email'
  | 'parent_name'
  | 'student_name'
  | 'date_of_birth'
  | 'locale'
  | 'relation'
  | 'student_email'
  | 'consent'
>

function logFieldsFrom(p: Partial<Parsed>): LogFields {
  return {
    submitted_at: p.submitted_at ?? null,
    verified_email: p.verified_email ?? null,
    parent_name: p.parent_name ?? null,
    student_name: p.student_name ?? null,
    date_of_birth: p.date_of_birth ?? null,
    locale: p.locale ?? null,
    relation: p.relation ?? null,
    student_email: p.student_email ?? null,
    consent: p.consent ?? null,
  }
}

interface EnrolRpcRow {
  parent_user_id: string
  student_id: string
  parent_created: boolean
  student_created: boolean
  student_account_created: boolean
  status: EnrolStatus | null
}

export async function enrolFromForm(client: ServiceClient, body: unknown): Promise<EnrolResult> {
  // ── 1. validate ───────────────────────────────────────────────
  const parsed = parseEnrolPayload(body)
  if (!parsed.ok) {
    await writeLog(client, {
      ...logFieldsFrom(parsed.partial),
      parent_user_id: null,
      student_id: null,
      status: 'error',
      error: parsed.error,
    })
    return { ok: false, status: 400, error: parsed.error }
  }
  const p = parsed.value
  const logBase = logFieldsFrom(p)

  // ── 2. resolve the parent auth.users id ───────────────────────
  const { data: existing, error: lookupError } = await client
    .from('users')
    .select('id, role')
    .eq('email', p.verified_email)
    .maybeSingle()
  if (lookupError) {
    await writeLog(client, { ...logBase, parent_user_id: null, student_id: null, status: 'error', error: lookupError.message })
    return { ok: false, status: 500, error: lookupError.message }
  }

  let parentId: string
  let parentAuthCreated = false
  if (existing) {
    parentId = existing.id
  } else {
    const { data: created, error: createError } = await client.auth.admin.createUser({
      email: p.verified_email,
      email_confirm: true,
    })
    if (createError || !created?.user) {
      // An auth.users row exists for this e-mail but has no profile — a
      // prior Google sign-in, or a past partial failure. supabase-js
      // cannot look an auth user up by e-mail, so this is left for an
      // admin to finish from Registrations. Rare — the families are new
      // to the app.
      if (createError?.code === 'email_exists') {
        await writeLog(client, {
          ...logBase,
          parent_user_id: null,
          student_id: null,
          status: 'needs_attention',
          error: 'An account for this e-mail exists but is not registered — finish it from Registrations.',
        })
        return {
          ok: true,
          status: 200,
          data: {
            status: 'needs_attention',
            parent_user_id: null,
            student_id: null,
            invitation_email: null,
            student_invitation_email: null,
          },
        }
      }
      const message = createError?.message ?? 'Could not create the parent account'
      await writeLog(client, { ...logBase, parent_user_id: null, student_id: null, status: 'error', error: message })
      return { ok: false, status: 502, error: message }
    }
    parentId = created.user.id
    parentAuthCreated = true
  }

  // ── 2b. resolve the student auth.users id, if an e-mail was given ──
  // Only when it differs from the parent's own address. A miss on
  // `public.users` → createUser (the `invite-user` shape); an
  // `email_exists` there means an auth row exists with no profile, which
  // the RPC resolves itself via `auth.users`. No age gate (ADR-021), and
  // the form consent tick is recorded, not required (ADR-044).
  let studentAuthId: string | undefined
  if (p.student_email && p.student_email !== p.verified_email) {
    const { data: stuProfile, error: stuLookupError } = await client
      .from('users')
      .select('id')
      .eq('email', p.student_email)
      .maybeSingle()
    if (stuLookupError) {
      await writeLog(client, { ...logBase, parent_user_id: parentId, student_id: null, status: 'error', error: stuLookupError.message })
      return { ok: false, status: 500, error: stuLookupError.message }
    }
    if (!stuProfile) {
      const { data: stuCreated, error: stuCreateError } = await client.auth.admin.createUser({
        email: p.student_email,
        email_confirm: true,
      })
      if (stuCreateError && stuCreateError.code !== 'email_exists') {
        const message = stuCreateError.message ?? 'Could not create the student account'
        await writeLog(client, { ...logBase, parent_user_id: parentId, student_id: null, status: 'error', error: message })
        return { ok: false, status: 502, error: message }
      }
      if (stuCreated?.user) studentAuthId = stuCreated.user.id
      // email_exists → leave undefined; the RPC looks it up in auth.users.
    }
    // an existing public.users row → leave undefined; the RPC reads its role/link.
  }

  // ── 3. the one-transaction upsert ─────────────────────────────
  const { data: rpcData, error: rpcError } = await client.rpc('fn_enrol_from_form', {
    p_parent_id: parentId,
    p_parent_email: p.verified_email,
    p_parent_name: p.parent_name,
    p_locale: p.locale,
    p_student_name: p.student_name,
    p_dob: p.date_of_birth,
    p_relation: p.relation ?? undefined,
    p_student_email: p.student_email ?? undefined,
    p_student_auth_id: studentAuthId,
  })
  if (rpcError) {
    await writeLog(client, { ...logBase, parent_user_id: parentId, student_id: null, status: 'error', error: rpcError.message })
    return { ok: false, status: 500, error: rpcError.message }
  }
  const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as EnrolRpcRow | undefined
  if (!row) {
    const message = 'fn_enrol_from_form returned no row'
    await writeLog(client, { ...logBase, parent_user_id: parentId, student_id: null, status: 'error', error: message })
    return { ok: false, status: 500, error: message }
  }
  const status: EnrolStatus = row.status ?? (row.student_created ? 'enrolled' : 'updated')

  // ── 4. invitation e-mail — only for a brand-new account ──────
  let invitationEmailStatus: string | null = null
  if (row.parent_created && parentAuthCreated) {
    const invitation = invitationEmail({
      role: 'parent',
      locale: p.locale,
      fullName: p.parent_name,
      email: p.verified_email,
    })
    const emailResult = await sendEmail({
      to: p.verified_email,
      subject: invitation.subject,
      html: invitation.html,
      text: invitation.text,
    })
    invitationEmailStatus = emailResult.status
    if (emailResult.status !== 'sent') {
      console.warn(`enrol-from-form: parent invitation e-mail not sent (${emailResult.status})`)
    }
  }

  // ── 4b. the student's own invitation — only when the RPC just wrote
  //        a new role=student profile (PRD #10 self-login). ────────────
  let studentInvitationEmailStatus: string | null = null
  if (row.student_account_created && p.student_email) {
    const invitation = invitationEmail({
      role: 'student',
      locale: p.locale,
      fullName: p.student_name,
      email: p.student_email,
    })
    const emailResult = await sendEmail({
      to: p.student_email,
      subject: invitation.subject,
      html: invitation.html,
      text: invitation.text,
    })
    studentInvitationEmailStatus = emailResult.status
    if (emailResult.status !== 'sent') {
      console.warn(`enrol-from-form: student invitation e-mail not sent (${emailResult.status})`)
    }
  }

  // ── 5. log the outcome ───────────────────────────────────────
  await writeLog(client, {
    ...logBase,
    parent_user_id: row.parent_user_id,
    student_id: row.student_id,
    status,
    error: null,
  })

  return {
    ok: true,
    status: 201,
    data: {
      status,
      parent_user_id: row.parent_user_id,
      student_id: row.student_id,
      invitation_email: invitationEmailStatus,
      student_invitation_email: studentInvitationEmailStatus,
    },
  }
}
