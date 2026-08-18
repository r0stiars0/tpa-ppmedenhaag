import { describe, expect, it } from 'vitest'
import { createOfflineQueue, type QueueEntry, type QueueStore } from '../../src/lib/offlineQueue'

/**
 * Exercises `createOfflineQueue`'s logic — entry shape, ordering, retry
 * bookkeeping — against a plain in-memory `QueueStore`, never against
 * real IndexedDB (jsdom has none). The real `indexedDbStore()` adapter
 * is intentionally not covered here; see offlineQueue.ts's module
 * comment.
 */
function fakeStore(): QueueStore {
  const entries = new Map<string, QueueEntry>()
  return {
    async put(entry) {
      entries.set(entry.id, entry)
    },
    async list() {
      return [...entries.values()]
    },
    async remove(id) {
      entries.delete(id)
    },
  }
}

describe('createOfflineQueue', () => {
  it('enqueues an entry with a fresh id, timestamp, and zero attempts', async () => {
    const queue = createOfflineQueue(fakeStore())
    const entry = await queue.enqueue('attendance', { session_id: 's1' })

    expect(entry.id).toBeTruthy()
    expect(entry.kind).toBe('attendance')
    expect(entry.payload).toEqual({ session_id: 's1' })
    expect(entry.attempts).toBe(0)
    expect(entry.lastError).toBeUndefined()
    expect(new Date(entry.createdAt).toString()).not.toBe('Invalid Date')
  })

  it('lists entries oldest-first regardless of store order', async () => {
    const store = fakeStore()
    const queue = createOfflineQueue(store)

    await store.put({ id: 'b', kind: 'murajaah', payload: {}, createdAt: '2026-08-16T10:00:00.000Z', attempts: 0 })
    await store.put({ id: 'a', kind: 'murajaah', payload: {}, createdAt: '2026-08-16T09:00:00.000Z', attempts: 0 })
    await store.put({ id: 'c', kind: 'murajaah', payload: {}, createdAt: '2026-08-16T11:00:00.000Z', attempts: 0 })

    const listed = await queue.list()
    expect(listed.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('removes an entry by id', async () => {
    const queue = createOfflineQueue(fakeStore())
    const entry = await queue.enqueue('attendance', {})
    await queue.remove(entry.id)
    expect(await queue.list()).toEqual([])
  })

  it('markAttempt increments attempts and records an Error message', async () => {
    const queue = createOfflineQueue(fakeStore())
    const entry = await queue.enqueue('murajaah', {})

    await queue.markAttempt(entry, new Error('network unreachable'))

    const [updated] = await queue.list()
    expect(updated.attempts).toBe(1)
    expect(updated.lastError).toBe('network unreachable')
  })

  it('markAttempt stringifies a non-Error failure', async () => {
    const queue = createOfflineQueue(fakeStore())
    const entry = await queue.enqueue('murajaah', {})

    await queue.markAttempt(entry, { code: '23505' })

    const [updated] = await queue.list()
    expect(updated.lastError).toContain('23505')
  })

  it('markAttempt does not remove the entry — it stays queued for the next replay', async () => {
    const queue = createOfflineQueue(fakeStore())
    const entry = await queue.enqueue('attendance', {})
    await queue.markAttempt(entry, new Error('boom'))
    expect(await queue.list()).toHaveLength(1)
  })
})
