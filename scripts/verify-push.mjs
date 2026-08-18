/**
 * Live Web Push verification harness — test-plan §6, "Desktop Chrome"
 * column.
 *
 * Everything about push is easy to *believe* is working: the Function
 * returns 200, the row has a subscription, the logs look fine, and
 * nothing ever arrives on a phone. So this drives the whole pipeline
 * with nothing stubbed — a real Chromium, a real FCM subscription, a
 * real attendance write, the real database webhook, a real push — and
 * asserts on what the browser actually displayed.
 *
 * It is not part of `npm test`: it needs Docker, a loaded dev fixture
 * and a running `netlify dev`, none of which CI has. Run it by hand
 * after touching anything in the notification path.
 *
 *   supabase start
 *   supabase db reset --local
 *   docker exec -i supabase_db_tpa-ppme-denhaag \
 *     psql -U postgres -v ON_ERROR_STOP=1 < supabase/dev-fixture.sql
 *   # configure the webhook target (README "Database webhooks"):
 *   docker exec -i supabase_db_tpa-ppme-denhaag psql -U postgres -c \
 *     "select vault.create_secret('http://host.docker.internal:8888/.netlify/functions','notify_webhook_base_url');
 *      select vault.create_secret('dev-webhook-secret-local-only','notify_webhook_secret');"
 *   npm run build && netlify dev --dir dist --port 8888
 *   node scripts/verify-push.mjs
 *
 * The `.env` used by `netlify dev` must point at the local stack and set
 * VAPID_PUBLIC_KEY / VITE_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY and
 * NOTIFY_WEBHOOK_SECRET (matching the Vault secret above).
 */
import { chromium } from '@playwright/test'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ORIGIN = process.env.VERIFY_ORIGIN ?? 'http://localhost:8888'
const WEBHOOK_SECRET = process.env.NOTIFY_WEBHOOK_SECRET ?? 'dev-webhook-secret-local-only'
// The Supabase CLI's well-known fixed local JWT secret — not a real
// secret (same value in every `supabase init` project). Also used by
// `src/dev/devAuth.ts`.
const JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'
const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_tpa-ppme-denhaag'

// supabase/dev-fixture.sql
const SITI = { id: 'a2000000-0000-0000-0000-000000000001', email: 'ibu.siti@dev.local' }
const RUDI = { id: 'a2000000-0000-0000-0000-000000000002', email: 'bapak.rudi@dev.local' }
const AHMAD = { id: 'a1000000-0000-0000-0000-000000000001', email: 'ustadz.ahmad@dev.local' }
const ADMIN = { id: 'c1000000-0000-0000-0000-000000000001', email: 'admin.dev@dev.local' }
const FATIMAH_USER = { id: 'a3000000-0000-0000-0000-000000000001', email: 'fatimah@dev.local' }
// The two accounts ADR-022 exists for. Both teach Kelas A and have their
// own child in Kelas B, so for each of them "my child" and "my class"
// are disjoint sets — which is what makes the two halves of the rule
// separable in a live assertion rather than only in a unit test.
const AMINAH = { id: 'd1000000-0000-0000-0000-000000000001', email: 'ustadzah.aminah@dev.local' }
const LAILA = { id: 'd1000000-0000-0000-0000-000000000003', email: 'ustadzah.laila@dev.local' }
const ALI = 'a5000000-0000-0000-0000-000000000001' // Ibu Siti's child, Kelas A
const ZAINAB = 'a5000000-0000-0000-0000-000000000002' // Ibu Siti's second child, Kelas A
const FATIMAH = 'a5000000-0000-0000-0000-000000000003' // Bapak Rudi's child, Kelas A, 16+ self-login
const YUSUF = 'a5000000-0000-0000-0000-000000000005' // Ustadzah Aminah's own child, Kelas B
const SALMA = 'a5000000-0000-0000-0000-000000000007' // Ustadzah Laila's own child, Kelas B
// The two overlap personas (ADR-023, ADR-024) and the disjoint
// tutor-parent, for the scope-switch gates in section 9.
const HASAN = { id: 'd1000000-0000-0000-0000-000000000002', email: 'bapak.hasan@dev.local' }
const AISYAH_USER = { id: 'd1000000-0000-0000-0000-000000000004', email: 'aisyah@dev.local' }
const KHADIJAH = 'a5000000-0000-0000-0000-000000000006' // Bapak Hasan's own child, Kelas A
const AISYAH = 'a5000000-0000-0000-0000-000000000008' // the assistant's own record, Kelas A
const KELAS_A = 'a4000000-0000-0000-0000-000000000001'
const MURAJAAH_TARGET = 'a7000000-0000-0000-0000-0000000000e1'
const DUE_TOMORROW = 'a8000000-0000-0000-0000-0000000000e1'

const sql = (query) =>
  execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-tAc', query], {
    encoding: 'utf8',
  }).trim()

const b64url = (input) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function mintJwt(sub) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({
      sub,
      role: 'authenticated',
      aud: 'authenticated',
      iss: 'supabase-demo',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  )
  const data = `${header}.${payload}`
  return `${data}.${b64url(crypto.createHmac('sha256', JWT_SECRET).update(data).digest())}`
}

function sessionJson(user) {
  return JSON.stringify({
    access_token: mintJwt(user.id),
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'local-dev-fixture-refresh-token',
    user: {
      id: user.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: user.email,
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  })
}

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass })
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}

const profiles = []
async function openAs(user) {
  // `channel: 'chromium'` is load-bearing: Playwright's default headless
  // shell has no notifications/push implementation, so
  // Notification.permission is permanently 'denied' there and every
  // assertion below would fail for the wrong reason.
  const dir = mkdtempSync(join(tmpdir(), 'tpa-push-'))
  profiles.push(dir)
  const context = await chromium.launchPersistentContext(dir, {
    headless: true,
    channel: 'chromium',
    permissions: ['notifications'],
    args: ['--no-sandbox'],
  })
  await context.grantPermissions(['notifications'], { origin: ORIGIN })

  const consoleErrors = []
  const failedRequests = []
  const aborted = []
  const page = await context.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('requestfailed', (req) => {
    // `net::ERR_ABORTED` is the browser cancelling an in-flight request
    // because the page navigated away — the TopNav bell fires its
    // unread count on every route change, and this harness navigates
    // constantly. That is normal browser behaviour, not a rejected
    // request, and lumping the two together would make this check
    // useless for finding the thing it exists to find: a 4xx the UI
    // swallows. Recorded either way, but only the rest fail the run.
    const reason = req.failure()?.errorText ?? 'unknown'
    if (reason === 'net::ERR_ABORTED') aborted.push(`${req.method()} ${req.url()}`)
    else failedRequests.push(`${req.method()} ${req.url()} (${reason})`)
  })
  page.on('response', (res) => {
    if (res.status() >= 400) failedRequests.push(`${res.status()} ${res.url()}`)
  })
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [
    'sb-127-auth-token',
    sessionJson(user),
  ])
  await page.goto(`${ORIGIN}/settings/notifications`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => navigator.serviceWorker.ready)
  return { context, page, consoleErrors, failedRequests, aborted }
}

const shown = (page) =>
  page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    return (await registration.getNotifications()).map((n) => ({
      title: n.title,
      body: n.body,
      tag: n.tag,
    }))
  })

const clearTray = (page) =>
  page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    for (const n of await registration.getNotifications()) n.close()
  })

/**
 * Waits for at least `count` notifications.
 *
 * `waitForNotification` returns on the first one, which is a race as
 * soon as a family has two children: the second delivery is a separate
 * HTTPS round trip to a push service and lands whenever it lands. Since
 * ADR-016 put the child in the dedup tag those are two notifications
 * rather than one replaced one, so anything asserting on a sibling pair
 * has to wait for both.
 */
async function waitForCount(page, count, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  let tray = await shown(page)
  while (Date.now() < deadline && tray.length < count) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    tray = await shown(page)
  }
  return tray
}

