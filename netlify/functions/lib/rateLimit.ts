/**
 * A minimal fixed-window rate limiter for the public-facing Functions
 * (checklist §6 names `push-subscribe` specifically).
 *
 * Scope, stated plainly: this counts requests **per warm function
 * instance**, in memory. Netlify may run several instances concurrently
 * and recycles them freely, so a determined attacker spreading requests
 * across cold starts is not stopped by it. What it does stop is the
 * realistic case — a looping client, a retry storm, or a stuck
 * `useEffect` — hammering one instance and writing to `users.push_sub`
 * hundreds of times a minute. Anything stronger needs shared state
 * (Postgres or a KV store) that this project doesn't have a place for
 * yet; that trade is recorded in TAD ADR-015 rather than hidden here.
 *
 * Kept pure and clock-injectable so it can be unit-tested without
 * waiting for wall-clock time to pass.
 */
export interface RateLimitOptions {
  /** Requests allowed per window, per key. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
}

export interface RateLimitResult {
  allowed: boolean
  /** Requests still available in the current window. */
  remaining: number
  /** When the current window resets, as an epoch-ms timestamp. */
  resetAt: number
}

export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>()

  constructor(private readonly options: RateLimitOptions) {}

  check(key: string, now = Date.now()): RateLimitResult {
    const existing = this.hits.get(key)

    if (!existing || now >= existing.resetAt) {
      const resetAt = now + this.options.windowMs
      this.hits.set(key, { count: 1, resetAt })
      this.sweep(now)
      return { allowed: true, remaining: this.options.limit - 1, resetAt }
    }

    if (existing.count >= this.options.limit) {
      return { allowed: false, remaining: 0, resetAt: existing.resetAt }
    }

    existing.count += 1
    return {
      allowed: true,
      remaining: this.options.limit - existing.count,
      resetAt: existing.resetAt,
    }
  }

  /**
   * Drop expired entries so a long-lived instance doesn't accumulate one
   * map entry per user forever. Runs only when a new window opens, which
   * bounds it to at most one pass per key per window.
   */
  private sweep(now: number): void {
    for (const [key, entry] of this.hits) {
      if (now >= entry.resetAt) this.hits.delete(key)
    }
  }
}
