# TPA PPME Den Haag — Development Kickoff Checklist

*Prepared 2 July 2026. Reflects all decisions confirmed to date in the PRD/TAD, plus the validated Figma Make prototype (15 screens, 3 roles: Ustadz, Orang Tua, Santri).*

*Status checkboxes updated as of this writing: `[x]` done, `[ ]` not started, `[~]` partially done (not standard GFM checkbox syntax — reads as literal text rather than a rendered checkbox, used deliberately where "done"/"not done" would be misleading; the item's own text explains what's actually built vs. missing).*

---

## 0. Confirmed Decisions (quick reference)

| Area | Decision |
|---|---|
| Platform | PWA on Netlify (no app store) |
| Auth | Google OAuth 2.0 |
| Database | Supabase, EU/Frankfurt region |
| Domain | Subdomain — `tpa.ppmedenhaag.nl` |
| Language | Bahasa Indonesia (primary) + Dutch (secondary), toggle in nav |
| Brand palette | Primary `#0D50A0`, dark variant `#0A3E7A`, gold accent `#C8A415`, success `#4CAF50`, danger `#D32F2F` |
| Student accounts | Hybrid — always linked to a Parent; a student may additionally self-login (`Student.user_id`, nullable). **Who is old enough for that is Google's rule, not ours** (ADR-021): auth is Google OAuth only, so the account either exists or it does not, and this project stores `date_of_birth` without ever gating on it |
| Board approval | Not required |
| Tutor compensation | Not tracked — tutors are volunteers |
| GDPR/DPIA ownership | PPME Den Haag IT team (operational); PPME Den Haag remains legal controller |
| UI reference | Figma Make prototype — validated, palette matches pixel-for-pixel |

Still open (non-blocking, can resolve in parallel): WhatsApp integration + budget, multi-branch timing, Yanbu'a curriculum variants. See §8.

**✅ Critical path resolved:** rather than waiting on PPME IT to provision accounts, the bootstrap-then-transfer approach removes the blocker — create the org/team containers now (named for PPME, not you), build under them immediately, and hand over ownership (invite PPME IT as owners, remove yourself) before real student data enters the system. See §1 for specifics. The one thing this doesn't remove: PPME IT should give an informal nod that this arrangement is the plan, since they remain the GDPR data controller's operational owner even during the bootstrap period.

---

## 1. Accounts & Infrastructure

*Approach: bootstrap now, transfer ownership later. Instead of waiting on PPME IT to create accounts, create the organization/team container on each platform now — named for PPME (e.g. `ppme-denhaag`), not personal — with you as the sole owner today. This unblocks development immediately. Before real student data enters the system, invite PPME IT as owners on each and remove yourself; because the work already lives inside a PPME-named container rather than your personal account, this is an ownership-role change, not a project migration — no downtime, no re-doing environment variables or DNS.*

