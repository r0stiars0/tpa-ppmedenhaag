import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { useCapabilities } from '../../hooks/useCapabilities'
import { canReceiveNotifications } from '../../lib/notificationRecipients'
import { fetchUnreadCount } from './api'

/**
 * The TopNav bell and its unread badge — checklist §5's one outstanding
 * top-nav row, held back until there was a stored list for it to open.
 * A bell with a badge promises a readable history; without the
 * notifications table there was nothing behind it to read, which is why
 * it waited for part 3 rather than shipping with the push pipeline.
 *
 * **Not rendered for an account no child's row points at.** Such an
 * account receives no notification (ADR-022) and can read nobody else's
 * (ADR-017), so a bell would be a permanently empty control — and, for
 * an admin, would suggest an inbox of every family's messages exists
 * somewhere. That is a question about relationships, not about the role
 * column: a tutor whose own child attends the TPA *does* get a bell, and
 * what is behind it is their own child and nothing from their class.
 *
 * `useCapabilities` rather than `profile.role` since ADR-022, and the
 * same predicate the settings screen and `push-subscribe` use. While it
 * loads, `NO_CAPABILITIES` hides the bell — a control that appears a
 * moment late is the right way round for one whose whole content is
 * "something is waiting".
 *
 * The count refreshes on navigation rather than on a timer or a
 * realtime subscription. A notification arriving is not urgent enough
 * to justify an open socket on every screen for every family, and the
 * push notification is what carries urgency; the badge only has to be
 * right by the time someone looks at it.
 */
export function NotificationBell() {
  const { t } = useTranslation()
  const { capabilities } = useCapabilities()
  const location = useLocation()
  const [unread, setUnread] = useState(0)

  const isRecipient = canReceiveNotifications(capabilities)

  useEffect(() => {
    if (!isRecipient) return
    let active = true
    fetchUnreadCount()
      .then((count) => active && setUnread(count))
      // Deliberately silent: a badge that cannot load its count is not
      // worth an error banner across every screen in the app.
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [isRecipient, location.pathname])

  if (!isRecipient) return null

  return (
    <Link
      to="/notifications"
      aria-label={
        unread > 0
          ? `${t('notifications.title')} (${unread})`
          : t('notifications.title')
      }
      className="relative flex min-h-11 min-w-11 items-center justify-center rounded-md text-white/90 hover:text-white"
    >
      {/* Inline SVG rather than an icon dependency, matching
          LanguageToggle's globe. */}
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      {unread > 0 && (
        <span
          // Gold is reserved for achievement moments (checklist §5), so
          // the badge uses the danger/attention colour instead of the
          // accent — this is "something is waiting", not a celebration.
          className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-ppme-danger px-1 text-center text-[10px] font-bold leading-4 text-white"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  )
}