async function waitForNotification(page, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs
  let last = []
  while (Date.now() < deadline) {
    last = await shown(page)
    if (last.length > 0) return last
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  return last
}

/**
 * How many TopNav bells the header is showing.
 *
 * Waits, rather than counting immediately. Since ADR-022 the bell is
 * gated on the caller's *relationships*, which is a round trip rather
 * than a value already in the auth context, so it renders a beat after
 * the page does. `waitFor` covers the positive case; `settleMs` is what
 * keeps the negative case honest — counting zero before the query has
 * come back would pass for a tutor even if the gate were broken.
 */
async function bellCount(page, { settleMs = 4000 } = {}) {
  const bell = page.locator('header').getByRole('link', { name: /Notifikasi|Meldingen/ })
  try {
    await bell.first().waitFor({ timeout: 15000 })
  } catch {
    await page.waitForTimeout(settleMs)
  }
  return bell.count()
}

async function enable(page, label) {
  const button = page.getByRole('button', { name: /Aktifkan notifikasi|Meldingen inschakelen/ })
  await button.waitFor({ timeout: 15000 })
  await button.click()
  await page
    .getByText(/Notifikasi aktif di perangkat ini|Meldingen staan aan op dit apparaat/)
    // Must exceed `SUBSCRIBE_TIMEOUT_MS` in `src/lib/push.ts`, or this
    // gives up before the screen it is watching has finished deciding.
    // FCM has been measured taking 32s to serve a subscription.
    .waitFor({ timeout: 75000 })
  console.log(`       (${label} subscribed)`)
}

function markAbsent(studentId, reason = null) {
  sql(`
    insert into public.sessions (class_id, date, tutor_id)
    values ((select class_id from public.students where id='${studentId}'), current_date, '${AHMAD.id}')
    on conflict (class_id, date) do nothing;
  `)
  const sessionId = sql(`
    select id from public.sessions
    where class_id = (select class_id from public.students where id='${studentId}')
      and date = current_date limit 1
  `)
  sql(`
    insert into public.attendance (session_id, student_id, status, reason)
    values ('${sessionId}', '${studentId}', 'absent', ${reason ? `'${reason}'` : 'null'})
    on conflict (session_id, student_id) do update set status='absent', reason=excluded.reason;
  `)
}

function markPresent(studentId) {
  sql(`update public.attendance set status='present' where student_id='${studentId}'`)
}

function recordYanbua(studentId, jilid, page, mastery) {
  sql(`
    insert into public.yanbua_progress (student_id, tutor_id, jilid, page, mastery)
    values ('${studentId}', '${AHMAD.id}', ${jilid}, ${page}, '${mastery}');
  `)
}

function assignMurajaah(studentId) {
  sql(`
    insert into public.murajaah_assignments (id, student_id, tutor_id, surah_num, ayah_from, ayah_to, active)
    values ('${MURAJAAH_TARGET}', '${studentId}', '${AHMAD.id}', 114, 1, 6, true)
    on conflict (id) do update set active = true, student_id = excluded.student_id;
  `)
}

function draftReport(studentId, year = '2025/2026') {
  sql(`
    insert into public.year_end_reports (student_id, academic_year, tutor_id, status, narrative)
    values ('${studentId}', '${year}', '${AHMAD.id}', 'draft', 'Alhamdulillah, progres baik.')
    on conflict (student_id, academic_year) do update set status = 'draft';
  `)
  return sql(`select id from public.year_end_reports where student_id='${studentId}' and academic_year='${year}'`)
}

const today = sql("select to_char(current_date, 'YYYY-MM-DD')")

/**
 * Runs a scheduled Function at a chosen instant and returns its
 * response — see `scripts/invoke-scheduled.mjs` for why the clock is
 * moved out here rather than through a hook in the Function.
 */
function invokeScheduled(name, instant) {
  const out = execFileSync('node', ['scripts/invoke-scheduled.mjs', name, instant], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return JSON.parse(out)
}

const addDaysStr = (date, days) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)

const mondayOf = (date) => {
  const day = new Date(Date.parse(`${date}T00:00:00Z`)).getUTCDay()
  return addDaysStr(date, day === 0 ? -6 : 1 - day)
}

/**
 * The UTC instant at which it is `hour` o'clock in Amsterdam on `date`.
 *
 * Found by asking the IANA database rather than by adding an offset,
 * which is the same reason the Functions themselves do — an offset
 * hard-coded here would make the CET/CEST assertions agree with a bug
 * rather than catch one.
 */
function amsterdamInstant(date, hour) {
  const localHour = (d) =>
    Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Amsterdam',
        hour: '2-digit',
        hour12: false,
      }).format(d),
    )
  const localDate = (d) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Amsterdam',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d)

  for (let utcHour = hour - 3; utcHour <= hour; utcHour += 1) {
    const candidate = new Date(
      Date.parse(`${date}T00:00:00Z`) + ((utcHour + 24) % 24) * 3600000 - (utcHour < 0 ? 86400000 : 0),
    )
    if (localHour(candidate) === hour && localDate(candidate) === date) return candidate.toISOString()
  }
  throw new Error(`no UTC instant maps to ${hour}:00 Europe/Amsterdam on ${date}`)
}

// ── preconditions ────────────────────────────────────────────────
const configured = sql('select base_url is not null and secret is not null from public.fn_webhook_config()')
if (configured !== 't') {
  console.error('Webhook is not configured in Vault — see the header comment in this file.')
  process.exit(2)
}
sql(`update public.users set push_sub = null, locale = 'id' where id in ('${SITI.id}', '${RUDI.id}', '${FATIMAH_USER.id}', '${AMINAH.id}', '${LAILA.id}')`)
sql(`delete from public.notifications where user_id in ('${AMINAH.id}', '${LAILA.id}')`)
sql(`delete from public.attendance where student_id in ('${ALI}', '${FATIMAH}', '${YUSUF}', '${SALMA}') and session_id in (select id from public.sessions where date = current_date)`)
sql(`delete from public.yanbua_progress where student_id in ('${ALI}', '${FATIMAH}')`)
sql(`delete from public.murajaah_assignments where id = '${MURAJAAH_TARGET}'`)
sql(`delete from public.assignments where class_id = '${KELAS_A}'`)
sql(`delete from public.year_end_reports where student_id in ('${ALI}', '${FATIMAH}')`)

const siti = await openAs(SITI)
const rudi = await openAs(RUDI)
// The 16+ self-login student — the only fixture identity that exercises
// the 'family' audience, where a notification reaches both a parent and
// the student themselves.
const fatimah = await openAs(FATIMAH_USER)

