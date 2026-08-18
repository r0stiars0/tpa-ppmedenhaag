# TPA PPME Den Haag

Progress-tracking PWA for PPME Den Haag's TPA (Taman Penitipan Al-Quran) program —
attendance, homework, Yanbu'a/Quran/Murajaah progress, and year-end reports for
tutors, parents, and students.

Full specs live in [`docs/`](./docs): [PRD](./docs/PRD-PPME-TPA.md),
[TAD](./docs/TAD-PPME-TPA.md), [dev checklist](./docs/PPME-TPA-Development-Checklist.md),
[API contract](./docs/openapi.yaml), [test plan](./docs/test-plan.md).

## Stack

React + Vite + TypeScript + Tailwind CSS v4, Supabase (Postgres + Auth + Storage,
Frankfurt/eu-central-1), Netlify (hosting + Functions), react-i18next (id/nl),
vite-plugin-pwa (Workbox).

## Local development

```bash
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
                        # from Supabase dashboard > Project Settings > API
npm run dev
```

```bash
npm run typecheck            # tsc -b --noEmit (src/)
npm run typecheck:functions  # tsc -p netlify/functions (Netlify Functions, not covered by the above)
npm run test                  # Vitest unit tests
npm run test:coverage         # …with a v8 coverage report over src/lib + netlify/functions/lib
npm run test:e2e              # Playwright (starts its own dev server)
npm run build                  # production build
```

## Database

Migrations live in `supabase/migrations/` (001–012, applied in order). The
project is already linked (`supabase/config.toml` + `supabase link`); to apply
a new migration:

```bash
supabase db push
```

### Local Postgres (requires Docker)

`supabase start` runs a full local stack (Postgres, GoTrue, PostgREST, Storage)
via Docker and applies `supabase/migrations/` automatically — this is how CI's
`rls` job runs, and it's the safest way to develop/test against real RLS
without touching the linked Frankfurt project:

```bash
supabase start   # first run pulls several images, can take a few minutes
supabase stop    # tears the stack down; add --no-backup to also drop the volume
```

If `docker ps` fails with a permission error, your user likely isn't in the
`docker` group yet: `sudo usermod -aG docker $USER`, then start a fresh login
session (the group change doesn't apply to already-running shells — in a pinch,
`sg docker -c "supabase start"` picks it up without a new login).

Point `.env` at the local stack (`API_URL`/`ANON_KEY` from the `supabase start`
output, both under `http://127.0.0.1:54321`) to run `npm run dev` against it
instead of Frankfurt. **Never point tests or local dev at data you wouldn't
want in a shared dev database** — see test-plan.md's "no real student data in
any test environment, ever" rule; this applies to the linked project, not the
local Docker stack, which is disposable and per-machine.

#### Dev fixture + fixture sign-in (no real Google OAuth needed)

`supabase/dev-fixture.sql` seeds a small realistic dataset (2 tutors — one
assigned to both classes, one to Grup B only — plus admin, 2 parents,
4 multi-role accounts, 2 classes, 8 students, 1 pending/unregistered sign-in)
into a local stack — load it after migrations are applied:

```bash
supabase migration up --local
docker exec -i supabase_db_tpa-ppme-denhaag \
  psql -U postgres -v ON_ERROR_STOP=1 < supabase/dev-fixture.sql
```

With `.env` pointed at the local stack, `npm run dev` then shows a
"Dev only" sign-in panel (`src/dev/DevAuthSwitcher.tsx`, gated on
`import.meta.env.DEV` and confirmed absent from production builds) on the
sign-in screen — pick any fixture identity to get a real authenticated
session against the local stack without configuring Google OAuth
(`supabase/config.toml` has no `[auth.external.google]` section locally).

The last three identities in that panel hold **more than one
relationship** (TAD ADR-019): Ustadzah Aminah teaches Grup A and her own
son is in Grup B, Bapak Hasan teaches Grup B and his own daughter is in
Grup A, and Ustadzah Laila is an admin who *also* teaches Grup A and
*also* has a daughter in Grup B. The first two land on opposite halves
of the app, because which half you see is still decided by `users.role` —
Aminah on the tutor views, Hasan on the family ones. Worth using whenever
a change touches "my children" or "my classes": each of them has a child
in a class they do **not** teach, which is exactly the shape that made an
unfiltered `select` look correct in testing. Laila is the one to use when
a query grows an admin branch, since for her the admin grant and the
tutor relationship disagree — `useMyClasses` hands her every class while
`fn_my_classes()` holds only Grup A. Aisyah is the fourth: a 16+ santri
in Grup A who assists in Grup B (ADR-020). She is entitled to record
for Grup B and cannot reach a screen that would let her, because
routing still follows `users.role` — signing in as her is how that gap
stays visible until role switching lands.

**Two of them also teach the class their own record is in** (ADR-023,
ADR-024),
which is the case every other fixture in this project deliberately avoids
and the likeliest arrangement at a real TPA. Aisyah assists Grup A, where
she is herself enrolled: her class picker offers both classes, the Grup A
roster contains her own name, and recording progress against that row is
refused while any classmate succeeds — her attendance row is the
documented exception (ADR-023(c)). Bapak Hasan teaches Grup A too, where
his daughter Khadijah is enrolled: his overlap is **not** closed, so he can
record her progress and write her year-end report, seeing it in draft,
through the tutor grant. That is PPME's decision rather than an oversight
(ADR-024, RLS-36) — at a small TPA a teacher teaches their own children —
and he is the account to sign in as when a change touches the report
editor or a "drafts are invisible to parents" assumption, because for him
that assumption does not hold. Neither persona added a row to the fixture — both are an existing account named in
an existing class's `tutor_ids`, so every roster size and fan-out count
`scripts/verify-push.mjs` asserts is unchanged.

