/**
 * Distinguishes "the request never reached the server" from "the server
 * reached a real answer" — only the first should ever go into the
 * offline queue. A validation error or an RLS rejection is a real
 * answer and must reach the user immediately; queuing it would retry a
 * write that was never going to succeed and hide the failure from the
 * person who needs to see it.
 *
 * `fetch` (which `supabase-js` calls under the hood) rejects with a bare
 * `TypeError` when the network is unreachable — no `.code`, no
 * `.status`, nothing else in this codebase throws that shape for a
 * write. `navigator.onLine` is checked first since it is the cheaper,
 * more direct signal when available; the `TypeError` check catches the
 * case where the browser believes it is online but the request still
 * failed to leave the device (a flaky connection, a captive portal).
 */
export function isNetworkError(err: unknown): boolean {
  if (!navigator.onLine) return true
  return err instanceof TypeError
}
