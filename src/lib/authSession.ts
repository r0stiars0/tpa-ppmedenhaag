/**
 * Whether an auth event changes WHO is signed in, and so needs the
 * profile re-read with the app in its loading state.
 *
 * supabase-js announces the current session again whenever the page
 * becomes visible — a phone returning from the file picker or another app
 * — and on every token refresh. Those keep the same account; re-entering
 * the loading state for them unmounted every screen and threw away any
 * open form. Only a different account, or none, is a real change.
 */
export function needsProfileReload(currentUserId: string | null, next: { user: { id: string } } | null): boolean {
  if (!next || !currentUserId) return true
  return next.user.id !== currentUserId
}