**Gotcha if you ever hand-write `auth.users` rows yourself** (dev-fixture.sql
already does this correctly): PostgREST/RLS never look at `instance_id` or
the `*_token`/`*_change` columns — they only validate the JWT signature and
trust its claims. But `supabase.auth.setSession()` (what the fixture sign-in
panel uses) calls GoTrue's own `/auth/v1/user` endpoint, which does a real
row lookup and scan. A `NULL` `instance_id` makes that lookup silently match
nothing (`"User from sub claim in JWT does not exist"`); a `NULL`
`confirmation_token`/etc. makes it find the row but then fail to scan it
(`"sql: Scan error ... converting NULL to string is unsupported"`). Set
`instance_id = '00000000-0000-0000-0000-000000000000'` and all the token
columns to `''`, not left unset — see `dev-fixture.sql`'s comment for the
full column list. A real Google-OAuth-created row never hits this since
GoTrue sets these itself; only a hand-written SQL fixture can.

**Don't run the RLS suite (below) against a stack that already has
dev-fixture.sql loaded** — `RLS-14` asserts admin sees exactly the suite's
own 4 fixture students, and it'll see dev-fixture's students too. Use a
plain `supabase db reset --local` (no fixture) before `supabase test db`.

## RLS automated test suite

`supabase/tests/database/rls.test.sql` implements all 41 cases from
test-plan.md §3 (RLS-01…RLS-41), plus WH-01…WH-12 for the notification
webhooks in migrations 009 and 010, plus NC-01…NC-18 for the notification
centre in migration 012 — 231 pgTAP assertions, using the standard
fixture set from §2. RLS-36…RLS-41 and NC-17/NC-18 close the combination
space rather than adding a feature: every dual-role persona before them
deliberately kept the tutor half and the parent half in different
classes, so the commonest arrangement at a small TPA — teaching the class
your own child is in — had never been asserted, and four of the sixteen
capability combinations had no case at all. RLS-37 found a real hole
there: a student assistant assigned to their own class could grade their
own work, which is the boundary ADR-020 states in prose and never
enforced. Migration 013 (ADR-023) closes it for every evaluative write. The NC cases assert that only the addressee reads a
notification, that **no client role can create or delete one at all**,
that a recipient may write `read_at` and nothing else (a column-level
GRANT, since RLS has no column granularity), that neither admin nor tutor
reads one addressed to anybody else, and that `TRUNCATE` — which RLS does
not filter — is no longer held by `anon`/`authenticated` on any table.
NC-12…NC-16 ask the same question of people who are more than one thing
(ADR-022): a tutor-parent and an admin-parent read their own child's
notifications and nobody else's, and read none for the class they teach. The WH cases assert each trigger fires on
exactly its own event and nothing else (a re-saved roster, a re-activated
murajaah target and a re-published report must all notify nobody), that
they are silent when unconfigured, that the body carries the row id and
never the absence `reason` or the assignment title, that no client role
can read the webhook secret, and that a broken webhook path cannot fail
the write it observes. pg_net queues inside the calling transaction, so
the whole thing rolls back with everything else and never makes a real
request. RLS-22…RLS-27 cover the super-admin change (TAD
ADR-014): that an admin INSERT/UPDATE lands on every operational table, and
— the half that matters more — that those rows widen nobody else's
visibility. RLS-28…RLS-33 cover dual-role people (ADR-019): that someone
who is both a tutor of one class and the parent of a child in another
gets the union of both grants and nothing more, identically whichever
value their `users.role` holds, and that the union is not a promotion —
they cannot record progress for their own child, cannot confirm home
practice for a student they teach, and cannot see their own child's
draft report. RLS-34 adds a third relationship on top (admin + tutor +
parent) to show the model is n-ary rather than merely dual, and to mark
where the pattern stops: `fn_is_admin()` is an unconditional `ALL`, so
once admin is in the union the "nothing more" property no longer holds
and each of RLS-31/RLS-32's refusals becomes an allowance. RLS-35 covers
the student assistant (ADR-020): a student with their own login who also tutors may
record for the class they teach, and — since ADR-023 and RLS-37 — not for
their own record even when they teach the class they sit in, which is
where that boundary turned out never to have been enforced. No policy
tests for the `student` role anywhere, so "students are read-only" only
ever described a student who taught nothing. Like the
RLS-22 block, these cases add rows of their own and so are placed after
the assertions that count exact fixture rows. It runs entirely inside a transaction that's rolled
back at the end, so it never leaves data behind. CI runs it against a
fresh local Postgres (Docker, via the Supabase CLI) built from
`supabase/migrations` — see the `rls` job in `.github/workflows/test.yml`.

To run it yourself:

```bash
supabase test db --local supabase/tests/database
```

**Local and CI only — not the live project.** This section used to
document `supabase db query --linked -f …`, which is neither a command
the CLI has nor something to point at production: the suite inserts
fixture families and `auth.users` rows, and test-plan §2 gives production
smoke tests only. It would not run there in any case — migration 006
installs pgTAP into the `extensions` schema, and the role a linked run
connects as cannot resolve functions in it.

