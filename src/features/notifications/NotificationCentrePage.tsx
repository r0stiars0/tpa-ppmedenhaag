import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useCapabilities } from '../../hooks/useCapabilities'
import { getErrorMessage } from '../../lib/errors'
import { canReceiveNotifications } from '../../lib/notificationRecipients'
import {
  NOTIFICATION_ROUTE,
  copyKeyFor,
  copyValuesFor,
  type NotificationEventName,
} from '../../lib/notificationCopy'
import { EVENT_ICON_PATH, EVENT_TONE, TONE_CLASS } from './eventStyle'
import { fetchNotifications, markAllRead, type NotificationRow } from './api'

/**
 * The in-app notification centre — ADR-015 part 3.
 *
 * ── A note for whoever design-reviews this ──────────────────────────
 * This screen has **not** been through the prototype design review; PRD
 * §71 still lists it as an open follow-up, and it is the reason part 3
 * was held back after parts 1 and 2 shipped. It is built from the
 * card-list pattern the Murajaah and Quran timelines already use rather
 * than from a new idea, so that a review has something conventional to
 * react to.
 *
 * What a review can change freely: everything on this page. Grouping by
 * child, splitting read from unread, per-row dismissal, icons, relative
 * timestamps, filters. **None of that needs a migration** — the table
 * stores domain events and nothing about presentation (ADR-017), and
 * every sentence here is rendered at read time from `event` + `context`
 * against the i18n copy. That was the specific risk worth designing
 * around: a schema shaped like one particular list is a schema that has
 * to change when the list does.
 *
 * ── Read state ──────────────────────────────────────────────────────
 * Opening the page marks everything read, which is what makes the
 * badge honest: it counts what the family has not looked at, and they
 * have now looked. Rows stay on screen afterwards — this is a record of
 * what they were told, not an inbox to clear. The unread ones keep a
 * marker until the next load so the page does not visibly rewrite
 * itself under the reader.
 */
export function NotificationCentrePage() {
  const { t, i18n } = useTranslation()
  const {
    capabilities,
    loading: capabilitiesLoading,
    error: capabilitiesError,
  } = useCapabilities()

  const [rows, setRows] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isRecipient = canReceiveNotifications(capabilities)

  const dateFormatter = new Intl.DateTimeFormat(i18n.language === 'nl' ? 'nl-NL' : 'id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchNotifications()
      setRows(data)
      setError(null)
      // After rendering, not before: a family that never sees the list
      // because the request failed has not read anything.
      if (data.some((row) => row.read_at === null)) await markAllRead()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Nothing is decided until the relationships are known: fetching on
    // `NO_CAPABILITIES` would render "you receive none" at a parent for
    // as long as the lookup takes.
    if (capabilitiesLoading || capabilitiesError) return
    if (!isRecipient) {
      setLoading(false)
      return
    }
    void load()
  }, [capabilitiesLoading, capabilitiesError, isRecipient, load])

  if (capabilitiesError) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold text-ppme-primary">{t('notifications.title')}</h1>
        <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">
          {capabilitiesError}
        </p>
      </div>
    )
  }

  if (!capabilitiesLoading && !isRecipient) {
    // An account no child's row points at receives nothing (ADR-022) and
    // can read nobody else's (ADR-017) — so this is genuinely empty
    // rather than merely filtered, and says so. A tutor whose own child
    // attends the TPA never lands here; the class they teach is what
    // they will not find behind it.
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold text-ppme-primary">{t('notifications.title')}</h1>
        <p className="rounded-lg bg-white p-4 text-center text-ppme-text/60 shadow-sm">
          {t('notifications.settings.notLinkedToAStudent')}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-ppme-primary">{t('notifications.title')}</h1>
        <Link
          to="/settings/notifications"
          className="min-h-11 rounded-md px-2 py-2 text-sm font-medium text-ppme-primary hover:underline"
        >
          {t('notifications.settings.title')}
        </Link>
      </div>

      {error && <p className="rounded-lg bg-ppme-danger/10 p-3 text-sm text-ppme-danger">{error}</p>}

      {loading ? (
        <p className="text-ppme-text/60">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg bg-white p-6 text-center text-ppme-text/60 shadow-sm">
          {t('notifications.empty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            const context = (row.context ?? {}) as Record<string, unknown>
            const childName = row.students?.full_name ?? ''
            const event = row.event as NotificationEventName
            const unread = row.read_at === null
            return (
              <li
                key={row.id}
                // `ppme-bg-alt` is the page background, so an unread row
                // is tinted with the brand colour instead — on a white
                // card list, the page colour reads as a hole, not a
                // highlight. The left rule carries it further: a tint
                // this light is easy to miss on a phone in daylight.
                className={`overflow-hidden rounded-lg shadow-sm ${
                  unread ? 'border-l-4 border-ppme-primary bg-ppme-primary/5' : 'bg-white'
                }`}
              >
                <Link
                  to={NOTIFICATION_ROUTE[event] ?? '/'}
                  className="flex items-start gap-3 p-3"
                >
                  {/* Tone before text: the review's central finding was
                      that an absence and a finished jilid looked
                      identical, so the palette does the work the copy
                      cannot do at a glance. See eventStyle.ts. */}
                  <span
                    aria-hidden
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                      TONE_CLASS[EVENT_TONE[event]]
                    }`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-5 w-5"
                    >
                      <path d={EVENT_ICON_PATH[event]} />
                    </svg>
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ppme-text">
                      {t(copyKeyFor(event, context), copyValuesFor(childName, context))}
                    </span>
                    <span className="mt-1 block text-xs text-ppme-text/50">
                      {dateFormatter.format(new Date(row.created_at))}
                    </span>
                  </span>

                  {unread && (
                    <span
                      aria-hidden
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ppme-primary"
                    />
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
