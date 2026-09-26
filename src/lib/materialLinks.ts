/**
 * The link allow-list for course materials (PRD Feature 8 FR-005,
 * Resolved Decision 28; TAD ADR-045(f)).
 *
 * The database enforces the same rule with a check constraint on
 * `group_materials.url` (migration 028), so this is not the security
 * boundary. It is what turns a refusal into a sentence a tutor can act
 * on — above all for `1drv.ms`, which is what OneDrive's own "Copy link"
 * button produces, and which has to be swapped for the full address.
 *
 * Keep ALLOWED in step with `group_materials_link_allowed`.
 */
const ALLOWED = /^https:\/\/(docs\.google\.com\/(document|presentation)\/d\/|drive\.google\.com\/file\/d\/|onedrive\.live\.com\/)/

export type MaterialLinkRefusal =
  | 'empty'
  | 'notHttps'
  | 'shortOneDrive'
  | 'sharepoint'
  | 'googleForm'
  | 'driveFolder'
  | 'notAllowed'

export type MaterialLinkCheck = { ok: true; url: string; host: string } | { ok: false; reason: MaterialLinkRefusal }

export function checkMaterialLink(raw: string): MaterialLinkCheck {
  const url = raw.trim()
  if (!url) return { ok: false, reason: 'empty' }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, reason: 'notHttps' }
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'notHttps' }

  if (ALLOWED.test(url)) return { ok: true, url, host: parsed.host }

  // Refused either way; these get their own explanation.
  const host = parsed.host.toLowerCase()
  if (host === '1drv.ms') return { ok: false, reason: 'shortOneDrive' }
  if (host === 'sharepoint.com' || host.endsWith('.sharepoint.com')) return { ok: false, reason: 'sharepoint' }
  if (host === 'forms.gle' || (host === 'docs.google.com' && parsed.pathname.startsWith('/forms/'))) {
    return { ok: false, reason: 'googleForm' }
  }
  if (host === 'drive.google.com' && parsed.pathname.includes('/folders/')) return { ok: false, reason: 'driveFolder' }
  return { ok: false, reason: 'notAllowed' }
}
