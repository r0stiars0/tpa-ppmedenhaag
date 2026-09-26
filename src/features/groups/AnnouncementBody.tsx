import { linkify } from '../../lib/linkify'

/**
 * An announcement body as text nodes, never HTML (TAD ADR-045). Only
 * `https://` links become anchors, shown by their host, opening in a new
 * tab with no access back to the app.
 */
export function AnnouncementBody({ body }: { body: string }) {
  if (!body) return null
  return (
    <p className="whitespace-pre-line break-words text-sm leading-relaxed text-ppme-text">
      {linkify(body).map((part, i) =>
        part.kind === 'text' ? (
          <span key={i}>{part.text}</span>
        ) : (
          <a
            key={i}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-ppme-primary underline"
          >
            {part.host} ↗
          </a>
        ),
      )}
    </p>
  )
}