try {
  console.log('\n1. subscribe → store')
  await enable(siti.page, 'Ibu Siti')
  await enable(rudi.page, 'Bapak Rudi')
  await enable(fatimah.page, 'Fatimah (16+ student)')
  check('a 16+ student can subscribe', sql(`select push_sub is not null from public.users where id='${FATIMAH_USER.id}'`) === 't')
  check('subscription stored for Ibu Siti', sql(`select push_sub is not null from public.users where id='${SITI.id}'`) === 't')
  check('subscription stored for Bapak Rudi', sql(`select push_sub is not null from public.users where id='${RUDI.id}'`) === 't')
  check(
    'stored subscription has endpoint + both keys and nothing else',
    sql(`select (select array_agg(k order by k) from jsonb_object_keys(push_sub) k) = array['endpoint','keys']
         from public.users where id='${SITI.id}'`) === 't',
  )

  console.log('\n2. absence → webhook → push → notification')
  const queueMark = sql('select coalesce(max(id),0) from net.http_request_queue')
  markAbsent(ALI, 'demam tinggi')
  check('the database webhook queued one request', Number(sql(`select count(*) from net.http_request_queue where id > ${queueMark}`)) === 1)

  const received = await waitForNotification(siti.page)
  check('Ibu Siti received the absence push', received.length === 1, JSON.stringify(received))
  if (received.length === 1) {
    check('body is the Indonesian copy, first name only', received[0].body === 'Ali tidak hadir hari ini di TPA', received[0].body)
    check('DPIA R6: the absence reason is nowhere in the payload', !JSON.stringify(received[0]).includes('demam'))
    check('dedup tag is per (user, event, child, date)', received[0].tag === `absence:${SITI.id}:${ALI}:${today}`, received[0].tag)
    check('title is the app name', received[0].title === 'TPA PPME Den Haag', received[0].title)
  }
  check(
    'CROSS-FAMILY: the other parent received nothing (test-plan §1)',
    (await shown(rudi.page)).length === 0,
  )

  console.log('\n2b. two children, two notifications (ADR-016)')
  // The regression the child was added to the dedup tag for: keyed on
  // (user, event, date) alone these two collapse on the lock screen and
  // the parent is told about one child while the other silently
  // disappears. Ibu Siti is the fixture's only two-child family.
  // Ali's notification from the previous section is deliberately left
  // on screen — the whole question is whether Zainab's replaces it.
  markAbsent(ZAINAB)
  // Ali's is still displayed from the previous section's send.
  const sitiTray = await waitForCount(siti.page, 2)
  check('a parent of two absent children sees two notifications', sitiTray.length === 2, JSON.stringify(sitiTray.map((n) => n.tag)))
  check(
    '…one naming each child',
    new Set(sitiTray.map((n) => n.body)).size === 2 &&
      sitiTray.some((n) => n.body.startsWith('Ali ')) &&
      sitiTray.some((n) => n.body.startsWith('Zainab ')),
    JSON.stringify(sitiTray.map((n) => n.body)),
  )
  check(
    '…on two distinct tags, one per child',
    new Set(sitiTray.map((n) => n.tag)).size === 2 &&
      sitiTray.every((n) => n.tag === `absence:${SITI.id}:${ALI}:${today}` || n.tag === `absence:${SITI.id}:${ZAINAB}:${today}`),
    JSON.stringify(sitiTray.map((n) => n.tag)),
  )
  await clearTray(siti.page)
  markPresent(ZAINAB)

  console.log('\n3. recipient locale drives the copy')
  sql(`update public.users set locale='nl' where id='${RUDI.id}'`)
  markAbsent(FATIMAH, 'griep')
  const dutch = await waitForNotification(rudi.page)
  check('a Dutch-locale parent gets the Dutch body', dutch.length === 1 && dutch[0].body === 'Fatimah was vandaag niet aanwezig bij TPA', JSON.stringify(dutch))
  check('DPIA R6 holds in Dutch too', !JSON.stringify(dutch).includes('griep'))

  console.log('\n4. dedup and idempotency')
  const mark2 = sql('select coalesce(max(id),0) from net.http_request_queue')
  markAbsent(FATIMAH, 'griep')
  check('re-saving an already-absent roster queues nothing', Number(sql(`select count(*) from net.http_request_queue where id > ${mark2}`)) === 0)
  markPresent(FATIMAH)
  markAbsent(FATIMAH, 'griep')
  await new Promise((resolve) => setTimeout(resolve, 12000))
  check('the same event twice shows one notification, not two', (await shown(rudi.page)).length === 1)

  // Back to Indonesian so the remaining assertions read in one language.
  sql(`update public.users set locale='id' where id='${RUDI.id}'`)
  await clearTray(siti.page)
  await clearTray(rudi.page)
  await clearTray(fatimah.page)

  console.log('\n4b. jilid completed (PRD Feature 3 FR-006)')
  // A mid-jilid entry fires the webhook — the trigger is deliberately
  // unselective so the completion rule has one implementation — but must
  // produce no notification.
  recordYanbua(ALI, 1, 20, 'lancar')
  await new Promise((resolve) => setTimeout(resolve, 8000))
  check('a mid-jilid entry notifies nobody', (await shown(siti.page)).length === 0)

  // Last page of jilid 1 (page_count 44, migration 004) with mastery lancar.
  recordYanbua(ALI, 1, 44, 'lancar')
  const jilid = await waitForNotification(siti.page)
  check('completing a jilid notifies the parent', jilid.length === 1 && jilid[0].body === 'Alhamdulillah! Ali menyelesaikan satu jilid', JSON.stringify(jilid))
  check('DPIA R6: the jilid number is not on the lock screen', !/Jilid 1|jilid 1/.test(JSON.stringify(jilid)))
  check('the other family hears nothing about it', (await shown(rudi.page)).length === 0)

  // Same page, but needing repetition — the rule in src/lib/yanbua.ts
  // says that is not a completion.
  await clearTray(siti.page)
  recordYanbua(ALI, 2, 44, 'kurang_lancar')
  await new Promise((resolve) => setTimeout(resolve, 8000))
  check('a last page that still needs repeating is not a completion', (await shown(siti.page)).length === 0)

  console.log('\n4c. surah memorized (PRD Feature 5 FR-005)')
  await clearTray(siti.page)
  assignMurajaah(ALI)
  await new Promise((resolve) => setTimeout(resolve, 5000))
  check('assigning a murajaah target notifies nobody', (await shown(siti.page)).length === 0)

  sql(`update public.murajaah_assignments set active = false where id = '${MURAJAAH_TARGET}'`)
  const memorized = await waitForNotification(siti.page)
  check('marking a target memorized notifies the parent', memorized.length === 1 && memorized[0].body === 'Alhamdulillah! Ali hafal satu surah baru', JSON.stringify(memorized))
  check('DPIA R6: the surah name is not on the lock screen', !/An-Nas|Al-Fatihah|surah 114/i.test(memorized[0]?.body ?? ''))

  await clearTray(siti.page)
  sql(`update public.murajaah_assignments set active = true where id = '${MURAJAAH_TARGET}'`)
  await new Promise((resolve) => setTimeout(resolve, 8000))
  check('re-activating a target notifies nobody', (await shown(siti.page)).length === 0)

  console.log('\n4d. new homework — fan-out across a class')
  await clearTray(siti.page)
  await clearTray(rudi.page)
  await clearTray(fatimah.page)
  sql(`
    insert into public.assignments (class_id, tutor_id, title, due_date)
    values ('${KELAS_A}', '${AHMAD.id}', 'Hafalan Surah An-Nas ayat 1-6', current_date + 2);
  `)
  await waitForNotification(siti.page)
  // Bapak Rudi has *two* children in Kelas A: Fatimah, and Aisyah — the
  // student assistant, whose own record is enrolled here even though the
  // class she helps with is Kelas B (ADR-020). Both are his, so he is
  // notified about both. This read `waitForNotification` and asserted a
  // single notification until the dev fixture gained Aisyah and
  // Khadijah, at which point it was asserting the old roster rather than
  // the delivery rule.
  const rudiHomework = await waitForCount(rudi.page, 2)
  const fatimahHomework = await waitForNotification(fatimah.page)

  // Two children in this class, so two notifications — one per child.
  // This assertion read `=== 1` until ADR-016 put the child in the dedup
  // tag; it was encoding the collision rather than catching it.
  const sitiClass = await waitForCount(siti.page, 2)
  check('the parent of two children in the class is notified about both', sitiClass.length === 2, JSON.stringify(sitiClass.map((n) => n.body)))
  check(
    '…once for each of her own children',
    sitiClass.some((n) => n.body === 'Ada tugas baru untuk Ali') &&
      sitiClass.some((n) => n.body === 'Ada tugas baru untuk Zainab'),
    JSON.stringify(sitiClass.map((n) => n.body)),
  )
  check(
    'the other family in the same class is notified about their own children',
    rudiHomework.length === 2 &&
      rudiHomework.some((n) => n.body === 'Ada tugas baru untuk Fatimah') &&
      rudiHomework.some((n) => n.body === 'Ada tugas baru untuk Aisyah'),
    JSON.stringify(rudiHomework.map((n) => n.body)),
  )
  check('CROSS-FAMILY: that parent is told nothing about the other families’ children', !/Ali|Zainab|Khadijah/.test(JSON.stringify(rudiHomework)))
  check('FAMILY AUDIENCE: the 16+ student is notified too', fatimahHomework.length === 1 && fatimahHomework[0].body === 'Ada tugas baru untuk Fatimah', JSON.stringify(fatimahHomework))
  check('DPIA R6: the assignment title is not on the lock screen', !/An-Nas|ayat/i.test(JSON.stringify([...sitiClass, ...rudiHomework, ...fatimahHomework])))

  console.log('\n4e. year-end report published (PRD Feature 6 FR-007)')
  await clearTray(siti.page)
  await clearTray(rudi.page)
  await clearTray(fatimah.page)
  const aliReport = draftReport(ALI)
  const fatimahReport = draftReport(FATIMAH)
  await new Promise((resolve) => setTimeout(resolve, 5000))
  check('creating a draft report notifies nobody', (await shown(siti.page)).length === 0)

  sql(`update public.year_end_reports set status='published', published_at=now() where id='${fatimahReport}'`)
  const rudiReport = await waitForNotification(rudi.page)
  const fatimahOwnReport = await waitForNotification(fatimah.page)
  check('publishing notifies the parent', rudiReport.length === 1 && rudiReport[0].body === 'Rapor akhir tahun Fatimah sudah siap', JSON.stringify(rudiReport))
  check('FAMILY AUDIENCE: …and the 16+ student, who can open it themselves', fatimahOwnReport.length === 1 && fatimahOwnReport[0].body === 'Rapor akhir tahun Fatimah sudah siap', JSON.stringify(fatimahOwnReport))
  check('CROSS-FAMILY: the other parent hears nothing', (await shown(siti.page)).length === 0)

  const beforeRepublish = sql('select coalesce(max(id),0) from net.http_request_queue')
  sql(`update public.year_end_reports set status='published' where id='${fatimahReport}'`)
  sql(`update public.year_end_reports set narrative='corrected' where id='${fatimahReport}'`)
  check('re-publishing or editing a published report queues nothing', Number(sql(`select count(*) from net.http_request_queue where id > ${beforeRepublish}`)) === 0)

  sql(`update public.year_end_reports set status='published', published_at=now() where id='${aliReport}'`)
  const sitiReport = await waitForNotification(siti.page)
  check('a second family’s report reaches only them', sitiReport.length === 1 && sitiReport[0].body === 'Rapor akhir tahun Ali sudah siap', JSON.stringify(sitiReport))

  await clearTray(siti.page)
  await clearTray(rudi.page)
  await clearTray(fatimah.page)

  console.log('\n4f. scheduled Functions — the Amsterdam gate (ADR-016)')
  // The DST half, asserted with no subscription in play so nothing is
  // sent to a push service. That matters: a VAPID request is signed
  // with a JWT a push service rejects if its `exp` is more than 24h
  // from real now, so a January instant can prove the *gate* and only
  // an instant near today can prove a delivery. Both are below.
  const savedSubs = [SITI, RUDI, FATIMAH_USER].map((u) => ({
    id: u.id,
    sub: sql(`select coalesce(push_sub::text, 'null') from public.users where id='${u.id}'`),
  }))
  sql(`update public.users set push_sub = null`)

  const cetRun = invokeScheduled('send-murajaah-reminders', '2026-01-15T17:00:00Z')
  check(
    'CET date: 17:00 UTC is 18:00 in Amsterdam, and the job runs',
    cetRun.body.skipped !== undefined && !String(cetRun.body.skipped).startsWith('not 18:00'),
    JSON.stringify(cetRun.body),
  )
  const cestSameUtcHour = invokeScheduled('send-murajaah-reminders', `${today}T17:00:00Z`)
  check(
    'CEST date: the same 17:00 UTC is 19:00 local, and the job does not run',
    cestSameUtcHour.body.skipped === 'not 18:00 in Europe/Amsterdam',
    JSON.stringify(cestSameUtcHour.body),
  )
  const cestRun = invokeScheduled('send-murajaah-reminders', amsterdamInstant(today, 18))
  check(
    'CEST date: 18:00 local is an hour earlier in UTC, and the job runs there instead',
    cestRun.body.skipped !== 'not 18:00 in Europe/Amsterdam',
    JSON.stringify(cestRun.body),
  )
  check(
    'a scheduled Function never returns a dedup tag, which would carry two ids',
    !('tags' in cestRun.body) && !JSON.stringify(cestRun.body).includes(SITI.id),
    JSON.stringify(cestRun.body),
  )

  for (const { id, sub } of savedSubs) {
    if (sub !== 'null') sql(`update public.users set push_sub = $j$${sub}$j$::jsonb where id='${id}'`)
  }
  check(
    'subscriptions restored for the delivery assertions',
    sql(`select count(*) from public.users where push_sub is not null`) === '3',
  )

  console.log('\n4g. send-murajaah-reminders → real notification')
  await clearTray(siti.page)
  await clearTray(rudi.page)
  await clearTray(fatimah.page)
  // A daily target for Ali, unconfirmed today: `needsReminder` says the
  // last chance to keep the streak is tonight.
  assignMurajaah(ALI)
  sql(`update public.murajaah_assignments set frequency='daily' where id='${MURAJAAH_TARGET}'`)
  sql(`delete from public.murajaah_log where assignment_id='${MURAJAAH_TARGET}'`)

  const reminder = invokeScheduled('send-murajaah-reminders', amsterdamInstant(today, 18))
  check('the 18:00 run reports one send', reminder.body.sent === 1, JSON.stringify(reminder.body))
  const reminded = await waitForNotification(siti.page)
  check(
    'Ibu Siti received the murajaah reminder',
    reminded.length === 1 && reminded[0].body === 'Waktunya murajaah bersama Ali',
    JSON.stringify(reminded),
  )
  check(
    'DPIA R6: the surah and ayah range are not on the lock screen',
    !/An-Nas|ayat|114/i.test(JSON.stringify(reminded)),
  )
  check('CROSS-FAMILY: the other family is not reminded about it', (await shown(rudi.page)).length === 0)

  // Idempotency — the property the hourly cron depends on.
  const rerun = invokeScheduled('send-murajaah-reminders', amsterdamInstant(today, 18))
  check('a second run at the same hour still reports one send', rerun.body.sent === 1, JSON.stringify(rerun.body))
  await new Promise((resolve) => setTimeout(resolve, 12000))
  check(
    'IDEMPOTENT: running twice leaves one notification, not two',
    (await shown(siti.page)).length === 1,
    JSON.stringify(await shown(siti.page)),
  )

  // Confirming practice takes the family out of tonight's run entirely.
  sql(`
    insert into public.murajaah_log (assignment_id, confirmed_by, quality, date)
    values ('${MURAJAAH_TARGET}', '${SITI.id}', 'hafal_lancar', current_date)
    on conflict (assignment_id, date) do nothing;
  `)
  const confirmed = invokeScheduled('send-murajaah-reminders', amsterdamInstant(today, 18))
  check(
    'a family who already practised tonight is not reminded',
    confirmed.body.skipped === 'every target is on track',
    JSON.stringify(confirmed.body),
  )
  // Deleted rather than deactivated: deactivating is the tutor's "mark
  // memorized" action and would fire a real notification (4c).
  sql(`delete from public.murajaah_assignments where id='${MURAJAAH_TARGET}'`)
  await new Promise((resolve) => setTimeout(resolve, 6000))
  await clearTray(siti.page)
  await clearTray(rudi.page)
  await clearTray(fatimah.page)

  console.log('\n4h. homework-due-reminders → real notification')
  sql(`delete from public.assignments where class_id = '${KELAS_A}'`)
  sql(`
    insert into public.assignments (id, class_id, tutor_id, title, due_date)
    values ('${DUE_TOMORROW}', '${KELAS_A}', '${AHMAD.id}', 'Menulis huruf hijaiyah', current_date + 1);
  `)
  // That INSERT is also the "new homework" webhook — let it land and
  // clear it, so what follows is only the 08:00 reminder.
  await new Promise((resolve) => setTimeout(resolve, 12000))
  await clearTray(siti.page)
  await clearTray(rudi.page)
  await clearTray(fatimah.page)

  const nothingDue = invokeScheduled('homework-due-reminders', amsterdamInstant(addDaysStr(today, 3), 8))
  check(
    'a morning with nothing due tomorrow sends nothing',
    String(nothingDue.body.skipped ?? '').startsWith('nothing due on'),
    JSON.stringify(nothingDue.body),
  )

  const dueRun = invokeScheduled('homework-due-reminders', amsterdamInstant(today, 8))
  // Five pushes across Kelas A's five children: Ibu Siti for Ali and for
  // Zainab, Bapak Rudi for Fatimah and for Aisyah, and Fatimah's own
  // 16+ login. Khadijah's parent is subscribed to nothing, so hers is
  // recorded in the centre and pushed nowhere — `recorded` is 7.
  check('the 08:00 run reports the whole class', dueRun.body.sent === 5, JSON.stringify(dueRun.body))
  const sitiDue = await waitForCount(siti.page, 2)
  const rudiDue = await waitForCount(rudi.page, 2)
  const fatimahDue = await waitForNotification(fatimah.page)
  check('the parent of two children in the class is reminded about both', sitiDue.length === 2, JSON.stringify(sitiDue.map((n) => n.body)))
  check(
    '…once for each child',
    new Set(sitiDue.map((n) => n.tag)).size === 2 &&
      sitiDue.some((n) => n.body === 'Tugas Ali deadline besok') &&
      sitiDue.some((n) => n.body === 'Tugas Zainab deadline besok'),
    JSON.stringify(sitiDue.map((n) => n.body)),
  )
  check(
    'the other family is reminded about their own children',
    rudiDue.length === 2 &&
      rudiDue.some((n) => n.body === 'Tugas Fatimah deadline besok') &&
      rudiDue.some((n) => n.body === 'Tugas Aisyah deadline besok'),
    JSON.stringify(rudiDue.map((n) => n.body)),
  )
  check('CROSS-FAMILY: and about nobody else’s', !/Ali|Zainab|Khadijah/.test(JSON.stringify(rudiDue)))
  check('FAMILY AUDIENCE: the 16+ student is reminded too', fatimahDue.length === 1 && fatimahDue[0].body === 'Tugas Fatimah deadline besok', JSON.stringify(fatimahDue))
  check('DPIA R6: the assignment title is not on the lock screen', !/hijaiyah|Menulis/i.test(JSON.stringify([...sitiDue, ...rudiDue, ...fatimahDue])))

  const dueRerun = invokeScheduled('homework-due-reminders', amsterdamInstant(today, 8))
  check('a second 08:00 run reports the same sends', dueRerun.body.sent === 5, JSON.stringify(dueRerun.body))
  await new Promise((resolve) => setTimeout(resolve, 12000))
  check('IDEMPOTENT: the parent of two still sees exactly two', (await shown(siti.page)).length === 2, JSON.stringify((await shown(siti.page)).map((n) => n.tag)))
  check('IDEMPOTENT: the 16+ student still sees exactly one', (await shown(fatimah.page)).length === 1)

  // A child who has marked the homework done drops out of the run.
  sql(`
    insert into public.assignment_status (assignment_id, student_id, status)
    values ('${DUE_TOMORROW}', '${FATIMAH}', 'completed')
    on conflict (assignment_id, student_id) do update set status = 'completed';
  `)
  const afterCompletion = invokeScheduled('homework-due-reminders', amsterdamInstant(today, 8))
  check(
    'a student who already completed it is left out',
    // Fatimah's two deliveries — her parent's and her own — drop out of
    // the five.
    afterCompletion.body.sent === 3,
    JSON.stringify(afterCompletion.body),
  )
  sql(`delete from public.assignment_status where assignment_id='${DUE_TOMORROW}'`)
  await new Promise((resolve) => setTimeout(resolve, 8000))
  await clearTray(siti.page)
  await clearTray(rudi.page)
  await clearTray(fatimah.page)

  console.log('\n4i. weekly-progress-digest → real notification')
  const thisFriday = addDaysStr(mondayOf(today), 4)
  const thursday = addDaysStr(mondayOf(today), 3)
  // The digest summarises `weekStart(today) … today`, and the run is
  // pinned to this week's Friday — so everything the sections above
  // recorded, which is stamped with the *real* current date, is inside
  // that window only from Monday to Friday. Run on a Saturday the
  // digest correctly found nothing and this section failed for a reason
  // that had nothing to do with the digest. One present-marked session
  // dated on the Friday itself makes it the same test on any day.
  sql(`
    insert into public.sessions (class_id, date, tutor_id)
    values ('${KELAS_A}', '${thisFriday}', '${AHMAD.id}')
    on conflict (class_id, date) do nothing;
  `)
  const fridaySession = sql(
    `select id from public.sessions where class_id='${KELAS_A}' and date='${thisFriday}'`,
  )
  // 'present', deliberately: the absence webhook fires only on the
  // transition *into* absent (migration 009), so this seeds activity
  // without also sending two families a notification.
  sql(`
    insert into public.attendance (session_id, student_id, status)
    values ('${fridaySession}', '${ALI}', 'present'), ('${fridaySession}', '${ZAINAB}', 'present')
    on conflict (session_id, student_id) do update set status = 'present';
  `)
  const wrongDay = invokeScheduled('weekly-progress-digest', amsterdamInstant(thursday, 8))
  check(
    'the digest does not go out on a Thursday',
    wrongDay.body.skipped === 'not the scheduled weekday',
    JSON.stringify(wrongDay.body),
  )
  const wrongHour = invokeScheduled('weekly-progress-digest', amsterdamInstant(thisFriday, 9))
  check(
    'nor at 09:00 on the Friday',
    wrongHour.body.skipped === 'not 8:00 in Europe/Amsterdam',
    JSON.stringify(wrongHour.body),
  )

  // ── Whether this Friday can carry a real push, and why it might not ──
  // Unlike every other delivery here, the digest's instant is not
  // "today": it is this week's Friday, and the clock is pinned to it.
  // `web-push` signs its VAPID JWT from that pinned clock, and a push
  // service rejects a JWT whose `exp` has passed or is more than 24h
  // ahead — so run on a Saturday, the Friday 08:00 JWT expired eleven
  // hours before the request was made and every send comes back
  // `failed`. That is the caveat `scripts/invoke-scheduled.mjs` already
  // documents, and this section did not respect it: it asserted a real
  // notification on a day when no valid JWT can exist, so it failed for
  // a reason that has nothing to do with the digest.
  //
  // The digest's *own* decisions — the weekday gate, the hour gate,
  // which children have a week worth summarising, and idempotency — are
  // asserted every day either way. What varies is only the transport,
  // and when it cannot be exercised the subscriptions are taken out of
  // play (as §4f already does for the DST gate) so the run reports a
  // clean "nobody to push to" rather than a spurious failure. The
  // identical `dispatch` path is proven against a real push service in
  // §4g and §4h in the same run.
  const digestInstant = amsterdamInstant(thisFriday, 8)
  const digestCanPush = Math.abs(Date.parse(digestInstant) - Date.now()) < 11 * 3600_000
  if (!digestCanPush) {
    console.log(
      `       (push leg not exercised: a VAPID JWT signed at ${digestInstant} is not valid at real now —` +
        ' the digest decides on Fridays and today is not one. Its recipients are asserted below;' +
        ' delivery is proven in 4g/4h)',
    )
  }

  const digestSubs = [SITI, RUDI, FATIMAH_USER].map((u) => ({
    id: u.id,
    sub: sql(`select coalesce(push_sub::text, 'null') from public.users where id='${u.id}'`),
  }))
  if (!digestCanPush) sql(`update public.users set push_sub = null`)

  const digest = invokeScheduled('weekly-progress-digest', digestInstant)
  // Ali and Zainab were both marked present in a session dated on the
  // Friday above. `>= 2` rather than `=== 2` because the window is
  // Monday→Friday: run on a weekday, everything the sections above
  // recorded today is inside it too, and which children that adds
  // depends on the day rather than on the digest.
  check(
    'the Friday 08:00 run summarises the children with a week behind them',
    digest.body.recorded >= 2,
    JSON.stringify(digest.body),
  )
  check(
    '…addressed to their parent, one row per child',
    sql(`select count(*) from public.notifications
         where user_id='${SITI.id}' and event='weeklyDigest' and event_date='${thisFriday}'
           and student_id in ('${ALI}', '${ZAINAB}')`) === '2',
  )
  check(
    digestCanPush ? 'the Friday 08:00 run sends' : 'the Friday 08:00 run has nobody to push to',
    digestCanPush ? digest.body.sent >= 1 : digest.body.skipped === 'no push subscription',
    JSON.stringify(digest.body),
  )

  if (digestCanPush) {
    const sitiDigest = await waitForCount(siti.page, 2)
    check(
      'Ibu Siti received the weekly digest, one per child',
      sitiDigest.some((n) => n.body === 'Ringkasan mingguan Ali sudah siap') &&
        sitiDigest.some((n) => n.body === 'Ringkasan mingguan Zainab sudah siap'),
      JSON.stringify(sitiDigest.map((n) => n.body)),
    )
    check(
      'DPIA R6: no attendance percentage on the lock screen',
      !/%|\d+\s*(dari|van)/.test(JSON.stringify(sitiDigest)),
      JSON.stringify(sitiDigest.map((n) => n.body)),
    )
  }

  const digestRerun = invokeScheduled('weekly-progress-digest', digestInstant)
  const digestTrayBefore = (await shown(siti.page)).length
  await new Promise((resolve) => setTimeout(resolve, 12000))
  check(
    'IDEMPOTENT: a second Friday run adds no notifications',
    (await shown(siti.page)).length === digestTrayBefore,
    `${digestTrayBefore} → ${(await shown(siti.page)).length}`,
  )
  check('…and reports the same sends', digestRerun.body.sent === digest.body.sent, JSON.stringify(digestRerun.body))
  check(
    '…and the same rows, updated rather than duplicated',
    sql(`select count(*) from public.notifications
         where event='weeklyDigest' and event_date='${thisFriday}'`) === String(digest.body.recorded),
  )

  // A child with no activity at all this week is not summarised. Umar
  // is in Kelas B, which nothing above has touched.
  check(
    'a quiet week is not summarised',
    digest.body.recorded < Number(sql('select count(*) from public.students where parent_id is not null')),
    JSON.stringify(digest.body),
  )

  for (const { id, sub } of digestSubs) {
    if (sub !== 'null') sql(`update public.users set push_sub = $j$${sub}$j$::jsonb where id='${id}'`)
  }

  await clearTray(siti.page)
  await clearTray(rudi.page)
  await clearTray(fatimah.page)

  console.log('\n4j. in-app notification centre (ADR-017)')
  // Every push above should also have left a row in the centre. The
  // counts are asserted against the *senders'* own reported `recorded`
  // where possible, and against the database otherwise.
  const notifCount = (userId, extra = '') =>
    Number(sql(`select count(*) from public.notifications where user_id='${userId}' ${extra}`))

  check(
    'the absence, milestone, homework and report events all left rows for Ibu Siti',
    notifCount(SITI.id) >= 5,
    `${notifCount(SITI.id)} rows`,
  )
  check(
    'each row names a child of that family and nobody else',
    sql(`select count(*) from public.notifications n
         join public.students s on s.id = n.student_id
         where n.user_id='${SITI.id}' and s.parent_id <> '${SITI.id}'`) === '0',
  )
  check(
    'CROSS-FAMILY: the other parent’s rows are all about their own child',
    sql(`select count(*) from public.notifications n
         join public.students s on s.id = n.student_id
         where n.user_id='${RUDI.id}' and s.parent_id <> '${RUDI.id}'`) === '0',
  )
  check(
    'the in-app row carries the detail the lock screen may not — the jilid number',
    sql(`select context->>'number' from public.notifications
         where user_id='${SITI.id}' and event='jilidMilestone' limit 1`) === '1',
    sql(`select context::text from public.notifications where user_id='${SITI.id}' and event='jilidMilestone' limit 1`),
  )
  check(
    '…and the assignment title',
    sql(`select context->>'title' from public.notifications
         where user_id='${SITI.id}' and event='assignmentDueTomorrow' limit 1`) === 'Menulis huruf hijaiyah',
  )
  check(
    'the child’s name is never stored on the row',
    sql(`select count(*) from public.notifications where context::text ilike '%ali%' or context::text ilike '%zainab%'`) === '0',
  )
  check(
    'a repeated scheduled run updates its row rather than adding one',
    sql(`select count(*) from public.notifications
         where user_id='${SITI.id}' and event='assignmentDueTomorrow'
           and student_id='${ALI}' and event_date='${today}'`) === '1',
  )
  // This used to read "no admin or tutor was given a notification row",
  // which asserted the bug ADR-022 fixed rather than the property worth
  // having: a tutor whose own child attends *should* have rows. The
  // invariant underneath it is about relationships and holds for every
  // account whatever its role — every row is addressed to that child's
  // own parent, or to that child's own 16+ login, and to nobody else.
  check(
    'every notification row is addressed to that child’s own parent or the child themselves',
    sql(`select count(*) from public.notifications n join public.students s on s.id = n.student_id
         where n.user_id <> s.parent_id
           and (s.user_id is null or n.user_id <> s.user_id)`) === '0',
  )

  // The property the centre exists for: a family with push switched off
  // still gets the in-app record.
  const savedRudi = sql(`select coalesce(push_sub::text,'null') from public.users where id='${RUDI.id}'`)
  sql(`update public.users set push_sub = null where id='${RUDI.id}'`)
  const beforeOff = notifCount(RUDI.id)
  sql(`delete from public.notifications where user_id='${RUDI.id}' and event='murajaahReminder'`)
  assignMurajaah(FATIMAH)
  sql(`update public.murajaah_assignments set frequency='daily' where id='${MURAJAAH_TARGET}'`)
  sql(`delete from public.murajaah_log where assignment_id='${MURAJAAH_TARGET}'`)
  const offRun = invokeScheduled('send-murajaah-reminders', amsterdamInstant(today, 18))
  check(
    'a family with push disabled is still recorded in the centre',
    offRun.body.recorded >= 1 && offRun.body.sent === 0,
    JSON.stringify(offRun.body),
  )
  check(
    '…and the row is really there',
    notifCount(RUDI.id, `and event='murajaahReminder'`) === 1,
    `${notifCount(RUDI.id)} rows total (was ${beforeOff})`,
  )
  check(
    'the sender reports recorded separately from sent',
    offRun.body.skipped === 'no push subscription',
    JSON.stringify(offRun.body),
  )
  sql(`delete from public.murajaah_assignments where id='${MURAJAAH_TARGET}'`)
  if (savedRudi !== 'null') sql(`update public.users set push_sub = $j$${savedRudi}$j$::jsonb where id='${RUDI.id}'`)

  console.log('\n4k. the centre on screen, and the bell')
  await siti.page.goto(`${ORIGIN}/notifications`, { waitUntil: 'domcontentloaded' })
  // The rows arrive after a round trip, so waiting for the heading is
  // not waiting for the list — an earlier version of this read the page
  // before any row had rendered and reported an empty centre.
  await siti.page.locator('li').first().waitFor({ timeout: 20000 })
  const centreText = await siti.page.locator('body').innerText()
  check('the centre lists the absence in Indonesian', centreText.includes('Ali tidak hadir hari ini di TPA'), centreText.slice(0, 160))
  check(
    'the jilid number appears in the app, where R6 allows it',
    /Jilid 1/.test(centreText),
    centreText.slice(0, 300),
  )
  check('the centre names both children', /Ali/.test(centreText) && /Zainab/.test(centreText))
  check(
    'CROSS-FAMILY: the other family’s child is nowhere on the screen',
    !/Fatimah/.test(centreText),
  )
  check(
    'opening the centre clears the unread count',
    sql(`select count(*) from public.notifications where user_id='${SITI.id}' and read_at is null`) === '0',
  )

  await siti.page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
  check('the TopNav bell is shown to a parent', (await bellCount(siti.page)) === 1)

  // A tutor with no child of their own, and an admin likewise, get no
  // bell at all.
  const tutorCtx = await openAs(AHMAD)
  try {
    await tutorCtx.page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
    check(
      'no bell for a tutor with no child of their own — they receive none and can read none',
      // Scoped to the header: the dashboard has its own "Notifikasi"
      // link to the *settings* screen, which everyone gets and which an
      // unscoped selector matched.
      (await bellCount(tutorCtx.page)) === 0,
    )
    await tutorCtx.page.goto(`${ORIGIN}/notifications`, { waitUntil: 'domcontentloaded' })
    // The screen cannot say "you are linked to no santri" until it knows
    // the relationships, which is a round trip since ADR-022 — reading
    // the body straight after the navigation caught it mid-"Memuat…".
    // Waiting for the sentence is also the assertion that it arrives.
    await tutorCtx.page
      .getByText(/belum terhubung dengan santri mana pun|aan geen enkele leerling gekoppeld/i)
      .waitFor({ timeout: 15000 })
      .catch(() => undefined)
    const tutorText = await tutorCtx.page.locator('body').innerText()
    check(
      'a tutor visiting the centre directly is told plainly they are linked to no santri',
      /belum terhubung dengan santri mana pun|aan geen enkele leerling gekoppeld/i.test(tutorText),
      tutorText.slice(0, 200),
    )
    check('a tutor sees no family’s notification on that screen', !/tidak hadir hari ini/.test(tutorText))
    check('no console errors (tutor, notification centre)', tutorCtx.consoleErrors.length === 0, tutorCtx.consoleErrors.join(' | '))
  } finally {
    await tutorCtx.context.close()
  }

  console.log('\n4l. retention (DPIA R5)')
  sql(`
    insert into public.notifications (user_id, student_id, event, event_date, created_at)
    values ('${SITI.id}', '${ALI}', 'weeklyDigest', current_date - 200, now() - interval '200 days')
    on conflict do nothing;
  `)
  const beforePrune = notifCount(SITI.id)
  const pruned = invokeScheduled('prune-notifications', amsterdamInstant(today, 3))
  check('the prune job deletes past the retention window', pruned.body.deleted === 1, JSON.stringify(pruned.body))
  check('…and leaves everything inside it', notifCount(SITI.id) === beforePrune - 1)
  check(
    'the job reports its cutoff, so a DPIA review has something to read',
    pruned.body.retentionDays === 90 && typeof pruned.body.cutoff === 'string',
    JSON.stringify(pruned.body),
  )
  const pruneAgain = invokeScheduled('prune-notifications', amsterdamInstant(today, 3))
  check('a second prune run deletes nothing', pruneAgain.body.deleted === 0, JSON.stringify(pruneAgain.body))
  check(
    'the prune job does nothing outside its hour',
    String(invokeScheduled('prune-notifications', amsterdamInstant(today, 10)).body.skipped ?? '').startsWith('not 3:00'),
  )

  console.log('\n4m. a tutor-parent and an admin-parent (ADR-022)')
  // The bug this section exists for was silent: a tutor whose own child
  // attends the TPA received nothing about that child — no push, no
  // in-app row — and could not store a subscription in the first place,
  // which is indistinguishable from a quiet week. So it is proven here
  // end to end rather than inferred from the unit suite: a real browser,
  // a real subscription, a real absence, a real push service.
  //
  // Both accounts teach Kelas A and have their own child in Kelas B. The
  // two halves of the rule are therefore asserted against the same
  // account in the same run: they hear about their own child, and they
  // hear nothing about the class they teach.
  // Every child in the fixture, so "nobody else's" can be asserted as a
  // closed set rather than as a couple of names somebody remembered.
  const EVERY_CHILD = ['Ali', 'Zainab', 'Fatimah', 'Umar', 'Yusuf', 'Khadijah', 'Salma', 'Aisyah']

  for (const persona of [
    {
      label: 'tutor-parent',
      user: AMINAH,
      who: 'Ustadzah Aminah (users.role = tutor, teaches Kelas A, own child in Kelas B)',
      childId: YUSUF,
      childName: 'Yusuf',
    },
    {
      label: 'admin-parent',
      user: LAILA,
      who: 'Ustadzah Laila (users.role = admin, teaches Kelas A, own child in Kelas B)',
      childId: SALMA,
      childName: 'Salma',
    },
  ]) {
    // One at a time rather than both at once: each persona drives a real
    // Chromium with a real FCM registration, and the fewer of those are
    // live simultaneously the less a delivery failure can be somebody
    // else's resource problem rather than this rule's.
    const ctx = await openAs(persona.user)
    const others = new RegExp(EVERY_CHILD.filter((n) => n !== persona.childName).join('|'))
    try {
      await clearTray(siti.page)

      // 1. The settings screen offers them the toggle at all, and
      //    `push-subscribe` honours it. It used to tell them their role
      //    receives nothing, and 403 them if they tried anyway.
      await enable(ctx.page, persona.who)
      check(
        `${persona.label}: can store a push subscription at all`,
        sql(`select push_sub is not null from public.users where id='${persona.user.id}'`) === 't',
      )

      // 2. Their own child, in a class they do not teach.
      markAbsent(persona.childId)
      const own = await waitForNotification(ctx.page)
      check(
        `${persona.label}: receives the push about their OWN child`,
        own.length === 1 && own[0].body === `${persona.childName} tidak hadir hari ini di TPA`,
        JSON.stringify(own),
      )
      check(
        `${persona.label}: …tagged to them and to that child`,
        own[0]?.tag === `absence:${persona.user.id}:${persona.childId}:${today}`,
        own[0]?.tag,
      )
      check(
        `${persona.label}: …and the in-app row is there too`,
        sql(`select count(*) from public.notifications
             where user_id='${persona.user.id}' and student_id='${persona.childId}'
               and event='absence'`) === '1',
      )

      // 3. The half of ADR-015(a) that survives, live: a child in the
      //    class they teach. Ibu Siti is that child's parent and is
      //    subscribed, so this also proves the notification was really
      //    sent — a silent pipeline would pass the negative for the
      //    wrong reason.
      await clearTray(ctx.page)
      markPresent(ALI)
      markAbsent(ALI, 'demam')
      const sitiAgain = await waitForNotification(siti.page)
      check(
        `${persona.label}: the class absence really was delivered — to that child’s own parent`,
        sitiAgain.length === 1 && sitiAgain[0].body === 'Ali tidak hadir hari ini di TPA',
        JSON.stringify(sitiAgain),
      )
      check(
        `${persona.label}: DATA MINIMISATION — nothing at all about a pupil in the class they teach`,
        (await shown(ctx.page)).length === 0,
        JSON.stringify(await shown(ctx.page)),
      )
      check(
        `${persona.label}: …and no in-app row was written for them either`,
        sql(`select count(*) from public.notifications
             where user_id='${persona.user.id}' and student_id='${ALI}'`) === '0',
      )

      // 4. The centre, read through RLS as they see it. The admin is the
      //    one that matters: ADR-014 made admin a super admin over every
      //    operational screen, and `public.notifications` is the one
      //    table that does not reach (ADR-017(d), pgTAP NC-14).
      await ctx.page.goto(`${ORIGIN}/notifications`, { waitUntil: 'domcontentloaded' })
      await ctx.page.locator('li').first().waitFor({ timeout: 20000 })
      const centre = await ctx.page.locator('body').innerText()
      check(`${persona.label}: their centre lists their own child`, new RegExp(persona.childName).test(centre))
      check(
        `${persona.label}: CROSS-FAMILY — and names no other child in the school`,
        !others.test(centre),
        centre.slice(0, 300),
      )

      // 5. And the bell, which is the same gate a third time.
      await ctx.page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' })
      check(`${persona.label}: the TopNav bell is shown`, (await bellCount(ctx.page)) === 1)

      check(`${persona.label}: no console errors`, ctx.consoleErrors.length === 0, ctx.consoleErrors.join(' | '))
      check(`${persona.label}: no failed requests`, ctx.failedRequests.length === 0, ctx.failedRequests.join(' | '))
    } finally {
      await ctx.context.close()
    }
  }
  await clearTray(siti.page)

  console.log('\n5. unsubscribe → silence')
  const disable = rudi.page.getByRole('button', { name: /Meldingen uitschakelen|Matikan notifikasi/ })
  await disable.waitFor({ timeout: 15000 })
  await disable.click()
  await rudi.page.getByText(/Meldingen staan uit|Notifikasi tidak aktif/).waitFor({ timeout: 20000 })
  check('unsubscribe clears users.push_sub', sql(`select push_sub is null from public.users where id='${RUDI.id}'`) === 't')

  await clearTray(rudi.page)
  markPresent(FATIMAH)
  markAbsent(FATIMAH)
  await new Promise((resolve) => setTimeout(resolve, 15000))
  check('an unsubscribed parent receives nothing at all', (await shown(rudi.page)).length === 0)

  console.log('\n6. browser health')
  check('no console errors (Ibu Siti)', siti.consoleErrors.length === 0, siti.consoleErrors.join(' | '))
  check('no console errors (Bapak Rudi)', rudi.consoleErrors.length === 0, rudi.consoleErrors.join(' | '))
  check('no console errors (Fatimah, 16+ student)', fatimah.consoleErrors.length === 0, fatimah.consoleErrors.join(' | '))
  check('no failed requests (Ibu Siti)', siti.failedRequests.length === 0, siti.failedRequests.join(' | '))
  console.log(`       (navigation-aborted requests, not failures — Siti ${siti.aborted.length}, Rudi ${rudi.aborted.length}, Fatimah ${fatimah.aborted.length})`)
  check('no failed requests (Bapak Rudi)', rudi.failedRequests.length === 0, rudi.failedRequests.join(' | '))
  check('no failed requests (Fatimah, 16+ student)', fatimah.failedRequests.length === 0, fatimah.failedRequests.join(' | '))
} finally {
  await siti.context.close()
  await rudi.context.close()
  await fatimah.context.close()
  sql(`update public.users set locale='id' where id='${RUDI.id}'`)
}

