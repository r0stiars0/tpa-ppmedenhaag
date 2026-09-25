import { describe, expect, it, vi } from 'vitest'
import type { ServiceClient } from '../../netlify/functions/lib/callerAuth'
import { recordPushSubscriberCount } from '../../netlify/functions/lib/pushSubscriberCount'

/**
 * The weekly push-subscriber baseline (migration 025, TAD ADR-045,
 * PRD Feature 8 KPI 10). The count itself is computed and stored by
 * `fn_record_push_subscriber_count` and proven in the pgTAP suite
 * (RLS-117…121); what is pinned here is the Function's side of it.
 */
function clientWith(rpc: ReturnType<typeof vi.fn>): ServiceClient {
  return { rpc } as unknown as ServiceClient
}

describe('recordPushSubscriberCount', () => {
  it('records against the Monday of the given date, not the date itself', async () => {
    // Friday 2 Oct 2026 → the week that began Monday 28 Sep. The digest
    // runs on Fridays, so passing `today` straight through would key the
    // baseline on Fridays and misalign with any later Monday-keyed week.
    const rpc = vi.fn().mockResolvedValue({ data: 42, error: null })
    const result = await recordPushSubscriberCount(clientWith(rpc), '2026-10-02')
    expect(rpc).toHaveBeenCalledWith('fn_record_push_subscriber_count', { p_week_start: '2026-09-28' })
    expect(result).toEqual({ subscribers: 42 })
  })

  it('reports a failure instead of throwing, so the digest still goes out', async () => {
    // A metric failing must never cost families their weekly summary.
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await recordPushSubscriberCount(clientWith(rpc), '2026-10-02')
    expect(result).toEqual({ subscriberCountError: 'boom' })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('reports a thrown client error the same way', async () => {
    const rpc = vi.fn().mockRejectedValue(new Error('network down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await recordPushSubscriberCount(clientWith(rpc), '2026-10-02')
    expect(result).toEqual({ subscriberCountError: 'network down' })
    errorSpy.mockRestore()
  })
})
