/**
 * Invokes a scheduled Function directly, at a chosen instant.
 *
 * Netlify's scheduler is the only thing that ever calls these in
 * production, and it calls them on the hour — so the two things most
 * worth verifying (does the Europe/Amsterdam gate open at the right
 * moment, and does the job do the right thing when it does) are exactly
 * the two a normal invocation cannot reach: 23 runs out of 24 return
 * "not my hour", and you cannot wait until 18:00 CET in August.
 *
 * There is deliberately no test hook in the Function for this. A query
 * parameter or header that moved the clock would be a way for whatever
 * can reach the endpoint to move it, and `lib/scheduled.ts` reads
 * nothing at all from the request precisely so that no such thing
 * exists. The clock is moved out here instead, in the process that
 * loads the handler, which production has no equivalent of.
 *
 *   node scripts/invoke-scheduled.mjs send-murajaah-reminders
 *   node scripts/invoke-scheduled.mjs send-murajaah-reminders 2026-08-14T16:00:00Z
 *
 * Prints `{ status, body }` as JSON on stdout; everything else goes to
 * stderr so the output can be piped.
 *
 * ── One caveat, and why it shapes how this is used ──────────────────
 * A VAPID request is signed with a JWT whose `exp` a push service will
 * reject if it is more than 24 hours from *real* now. So an instant
 * near today can be driven all the way to a real notification, and a
 * January instant cannot. `scripts/verify-push.mjs` uses that split
 * deliberately: the CET-date runs assert the gate and the job's own
 * decisions with no subscription in play, and the CEST-date run — today
 * — asserts the notification actually arriving.
 */
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const [name, instant] = process.argv.slice(2)
if (!name) {
  console.error('usage: node scripts/invoke-scheduled.mjs <function-name> [iso-instant]')
  process.exit(2)
}

// `netlify dev` loads .env for the Functions; a bare node process does
// not, and these three are what `serviceClient()` and `web-push` need.
for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
}

// Bundled the same way Netlify bundles it (netlify.toml: esbuild), so
// what runs here is the Function's own module graph rather than a
// hand-assembled approximation of it. Dependencies stay external and
// resolve out of node_modules, which is why the output lives inside it.
const outdir = join(ROOT, 'node_modules', '.cache', 'tpa-scheduled')
mkdirSync(outdir, { recursive: true })
const outfile = join(outdir, `${name}.mjs`)
await build({
  entryPoints: [join(ROOT, 'netlify', 'functions', `${name}.mts`)],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  logLevel: 'warning',
})

if (instant) {
  const fixed = new Date(instant).getTime()
  if (Number.isNaN(fixed)) {
    console.error(`not a parseable instant: ${instant}`)
    process.exit(2)
  }
  const RealDate = Date
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed)
      else super(...args)
    }
    static now() {
      return fixed
    }
  }
  globalThis.Date = FixedDate
  console.error(`clock pinned to ${new RealDate(fixed).toISOString()}`)
  keepVapidSignedInRealTime(fixed, RealDate)
}

/**
 * Signs VAPID with the **real** clock while the handler keeps the
 * pinned one.
 *
 * Pinning `Date` globally is what lets the Amsterdam gate be driven to
 * any hour, but `web-push` reads the same `new Date()` to stamp the
 * `exp` of the JWT it signs each request with — so a run pinned to
 * 08:00 produces a token that expired at 20:00, and every push in it
 * comes back `403 Received unexpected response code`. That made the
 * delivery assertions depend on what time of day the suite was run:
 * green before ~20:00 Amsterdam, nine failures after it, with nothing
 * about the code different. The 18:00 job passed while the 08:00 job
 * failed in the same run, which is what the shape of this bug looks
 * like from the outside.
 *
 * `getVapidHeaders` already takes an explicit expiration; `web-push`
 * simply never passes one. Filling it in here keeps the fix on the
 * harness side of the line — the Functions get no test hook, and
 * production still signs with the ordinary default (see the note at the
 * top of this file about there deliberately being no way to move the
 * clock from a request).
 *
 * The bound is what `validateExpiration` will accept, and it is checked
 * against the *pinned* clock: strictly less than pinned + 24h. The
 * value is otherwise the real now + 12h, i.e. exactly what an unpinned
 * run would have produced.
 */
function keepVapidSignedInRealTime(fixed, RealDate) {
  const require = createRequire(import.meta.url)
  let vapidHelper
  try {
    vapidHelper = require('web-push/src/vapid-helper.js')
  } catch {
    // web-push not installed, or it moved its internals: leave the
    // default alone rather than guess. The delivery assertions will
    // report their own failure if that ever happens.
    return
  }

  const original = vapidHelper.getVapidHeaders
  vapidHelper.getVapidHeaders = (audience, subject, publicKey, privateKey, encoding, expiration) => {
    if (expiration === undefined) {
      const realNow = Math.floor(RealDate.now() / 1000)
      const pinnedCeiling = Math.floor(fixed / 1000) + 24 * 60 * 60 - 60
      expiration = Math.min(realNow + 12 * 60 * 60, pinnedCeiling)
      if (expiration <= realNow) {
        // The pin is more than a day behind real time — the January CET
        // instants. No token signed now can be both unexpired and
        // within 24h of a clock that far back, which is the caveat this
        // file's header describes; those runs assert the gate, not
        // delivery. Said out loud rather than left as a silent 403.
        console.error(
          `vapid: pinned instant is ${Math.round((realNow - expiration) / 3600)}h too far back to sign a live push`,
        )
      }
    }
    return original(audience, subject, publicKey, privateKey, encoding, expiration)
  }
}

const handler = (await import(pathToFileURL(outfile).href)).default
const response = await handler(
  new Request(`https://localhost/.netlify/functions/${name}`, { method: 'POST' }),
)
const body = await response.json()
console.error(`${name} → ${response.status}`)
process.stdout.write(JSON.stringify({ status: response.status, body }))

// supabase-js keeps a realtime heartbeat alive; nothing here needs it.
process.exit(0)