The production check is read-only and writes nothing:

```bash
supabase db diff --linked --schema public
```

Empty means the deployed schema still matches the migrations these
assertions were proven against — which is also how a policy edited by
hand in the Supabase dashboard would surface. Expect one class of false
positive: a wall of `REVOKE MAINTAIN, REFERENCES …` lines is a Postgres
17 privilege baseline mismatch between the shadow database and the
remote, not drift. Real drift shows up as `CREATE`/`DROP`/`ALTER POLICY`,
function bodies, or table DDL.

**While building this suite, it surfaced a critical bug**: migrations
002/003/005 defined RLS policies but never granted the underlying
`anon`/`authenticated`/`service_role` table privileges those policies
depend on — GRANT is a separate, prerequisite gate in front of RLS, so
every single API request (including from `service_role`, i.e. Netlify
Functions) was getting "permission denied" regardless of how correct the
RLS policies were. Fixed in migration `007_grants.sql`. This means the
app was non-functional at the database layer from when migrations 002/003
were first applied until this fix — worth knowing if anything was tested
against the live project in that window and appeared broken.

## Netlify Functions

`netlify/functions/`:

| Function | Purpose |
|---|---|
| `health.mts` | Pipeline smoke test |
| `invite-user.mts` | Admin-only: invites a user by email and creates their profile in one step (see RegistrationsPage) |
| `generate-year-end-drafts.mts` | Admin-only: bulk-creates draft year-end reports for an academic year, optionally scoped to a class. Triggered from the panel at the top of the admin's own Reports screen |
| `publish-report.mts` | Authoring tutor only — **not admin**, deliberately (TAD ADR-014 left this boundary where ADR-013 put it): renders the report PDF (pdfkit), uploads it to the private `reports` bucket, then flips `draft → published` |
| `report-pdf.mts` | Mints a 5-minute signed URL for a report's PDF after re-checking the caller's authorization (admin: any report; tutor: own class; parent/student 16+: own child/self, published only) |
| `push-subscribe.mts` | Stores (POST) or clears (DELETE) the caller's own Web Push subscription in `users.push_sub`. **403 when no student row points at the caller** — a notification is always about a child, so no push endpoint is stored for an account nothing would send to (TAD ADR-022). That is a *relationship*, not a role: a tutor or admin whose own child attends the TPA can subscribe and is notified about that child; a tutor with no child of their own cannot, and hears nothing about the class they teach |
| `notify-absence.mts` | Invoked by the **database webhook** on `public.attendance` (migration 009), not by the client that saved the attendance. Sends one push to the absent child's parent, in that parent's own locale |
| `notify-milestone.mts` | Webhook on `yanbua_progress` (jilid completed — applies `src/lib/yanbua.ts#isJilidComplete`, imported rather than restated) and on `murajaah_assignments.active` going true→false (surah memorized) |
| `notify-assignment.mts` | Webhook on `assignments`. The one sender that fans out across a whole class: every enrolled student's parent, plus any 16+ student themselves |
| `notify-report-ready.mts` | Webhook on `year_end_reports.status` reaching `published` (PRD FR-007). Deliberately not called from inside `publish-report`, so a push failure can never affect whether a report published |
| `send-murajaah-reminders.mts` | **Scheduled**, hourly, acting in the 18:00 Europe/Amsterdam hour (PRD FR-006). Reminds a family only on the last day their target's `frequency` can still be met — see `needsReminder` in `src/lib/murajaah.ts` |
| `homework-due-reminders.mts` | **Scheduled**, hourly, acting at 08:00 Europe/Amsterdam (PRD FR-005). Assignments due *tomorrow*, across each class roster, skipping students who already marked it `completed` |
| `weekly-progress-digest.mts` | **Scheduled**, hourly, acting at 08:00 on a Friday in Europe/Amsterdam. Parents of any child with activity this week; the summary itself is on the dashboard, because DPIA R6 will not have an attendance figure on a lock screen |
| `prune-notifications.mts` | **Scheduled**, hourly, acting at 03:00 Europe/Amsterdam. Deletes notification-centre rows past 90 days — DPIA R5. Its own job rather than folded into the weekly digest, because retention is an obligation and the digest is a courtesy |

All use the Netlify Functions v2 API (default export, Web-standard
`Request`/`Response`) and are typechecked separately from the main app
(`npm run typecheck:functions`) since `netlify/functions/` isn't a project
reference of the root `tsconfig.json`.

**The runtime is pinned to Node 22 and must not drop below it.**
`netlify.toml` sets `NODE_VERSION = "22"` and CI's `node-version` matches.
`@supabase/supabase-js` builds a `RealtimeClient` inside `createClient()`,
which needs a global `WebSocket` and **throws at construction** without one
— and Node only has that unflagged from 22. Every Function holding the
service-role key calls `createClient`, so a runtime below 22 takes out
every notification and every report Function at once, at the first
request rather than at build time. Nothing in the app itself would tell
you; it surfaced only when a unit test first called `serviceClient()` on
CI's then-Node-20. If you ever need to run on an older runtime, pass a
WebSocket implementation via supabase-js's `realtime.transport` option
instead of unpinning this.