// Ustadz Ahmad teaches both classes and has no child of his own; Admin
// Dev has neither. Neither is a recipient — not because of what their
// role column says, but because no student row points at them (ADR-022).
// The tutor-parent and admin-parent cases in 4m are the other half of
// this: same roles, different relationships, opposite outcome.
console.log('\n7. accounts no student row points at (ADR-022)')
for (const [label, user] of [['tutor', AHMAD], ['admin', ADMIN]]) {
  const ctx = await openAs(user)
  try {
    const text = await ctx.page.locator('body').innerText()
    check(`${label}: told plainly that this account is linked to no santri`, text.includes('Akun ini belum terhubung dengan santri mana pun'))
    check(`${label}: no enable button is offered`, (await ctx.page.getByRole('button', { name: /Aktifkan notifikasi/ }).count()) === 0)
    check(`${label}: the lock-screen privacy note is still readable`, text.includes('Apa yang tampil di layar kunci'))
    check(`${label}: no console errors`, ctx.consoleErrors.length === 0, ctx.consoleErrors.join(' | '))
    check(`${label}: no failed requests`, ctx.failedRequests.length === 0, ctx.failedRequests.join(' | '))
  } finally {
    await ctx.context.close()
  }
}

console.log('\n8. endpoint authorization')
const post = (path, init) => fetch(`${ORIGIN}/.netlify/functions/${path}`, init)
const asUser = (user, body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${mintJwt(user.id)}` },
  body: JSON.stringify(body),
})
// A real 65-byte P-256 point and 16-byte auth secret. It used to be
// `{ p256dh: 'a', auth: 'b' }`, which `push-subscribe` happily stored —
// and which `web-push` then refused locally, with no status code, on
// every notification those three accounts were owed from that point on.
// The endpoint is still a dummy: this section is about who may store a
// subscription, and nothing here is ever delivered to.
const VALID_SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/x',
  keys: {
    p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM=',
    auth: 'tBHItJI5svbpez7KI4CCXg==',
  },
}

// The gate is the relationship, so the same two roles appear on both
// sides of it: refused when no student row points at the account,
// accepted when one does (ADR-022).
check('push-subscribe refuses a tutor with no child of their own', (await post('push-subscribe', asUser(AHMAD, VALID_SUB))).status === 403)
check('push-subscribe refuses an admin with no child of their own', (await post('push-subscribe', asUser(ADMIN, VALID_SUB))).status === 403)
check('push-subscribe accepts a tutor whose own child attends', (await post('push-subscribe', asUser(AMINAH, VALID_SUB))).status === 201)
check('push-subscribe accepts an admin whose own child attends', (await post('push-subscribe', asUser(LAILA, VALID_SUB))).status === 201)
check('push-subscribe accepts a 16+ santri, through their own record', (await post('push-subscribe', asUser(FATIMAH_USER, VALID_SUB))).status === 201)
check('push-subscribe rejects a non-HTTPS endpoint', (await post('push-subscribe', asUser(RUDI, { ...VALID_SUB, endpoint: 'http://evil.example/x' }))).status === 400)
check('push-subscribe rejects junk', (await post('push-subscribe', asUser(RUDI, { nope: true }))).status === 400)
// A subscription that cannot be sent to must be refused at the door
// rather than stored: `web-push` rejects a wrong-length key locally with
// no status code, which `sendPush` can only record as `failed` and never
// as `gone`, so nothing would ever clear it.
check(
  'push-subscribe rejects a key pair that could never be sent to',
  (await post('push-subscribe', asUser(RUDI, { ...VALID_SUB, keys: { p256dh: 'a', auth: 'b' } }))).status === 400,
)
check('push-subscribe requires a session', (await post('push-subscribe', { method: 'POST', body: '{}' })).status === 401)
check('notify-absence rejects a missing webhook secret', (await post('notify-absence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"record":{"id":"x"}}' })).status === 401)
check('notify-absence rejects a wrong webhook secret', (await post('notify-absence', { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-secret': 'wrong' }, body: '{"record":{"id":"x"}}' })).status === 401)
check('notify-absence rejects GET', (await post('notify-absence', { method: 'GET' })).status === 405)

const noSub = await post('notify-absence', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET },
  body: JSON.stringify({ record: { id: sql(`select id from public.attendance where student_id='${FATIMAH}' limit 1`) } }),
})
check('a valid webhook for an unsubscribed parent is a no-op 200', noSub.status === 200 && (await noSub.json()).sent === 0)

// The scheduled Functions carry no secret — Netlify's scheduler cannot
// send one — and under `netlify dev` they are ordinary endpoints. What
// must hold is that being reachable buys nothing: outside the
// Amsterdam hour they do nothing, they read no part of the request, and
// they never disclose an identifier. ADR-016(d)/(e).
for (const job of ['send-murajaah-reminders', 'homework-due-reminders', 'weekly-progress-digest']) {
  const anonymous = await post(job, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Deliberately hostile: a body naming another family's child, which
    // the Function must not so much as read.
    body: JSON.stringify({ student_id: FATIMAH, hour: 18, force: true }),
  })
  const body = await anonymous.json()
  const serialized = JSON.stringify(body)
  check(
    `${job}: an unauthenticated caller learns nothing — no tags, no ids`,
    anonymous.status === 200 &&
      !('tags' in body) &&
      !serialized.includes(FATIMAH) &&
      !serialized.includes(SITI.id) &&
      !serialized.includes(RUDI.id),
    serialized,
  )
  check(
    `${job}: …and the posted body is ignored entirely`,
    // Whatever the gate decides, it decides it from the clock. The only
    // shapes possible are a skip or a count — never anything derived
    // from what was posted.
    typeof body.skipped === 'string' || typeof body.sent === 'number',
    serialized,
  )
}


// The gates ADR-025 introduces, asserted against the rendered app for
// the same reason section 7 is: a switch that appears for the wrong
// person shows them a screen that is not theirs, and no unit test over
// `viewScope.ts` can prove the component consulted it.
console.log('\n9. view scope (ADR-025)')
{
  const switchGroup = (page) => page.getByRole('group', { name: /Tampilan|Weergave/ })

  // Nobody who is one thing may be offered a second. This is the whole
  // regression bar of ADR-025, and it is asserted for each of the four
  // single-relationship personas rather than argued from the lattice.
  for (const [label, user] of [
    ['pure parent', SITI],
    ['pure tutor', AHMAD],
    ['16+ santri', FATIMAH_USER],
    ['pure admin', ADMIN],
  ]) {
    const ctx = await openAs(user)
    try {
      await ctx.page.goto(`${ORIGIN}/attendance`, { waitUntil: 'networkidle' })
      await ctx.page.waitForTimeout(1500)
      check(`${label}: no scope switch is rendered`, (await switchGroup(ctx.page).count()) === 0)
      check(`${label}: no failed requests on the register`, ctx.failedRequests.length === 0, ctx.failedRequests.join(' | '))
    } finally {
      await ctx.context.close()
    }
  }

  // …and everybody who is two things gets one, labelled by subject.
  // The label assertion is the one that keeps PRD §70 honest: a control
  // captioned "Ustadz"/"Orang Tua" would be the switcher that note
  // rejects, whatever the code underneath it derives.
  for (const [label, user, expected] of [
    ['tutor-parent (disjoint)', AMINAH, ['Kelas saya', 'Anak saya']],
    ['tutor-parent (overlap)', HASAN, ['Kelas saya', 'Anak saya']],
    ['admin + tutor + parent', LAILA, ['Kelas saya', 'Anak saya']],
    ['student assistant', AISYAH_USER, ['Kelas saya', 'Saya']],
  ]) {
    const ctx = await openAs(user)
    try {
      await ctx.page.goto(`${ORIGIN}/attendance`, { waitUntil: 'networkidle' })
      await ctx.page.waitForTimeout(1500)
      const options = await switchGroup(ctx.page).first().getByRole('button').allInnerTexts()
      check(`${label}: is offered both scopes`, options.length === 2, options.join(' | '))
      check(`${label}: labelled by subject, not by role`, options.join('|') === expected.join('|'), options.join(' | '))
      check(`${label}: defaults to the class scope`, (await ctx.page.locator('h1').first().innerText()) === 'Kehadiran')
      check(`${label}: no failed requests`, ctx.failedRequests.length === 0, ctx.failedRequests.join(' | '))
    } finally {
      await ctx.context.close()
    }
  }

  // ADR-023(c), closed. The assistant now reaches the register for the
  // class she is enrolled in — which is what this PR changed — and the
  // upsert must leave her own row out while writing every classmate's.
  // Asserted by taking the register for real and reading the table,
  // because the whole failure mode is a payload that looks right.
  //
  // The date is the browser's, not Postgres's. `submitAttendance` writes
  // `todayLocalDate()` — Europe/Amsterdam — while `current_date` in the
  // container is UTC, and between local midnight and 02:00 CEST those
  // are different days. Comparing against `current_date` made this
  // section fail after midnight while the register had in fact written
  // every row correctly, one day further on. The suite already knows
  // this hazard: it is the same skew the weekly digest narrows for
  // (test-plan §4.6, "00:30 Monday in Amsterdam is 23:30 Sunday in
  // UTC").
  const LOCAL_DATE = "(now() at time zone 'Europe/Amsterdam')::date"
  const before = sql(`select count(*) from public.attendance a join public.sessions s on s.id=a.session_id where s.class_id='${KELAS_A}' and s.date=${LOCAL_DATE} and a.student_id='${AISYAH}'`)
  const ctx = await openAs(AISYAH_USER)
  try {
    await ctx.page.goto(`${ORIGIN}/attendance`, { waitUntil: 'networkidle' })
    await ctx.page.waitForTimeout(2000)
    const body = await ctx.page.locator('main').innerText()
    check('assistant: her own row is shown on the register, not hidden', body.includes('Aisyah'))
    check('assistant: and captioned as somebody else\'s to fill in', body.includes('Kehadiranmu sendiri dicatat oleh ustadz lain atau admin.'))

    await ctx.page.getByRole('button', { name: /^Kirim Kehadiran$/ }).click()
    await ctx.page.getByRole('button', { name: /^Konfirmasi$/ }).click()
    await ctx.page.getByText('Kehadiran berhasil dikirim').waitFor({ timeout: 15000 })

    check('assistant: the register saves rather than failing the whole class', true)
    check(
      'assistant: her own attendance row is not written',
      sql(`select count(*) from public.attendance a join public.sessions s on s.id=a.session_id where s.class_id='${KELAS_A}' and s.date=${LOCAL_DATE} and a.student_id='${AISYAH}'`) === before,
    )
    check(
      'assistant: every classmate is written, including a tutor-parent’s own child (ADR-024)',
      sql(`select count(*) from public.attendance a join public.sessions s on s.id=a.session_id where s.class_id='${KELAS_A}' and s.date=${LOCAL_DATE} and a.student_id='${KHADIJAH}'`) === '1',
    )
    check('assistant: no failed requests taking the register', ctx.failedRequests.length === 0, ctx.failedRequests.join(' | '))

    // The evaluative screens go further: her own name is off the roster
    // entirely, mirroring `fn_my_recordable_students()` rather than
    // showing her a row every save would refuse.
    await ctx.page.goto(`${ORIGIN}/yanbua`, { waitUntil: 'networkidle' })
    await ctx.page.waitForTimeout(2000)
    const yanbua = await ctx.page.locator('main').innerText()
    check('assistant: her own name is off the Yanbu’a roster she teaches', !yanbua.includes('Aisyah'))
    check('assistant: her classmates are still on it', yanbua.includes('Ali') && yanbua.includes('Zainab'))
    check('assistant: no failed requests on a recording screen', ctx.failedRequests.length === 0, ctx.failedRequests.join(' | '))
  } finally {
    await ctx.context.close()
  }
}

// The child picker's card follows the picker, asserted on the rendered
// page because that is the only place the bug existed. `ChildPicker`
// returns null for a family with one child, and all six family views
// used to draw the white card around it themselves — so the card stayed
// behind, empty, on every screen a single-child family opened. Nothing
// in TypeScript or in a unit test can see an empty box; only a rendered
// DOM can, which is why these checks live here rather than in Vitest.
console.log('\n10. the child picker takes its card with it')
{
  const FAMILY_ROUTES = ['/attendance', '/assignments', '/yanbua', '/quran', '/murajaah', '/reports']

  // A person with exactly one record on their family screens — the 16+
  // santri, who lands on those screens by default and sees precisely one
  // subject, herself. No picker, and therefore no card that held it.
  {
    const ctx = await openAs(FATIMAH_USER)
    try {
      for (const route of FAMILY_ROUTES) {
        await ctx.page.goto(`${ORIGIN}${route}`, { waitUntil: 'networkidle' })
        await ctx.page.waitForTimeout(1200)
        const body = await ctx.page.locator('main').innerText()
        check(`single record ${route}: no picker is offered`, !body.includes('Pilih Anak'))
        // The regression itself: a white card with nothing inside it.
        const empty = await ctx.page.$$eval(
          'div.rounded-lg.bg-white',
          (els) => els.filter((el) => el.textContent.trim() === '').length,
        )
        check(`single record ${route}: and no empty card is left behind`, empty === 0, `${empty} empty card(s)`)
      }
      check('single record: no failed requests across the family screens', ctx.failedRequests.length === 0, ctx.failedRequests.join(' | '))
    } finally {
      await ctx.context.close()
    }
  }

  // …and the other half, so the fix cannot be "delete the picker": a
  // parent of three still gets it, still inside a card of its own.
  {
    const ctx = await openAs(SITI)
    try {
      for (const route of FAMILY_ROUTES) {
        await ctx.page.goto(`${ORIGIN}${route}`, { waitUntil: 'networkidle' })
        await ctx.page.waitForTimeout(1200)
        const body = await ctx.page.locator('main').innerText()
        check(`three children ${route}: the picker is still offered`, body.includes('Pilih Anak'))
        const carded = await ctx.page.$$eval('div.rounded-lg.bg-white select', (els) => els.length)
        check(`three children ${route}: and still sits inside its card`, carded >= 1, `${carded} carded select(s)`)
      }
      check('three children: no failed requests across the family screens', ctx.failedRequests.length === 0, ctx.failedRequests.join(' | '))
    } finally {
      await ctx.context.close()
    }
  }
}

for (const dir of profiles) rmSync(dir, { recursive: true, force: true })

const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) console.log(failed.map((f) => `  FAILED: ${f.name}`).join('\n'))
process.exit(failed.length === 0 ? 0 : 1)
