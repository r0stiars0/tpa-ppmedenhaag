import { jsonError, jsonOk } from './lib/callerAuth'
import { enrolFromForm } from './lib/enrolFromForm'
import { serviceClient, verifyWebhookSecret } from './lib/webhookAuth'

/**
 * Enrols a family from the "Daftar Ulang" Google Form (TAD ADR-043, PRD
 * FR-010). No caller — the request comes from a Google Apps Script bound
 * to the form's response sheet, so it authenticates the *channel* with
 * the shared `ENROL_FORM_SECRET` (`x-webhook-secret` header), the
 * `notify-*` webhook shape. Everything after runs on the service-role
 * client; the decisions live in `lib/enrolFromForm.ts`.
 *
 * No `config.path` export — same as `invite-user.mts` / `health.mts`:
 * served at the default `/.netlify/functions/enrol-from-form`, and an
 * explicit path breaks local `netlify dev` routing.
 */
export default async (req: Request) => {
  if (req.method !== 'POST') return jsonError('Method not allowed', 405)

  const secretCheck = verifyWebhookSecret(req, 'ENROL_FORM_SECRET')
  if (secretCheck) return secretCheck.error

  const svc = serviceClient()
  if ('error' in svc) return svc.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON body', 400)
  }

  const result = await enrolFromForm(svc.client, body)
  if (!result.ok) return jsonError(result.error, result.status)
  return jsonOk(result.data, result.status)
}
