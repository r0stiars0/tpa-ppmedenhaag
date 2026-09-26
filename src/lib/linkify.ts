/**
 * Splits an announcement body into text and links (TAD ADR-045 rendering
 * rule, PRD Resolved Decision 28).
 *
 * The body is rendered as text nodes, never HTML. Only `https://` URLs
 * become links, shown by their host so a family sees where a link goes
 * before tapping it. Every other scheme — `javascript:`, `data:`,
 * `http:`, `mailto:` — stays plain text. The caller renders a link with
 * `target="_blank" rel="noopener noreferrer"`.
 */
export type BodySegment = { kind: 'text'; text: string } | { kind: 'link'; href: string; host: string }

// Stops at whitespace and at characters that cannot end a URL in prose.
const HTTPS_URL = /https:\/\/[^\s<>"']+/g
// Sentence punctuation right after a URL belongs to the sentence.
const TRAILING = /[.,;:!?)\]}]+$/

export function linkify(body: string): BodySegment[] {
  const out: BodySegment[] = []
  const pushText = (text: string) => {
    if (!text) return
    const last = out[out.length - 1]
    if (last?.kind === 'text') last.text += text
    else out.push({ kind: 'text', text })
  }

  let cursor = 0
  for (const match of body.matchAll(HTTPS_URL)) {
    const start = match.index ?? 0
    let candidate = match[0]
    const trailing = candidate.match(TRAILING)?.[0] ?? ''
    if (trailing) candidate = candidate.slice(0, -trailing.length)

    let host: string | null = null
    try {
      const parsed = new URL(candidate)
      if (parsed.protocol === 'https:' && parsed.host) host = parsed.host
    } catch {
      host = null
    }

    pushText(body.slice(cursor, start))
    if (host) out.push({ kind: 'link', href: candidate, host })
    else pushText(candidate)
    pushText(trailing)
    cursor = start + match[0].length
  }
  pushText(body.slice(cursor))
  return out
}