- [x] **GitHub** — confirmed live 2026-08-16: org `ppme-denhaag` (created 2026-08-11), private repo `ppme-denhaag/tpa-ppme-denhaag` inside it, `radnan80` sole Owner, branch protection on `main` (`enforce_admins`, 0 required reviews — matches the setup guide's "workable solo" note). Ownership handoff to PPME IT is the one part of this row still open — see the dedicated row below
- [~] **Netlify** — Team `ppme-denhaag` and project `ppme-tpa` confirmed live, connected to the GitHub repo. **EU region is not confirmed — it's confirmed wrong, and confirmed blocked.** `netlify api getSite` reports `functions_region: "us-east-2"` and `blobs_region: "us-east-2"`: every Function holding the service-role key (`invite-user`, the three report Functions, every notification sender) runs in Ohio, not the EU, while the database it calls is meant to be Frankfurt. This wasn't flagged anywhere else in the project's docs before this check (2026-08-16). The fix (Project configuration → Build & deploy → Continuous deployment → Functions region → `fra`) turns out to need a **Netlify Pro plan** — the current team is on the free tier, where the region selector isn't offered at all. Deliberately left as-is for now rather than upgrading; revisit alongside the ownership-handoff/billing decision below, and before real student data flows through these Functions
- [ ] **Supabase** — project `tpa-ppme-denhaag` (ref in `supabase/config.toml`) confirmed linked, but the **Frankfurt (eu-central-1)** region itself could not be verified this session — no `supabase` CLI on this machine and no dashboard access. Given the Netlify region finding above, don't assume this one is correct either; check it directly in the Supabase dashboard (Project Settings → General → Region)
- [ ] **Supabase DPA** — reviewed/signed by PPME IT team once they're in the loop (TAD open question #1) — this can happen in parallel with bootstrap, doesn't block building
- [ ] **Google Cloud Console** — create your own project for now (OAuth 2.0 client, Web application type); confirm with PPME IT whether they already have a Workspace/Cloud project you should use instead once you're in touch — if so, migrating an OAuth client later is low-effort (new client ID/secret, update env vars)
- [ ] **OAuth redirect URIs** configured for Supabase Auth callback + Netlify preview/prod domains
- [ ] **Google Workspace service account** — confirm need once server-side operations require it (TAD open question #4); not a bootstrap blocker
- [ ] **DNS** — still PPME IT's responsibility regardless of the bootstrap approach, since it touches their existing `ppmedenhaag.nl` domain. Send them the exact CNAME record once the Netlify site is provisioned; runs in parallel, not on the critical path
- [~] **VAPID key pair** — generated for Web Push, stored as Netlify env vars (never committed to repo). A **development** pair has been generated and used to verify the pipeline locally; the production/preview pairs are still PPME's to generate and set. Three variables, not two: `VAPID_PRIVATE_KEY` (secret), `VAPID_PUBLIC_KEY`, and `VITE_VAPID_PUBLIC_KEY` (same public value — the browser needs it to subscribe, and only `VITE_`-prefixed vars reach the bundle). Rotating the pair silently invalidates every stored subscription, so generate once per environment. See README "Web Push notifications"
- [ ] **Webhook shared secret** — `NOTIFY_WEBHOOK_SECRET` in Netlify, and the *same value* in Supabase Vault as `notify_webhook_secret`, plus `notify_webhook_base_url` for the environment. Without both Vault secrets the absence webhook is a silent no-op (which is deliberate — it is what keeps CI and fresh local stacks quiet). Generate with `openssl rand -base64 32`
- [ ] **WhatsApp Business API** — deferred until Phase 3 budget decision (~€300/mo) is made
- [ ] **Ownership handoff (before real student data)** — invite PPME IT as Owner on GitHub Org, Netlify Team, and Supabase Org; remove yourself once confirmed; get an informal sign-off from PPME leadership that the bootstrap arrangement was the plan all along, for the DPIA record

## 2. Repository & Environments

- [x] Repo scaffolded: React 19 + Vite + TypeScript + Tailwind v4 (`package.json`)
- [x] Tailwind theme tokens set to the confirmed brand palette (§0) — `src/index.css`'s `@theme` block (Tailwind v4 is CSS-config, no `tailwind.config.js`)
- [~] Netlify deploy contexts: Preview and Production contexts are configured in `netlify.toml`, and branch protection is set on `main` (see §1). **Production builds are currently stopped deliberately**, to conserve build credits while the project is still being built out — deploy previews still build per PR, but `ppme-tpa.netlify.app` does not track `main` and is published by hand when builds are re-enabled (TAD, Deployment). A merged change is therefore expected not to be live, and the first release after re-enabling will carry every undeployed commit at once
- [x] Environment variables documented (`.env.example`): Supabase URL/anon key, VAPID keys, webhook secret, (later) WhatsApp API keys — separate values per environment. Confirmed live in Netlify (`netlify env:list`): Supabase keys, `RESEND_API_KEY` and `VAPID_PUBLIC_KEY` are set for the project; `VAPID_PRIVATE_KEY` and `NOTIFY_WEBHOOK_SECRET` are **not** — matches §1's open rows exactly, so those two rows are read as confirmed-accurate rather than stale
- [x] Local dev setup via Supabase CLI (local Postgres + Auth emulation) — `supabase/config.toml`, `supabase/migrations/`, `supabase/dev-fixture.sql` all present and this is the stack every milestone's verification section above was run against
- [x] `react-i18next` scaffolded with `id`/`nl` locale files (`public/locales/`, `src/i18n/`); Islamic/Arabic terms (Murajaah, Yanbu'a, Surah, Ayah, etc.) kept untranslated in both, per every milestone's i18n section above

## 3. Database Build-out

- [x] SQL migrations written for all 10 entities: User, Student, Class, Session, Attendance, Assignment, AssignmentStatus, YanbuaProgress, QuranProgress, MurajaahAssignment, MurajaahLog
- [x] `Student.user_id` (nullable) FK implemented for self-login students, separate from `Student.parent_id`. Records that the student has an account of their own, and nothing about their age — the age threshold is Google's (ADR-021)
- [x] All enums implemented as Postgres enum types: `user_role`, `locale`, `attendance_status`, `assignment_status`, `yanbuah_mastery`, `quran_quality`, `murajaah_quality`, `murajaah_frequency`
- [x] **RLS policies written and tested per table** — highest-risk item; a misconfigured policy leaks children's data across families. At minimum: Parent (own children only), Tutor (own assigned classes only), Student 16+ (own data only, and read-only unless they also tutor a class — ADR-020), Admin (all)
- [x] Automated RLS tests: assert Parent A cannot query Parent B's child data, Student cannot query siblings' data, etc. — 38 pgTAP assertions (RLS-01..21), CI-gated
- [x] Seed data: 114 Surahs (name, Arabic, transliteration, ayah count) and 7 Jilid (page counts) — version-controlled seed file (migration 004)
- [x] Database webhooks configured (Supabase → Netlify Functions) for absence notifications **and jilid-completion detection** — both done, plus surah-memorized, new-homework and report-published. Written as migrations rather than configured in the Supabase dashboard, so they are version-controlled and reproduced by `db reset`; per-environment target read from Vault, no-op when unconfigured. Jilid completion is now detected **server-side** by `notify-milestone`, which *imports* `src/lib/yanbua.ts#isJilidComplete` rather than restating it — the client-side detection in the Yanbu'a screen remains, using the same function, so there is one rule with two callers rather than two rules
- [x] Migration 009 added: `fn_notify_absence()` + `trg_notify_absence` + `fn_webhook_config()`. Covered by pgTAP cases WH-01…WH-06 asserting the trigger fires on the transition into `absent` and *only* that, is silent when unconfigured, carries the row id and never the absence `reason`, and that no client role can execute `fn_webhook_config()` to read the shared secret
- [x] Migration 010 added: `fn_post_webhook()` (the shared sender, extracted once four more triggers needed it) plus triggers on `yanbua_progress`, `murajaah_assignments`, `assignments` and `year_end_reports`. Covered by WH-07…WH-12 — including that the Yanbu'a trigger is *deliberately unselective* (so the completion rule has one implementation), that re-activating a murajaah target and re-publishing a report both notify nobody, that the assignment title never leaves the database, and that a broken webhook path cannot fail the write it observes
- [ ] Backup/PITR policy confirmed for chosen Supabase tier
- [x] Migration 008 added: `fn_pending_registrations()` — not in the original 10-entity scope, added to support admin enrollment (see §10)

## 4. API & Netlify Functions

- [x] Convention documented for when to call PostgREST directly vs. via a Netlify Function wrapper — emerged in practice rather than being decided upfront: plain CRUD goes straight through PostgREST from the client; anything needing the service-role key (bypassing RLS) goes through a Function that independently re-verifies the caller's authorization in code (see `invite-user.mts`)
- [x] 5 custom functions built — **seven exist, and the list itself changed**. Built: `push-subscribe`, `notify-absence`, `notify-milestone` (parts 1/2a), `notify-assignment` and `notify-report-ready` (2a, added because the Notification Spec had rows with no Function against them), and the three scheduled jobs below. Two from the original five are deliberately **not** built and are recorded as superseded rather than dropped: `streak-status`, which would return an integer every caller can already compute from rows it has (ADR-016(c), and `openapi.yaml` keeps the path with that reasoning), and `send-reminder`, which was a generic "send a reminder" wrapper the three specific scheduled jobs make redundant
- [x] 4 scheduled functions built with correct cron — **three built, the fourth superseded** (part 2b). `send-murajaah-reminders` (18:00), `homework-due-reminders` (08:00) and `weekly-progress-digest` (Friday 08:00) all run on `0 * * * *` and gate on the local hour in `Europe/Amsterdam` (`isAmsterdamHour`), rather than a fixed UTC hour that would be an hour wrong throughout CEST — which is what the TAD's original cron column would have produced. `calculate-streak-resets` is superseded by ADR-016(a)/(b): its only job was zeroing stale stored streaks, and there is no stored streak any more. Verified live on both a CET and a CEST date, including the second idempotent run, via `scripts/invoke-scheduled.mjs`, which pins the clock from outside the process — there is deliberately no test hook in the Function
- [x] Notification deduplication-by-tag logic implemented and tested — tag is `(event, user, **child**, local date)`, asserted in unit tests and confirmed live (two identical events → one notification, not two; two children → two notifications, not one). The child was added in part 2b: keyed without it, a parent of two absent children received one notification naming one child, because the second silently replaced the first on the lock screen. Part 1 recorded that as accepted; it should not have been (ADR-016(f))
- [x] Streak calculation logic — every edge case defined and unit-tested (TAD ADR-016(a), `computeStreak` in `src/lib/murajaah.ts`). A streak counts consecutive *periods* the target's `frequency` asks for: a day for `daily`, a Mon–Sun week needing three confirmations for `3x_week`, a week needing one for `weekly`. Counting runs backwards from the current period if it is already met and otherwise from the previous one, so today being unconfirmed does not break a run but a day that is over and was missed does (PRD AC-003). The week a target is assigned in asks only for as many confirmations as there were days to give them — the "assignment created mid-week" case — never fewer than one. Migration 011 drops `murajaah_log.streak_count` and `fn_set_streak_count`, which could only change on INSERT and so could not tell a live run from a broken one, and counted days even for a weekly target
- [x] Notification payload builder with the DPIA R6 content limits (child's first name + event type only), driven by the *recipient's* `users.locale`. Enforced structurally — the builder accepts no parameter that could carry a reason, grade or position — and mechanically, by a test that rejects any push string interpolating a placeholder other than `{{name}}`
- [x] Recipient derivation shared by every sender (`netlify/functions/lib/notifyStudent.ts`) rather than written per Function. Sending one family a notification about another family's child is the worst thing this product could do, and the realistic way it happens is the fourth Function to need recipients writing its own slightly different query. One query, one mapping function, unit-tested exhaustively (including a two-family class roster) and re-confirmed live on every event. Since ADR-022 that mapping is the *only* thing deciding a recipient: the role filter that sat beside it is gone, along with `role` on the row type it read, because it could only ever subtract from a correct answer — and did, for every tutor and admin whose own child attends the TPA
- [x] Class-scale fan-out with bounded concurrency: one assignment reaches a whole roster, so sends run in parallel up to a cap — sequentially it could run the Function into its timeout with half the class notified, and unbounded it would open a socket per family. One dead subscription never costs the rest of the class their notification (unit-tested; that failure cannot be produced on demand against a real push service)
- [x] A second authorization shape for Functions with **no caller** (`netlify/functions/lib/webhookAuth.ts`): shared-secret channel authentication, constant-time, failing closed when unconfigured. `callerAuth.ts` does not fit a webhook or a scheduled job, and inventing a service-account JWT to make it fit would have been worse. Proving the channel does not decide recipients — `notify-absence` re-reads the row from the database and derives the parent from `students.parent_id`, never from the request
- [x] `invite-user.mts` built — the project's **first real Function**, landed ahead of the 5 above and not part of the original spec (admin email-invite, see §10 and TAD's Netlify Functions table). Since TAD ADR-018 it also sends the branded role-aware invitation email
- [~] **Transactional email (Resend)** — utility, templates and one call site built (ADR-018). `lib/email.ts` never throws and fails open; `lib/emailTemplates.ts` holds the invitation copy keyed role → locale, in the formal register PPME's own correspondence uses. Wired into `invite-user` only; the event notifications (absence, milestone, reminder, report-ready) stay push-only and get their own templates later on this same pattern. Three things kept this at `[~]` rather than done: the sending domain was not verified, the EU region was not confirmed selected, and no real email had ever been sent or seen in a client. **The domain is now verified** — `ppmedenhaag.nl` (not the `tpa.` subdomain originally assumed), confirmed by a live send from the production key landing in a real inbox (ADR-031); `FROM_ADDRESS` in `lib/email.ts` was updated to match. **The EU region is still not confirmed selected**, and remains a prerequisite before any real family is invited. The *two emails per invite* problem ADR-018(b) recorded is resolved (ADR-026): `invite-user` now sends exactly this one. The second user-creation path (`registerUser` in `src/features/admin/api.ts`, used when someone signed in before an admin registered them) is a client-side insert that cannot reach a server-side key, so it sends nothing
- [x] `generate-year-end-drafts.mts`, `publish-report.mts`, `report-pdf.mts` built (§9) — the 2nd–4th Functions, and the 2nd–4th holders of the service-role key. Their shared authorization shape (validate the JWT with an anon-key client, then look the role up independently with the service-role client) is now factored into `netlify/functions/lib/callerAuth.ts` rather than copied per Function

## 5. Frontend / PWA (build against the validated prototype)

- [x] `manifest.json` + icon set using the real PPME logo — configured (192/512/maskable) in `vite.config.ts`, now generated from the **high-resolution vendor masters** in `assets/brand/` (3564×1844) by `scripts/generate-brand-assets.py`, replacing the ~3.7x upscale from a 135×70px source. The square icons carry the **globe mark alone** rather than a letterboxed wordmark, so they stay readable at 48px; the maskable variant is scaled to 58% so its furthest pixel sits inside the 80% safe zone under any launcher mask. Also generated: `public/logo.png` (full colour), `public/logo-white.png` (reversed, for the blue top bar — the white pill behind the old logo is gone), 16/32px favicons, and `icons/badge-96.png` — the Android notification badge, which must be a **transparent monochrome silhouette** because Android masks that slot by its alpha channel and repaints it (an opaque icon shows as a white block, and no badge at all shows Chrome's logo; both were live until a real device caught it)
- [x] Service worker via Workbox: app-shell precaching done (`vite-plugin-pwa`, `generateSW`); runtime caching per route. **Offline attendance/murajaah/Yanbu'a/Quran submissions are now queued and replayed** (`src/lib/offlineQueue.ts`, `src/lib/offlineReplay.ts`, `src/hooks/useOnlineStatus.ts`) — deliberately at the **app layer**, not Workbox's Background Sync API: that API doesn't exist on Safari/iOS at all, and its default plugin has no hook to refresh an expired Supabase session before replay, so a queued write returning `401` would be silently treated as delivered and dropped. Driving replay from `supabase-js`'s own session state in the main thread avoids both. `submitAttendance`/`confirmPractice`/`insertYanbuaProgress`/`insertQuranProgress` are reused unmodified for replay, so there is exactly one implementation of each write, online or queued. Yanbu'a and Quran recording were added after attendance/murajaah (TAD ADR-030) and needed a new mechanism to replay safely — see the next line
- [x] IndexedDB offline queue tested for conflict resolution — **scope is "safe, idempotent replay," not a merge UI**, decided explicitly rather than discovered as a gap later: attendance's `upsert` on `(session_id, student_id)` is already last-write-wins at the database layer (true online today, unchanged by this work), so offline support widens the window during which two devices could overwrite each other's mark rather than introducing a new failure mode. What the queue gets right instead: oldest-first replay, and a murajaah replay that lands after its insert already succeeded (response lost, not the write) hits the table's `unique (assignment_id, date)` constraint and is treated as delivered rather than an error — the same pattern `getOrCreateTodaySession` already uses for its own race. `yanbua_progress`/`quran_progress` had no such constraint at all (a bare `insert`, confirmed by reading `002_tables.sql`), so migration 015 adds a nullable, unique `client_ref uuid` to both — set only on a queued write, from the queue entry's own client-generated id — and `offlineReplay.ts` treats a `23505` on it the same way (TAD ADR-030). No optimistic-concurrency/version-check merge logic exists, and none was asked for. `tests/unit/offlineQueue.test.ts` and `tests/unit/offlineReplay.test.ts` cover the queue and replay logic against an in-memory fake store — not real IndexedDB, which jsdom (this project's test environment) doesn't implement; `indexedDbStore()` itself is thin and untested, same treatment this project already gives other browser-API adapters (`push.ts`). Manual devtools-offline verification is **done for attendance/murajaah**: against the local Postgres stack and `npm run dev`, both queue and show the "will sync" banner when Chrome's Network panel is set to "Offline", replay and clear the queue when reconnected, land the rows in Supabase Studio, and a genuine same-day rejection while online still surfaces the red error banner rather than being queued. **Yanbu'a/Quran's `client_ref` idempotency is verified at the REST/RLS layer** against the same local stack (a fixture tutor's minted JWT): a fresh `client_ref` inserts and returns `201`; resubmitting the identical `client_ref` — simulating a replay of an entry whose response was lost after the write already committed — returns `409`/`23505` with no duplicate row created; a `tutor_id` not matching the caller returns `403`/`42501` (RLS); an invalid `ayah_to < ayah_from` returns `400`/`23514` (check constraint) — both genuine rejections, not network errors. The actual DevTools-Offline **browser** click-through for Yanbu'a/Quran (the "will sync" banner, IndexedDB entry, replay-on-reconnect through the real UI) is **not yet done** — no browser automation was available in the session that built this — and remains the one outstanding manual step before this row can be marked fully done for all four writes
- [x] Role-based routing/dashboards for the 3 roles shown in the prototype: **Ustadz** (Hadir/Tugas/Yanbu'a/Al-Quran/Murajaah — class roster views), **Orang Tua** (same 5 tabs — single child's data), **Santri** (same 5 tabs — self view, 16+ only) — built for all 5 tabs (**Hadir + Tugas + Yanbu'a + Al-Quran + Murajaah**). A 4th role (**Admin**) was also built (§10); since ADR-014 it uses the *same* five tabs and the same class-shaped tutor views on every class, rather than the separate replacement nav it had originally. **Routing is no longer keyed on the role column** (ADR-025): each of the six two-shaped screens picks its shape from a `ViewScope` resolved out of the caller's relationships, so a person who is several things — a tutor whose own child attends, an admin who also teaches, a 16+ santri who assists a class — reaches every screen they are entitled to instead of the one their `users.role` label happened to name. For anyone who is one thing the resolved scope is exactly what the old expression returned, including the invited-but-unassigned tutor, whose scope still comes from the role column because they hold no relationship yet
- [x] **An admin can create a person who holds more than one relationship** (ADR-028). The enrolment pickers no longer filter by `users.role`: a tutor or an admin may be named as a child's parent (ADR-024) and a 16+ santri as a class tutor (ADR-020). Until this change every such account in the project existed because SQL put it there, so ADR-024 was a decision the product could not act on and ADR-020(d)'s entitlement was unreachable from the admin side too. The filter was never a control — neither `students.parent_id` nor `classes.tutor_ids` is role-constrained, and only an admin sees these screens — so what changes is reach rather than privilege (DPIA R12). `student` stays out of the parent list deliberately; each option is labelled with the account's current role
  - [x] Note: prototype's top "Pilih Peran" switcher is **prototype-only** — production derives role from authenticated user via Supabase Auth + RLS, not a manual toggle — confirmed correct in the shipped `AuthContext`/RLS implementation. **Still true after ADR-025**, which builds a control that has to be told apart from it: the **scope switch** offers only the relationships the signed-in account already holds (never a role, and never a role it does not hold), renders only when there is more than one, and is captioned by subject — "Grup saya" / "Anak saya", "Saya" for a 16+ self-login, "Keluarga saya" for the account that is both. Role is still derived and never chosen; what is chosen is which of one's own relationships a screen is about. `scripts/verify-push.mjs` §9 asserts the captions live, so a future edit cannot quietly turn it back into "Pilih Peran"
  - [x] Scope switch placement: **not** a sixth tab. Five 44px targets is what a mobile bottom nav fits at 390px and those five are the prototype-validated set, and a scope is not a destination — pressing it leaves you on the same screen with a different subject. It renders above the content on mobile (`AppLayout`) and at the right-hand end of the desktop tab row (`DesktopTabs`), which is where the admin "Kelola" entry already lives for the same reason: desktop has the horizontal room. Verified at 390px in both locales; the longest Dutch caption pair is "Mijn groep / Mijn gezin" and neither overflows
- [x] **An admin can link a self-login account to a student created earlier, not only at the moment of creating them** (ADR-032). `StudentForm`'s "Tautkan Akun Login Mandiri" control (ADR-021(d)) only ever rendered inside the create form; every existing row on `StudentsPage` was read-only, with no edit action and no `updateStudent` in `api.ts`. That left the ordinary mid-year case — a September enrollment, a January Google account — with no admin path, even though `students_admin_all` (migration 003) already permits the update at the RLS layer. Each row now has an "Ubah" action opening the same form pre-filled, mirroring `ClassesPage`/`ClassForm`'s existing edit-in-place pattern exactly rather than inventing a second one. Verified against a real local Postgres+RLS stack via both routes an account can arrive by: a pending role=`student` sign-in seeded directly, and a full `netlify dev` run of the actual "Undang Pengguna Baru" invite Function (`201`, real success banner) — both ending in the same check, confirmed from the newly-linked account's own minted JWT, that it can now read its own record and, correctly, not a sibling's
- [x] Bottom tab nav built in confirmed order: Hadir | Tugas | Yanbu'a | Al-Quran | Murajaah — **the same five for every role including admin** since ADR-014. The admin-only tab set that used to *replace* them (Pendaftaran | Kelas | Santri | Rapor) is gone: 5 + 4 will not fit a mobile bottom nav at 44px tap targets, and the 5 above are the prototype-validated set. The enrollment screens sit one level down behind a single "Kelola" entry (a dashboard tile, plus a sixth tab on desktop where there is room), with an `AdminSectionNav` pill strip inside `/admin/*` to move between them. Order unchanged, so no re-validation against the Figma Make prototype was needed — a unit test (`tests/unit/tabs.test.ts`) now pins it
- [x] Top nav: logo left, language toggle (globe icon), notification bell with badge — **all three now built**. The bell waited for the in-app notification centre it opens (TAD ADR-015 part 3 / ADR-017), because a bell with a badge promises a stored, readable list and there was no table behind it until migration 012. It renders for parents and 16+ students only: a tutor or admin receives no notifications and can read nobody else's, so a bell for them would be a permanently empty control that also implied an admin inbox of every family's messages exists
- [x] Attendance check-in UI: 3-state per student (✓ present / clock late / ✕ absent), matching `attendance_status` enum
- [x] Streak/gold-accent treatment reserved specifically for achievement moments (Murajaah flame counter, "Sudah Hafal" badges) — not used elsewhere — followed for Yanbu'a's jilid-complete banner and now Murajaah's streak number + "mark memorized"/portfolio badges (§13)
- [ ] Accessibility pass: 44px minimum tap targets, tested on real Android 8+/iOS 13+ devices — 44px enforced in CSS (`min-h-11` convention) but never verified on real hardware
- [ ] **iOS Web Push tested specifically** — requires "Add to Home Screen" first on iOS 16.4+; not a given even though iOS technically supports it. **Still unverified: there is no iOS device available to this project.** What exists is the handling — an iPhone in a Safari tab is detected as `ios-install-required` (iPadOS's "I am a Mac" user-agent included, via the touch-point check) and shown the install steps, rather than the flat "your browser doesn't support notifications" that the missing `PushManager` would otherwise produce. That branch is unit-tested against each platform's shape; it is not the same thing as having watched a notification land on an iPhone, and must not be recorded as such
- [x] Notification permission / subscribe UI + settings screen (`/settings/notifications`) — built for everyone, reached from the dashboard. Whether the toggle is offered is a **relationship** question since ADR-022 (`canReceiveNotifications` over the caller's own capabilities), asked with the same predicate `push-subscribe` uses, so the screen cannot offer a switch the Function then refuses. Handles permission-denied (explains where to undo it, rather than re-prompting into a wall), unsupported browsers, iOS-not-installed, and a push service that does not respond. Shows enabled/disabled from **server** state, not the browser's, so a subscription the server has dropped cannot be displayed as working
- [~] Notification center/list screen — **built** (`/notifications`, TAD ADR-017) and **reviewed against §1's design direction**, with every finding applied. A PPME prototype-batch review is still outstanding, which is why this stays `[~]`.

  The review was done against the rendered screen at 390px in both locales, not against the code. Findings:

  - **The screen used none of the palette's meaning.** An absence, a finished jilid and a weekly summary rendered as three identical grey cards. §1 assigns these colours jobs — danger for "absence markers", gold for "milestone/celebration moments" — and the centre carries the only celebration content in the app outside Murajaah's streak and the "Sudah Hafal" badges, yet rendered it grey. Fixed with a three-tone system (`src/features/notifications/eventStyle.ts`): danger for absence, accent for the two milestones, primary for everything informational, each with a glyph drawn from the tab bar's own vocabulary. Three tones, not eight: eight colours is decoration, three is a language. Unit-tested so gold cannot leak to a non-celebration event and red cannot leak past absence
  - **The unread state was too weak to survive a phone in daylight** — a 2px dot and a 5%-opacity tint. Now also a left rule in the primary colour
  - **Verified, no change needed:** the last row clears the fixed bottom tab bar; rows are full-width links well past the 44px minimum; the icon is `aria-hidden` so a screen reader gets the sentence, not the decoration; Dutch copy (longer than Indonesian throughout) wraps to three lines without truncation or overflow; the non-recipient state renders correctly for a tutor
  - **Left alone deliberately:** the child's name sits mid-sentence rather than in a chip. For a parent with three children that is the weakest part of scanning the list, but every string already names the child (enforced by test), so a chip would print the name twice. Worth putting to PPME rather than deciding here
  - **Noted:** the bell's unread count uses danger red, where §1 assigns red to absence and overdue items. Kept, because a red count badge is near-universal and the alternatives read as decoration, but it is a deliberate departure rather than an oversight What changed is the risk of building it first. The schema records domain events and nothing about presentation, so a review can regroup by child, split read from unread, add filters or dismissal, or reword everything, without a migration — and the screen itself deliberately reuses the Murajaah/Quran card-list pattern rather than inventing a layout, so a review has something conventional to react to. The in-app copy it uses was already drafted (`notifications.*`); two of those strings did not name the child, which a parent of two needs, and now all of them do

## 6. Security & Compliance

- [ ] Privacy Policy drafted (NL + ID), owned by PPME IT team, linked before any authentication step
- [ ] DPIA completed for children's data (PPME IT team ownership)
- [~] Right-to-erasure flow: cascade delete of student + all related records is in place at the DB layer, and the **manual** procedure is now written down step by step (README "Right to erasure"), including deleting the year-end report PDF from Storage first — `on delete cascade` never reaches Storage. Still no admin-facing UI or automated flow
- [ ] GDPR Article 20 data export (CSV) implemented for parents
- [ ] Consent flow for under-16 students confirmed against the hybrid account model
- [ ] **[IT TEAM] Confirm Google's current minimum age for a self-managed account in the Netherlands, and decide whether a Family Link supervised account may be linked to a student record (ADR-021).** The app deliberately enforces no age rule of its own — auth is Google OAuth only, so the threshold is applied upstream, and `date_of_birth` is recorded but never gates anything. Two things follow that IT should settle rather than inherit: the privacy policy tells families that under-16s get no account of their own, which is true because *Google* declines them and not because the app refuses, and a supervised child account can complete an OAuth sign-in, so the boundary is a strong default rather than an enforced one. Related: PPME has decided an under-16 santri **may** assist with a younger class (ADR-020/ADR-021), and an assistant who does hold a login can record that class's data — assigning a student to `classes.tutor_ids` is an enrolment decision with an access consequence
- [~] Basic OWASP Top 10 check on public Netlify Functions (input validation, rate limiting on endpoints like `push-subscribe`) — done for the two Functions added with notifications, not yet as a sweep across all of them. `push-subscribe` validates the subscription shape (HTTPS endpoint, both keys present, length bounds) before anything reaches the untyped `jsonb` column, stores only the three fields it uses, and rate-limits per caller. `notify-absence` authenticates its channel in constant time and fails closed. **The rate limiter's honest scope**: it counts per warm function instance, in memory, so it stops a looping client or a retry storm but not an attacker spreading requests across cold starts. Anything stronger needs shared state (Postgres or a KV store) this project has no place for yet — recorded in TAD ADR-015 rather than left implied
- [ ] **PPME IT sign-off on the super-admin role (ADR-014) before real student data is entered.** The `admin` role now reads *and* writes every child's operational data across the whole TPA. Nothing about that is new at the database layer (RLS has always granted admin `ALL`), but it is new in practice, and it changes the blast radius of a compromised or offboarded admin account from "enrollment records" to "everything". Three things IT should decide and record: (1) how many admin accounts exist and who holds them — keep the number small and named, not shared; (2) 2FA required on the Google accounts behind them (the app has no password of its own — DPIA R2); (3) admin offboarding must be as prompt as tutor offboarding, and is more urgent (DPIA R8 vs R11). Also worth noting for the record: the app keeps no audit log, so an admin edit to a report or an attendance row is not attributable after the fact beyond the `tutor_id` on rows it creates

## 7. Testing & Monitoring

- [x] Vitest unit tests for streak/mastery/notification logic — all three covered. Notifications: payload building in both locales, R6 content limits, dedup tags including the sibling case, DST/local-time helpers, subscription validation, rate limiting, the service worker's own push/click handlers, platform capability detection, recipient derivation + fan-out dispatch, and that no Function response can carry an identifier. Streaks: every frequency, the missed-period reset, the mid-week assignment, both 2026 DST switchovers and a year boundary. Plus the scheduled-Function gate itself, on a CET and a CEST date. Capability derivation was added later with ADR-019 (test-plan §4.5): what a person can do derived from their relationships, including the dual-role case and the student assistant, and half of it asserting what the *queries* ask rather than what they return, since the bug it fixes was a query asking wider than the screen meant. The
suite was then swept for what it had never reached rather than for what
was newly written: all sixteen capability combinations instead of the six
somebody had named, the orchestration every notification sender shares,
the browser-side subscribe/unsubscribe flow, the weekly-activity query's
timezone narrowing, and — the two that mattered most — `authenticateCaller`
and `verifyWebhookSecret`, which decide who may operate the service-role
key and were at 9% and 35% of lines respectively. 346 unit tests, and
`npm run test:coverage` to re-measure (97.3% of statements over
`src/lib` + `netlify/functions/lib`, up from 67.6%)
- [ ] Playwright E2E covering the 5 primary flows: attendance, homework, Yanbu'a, Al-Quran, Murajaah. Note for whoever picks this up: the CI `e2e` job runs against a bare dev server with no Supabase, which is why the suite is still the sign-in scaffold. The notification flow is instead verified by `scripts/verify-push.mjs`, which needs Docker + a loaded fixture + `netlify dev` and so cannot run in that job either — it is run by hand and its results are recorded in test-plan §6
- [x] RLS policy tests automated in CI — 231 pgTAP assertions (RLS-01…RLS-42, WH-01…WH-12, NC-01…NC-18), up from 104. RLS-42 is the newest and asks a different kind of question: not what a role may see, but what it may *make*. `supabase db diff --linked --schema public` — the read-only production check, run against Frankfurt for the first time — reported no object drift at all and one privilege difference: `ALL ON SCHEMA public`, which is USAGE **and CREATE**, granted to `anon` and `authenticated` at provisioning and asked for by no migration here. Migration 014 revokes the CREATE half (ADR-027); USAGE stays, because PostgREST resolves every table through the schema. RLS-36…RLS-41 and NC-17/NC-18 close the combination space rather than adding a feature. Two axes had gone unvaried: **which class** (every dual-role fixture deliberately separates the tutor half from the parent half, so the commonest arrangement at a small TPA — teaching the class your own child is in — had never been asserted at all), and the **empty cells of the capability lattice** (four independent booleans have sixteen combinations; six were covered). The overlap cases surfaced two behaviours nobody had decided. One is now fixed: a student assistant assigned to their own class could grade their own Yanbu'a and Quran, set their own memorization target, mark their own homework verified, author their own year-end report and read that draft — the boundary ADR-020 states in prose and never enforced. Migration 013 (ADR-023) closes all five by relationship rather than by role; `attendance` is deliberately left, because the register is one upsert of the whole roster and refusing one row would stop the assistant marking anybody (ADR-023(c), asserted in RLS-37 rather than assumed closed). The other went the other way and is now ADR-024: a tutor of the class their own child is in *may* record that child's progress and write that child's year-end report, seeing it in draft. PPME decided the overlap is correct — at a small TPA a teacher teaches their own children — so RLS-36 pins a decision rather than an accident, with no migration behind it. NC-12…NC-16 (ADR-022) ask the notification-centre question of the same multi-relationship people: a tutor-parent and an admin-parent read their own child's notifications and nobody else's, a student assistant reads none for the class they teach, and the ordinary parent is unaffected. RLS-28…RLS-34 cover people who hold more than one relationship (ADR-019): that someone who is both a tutor of one class and the parent of a child in another gets the union of the two grants and **nothing more**, identically whichever of the two values their `users.role` happens to hold, and that the union is not a promotion — they cannot record progress for their own child, cannot confirm home practice for a student they teach, and cannot see their own child's draft report. RLS-34 extends that to three relationships at once (admin + tutor + parent) and records where the pattern stops: an admin's grant is unconditional, so it swallows the other two and the "nothing more" property does not survive it. RLS-35 covers the student assistant (ADR-020) — a 16+ student who also tutors may record for the class they teach, which the database has always allowed because no policy tests for the `student` role at all. The NC cases cover the notification centre: cross-family invisibility, that no client role can insert or delete a notification at all, that a recipient can write `read_at` and nothing else, that neither admin nor tutor reads any, and that `TRUNCATE` — which RLS does not filter — is no longer held by `anon`/`authenticated` on any table
- [ ] Netlify Analytics + Supabase Dashboard monitoring wired up; define who's alerted on scheduled function failures (silent otherwise). **More urgent again after part 2b**, which added three jobs that run 72 times a day between them and that nobody would notice failing: a family who stops getting reminders has no way to tell that from a quiet week. A failure is also *silent by design* elsewhere — `fn_notify_absence` swallows its own errors so a notification problem can never fail a tutor's attendance save, and pg_net delivers asynchronously. The scheduled jobs return their counts in the response body and a 500 with the message on failure, both of which land in Netlify's function log; `net._http_response` in Postgres is the other place to look (see README). Nobody is alerted by either today

## 8. Still Open — Resolve in Parallel, Non-Blocking

- [ ] **WhatsApp integration & budget** — Phase 3 feature (~€300/mo), not needed for MVP; push-only fallback already scoped
- [ ] **Multi-branch timing** — single-tenant recommended for Phase 1 (Den Haag only); revisit if PPME expands
- [ ] **Yanbu'a curriculum variants** — confirm whether the standard 7-jilid structure is universal at PPME, or if seed data needs adjusting

## 9. Year-End Curriculum Reports (New Feature, Milestone 6)

Built against the existing schema/RLS (migration 005 already covered
`year_end_reports`, the enums, the policies and the `reports` bucket; no new
migration needed) — same "verify against a real local Postgres+RLS stack" bar
as Milestones 1–4, plus a `netlify dev` layer this time, since the three
Functions below hold the service-role key and can't be exercised through
plain PostgREST calls the way the RLS-only features could.

- [x] Migration 005 applied (`year_end_reports` table, `report_status`/`report_grade` enums, RLS, `reports` Storage bucket)
- [x] `pdfkit` added as a dependency for the `publish-report` Function (ADR-011) — 8.2 MB installed (mostly standard-font metrics), well inside Netlify's 50 MB zipped / 250 MB unzipped Function limits, and no headless browser to cold-start; a report renders in well under a second locally
- [x] PDF template designed: brand header band, attendance stats table, subject grades table, narrative section, footer (tutor name + publish date) — labels are **bilingual ID/NL in one document** rather than rendered per recipient locale, so there is exactly one current PDF per report (FR-006) and no ambiguity about which language the stored object is in. The header now draws the **real reversed wordmark** (`doc.image()`), no longer a typographic stand-in: the high-resolution master exists, and the bundling problem was solved by inlining the PNG as base64 in `netlify/functions/lib/logoAsset.ts` rather than via `included_files` — a string constant is bundled by esbuild and behaves identically under `netlify dev` and on deployed Netlify, where runtime *file* resolution does not. The typographic header is kept as a fallback if the asset fails to decode, so a publish can never fail over branding (both paths unit-tested)
- [x] New "Reports" screen for Parent and Student 16+ (`FamilyReportsView`, reached from the dashboard tile — the 5-tab nav order is prototype-validated and deliberately unchanged); staff review/publish screen (`TutorReportsView` → `ReportEditor`). The admin generate-only screen at `/admin/reports` was **removed by ADR-014**: admin now uses the same `TutorReportsView` on every class, with bulk generation as a `GenerateDraftsPanel` above the list, so a deliberately content-blind screen had nothing left to protect
- [x] `generate-year-end-drafts`, `publish-report`, `report-pdf` Functions implemented per the OpenAPI contract, which was updated where the build found it wrong: `skipped_no_tutor` added to the generate response (a student with no class, or a class with no tutor, can't have an author — `tutor_id` is NOT NULL), `publish-report` narrowed to the authoring tutor only (ADR-013) and given a 400 for an empty narrative, `report-pdf` documented as denying admin
- [~] **Decision on the "Admin-triggered" generation call (TAD ADR-013)** — half of it superseded by ADR-014. Still true: bulk generation needs an enrollment-wide view, so the trigger is admin's, and **publishing is authoring-tutor-only**, admin included. No longer true: admin now reads and edits report content, `report-pdf` serves admin any report (draft or published), and the content-blind `/admin/reports` screen is gone. The one edge this created is handled explicitly — an admin edit to a *published* report cannot regenerate the PDF (that call 403s), so the editor hides the publish button for admin and shows "the PDF will not update until *[tutor]* re-publishes" rather than silently shipping a stored PDF that disagrees with the app
- [x] **Decision on the Storage path**: `{student_id}/{academic_year with / → -}.pdf`. The TAD's literal `{academic_year}.pdf` would nest each report a directory deeper, since Storage reads `/` as a separator. Deterministic per student+year, which is what makes re-publish overwrite in place rather than accumulate versions
- [x] Report-ready push notification (FR-007) — was deliberately out of scope for *this* milestone (Year-End Reports shipped before notification infra existed), and this row was never flipped back after it landed. `netlify/functions/notify-report-ready.mts` exists and is the fifth sender named in §4's "part 2a" status update below. This checkbox was stale, not the feature
- [x] i18n: `reports` namespace was pre-drafted at **30 keys per locale** (not the 172 this line previously claimed — corrected after counting); 19 genuinely-missing keys added for the review/publish/generate forms (`academicYearLabel`, `academicYearInvalid`, `classScope`, `allClasses`, `skippedExisting`, `skippedNoTutor`, `adminScopeNote`, `subjectYanbua`, `subjectQuran`, `subjectMurajaah`, `subjectNotes`, `notGraded`, `narrativeRequired`, `readOnlyOtherTutor`, `noDraftsForClass`, `republish`, `progressContext`, `murajaahTargets`, `saved`) → **49 per locale, parity-checked by the existing CI test**. `confirmPublish` was also reworded in both locales to stop promising a notification that FR-007 doesn't send. `reviewDraft`, `editPublished`, `notPublishedYet` and `notification` remain unused. *Since ADR-014: `adminScopeNote` was deleted (it described the content-blind admin screen that no longer exists) and three keys added — `adminCannotPublish`, `adminEditPdfStale`, `authoringTutor` — so the namespace stands at 51 per locale*
- [x] RLS tests RLS-15 through RLS-21 passing — unchanged by this milestone (no migration), re-run green as part of the full 38-assertion suite against a fresh local stack before and after the build
- [x] Right-to-erasure procedure updated to explicitly delete the student's Storage PDF object, not just the DB row (cascade delete doesn't reach Storage) — concrete runbook in README ("Right to erasure"), referenced from TAD "Other Artifacts" and test-plan.md §8
- [x] Unit tests for the §4.4 assertions (`tests/unit/reports.test.ts`, 15 cases): hand-computed stats accuracy, duplicate-generation skip counts, publish atomicity (an injected PDF-render failure and an injected Storage failure both leave `markPublished` uncalled), re-publish overwriting one object, and a PDF text-extraction smoke test for name/year/attendance rate/grades/tutor
- [x] Verified against a local Postgres+PostgREST+RLS stack **plus `netlify dev`**: 53 assertions via curl with minted JWTs for admin/two tutors/two parents/16+ student — non-admin generate rejected (403), invalid academic year rejected, first run creates 3 for one class, stats matching hand-computed 92.30/100.00/84.60 with an out-of-window session correctly excluded, re-run creating 0 and skipping 3, all-classes run adding only the remaining student, drafts invisible to parent and 16+ student via PostgREST, publish rejected with an empty narrative (status still `draft`), co-tutor and parent publish attempts rejected, publish → PDF in the bucket → status flipped, parent/tutor/16+-student signed URLs served and cross-family/admin/draft cases refused, then an edit + re-publish overwriting the same object with the same `published_at` and the corrected text inside the regenerated PDF. Also a scripted Playwright click-through of E2E-09/E2E-10 against `netlify dev` + `DevAuthSwitcher` (admin generate → tutor review/grade/publish → parent view + PDF download → admin blocked from `/reports`) with zero browser console errors; not committed to CI, which has neither the Functions runtime nor fixture data
- [ ] Dry run: one real tutor publishes one real report before the actual year-end rollout, to catch UX/content issues early

## 10. Admin Enrollment (New Feature — built ahead of schedule, not in the original numbered order)

Not part of the original PRD/TAD feature list or this checklist's build order — built in response to a direct need (someone has to be able to get users into the system) rather than as a scheduled milestone. Scope was deliberately narrowed to enrollment/setup only (TAD ADR-012); **ADR-014 has since reversed that narrowing** — admin is a super admin with full read/write access to every operational screen, and the enrollment screens below are simply the part of its job that no other role shares.

- [x] `/admin/registrations`, `/admin/classes`, `/admin/students` built (`src/features/admin/`)
- [x] Migration 008: `fn_pending_registrations()` — admin-only (enforced in the function itself), the only way to discover a Google sign-in with no `public.users` profile yet
- [x] Email invite flow: `netlify/functions/invite-user.mts` — creates `auth.users` + `public.users` together in one admin action, via `auth.admin.createUser()` under the service-role key (ADR-026; `auth.admin.inviteUserByEmail()` until then). Verified live against the local stack: 201 with a confirmed row, 409 on re-invite, zero GoTrue mail. **Not verified from this machine**: a real Google OAuth sign-in against a `createUser`-created row — no test Google account is available here, so ADR-026(a)'s account-linking claim rests on reading GoTrue's own source rather than a click-through
- [x] ~~Admin nav is exclusive, not additive~~ — **reversed by ADR-014.** `ADMIN_NAV_TABS` (which replaced the operational tabs) is now `ADMIN_SECTION_TABS`, a secondary pill strip *inside* `/admin/*`; admin gets the same five operational tabs as everyone else plus one "Kelola" entry point. `AdminRestricted.tsx` and its two i18n keys are deleted. `RequireAdmin.tsx` is unchanged and still guards every `/admin/*` route — including the new `/admin` index, which redirects to `/admin/registrations`
- [x] Dev-only fixture sign-in panel (`src/dev/DevAuthSwitcher.tsx`) + `supabase/dev-fixture.sql` — lets the whole admin flow (and Milestone 1) be exercised locally without real Google OAuth. The panel now also offers the fixture's **second tutor** (Ustadz Baru, assigned to Grup B only), which the fixture always contained but the panel never listed — it is the only way to check a tutor's class scoping from the browser rather than with a hand-minted JWT, and that check got more important once admin stopped being the only role whose scope was worth re-testing
- [ ] No standalone "remove/deactivate a student" flow
- [ ] No CSV export. ADR-012's objection no longer applies (admin may read this data), so what's left to settle is GDPR art. 20 scope and DPIA risk R4: an export must leave out the absence-`reason` free-text field, which can carry health data
- [x] ~~Supabase Auth's Site URL / Redirect URLs allow-list needs to be correct on the live project for invite emails to land on the right domain~~ — moot since ADR-026: `invite-user.mts` no longer sends an invite email, so there is no `redirectTo` link for that setting to affect

## 11. Homework Assignments — Tugas (New Feature, Milestone 2)

Built against the existing schema/RLS (migrations 002/003 already covered `assignments`/`assignment_status`; no new migration needed) — same "verify against a real local Postgres+RLS stack" bar as Milestone 1.

- [x] Tutor view (`TutorAssignmentsView`): class roster → create assignment (title/description/due_date) → assign to the whole class or a hand-picked subset of students (checkbox list, all checked by default) → per-student status marking (Pending/Completed/Incomplete/Partial) with optional notes, same drill-down shape as `TutorYanbuaView`
- [x] Family view (`FamilyAssignmentsView`): parent/student list with Pending/Completed/Incomplete/Partial/**Overdue** badges — Overdue is computed client-side (`src/lib/assignments.ts#computeDisplayStatus`), not a stored value: `assignment_status_enum` has no `overdue` member, so a row still `pending` past its assignment's `due_date` is the only case that maps to it; once a tutor marks a verdict, it stands even past the due date
- [x] Wired into the existing `/assignments` route in `src/App.tsx` (was `FeaturePlaceholder`); `AssignmentsPage` blocked admin the same way Attendance/Yanbu'a did (`AdminRestricted`) — **removed by ADR-014**, which routes admin to the tutor view here like every other class-shaped screen
- [x] Two new i18n keys added (`assignments.statusOverdue`, `assignments.notes`) — the rest of the `assignments` namespace was already drafted ahead of this build and reused as-is
- [x] Unit tests for `computeDisplayStatus` (`tests/unit/assignments.test.ts`)
- [x] Verified against a local Postgres+PostgREST+RLS stack: full create → assign-to-subset → mark-complete → parent-sees-update flow exercised via curl with minted JWTs for the fixture tutor/two parents/16+ self-login student, confirming cross-family isolation on `assignment_status` (empty result, not just filtered), a parent's write attempt resolving to 0 rows (no parent write policy exists), and a cross-class tutor's `assignments` INSERT rejected with 403
- [x] FR-005 (due-date reminder notifications) — was deliberately out of scope for *this* milestone, and this row was never flipped back after it landed. `netlify/functions/homework-due-reminders.mts` exists, is the scheduled Function §4's "part 2b" status update names, and runs daily at 08:00 Amsterdam time. This checkbox was stale, not the feature

## 12. Quran Recitation Progress Tracking — Al-Quran (New Feature, Milestone 3)

Built against the existing schema/RLS (migrations 002/003/004 already covered `quran_progress`/`surahs`; no new migration needed) — same "verify against a real local Postgres+RLS stack" bar as Milestones 1–2.

- [x] Tutor view (`TutorQuranView`): class roster → select student → record recitation session (surah via a searchable native `<select>` against the seeded `surahs` reference table, ayah_from/ayah_to range, `quran_quality` rating, optional tajweed notes), same roster-drill-down shape as `TutorYanbuaView`/`TutorAssignmentsView`
- [x] Family view (`FamilyQuranView`): parent/student current-position summary (surah, ayah reached, approximate whole-Quran completion %) + chronological recitation history with quality badges, mirroring `FamilyYanbuaView`'s `CurrentLevelCard`/timeline shape
- [x] **Decision on `students.current_surah`/`current_ayah`** (migration 002, never written by any prior code): current position is derived client-side from the latest `quran_progress` row rather than maintained as a second write path — see `src/lib/quran.ts`'s docstring and the TAD domain model footnote. Matches Yanbu'a's client-side jilid-completion detection (README "Known gaps") rather than introducing a new denormalization-sync pattern
- [x] Wired into the existing `/quran` route in `src/App.tsx` (was `FeaturePlaceholder`); `QuranPage` blocked admin the same way Attendance/Yanbu'a/Assignments did (`AdminRestricted`) — **removed by ADR-014**, which routes admin to the tutor view here like every other class-shaped screen
- [x] Four new i18n keys added (`quran.fieldSurah`, `quran.fieldQuality`, `quran.searchSurah`, `quran.savedMessage`) — the rest of the `quran` namespace was already drafted ahead of this build and reused as-is, including previously-unused keys (`surahNumber`, `percentQuran`, `lastSession`) now wired into `CurrentPositionCard`
- [x] Unit tests for `computeQuranPercent`/`findSurah` (`tests/unit/quran.test.ts`)
- [x] Verified against a local Postgres+PostgREST+RLS stack: tutor insert for own-class student, tutor `tutor_id` impersonation rejected, cross-class tutor insert rejected, parent read of own child, parent cross-family read returns empty (not just filtered), parent write attempt rejected (no parent INSERT policy exists on `quran_progress`), 16+ self-login student reads own rows only (not a classmate's), student write attempt rejected, and anonymous read returns empty — 11 cases via curl with minted JWTs for the fixture tutor/second tutor/two parents/16+ self-login student
- [ ] Milestone/celebration notification for reaching a juz or completing the Quran — **re-checked 2026-08-16 and downgraded from "open gap" to "speculative, never actually specced."** PRD Feature 4's FR-001…FR-005 name no such requirement (unlike Homework's FR-005 and Murajaah's FR-006, which explicitly ask for a reminder), and the TAD's Notification Spec table — the finalized list, states "all of them are live" — has exactly 8 rows and none of them is this. There is also no juz reference data anywhere in the schema or seed files to detect "reached a juz" against; "juz" exists only as a PRD glossary entry. This line was the checklist's own speculation by analogy to Yanbu'a/Murajaah's celebrations, made before the Notification Spec was finalized, and was never promoted into either source of truth. Leave unchecked as a record of scope PPME has not asked for, rather than a build task — if PPME wants it, it needs a scope decision (and, for the juz half, new seed data) before a Function does

## 13. Murajaah (Memorization) Tracking (New Feature, Milestone 4)

Built against the existing schema/RLS (migrations 002/003/004 already covered `murajaah_assignments`/`murajaah_log`, plus the `fn_set_streak_count` streak trigger; no new migration needed) — same "verify against a real local Postgres+RLS stack" bar as Milestones 1–3. Unlike Yanbu'a/Quran's single-table shape, this is a two-table model (tutor-set target + parent-confirmed log), which also means it's the first of these four builds where the tutor's create/manage screen and the parent's confirm screen touch genuinely different tables under different RLS policies rather than the same one.

- [x] Tutor view (`TutorMurajaahView`), two tabs — not a single roster-drill-down like Yanbu'a/Quran, since FR-004 needs a different shape than FR-001/FR-005/FR-007:
  - [x] "Tetapkan Target" (`TutorAssignView`): class roster → select student → assign a target (surah via the reused `SurahSelect`/`fetchSurahs`, ayah range, `murajaah_frequency`), same roster-drill-down shape as `TutorYanbuaView`/`TutorQuranView`; also shows the student's active target(s) with a "Tandai Sudah Hafal" action and their memorized-target portfolio + read-only confirmation history
  - [x] "Ringkasan Grup" (`TutorOverviewView`, FR-004): whole-class-at-once view of which students have/haven't confirmed today, plus a this-week confirmed-day count — same roster-at-once shape as `TutorAttendanceView`, unlike the drill-down above
- [x] Family view (`FamilyMurajaahView`): current active target(s) with streak display + one-tap "✓ Selesai Murajaah" confirmation (optional quality rating, parent role only), memorized-target portfolio, and chronological confirmation history — mirrors `FamilyQuranView`'s current-position/timeline shape
- [x] **Decision on "current streak" display — revised in Milestone 7 (TAD ADR-016(a)).** It originally read: the trigger-written `murajaah_log.streak_count` only changes on INSERT, so a live figure can't be verified between confirmations, and the UI therefore showed the latest log's stored count with its date rather than asserting a current streak. That was the right call while there was no way to compute one — and the wrong shape once there was. Migration 011 drops the column and its trigger; `computeStreak` derives the streak from the log at read time, in the period the target's `frequency` asks for, and the card shows a live number in the right unit (days for `daily`, weeks for `3x_week`/`weekly`). It also fixes a bug the stored count always had: a `3x_week` target confirmed Mon/Wed/Fri every week for a year read a streak of 1
- [x] **Decision on FR-005/FR-007's tutor TPA assessment**: there is no RLS write path from a tutor into `murajaah_log` (`mlog_tutor_read` is read-only; only `mlog_parent_insert`, scoped to the parent's own children, can write) and `murajaah_assignments` has no quality/assessment column — "if Hafal Lancar, mark as Memorized and assign next portion" resolves entirely through `murajaah_assignments.active` (tutor already has full RW there), applied as a tutor action rather than persisted as a separate assessment record — see `src/features/murajaah/api.ts`'s docstring and the TAD domain model footnote
- [x] Wired into the existing `/murajaah` route in `src/App.tsx` (was `FeaturePlaceholder`); `MurajaahPage` blocked admin the same way Attendance/Yanbu'a/Assignments/Quran did (`AdminRestricted`) — **removed by ADR-014**, which routes admin to the tutor view here like every other class-shaped screen
- [x] Nine new i18n keys added (`murajaah.fieldQuality`, `assignNew`, `targetAssigned`, `markMemorized`, `portfolio`, `noActiveTarget`, `tabAssign`, `tabOverview`, `history`) — the rest of the `murajaah` namespace was already drafted ahead of this build and reused as-is; `murajaah.assignedBy` and `murajaah.reminder` remain unused (the former needs a `users` read policy exposing a tutor's name to parents that doesn't exist — no other feature shows a "recorded by" name to families either — and the latter is FR-006, deferred with the rest of notifications)
- [x] Unit tests for `isStreakCurrent`/`startOfWeekLocalDate`, and since Milestone 7 for `computeStreak`/`computeBestStreak`/`currentPeriod`/`needsReminder` across all three frequencies, both 2026 DST switchovers and the mid-week-assignment case (`tests/unit/murajaah.test.ts`, 41 tests)
- [x] Verified against a local Postgres+PostgREST+RLS stack: tutor own-class insert, tutor `tutor_id` impersonation rejected, cross-class tutor insert rejected, tutor `active` PATCH (mark memorized) on own-class vs. cross-class (0 rows, not an error), parent read of own child, parent cross-family read returns empty, parent write attempt on `murajaah_assignments` rejected (no parent write policy), parent confirms `murajaah_log` for own child, parent `confirmed_by` impersonation rejected, parent cross-family `murajaah_log` insert rejected, tutor `murajaah_log` write attempt rejected (read-only), tutor read of own-class log, 16+ self-login student reads own rows only, student write attempt rejected, anonymous read returns empty, duplicate same-day confirmation rejected (unique violation) — plus a dedicated streak-trigger sequence confirming two consecutive days yields `streak_count=2` and a gap day resets it to 1 — 18 cases via curl with minted JWTs, plus a full click-through via `netlify dev`-equivalent (`npm run dev` + `DevAuthSwitcher`) as tutor and parent with zero browser console errors
- [x] FR-006 (daily practice reminders) — was deliberately out of scope for *this* milestone, and this row was never flipped back after it landed. `netlify/functions/send-murajaah-reminders.mts` exists, is the scheduled Function §4's "part 2b" status update names, and runs daily at 18:00 Amsterdam time. This checkbox was stale, not the feature

---

## Suggested Build Order

1. Repo + environments (§2) → 2. Database + RLS (§3) → 3. Auth flow (Google OAuth + role derivation) → 4. Ustadz attendance flow end-to-end (simplest, highest-value) → 5. Remaining Ustadz flows (Tugas, Yanbu'a, Al-Quran, Murajaah) → 6. Orang Tua views (read-mostly, reuses most backend work) → 7. Santri self-login (16+) → 8. Notifications/Functions (§4) → 9. PWA/offline polish (§5) → 10. Compliance docs finalized before any real student data is entered (§6)

**Status update (notifications, TAD ADR-015 part 2a):** every
*event-driven* notification is now built and verified — absence, jilid
completed, surah memorized, new homework assigned, and year-end report
published (PRD FR-007). Four of the five features that were waiting on
notification infrastructure are unblocked; the two that remain
(Homework's FR-005 due-date reminders and Murajaah's FR-006 daily
practice reminders) are both **scheduled**, and wait on part 2b along
with the weekly digest, `streak-status`, and the streak-reset decision.
Part 2 was split into 2a and 2b during the build — 2b introduces a
runtime this project has never run *and* the one real design decision
left (`3x_week`/`weekly` streak semantics), which has nothing to do with
the four event senders in 2a. The two Functions in 2a that were not in
the original five-Function list — `notify-assignment` and
`notify-report-ready` — exist because the Notification Spec had rows with
no Function against them.

**Status update (notifications, TAD ADR-015 part 2b + ADR-016):** every
notification in the Notification Spec is now built, and step 8's
notification half is done. The three scheduled Functions
(`send-murajaah-reminders`, `homework-due-reminders`,
`weekly-progress-digest`) close Homework's FR-005 and Murajaah's FR-006,
the last two features that were waiting on infrastructure. Two of the
originally-planned Functions were **not** built and are recorded as
superseded rather than quietly dropped — `calculate-streak-resets`,
because streaks became derived and cannot go stale, and `streak-status`,
because it would return an integer its callers already compute. What
remains of §4 is part 3, the in-app notification centre, which needs a
new table and a design review it has never had.

**Status update (notifications, ADR-015 part 3 + ADR-017):** Milestone 7
is complete. The notification centre is built — `public.notifications`
(migration 012), the `/notifications` screen, and the TopNav bell that
closes §5's last outstanding top-nav row. Every sender now writes a row
as well as pushing, including for families who have push switched off,
which is who the centre is mostly for.

Its **design is still unreviewed**, and the §5 row above is deliberately
left at `[~]` rather than ticked. What changed is not that the review
happened but that building first stopped being risky: the table records
domain events and nothing about presentation, so a review can regroup,
reorder, filter, split or reword the screen without a migration.

Three more things were fixed on the way, none of them part 3's brief.
Two of the drafted in-app strings did not name the child, which a parent
of two cannot use. `authenticated` and `anon` held **TRUNCATE** on every
table in `public` — a privilege RLS does not filter, confirmed by
emptying `attendance` from a `set role authenticated` session — inherited
from Supabase's own role bootstrap rather than from migration 007; not
reachable through PostgREST, which has no TRUNCATE verb, but revoked on
least-privilege grounds (NC-11). And the centre's "you receive none"
notice for a tutor rendered the raw i18n key, because the DB role enum
and the copy's key names deliberately differ.

Three things were fixed on the way through that were not part of the
brief, because they were bugs rather than gaps. A parent of two children
received **one** notification when both were absent — the dedup tag had
no child in it, so the second silently replaced the first; part 1 had
pinned that in a test as accepted. Every Function's response body
carried the dedup tags, each of which is a user id plus a student id,
on endpoints that under `netlify dev` answer unauthenticated requests.
And the 30-second bound on `pushManager.subscribe()` was tighter than
FCM's own latency — a subscription that FCM served perfectly well was
measured taking 32 seconds, so a family on a slow day was told the
feature was broken.

**Status update (notifications, TAD ADR-015 part 1):** step 8 is now
genuinely started rather than "barely". The push pipeline exists end to
end and the absence notification (PRD Feature 1 FR-005 / AC-002) is live:
VAPID, `push-subscribe`, the payload builder, the service-worker
handlers, the notification-settings screen, migration 009's database
webhook and `notify-absence`. It was **deliberately not built as one
milestone** — full §4 is nine Functions, webhooks, three pieces of UI, a
migration and eight documents, which is more than any milestone here has
shipped at once, and part of it (test-plan §6's real-device matrix)
cannot be verified from a development machine at all. Parts 2 and 3 are
scoped in ADR-015: the four scheduled Functions + `notify-milestone` +
`streak-status` + the `calculate-streak-resets` consequences, then the
notification centre once its design has been reviewed. The five features
that were waiting on this infrastructure are still waiting on part 2 —
homework FR-005, the Quran milestone celebration, Murajaah FR-006, and
the year-end report's FR-007 — but they are now waiting on a Function
each, not on infrastructure that does not exist.

**Post-milestone change (TAD ADR-029, no new milestone):** the offline
write queue for attendance/murajaah — the item the paragraph below named
as still open — is now built (`src/lib/offlineQueue.ts`,
`offlineReplay.ts`, `src/hooks/useOnlineStatus.ts`), deliberately at the
**app layer** rather than via Workbox's Background Sync API as TAD
ADR-005 originally specced. Background Sync doesn't exist on Safari/iOS
at all, and its default plugin has no hook to refresh an expired
Supabase session before replaying a queued request — a replay that comes
back `401` looks like a successful delivery to it and the write is
silently dropped. Driving replay from `supabase-js`'s own session state
in the main thread avoids both, at the cost of true background replay
(the app has to be open to replay, same as it always effectively was on
Safari, which never had Background Sync to begin with). Scope is
deliberately "safe, idempotent replay," not a conflict-merge UI —
attendance's `upsert` on `(session_id, student_id)` is already
last-write-wins at the database layer, unchanged by this work; murajaah's
replay treats the table's `unique (assignment_id, date)` violation as
already-delivered rather than an error, the same pattern
`getOrCreateTodaySession` already uses for its own race. 25 new unit
tests (`offlineQueue.test.ts`, `offlineReplay.test.ts`) cover the queue
and replay logic against an in-memory fake store; the real IndexedDB
adapter is untested, same treatment this project already gives other thin
browser-API adapters (`push.ts`), since jsdom has no IndexedDB
implementation to test it against. **Verified live** against the local
Postgres stack and `npm run dev`: as Ustadz Ahmad, marking Grup A
attendance with Chrome DevTools' Network panel set to "Offline" queued
in IndexedDB and showed the "will sync" banner rather than an error;
switching back to "No throttling" fired the `online` event, replayed,
and cleared the queue, with the rows landing in `attendance` via
Supabase Studio. Repeated for a murajaah confirmation as Ibu Siti, same
result, plus confirmation that a genuine same-day rejection while online
still surfaces the red error banner rather than being queued. See §5,
test-plan.md §6.

**Post-milestone change (TAD ADR-030, no new milestone):** the offline
write queue above is extended from two writes to four — Yanbu'a
(`TutorYanbuaView.handleSave`) and Quran recitation
(`TutorQuranView.handleSave`) recording now queue and replay the same
way attendance and murajaah do. Unlike those two, `yanbua_progress` and
`quran_progress` had no unique constraint at all (a bare `insert`), so a
replay of a write whose response was lost after it already committed
would have created a silent duplicate progress row. Migration 015 adds
a nullable, unique `client_ref uuid` to both tables — set only on a
queued write, to the offline queue entry's own client-generated id, and
reused as the optimistic history row's `id` rather than minting a second
uuid just for display — and `offlineReplay.ts` treats a `23505` on it as
already-delivered, the same shape it already used for murajaah's
`(assignment_id, date)` violation. No RLS policy change: `yanbua_tutor_insert`/
`quran_tutor_insert` (migration 013) check only `student_id`/`tutor_id`,
confirmed unaffected by the new column against a local stack. **Verified
against the local Postgres+RLS stack at the REST layer** (a fixture
tutor's minted JWT, same mechanism `DevAuthSwitcher` uses): a fresh
`client_ref` insert returns `201`; resubmitting the identical
`client_ref` — the response-lost/replay scenario the column exists for
— returns `409`/`23505` with exactly one row committed, not two; a
`tutor_id` not matching the caller returns `403`/`42501`; an invalid
`ayah_to < ayah_from` returns `400`/`23514` — both genuine rejections
surfacing as real errors rather than being queued. `npm run test`,
`typecheck` and `build` are green, including new `offlineReplay.test.ts`
cases mirroring the existing murajaah ones for `yanbua`/`quran`. **Not
done in the session that built this:** the actual DevTools-Offline
browser click-through for these two writes (no browser automation tool
was available) — attendance/murajaah's click-through above is unaffected
and remains valid. See §5, test-plan.md §6.

**Where Milestone 7 left things:** step 8's notification half
is **done** — the push pipeline, all eight notification types, four
scheduled Functions, and the in-app notification centre with its TopNav
bell. Two originally-planned Functions were superseded rather than built
(`calculate-streak-resets`, `streak-status` — ADR-016), and one screen is
built but **still awaiting design review** (the notification centre —
ADR-017, §5). What is still genuinely open across the project: the
real-device matrix (test-plan §6, no Android or iOS hardware available;
now includes the offline click-through above), monitoring and alerting
(§7), the retention window for progress data (§6, `[IT TEAM]` N=3), and
step 9/10.

**Status as of the milestone before that** (kept for the record; §4/§5/§7/§8's own rows above carry the current state): 1–3 done. 4 done (Hadir). 5 done (Tugas + Yanbu'a + Al-Quran + Murajaah, all built). 6 done for all five built flows plus the Reports screen (Hadir + Tugas + Yanbu'a + Al-Quran + Murajaah + Rapor). 7 works structurally (RLS + the family views already handle `role=student`, and the 16+ student's own year-end report read + PDF download were exercised end-to-end against the local stack) but still hasn't been through a real Google 16+ self-login account. 8 barely started — `invite-user.mts` plus the three year-end-report Functions (`generate-year-end-drafts`, `publish-report`, `report-pdf`) exist, but none of the 5 originally-planned notification/streak Functions do; FR-005 (homework due-date reminders), the Quran milestone-celebration notification, Murajaah's FR-006 (daily practice reminders) and the year-end report's FR-007 (report-ready push) are all deliberately deferred with the rest of notifications, same reasoning as Milestone 1. 9 not started, though the icon/manifest half of it is now done properly (§5 — real high-resolution brand assets replaced the upscaled placeholders). 10 not started, and it grew one item: the super-admin role needs PPME IT sign-off before real student data is entered (§6). Admin enrollment (§10) and Homework Assignments (§11) both landed out of the numbered order, in response to practical need rather than as scheduled milestones; Quran (§12) and Murajaah (§13) both landed in their intended §5 slot; Year-End Curriculum Reports (§9) is the first milestone to need Netlify Functions with the service-role key, and so the first that had to be verified through `netlify dev` rather than PostgREST alone. Every route in `src/App.tsx` resolves to a real feature — `FeaturePlaceholder` was deleted with the last one.

**Post-milestone change (TAD ADR-014, no new milestone):** the `admin` role became a real super admin — full read *and* write access to all six features on every class, using the same class-shaped views a tutor gets, with the enrollment screens moved behind a single "Kelola" entry point. No migration and no RLS change was involved: migrations 003/005 always granted admin `ALL`, and the restriction was purely application-layer. Two boundaries were kept deliberately — a report can still only be published by its authoring tutor, and Murajaah home practice can still only be confirmed by a parent. Landed together with the real high-resolution brand assets (§5, §9), since both touched the same documents.

**Post-milestone change (TAD ADR-019, no new milestone):** dual-role
people — a tutor whose own child attends, an admin who also teaches —
now work at the data layer, which is the first of three changes and
foundation only: no existing single-role user sees anything different.
The database needed nothing. Every family/tutor policy in migration 003
is written against a relationship rather than against `users.role`, so
one person holding two relationships already receives the union of both
grants, and RLS-28…RLS-33 now prove that rather than assume it — 29 new
assertions, including that the union is **not** a promotion in either
direction. What did need fixing were two hooks that let RLS answer a
wider question than the screen was asking: `useMyStudents` selected
students with no filter at all, so a tutor-parent's ChildPicker offered
their whole class as "my children" and an admin's would have offered the
school; `useMyClasses` had the same defect one table over, offering a
tutor-parent the class their child attends as one they could record
against. Capabilities (`isParentOfAnyone`, `isTutorOfAnyClass`,
`isSelfStudent`, `isAdmin`) are derived in the app from the same
predicates the policies use, with **no migration** — reasoning in
ADR-019(b). Nothing consumes them yet, deliberately: switching the
existing role checks over is a behaviour change, and which view a
dual-role person should land on is a UI question the next change
answers. Two consequences are recorded there rather than papered over —
the weekly-summary card is hidden from a tutor-parent, and a dual-role
person whose `users.role` is `tutor` has no route to their own child's
family views at all.

**Post-milestone change (TAD ADR-020, no new milestone):** PPME decided
that a **student assistant** — a 16+ santri who helps with a younger
class — should be able to record for that class. No migration and no
policy change was needed, and finding out why is the point of the row:
`fn_current_role()` is called in exactly one place in the whole schema,
inside `fn_is_admin()`, so nothing anywhere refuses a write because the
role column says `student`. "16+ students are read-only" was a true
description of every such account that exists, and a false statement
about the system — six documents said it flatly and were amended. RLS-35
now pins both halves: they may record for the class they teach, and not
for their own record, and their own classmates stay invisible to them.
What is **not** done is the screen access — routing still follows
`users.role`, so a student assistant lands on the family views and
cannot reach a recording screen. That is role switching, and it belongs
with ADR-019's other deferred UI consequences.

**Post-milestone change (TAD ADR-022, second of the three multi-role
changes):** notifications now follow the relationship rather than the
role, which turned out to be the first place ADR-019's foundation was
load-bearing rather than theoretical. `RECIPIENT_ROLES =
['parent','student']` meant a tutor whose own child attends the TPA
received **nothing about their own child** — no push, no in-app row, and
a 403 from `push-subscribe` so no way to store a subscription to receive
one with. Silent, and from the family's side identical to a quiet week.

The fix removes the role filter from `buildAudiences` rather than adding
an exception to it: recipients already came from the child's own
`parent_id`/`user_id`, so the filter could only subtract from a correct
answer. `role` is gone from the row type and from the query behind it, so
putting the bug back would mean fetching the column again. The five gates
that each asked the question separately — `push-subscribe`,
`buildAudiences`, the settings screen, the bell and the centre — now
share one predicate over two booleans derived in one place. **No
migration**: `notifications_own_read` is `user_id = auth.uid()`, a
relationship all along, which is why an admin-parent reads their own
child's notifications and still nobody else's.

The half of ADR-015(a) that had to survive is that a tutor hears nothing
about the class they teach, and it is asserted hardest: NC-12…NC-16 in
pgTAP, unit cases with no role available to test, and — because silent
non-delivery is the failure mode this feature keeps producing — live in
`verify-push.mjs` §4m, where a real tutor-parent and a real admin-parent
each receive a real push about their own child and receive nothing when a
pupil of theirs is marked absent, alongside that pupil's own parent
receiving it.

Two defects in the live harness were fixed on the way, neither part of
the brief: its class fan-out assertions still counted the Grup A roster
as it stood before ADR-019 added two children to the dev fixture, and the
weekly-digest section asserted a real push at an instant whose VAPID JWT
cannot be valid unless the harness happens to run on a Thursday or
Friday. Both now hold on any day. What is still **not** done is the
screen access from ADR-020 — routing follows `users.role`, and that is
the third change.

**Test-coverage sweep after PR 2.** With the three-way split's second
change landed, the suites were swept for what they had never covered
rather than for what had just been written, in two directions. The
combination space first: every dual-role fixture in the project puts the
tutor half and the parent half in *different* classes, which is what
makes the union provable and also means the commonest arrangement at a
small TPA — the ustadzah teaching the class her own child sits in — had
no case anywhere, and four of the sixteen capability combinations had
none either. RLS-36…RLS-41 and NC-17/NC-18 close both (219 pgTAP
assertions, up from 171). Then measured coverage, which found that
`authenticateCaller` and `verifyWebhookSecret` — the two functions
deciding who may operate the service-role key — were the least-tested
code in the repository at 9% and 35% of lines; those, the orchestration
all six notification senders share, the browser subscribe/unsubscribe
flow and the weekly-activity query are now covered (346 unit tests, 97.3%
of statements).

The sweep surfaced **two behaviours nobody had decided**, and they were
not the same kind of thing. The first is a santri grading themselves: a
student assistant assigned to their own class could record their own
Yanbu'a and Quran progress, set their own memorization target, mark their
own homework verified, author their own year-end report and read that
draft. That contradicts the boundary ADR-020 states in prose, so it was a
defect rather than a question, and **migration 013 (ADR-023)** closes it —
by relationship (`fn_my_recordable_students()`), not by role, which is
what keeps it consistent with the alternative ADR-020 explicitly rejected.
`attendance` is deliberately not narrowed: the register is one upsert of
the whole roster, so refusing one row would stop the assistant marking
anybody, and closing it properly needs a UI change and an answer to "who
marks the assistant present?" (ADR-023(c)). RLS-37 asserts that half as
current behaviour so it stays visible.

The second went the other way, and is now **ADR-024**: a tutor of the
class their own child is in may record that child's progress *and* write
that child's year-end report, seeing it in draft. RLS-31 and RLS-32 refuse
both, but only because their fixture puts the child in another class. PPME
decided the overlap is correct — at a school of ~200 with a handful of
volunteer teachers, an ustadz or ustadzah teaches their own children, and
a rule against it would be a rule against how the TPA runs. No migration:
the behaviour was always there, and what changed is that RLS-36 now pins a
decision rather than an accident. The two findings must not be collapsed
into one rule — a santri assessing their own work is not a teacher
assessing a pupil who happens to be their child — which is why
`fn_my_recordable_students()` excludes the caller's own record and never
their children.

**Status update (the UI catches up with the data layer, TAD ADR-025):**
this closes the multi-relationship work that ADR-019 opened. The database
has been relationship-shaped since ADR-019 and the notification pipeline
since ADR-022; routing was still keyed on `users.role` in six places,
where it picked a class view or a family view for a person who might be
both. Each of those six screens now resolves a **`ViewScope`** out of the
caller's relationships, and a person holding more than one gets an
explicit switch between them — captioned by subject ("Grup saya" / "Anak
saya"), never by role, which is what distinguishes it from the "Pilih
Peran" affordance PRD §1 rejected and still rejects. Anyone holding one
relationship sees no control and no change; the invited-but-unassigned
tutor keeps the screens they have today, because the one branch that
still reads the role column is the branch for someone holding no
relationship at all.

Two gates that were correct only by accident came out of building it, and
are fixed here rather than filed: `FamilyMurajaahView` decided who may
confirm home practice with `role === 'parent'`, which would have denied
Ustadzah Aminah the control for her own son the moment she could reach
his screens, and `WeeklySummary` hid the Friday digest card from every
tutor-parent it had been notifying. Both now ask about the relationship
to the child on screen.

**ADR-023(c) is closed in the same change, because this is what made it
reachable.** DPIA R7 accepted the assistant's own attendance row as
residual risk *on the grounds that no screen routed them to a register* —
a mitigation this change removes. The register now leaves their own
record out of what it submits while still showing the row, and the answer
to "who marks the assistant present?" is a co-tutor or an admin, which
holds for every class because ADR-014 gives an admin the class shape on
all of them. The five evaluative screens drop the row entirely, mirroring
`fn_my_recordable_students()` — and never a tutor-parent's own child
(ADR-024). No migration, no policy change.

**Creating a dual-role person is deliberately still not possible from the
admin UI.** `StudentsPage` picks parents with `fetchUsersByRole('parent')`
and `ClassesPage` picks tutors with `fetchUsersByRole('tutor')`, so every
multi-role account in this project still exists because SQL put it there.
This change lets such a person *use* both halves; it does not let anyone
*create* one. Widening those pickers is an enrolment decision about who
may be attached to a child's record, with a DPIA question of its own, and
belongs to the admin-UI change that follows.