The ones that hold `SUPABASE_SERVICE_ROLE_KEY` *and* have a signed-in
caller share one authorization
shape, extracted into `netlify/functions/lib/callerAuth.ts`: validate the
caller's JWT with a plain anon-key client, then look their role up
*independently* with the service-role client. The service-role key
bypasses RLS entirely, so each of these owns its own authorization check
in code — the report Functions deliberately restate the `year_end_reports`
RLS rules rather than inheriting them. This matters most in
`report-pdf.mts`: a Supabase signed URL bypasses RLS once minted and the
`reports` bucket has no client-facing read policy at all, so that check is
the only gate in front of the PDF.

Pure, testable pieces live under `netlify/functions/lib/` (attendance
stats, the draft skip rules, the publish ordering, PDF rendering) and are
unit-tested in `tests/unit/reports.test.ts` — including the assertion that
a failed PDF render never reaches the status flip.

To run Functions locally (not just the Vite app — `npm run dev` alone
doesn't serve `/.netlify/functions/*`):

```bash
netlify dev   # serves the Vite app + Functions together, default http://localhost:8888
```

Point `.env` at the local Supabase stack as usual, and additionally set
`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` there too (server-side
Functions read `process.env` directly, not Vite's `import.meta.env`) —
use the local stack's own keys from `supabase start`'s output, not the
production ones from `netlify env:list`.

## Web Push notifications

Every **event-driven** notification is live: a tutor (or admin) records
an absence, enters Yanbu'a progress that completes a jilid, marks a
murajaah target memorized, creates an assignment, or publishes a
year-end report → a trigger on that table posts to the matching Function
→ the Function looks up who the child's family is and sends a Web Push →
the service worker shows it.

Still deferred: the four **scheduled** notifications (daily Murajaah
reminder, homework due tomorrow, weekly digest, streak resets) are
ADR-015 part 2b, and the in-app notification centre is part 3 (built,
TAD ADR-017).

The client never calls any of these. Every trigger is a database webhook,
so a notification fires for a tutor write, an admin write (ADR-014) and
any future import alike, and no write path has to remember to ask.

### VAPID keys

Generate **one pair per environment** and never commit them:

```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

Set in Netlify (`netlify env:set`) and in local `.env`:
`VAPID_PRIVATE_KEY` (secret), `VAPID_PUBLIC_KEY`, and
`VITE_VAPID_PUBLIC_KEY` — the same public value twice, because the
browser needs it to subscribe and only `VITE_`-prefixed vars reach the
client bundle. **Rotating the pair invalidates every stored
subscription**: every family has to re-enable notifications, silently,
so generate once per environment and keep it.

### Scheduled Functions

The three `config.schedule` Functions all run on `0 * * * *` and decide
for themselves whether it is their hour in `Europe/Amsterdam`. Netlify
cron is UTC-only, so a fixed `0 17 * * *` would be 18:00 in winter and
19:00 through the whole CEST summer term — the entire TPA summer. The
gate resolves the offset from the runtime's IANA database
(`isAmsterdamHour`), so it needs no seasonal edit and cannot drift.

Cost: 24 invocations a day each, 72 total. 23 of every 24 return before
opening a database connection.

They authenticate nothing, and are built so they do not need to — TAD
ADR-016(d). Netlify's scheduler cannot attach a shared secret, so
requiring one would mean the job never running. Instead they read
*nothing* from the request, do nothing outside their hour, return counts
rather than dedup tags, and send nothing new on a repeat run. **Do not
add a request-derived input to one of these** without revisiting that
reasoning; see also the `netlify dev` note above, where they are plain
HTTP endpoints.

### Transactional email (Resend)

A second notification channel alongside Web Push, added in TAD ADR-018.
Push is not a channel every family has — on iOS it only works once the
PWA is on the Home Screen, and that column of test-plan §6 has never
been verified on a device — so email reaches the people push cannot.

Set in Netlify:

```
RESEND_API_KEY   # secret; never committed, never defaulted, only read via process.env
```

**Two deployment prerequisites, both dashboard work rather than code —
the first now resolved:**

1. **Resolved: `ppmedenhaag.nl` verified in Resend (ADR-031).** PPME's
   Resend admin verified the bare domain directly rather than the
   `tpa.` subdomain this originally assumed — `FROM_ADDRESS` in
   `lib/email.ts` was updated to match, and a live send from the
   production key confirmed it. Before a domain is verified, Resend
   refuses to send from it and permits only `onboarding@resend.dev`, to
   the account owner's own address; `lib/email.ts` deliberately keeps
   the real intended `from` address so a misconfigured deploy fails
   loudly instead of quietly sending from a sandbox sender nobody
   recognises.
2. **Select the EU region in Resend.** Supabase is Frankfurt and Netlify
   is EU by deliberate choice; mail carries a parent's address and a
   child's name, so the same residency reasoning applies — and it cannot
   be applied retroactively to mail already sent.

Free tier is **100/day, 3,000/month, 2 requests/second**. A 429 is
surfaced as its own result (`rate-limited`, with the retry hint) rather
than folded into a generic failure, because the sensible response
differs: a rate limit is worth retrying, a malformed address is not.

**Email can never break what it accompanies.** `sendEmail` never throws;
every outcome is a returned value, and `invite-user` reports it as
`invitation_email` without acting on it. It also fails *open* — a
missing key logs and returns `not-configured` — which is the opposite of
`NOTIFY_WEBHOOK_SECRET`'s fail-closed behaviour, deliberately: an
unauthenticated endpoint is a security failure, an unsent courtesy email
is a degraded feature.

**Resolved: `invite-user` sends exactly one email.** It used to also
trigger GoTrue's own magic-link invite, recorded as open in ADR-018(b).
`invite-user.mts` now creates the `auth.users` row with
`auth.admin.createUser({ email, email_confirm: true })` instead of
`inviteUserByEmail`, which creates the row without sending GoTrue's mail.
Safe here specifically because sign-in is Google OAuth only (ADR-003) —
there is no password or magic-link flow anywhere in this app for that
token to serve, so it was pure duplication. See ADR-026.

**Never send real email while developing.** The transport is injected
(`sendEmail(request, fetchImpl)`) and every test passes a fake, so the
suite cannot reach a real inbox. test-plan's "no real student data in
any test environment, ever" extends to not mailing real people.

Copy lives in `netlify/functions/lib/emailTemplates.ts`, keyed
role → locale, and is meant to be edited.

### Database webhooks

The triggers live in migrations 009 and 010, so they are
version-controlled and reproduced by `supabase db reset`. What is *not*
in the migration is where to send the request, since that differs per
environment — `fn_post_webhook()` reads it from Supabase Vault at fire
time, and **does nothing at all if it is unset**. That is why a fresh
local stack, CI and the pgTAP suite never make outbound requests.

Five triggers, all through the same sender:

| Table | Fires when | Function |
|---|---|---|
| `attendance` | a row becomes `absent` | `notify-absence` |
| `yanbua_progress` | **any** entry is recorded | `notify-milestone` |
| `murajaah_assignments` | `active` goes true → false | `notify-milestone` |
| `assignments` | a row is created | `notify-assignment` |
| `year_end_reports` | `status` reaches `published` | `notify-report-ready` |

The Yanbu'a one is the odd entry and is meant to be: it fires for every
progress entry rather than only completions, because filtering in SQL
would put a second copy of the jilid-completion rule next to the real one
in `src/lib/yanbua.ts`. The Function applies the rule and exits quietly
otherwise. See the migration's own comment and the TAD's Billing section
for the invocation cost of that choice.

None of these can fail the write they observe: each trigger function
swallows its own errors (pgTAP asserts this by breaking the webhook path
and checking the write still succeeds), and pg_net sends asynchronously
after commit.

To configure an environment (Supabase SQL editor, or `psql` locally):

```sql
select vault.create_secret('https://tpa.ppmedenhaag.nl/.netlify/functions',
                           'notify_webhook_base_url');
select vault.create_secret('<same value as Netlify NOTIFY_WEBHOOK_SECRET>',
                           'notify_webhook_secret');
```

The secret authenticates the *channel* (`netlify/functions/lib/webhookAuth.ts`)
— a webhook has no signed-in caller, so `callerAuth.ts` does not apply.
It fails closed: with `NOTIFY_WEBHOOK_SECRET` unset the Function rejects
every request rather than serving them unauthenticated.

Locally, Postgres runs in Docker and `netlify dev` runs on the host, so
the base URL must be `http://host.docker.internal:8888/.netlify/functions`
— `localhost` inside the database container is the container. Confirmed
working on this stack; pg_net reaches the host fine.

**pg_net is asynchronous.** The trigger queues into
`net.http_request_queue` and a background worker sends it a moment later,
which is what keeps a slow or failing Function from ever blocking a
tutor's attendance save. Two consequences worth knowing: a rolled-back
transaction never sends (which is what lets the pgTAP suite assert on
queued requests without a network), and the Function's response is
readable afterwards in `net._http_response` — the fastest way to see why
a notification did not arrive:

```sql
select id, status_code, content from net._http_response order by id desc limit 5;
```

### Verifying it end to end

`scripts/verify-push.mjs` drives the whole pipeline with nothing stubbed
— a real Chromium, a real push subscription, a real attendance write,
the real webhook, a real push — and asserts on what the browser actually
displayed, including that the *other* family's parent received nothing.
It is not part of `npm test` (it needs Docker, the dev fixture and a
running `netlify dev`); run it by hand after touching anything in the
notification path. The file header lists the exact setup steps.

One trap it documents: Playwright's default headless shell has **no
notifications or push implementation**, so `Notification.permission` is
permanently `denied` there and every check fails for the wrong reason.
The script launches with `channel: 'chromium'` for that reason.

Also note the browser's push service (FCM for Chrome) will quietly
**throttle repeated registrations** from one host — `pushManager.subscribe()`
then never settles rather than rejecting. If a run hangs at the subscribe
step, wait a few minutes rather than hunting for a bug in the app. The
app itself bounds that wait (60s, `SUBSCRIBE_TIMEOUT_MS` in
`src/lib/push.ts`) and shows a "push service is not responding" message
instead of spinning forever. That bound was 30s until a subscription FCM
served perfectly well was measured taking **32 seconds** — so if you
lower it, you are choosing to tell families the feature is broken on a
slow day. If you raise it, raise the harness's own wait with it.

**Do not add a `config.path` export to a v2 Function that just restates its
own default route** (`/.netlify/functions/<name>`) — confirmed on
`netlify-cli` 27.1.1: declaring it, even matching the default exactly,
makes local `netlify dev` refuse to match its own declared path and 404
every request, while working fine on real deployed Netlify. Both existing
functions omit it for this reason; only add `config.path` for an actually
different custom path.

**A scheduled Function is an ordinary HTTP endpoint under `netlify dev`.**
Confirmed on `netlify-cli` 27.1.1: the three jobs with `config.schedule`
(`send-murajaah-reminders`, `homework-due-reminders`,
`weekly-progress-digest`) are listed at startup like any other function,
and `curl` reaches them at `/.netlify/functions/<name>` on both GET and
POST — despite `@netlify/functions`' own types describing a scheduled
function as "Not reachable via HTTP". The cron itself does **not** run
locally; nothing fires on its own. `netlify functions:invoke <name>`
works too and goes to the same handler.

**Whether the deployed site behaves as its own types claim is untested
here**, and should not be assumed: deploy previews on this project sit
behind Netlify's password protection, which 401s every path including
`health`, so there is no deployed environment available to curl. Someone
with access to the production site should check it once. Nothing depends
on the answer — the jobs are built for the worse case — but it is worth
knowing which one is true.

Two consequences worth knowing before you change one of these:

- Locally there is nothing in front of them. That is a stated reason
  they read *nothing* from the request and return only counts, never a
  dedup tag — a tag carries a user id and a student id (TAD ADR-016).
  Keep it that way.
- They will not do anything useful when you curl them, because 23 hours
  out of 24 the Europe/Amsterdam gate returns `{"skipped": "not 18:00
  in Europe/Amsterdam"}`. To actually exercise one, move the clock from
  outside:

  ```bash
  node scripts/invoke-scheduled.mjs send-murajaah-reminders 2026-08-14T16:00:00Z
  ```

  That bundles the Function with esbuild exactly as Netlify does, pins
  the clock and calls the handler in process. There is deliberately no
  test hook inside the Function for this.

### The notification centre

Every notification any sender produces also writes a row to
`public.notifications` (migration 012), which the bell in the top nav
opens at `/notifications`. Three things about it are easy to get wrong
if you change it:

- **Rows are written whether or not the family has push enabled.** The
  centre exists mainly *for* the families push cannot reach, so
  recording happens at the audience level and only the push half filters
  on having a subscription. `recorded` and `sent` are reported
  separately and `recorded` is normally larger; that is not a
  discrepancy.
- **Nothing about presentation is stored** — no ordering key, no
  category, no rendered sentence. A row holds `event` plus a `context`
  object and the screen builds the text at read time from the i18n copy.
  This is deliberate: the screen has never been design-reviewed (PRD
  §71), so the schema is built to survive whatever a review decides.
  Keep it that way, and put display concerns in the component.
- **Nobody reads a notification addressed to somebody else — admin
  included.** The one place ADR-014's super admin stops (ADR-017(d)).
  There is no admin policy on the table; `notifications_own_read` is
  `user_id = auth.uid()` and nothing else, which NC-09 and NC-14 assert
  from both directions. An admin whose own child attends the TPA
  therefore reads that child's notifications and still nobody else's —
  the policy was always a relationship, so ADR-022 needed no migration.
- **Who a row is written *for* is also a relationship, not a role**
  (ADR-022). Recipients come from the child's own `parent_id` and
  `user_id`, so a tutor whose own child attends hears about that child
  and hears nothing about the class they teach. The five places that ask
  it — `push-subscribe`, `buildAudiences`, the settings screen, the bell
  and the centre — share one predicate over two derived booleans; if you
  add a sixth, use `canReceiveNotifications` rather than reading
  `users.role`.

The client's only write is `read_at`, and that is a column-level GRANT
rather than a convention — `update (read_at)` is all `authenticated`
holds, so a recipient cannot rewrite an event on their own row.

## Offline writes

Attendance submission, murajaah confirmation, and Yanbu'a/Quran
recitation recording are queued and replayed from the **app**, not the
service worker (TAD ADR-029) — a deliberate departure from ADR-005's
original plan to use Workbox's Background Sync API, made because that
API doesn't exist on Safari/iOS at all and has no hook to refresh an
expired Supabase session before replaying a queued request.

- `src/lib/offlineQueue.ts` — an IndexedDB-backed queue. `createOfflineQueue`
  holds the logic (entry shape, oldest-first ordering, retry bookkeeping)
  over an injected `QueueStore`, unit-tested against a plain in-memory
  fake; `indexedDbStore()` is the real adapter and is not unit-tested,
  since jsdom (this project's test environment) has no IndexedDB
  implementation.
- `src/lib/offlineReplay.ts` — `replayQueue()` refreshes the Supabase
  session first (a queue left overnight can outlive the access token),
  then replays oldest-first, reusing `submitAttendance`/`confirmPractice`/
  `insertYanbuaProgress`/`insertQuranProgress` unmodified so there is
  exactly one implementation of each write, online or queued. A murajaah
  replay that lands after its insert already succeeded (response lost,
  not the write) hits `murajaah_log`'s `unique (assignment_id, date)`
  constraint and is treated as delivered rather than an error — the same
  reasoning `getOrCreateTodaySession` already applies to its own race
  (`src/features/attendance/api.ts`). `yanbua_progress`/`quran_progress`
  have no such natural unique key, so a `client_ref uuid unique`
  column (migration 015, TAD ADR-030) gives them one: the queue entry's
  client-generated key is sent with the insert, and a `23505` on it
  during replay gets the same "already delivered" treatment.
- `src/hooks/useOnlineStatus.ts` — triggers replay on the `online` event
  and once on app load; mounted once near the top of `App.tsx`.
- A network failure (`src/lib/network.ts#isNetworkError`) is what queues
  a write. A real rejection — an RLS denial, a validation error — still
  surfaces immediately; the queue must never swallow one.

**Scope, stated deliberately rather than discovered as a gap later:**
this is safe, idempotent replay, not a conflict-merge UI. Attendance's
`upsert` on `(session_id, student_id)` is already last-write-wins at the
database layer, true online today and unchanged by this work — offline
support widens the window during which two devices could overwrite each
other's mark, it does not introduce a new failure mode. No
optimistic-concurrency/version-check merge logic exists. Homework,
murajaah target-setting, year-end reports, admin screens and
notification settings stay out of scope — desk-based usage on reliable
connectivity, and reports in particular go through a Netlify Function
rather than plain PostgREST, a different replay problem.

**Verified live** against the local Postgres stack and `npm run dev`
(test-plan.md §6): attendance and murajaah queue in IndexedDB and show
the "will sync" banner with Chrome's Network panel set to "Offline",
replay and clear the queue on reconnect with the rows landing
server-side, and a genuine same-day rejection while online still
surfaces the red error banner rather than being queued (pre-existing
verification, from the original ADR-029 work). Yanbu'a/Quran's
`client_ref` idempotency was verified directly against the local
Postgres+RLS stack at the REST layer (a fixture tutor's minted JWT):
inserting with a fresh `client_ref` succeeds; re-submitting the
identical `client_ref` — the response-lost/replay scenario the column
exists for — returns `23505` and commits no duplicate row; and a
genuine rejection (a `tutor_id` not matching the caller, or
`ayah_to < ayah_from`) returns a real error rather than being
swallowed. The Yanbu'a/Quran offline write queue's actual
DevTools-Offline browser click-through (the "will sync" banner, replay
on reconnect through the real UI) has **not** been driven in this
session — no browser automation tool was available — and is still
outstanding before test-plan.md §6 can be ticked for these two writes.

## Roles

| Role | What it can do |
|---|---|
| `tutor` | Their assigned classes only: record attendance, homework and verdicts, Yanbu'a/Quran progress, Murajaah targets; author, edit and **publish** year-end reports for their own students |
| `parent` | Their own children only, read-only — except confirming Murajaah home practice, which is the parent of *that child*'s to do, asked per child rather than of the role column (ADR-025) |
| `student` (self-login) | Their own record only, and read-only — unless they also tutor a class, in which case that class's tutor grants apply as they would to anyone (ADR-020) — with one carve-out since ADR-023: those grants exclude the assistant's **own** record for every evaluative write, so a santri assigned to the class they sit in cannot grade themselves (`attendance` excepted in SQL, deliberately — the register is one upsert for the whole class, so ADR-025 closes it in the interface instead: their own row is shown but not submitted, and a co-tutor or an admin fills it in). No policy keys on the `student` role; read-only is what holding no write-granting relationship looks like. The row records that the student has an account, not how old they are — the age threshold for holding one is Google's (ADR-021) |
| `admin` | **Everything a tutor can do, on every class** (TAD ADR-014), plus the enrollment screens behind "Kelola". Two deliberate exceptions: it cannot confirm Murajaah home practice (`confirmed_by` means "the parent who watched the child recite"), and it cannot publish a year-end report (that stays with the authoring tutor) |

**The table above names the four `users.role` values, and access does not
follow from them** (ADR-019). Every policy in the schema is written
against a relationship — `parent_id = auth.uid()`, `auth.uid() = any
(tutor_ids)`, `user_id = auth.uid()` — and `fn_is_admin()` is the only
one that reads the role column. One person routinely holds several of
these rows at once: an ustadz whose own child attends, an admin who also
teaches, a 16+ santri who assists a younger class. Since ADR-025 the
interface follows suit — such a person gets a **scope switch** on the six
two-shaped screens ("Grup saya" / "Anak saya") offering only the
relationships they actually hold, and anyone who holds one sees no
control at all. It is not a role picker: role is still derived from the
authenticated user and never chosen (PRD §1).

Admin's access has always been granted at the database layer — every table
has an `*_admin_all` policy keyed on `fn_is_admin()` (migrations 003/005).
Until ADR-014 the *application* blocked it anyway; removing that fence needed
no migration and no policy change, which is why an unchanged-green
`supabase test db` run is itself the evidence RLS was untouched.

An admin write stores the admin's own id in `tutor_id` ("who recorded this
row"), so that column no longer implies membership of `classes.tutor_ids` —
don't write code that assumes it does.

## Brand assets

The vendor-supplied logo masters (3564×1844, aspect 1.933:1) live in
`assets/brand/` in three colourways and are never served directly. Everything
derived from them is generated:

```bash
pip install Pillow                          # not a project dependency
python3 scripts/generate-brand-assets.py
```

That writes `public/logo.png` (full colour — light backgrounds, e.g. the
sign-in screen), `public/logo-white.png` (reversed — the brand-blue top bar),
the PWA icon set and favicons under `public/icons/`, and
`netlify/functions/lib/logoAsset.ts`, which inlines the reversed wordmark as
base64 for the year-end report PDF header.

Two things not to undo:

- **The square icons carry the globe mark alone**, cropped out of the
  artwork — letterboxing a 1.93:1 wordmark into a square is what made the
  previous icon set unreadable at 48px. Never stretch the wordmark square.
- **A notification says "Chrome" until the app is installed.** Android
  attributes a web push to whichever app delivered it, and there is no API
  for a site to override that — the payload cannot change it. It changes on
  its own once the PWA is *installed*: Chrome mints a WebAPK from the
  manifest, and that WebAPK owns its notifications, so the shade shows the
  app's own name and icon. This only works on a **publicly reachable HTTPS
  origin**, because Google's WebAPK service has to fetch the manifest and
  icons itself — on a LAN address behind a private CA, "Add to Home Screen"
  degrades to a plain shortcut and the attribution stays Chrome. So this is
  only testable on a real deploy, never on the local review stack.
- **The notification badge is a transparent silhouette, not an icon.**
  `public/icons/badge-96.png` is what Android draws in the status bar, and
  Android *masks it by its alpha channel* — colours are discarded and
  whatever is opaque is repainted in the system tint. Pointing that slot at
  `icon-192.png`, which is an opaque square, renders a plain white block;
  leaving it unset makes the browser fall back to Chrome's own logo. Both
  were true on a real phone until it was tested on one. Regenerate it with
  the brand script like every other asset, and keep it monochrome.
- **The PDF header logo is inlined as base64, not shipped as a file.** A
  bundled Netlify Function resolves runtime file paths differently under
  `netlify dev` than on deployed Netlify, and that difference would only ever
  surface at publish time in production. `reportPdf.ts` also keeps the old
  typographic header as a fallback if the asset fails to decode, so a publish
  can never fail over branding (unit-tested both ways).

## Right to erasure (GDPR art. 17)

Deleting a student cascades to all their DB rows (`on delete cascade` on
every student-scoped table, `year_end_reports` included) — but **cascade
does not reach Supabase Storage**, so a deleted student's year-end report
PDF would survive the deletion of every row that pointed at it. Delete the
Storage object *first*, while `pdf_path` is still readable:

```sql
-- 1. find the objects to remove (run as service role / in the SQL editor)
select id, academic_year, pdf_path
from public.year_end_reports
where student_id = '<student-uuid>' and pdf_path is not null;
```

```bash
# 2. delete each pdf_path from the private `reports` bucket
curl -X DELETE "$SUPABASE_URL/storage/v1/object/reports/<pdf_path>" \
  -H "authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

```sql
-- 3. only then delete the student; the DB rows cascade from here
delete from public.students where id = '<student-uuid>';
```

Verify with `select count(*) from storage.objects where bucket_id='reports'
and name like '<student-uuid>/%';` → 0. See test-plan.md §8 and
dpia-draft.md's Article 17 row; there is no automated erasure flow yet, so
this is a manual runbook, not a feature.

## Known gaps (foundation pass — not yet built)

- **Attendance, Yanbu'a (Milestone 1), Homework/Tugas (Milestone 2),
  Quran/Al-Quran recitation tracking (Milestone 3), Murajaah/memorization
  tracking (Milestone 4), and Year-End Curriculum Reports (Milestone 6) are
  built.** Every route in `src/App.tsx` now points at a real feature — the
  `FeaturePlaceholder` page was deleted with the last one. See the
  checklist's suggested build order for what's next — notifications (§4)
  are largely done (below), and offline sync for attendance/murajaah
  writes is now built (`src/lib/offlineQueue.ts`, `offlineReplay.ts`,
  `useOnlineStatus.ts`; TAD ADR-029, which supersedes ADR-005's
  original service-worker-level Background Sync plan). Of the feature
  FRs that were waiting on notification infrastructure, the milestone
  celebrations and the year-end report's FR-007 are now built; Homework's
  FR-005 (due-date reminders) and Murajaah's FR-006 (daily practice
  reminders) still wait on Netlify Scheduled Functions, which don't exist
  yet.
- **Notifications: everything event-driven is built** (ADR-015 parts 1
  and 2a) — absence, jilid completed, surah memorized, new homework, and
  report ready (PRD FR-007, so publishing a report *does* now notify the
  family). What remains is the four **scheduled** ones — the daily
  Murajaah reminder (FR-006), homework due tomorrow (FR-005), the weekly
  digest and streak resets — which are part 2b, plus the in-app
  notification centre and TopNav bell in part 3, held until that screen's
  design is reviewed. Notification settings live at
  `/settings/notifications`, reached from the dashboard.
- **Android and iOS push are unverified** — there is no phone available
  to this project, and test-plan §6's two mobile columns need one. The
  iOS "add to Home Screen first" path is implemented and unit-tested, but
  that is not the same as having watched a notification arrive on an
  iPhone. Desktop Chrome is verified for real (`scripts/verify-push.mjs`).
- **Admin enrollment UI is built** (`/admin/registrations`, `/admin/classes`,
  `/admin/students`), with two ways to register a user: invite by email
  (`invite-user.mts` — creates the account and profile together, no waiting
  on them to sign in first) or wait for them to sign in with Google and
  register them from the resulting pending-registrations list
  (`fn_pending_registrations()`, migration 008). These screens sit behind the
  single "Kelola" entry point (dashboard tile + a sixth desktop tab) and are
  still admin-only (`RequireAdmin.tsx`). A student's own account can now be
  linked to their enrollment record either at creation or **later** — an
  "Ubah" action on `/admin/students` opens the same form pre-filled and
  offers the same self-login picker (TAD ADR-032), which is what the
  ordinary September-enrollment/January-Google-account case actually needs;
  before this it only worked at the moment a student was first added. Still
  missing: no "tutor management" view beyond assigning tutors on the class
  form, no way to remove/deactivate an enrolled student, no CSV export.
- Bundle isn't code-split yet (single ~500KB JS chunk) — fine at this size, revisit
  once feature modules grow.
