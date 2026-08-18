# Data Protection Impact Assessment (DPIA) — DRAFT
## TPA PPME Den Haag Progress-Tracking App

> **STATUS: WORKING DRAFT** for completion and sign-off by the PPME Den Haag IT team
> (confirmed owner of GDPR/DPIA execution; PPME Den Haag remains the legal data
> controller). Written in English as an internal working document — translate the
> final version if required by internal policy. Sections marked **[IT TEAM]** need
> input or a decision.

---

## 1. Why a DPIA?

A DPIA is advisable (and arguably required under GDPR art. 35) because the processing
involves **systematic monitoring of children's educational progress at scale**
(~200 students, majority under 16), in an organizational context that is religious in
nature. Even though the app stores only educational progress data, the combination of
(a) vulnerable data subjects (children) and (b) the religious context of the
organization warrants a documented assessment.

## 2. Description of the processing

| Aspect | Description |
|---|---|
| Purpose | Track attendance, homework, Yanbu'a reading progress, Quran recitation, and home memorization (murajaah) for TPA students; inform parents via push notifications |
| Data subjects | Students (majority <16), parents/guardians, volunteer tutors, admins |
| Data categories | Identity (name, DOB), contact (email via Google account — parents/tutors/16+ students only), educational progress, attendance incl. absence reasons, push subscription tokens |
| Recipients | Parents (own children only), tutors (own classes only), TPA admins (**all students, all data, read and write** — see §3 and R11); no third-party sharing. One person may hold more than one of these (a tutor whose own child attends); the access is the union, and for *notifications* specifically it is the family relationship alone that decides who is told about a child — TAD ADR-022 |
| Processors | Supabase Inc. (database + auth; data region Frankfurt, DE), Netlify (hosting/functions, EU region), Google (OAuth identity provider; **and, for users who enable notifications, Firebase Cloud Messaging as the browser's push service** — see below), **Resend (transactional email, EU region — TAD ADR-018)** |
| Transfers outside EU | **Not "none" any more, for one optional feature.** All stored data stays in Frankfurt by design. But Web Push delivery necessarily goes through the *browser's own* push service, which for Chrome and Android is Firebase Cloud Messaging (Google, servers outside the EU); Firefox uses Mozilla's, Safari uses Apple's. This is not a supplier we can swap — the browser chooses it — and TAD ADR-009 ("no third-party service needed") is true only in the sense that we pay nobody and integrate with nobody. What that service receives is bounded: the payload is encrypted end-to-end under the Web Push protocol (the intermediary cannot read it), and the payload itself is limited to a child's first name and an event type (R6). It also receives the device's push endpoint and delivery metadata. **Mitigation available to families**: notifications are off by default and opt-in per account.<br><br>**Email (Resend) is a separate matter and stays in the EU.** Transactional email (ADR-018) goes through Resend with its **EU region** selected, chosen so mail sits under the same residency reasoning as Frankfurt/Supabase and EU-region Netlify. Unlike push, this *is* a supplier we choose, so the region is ours to set — but it has to be set in Resend's dashboard before real families are invited, because it cannot be applied retroactively to mail already sent. What Resend receives is the recipient's email address and the rendered message; for the invitation template that is the recipient's own name and address and nothing about a child. **[IT TEAM]**: add Resend to the processing register and put a DPA in place; confirm the EU region is actually selected before the first real invitation. **[IT TEAM]**: record this in the processing register and complete a Chapter V transfer assessment for it; and separately, verify via the Supabase DPA whether any sub-processor (support/telemetry) accesses stored data from outside the EU, documenting SCCs if so. |
| Retention | Proposed: 3 years post-enrollment, then delete/anonymize. **[IT TEAM]**: confirm. |

## 3. Necessity & proportionality

- **Data minimization:** Only educational progress data is collected; no photos, no
  free-form health data (absence reason is a short optional text — see risk R4), no
  location, no behavioral tracking or analytics beyond aggregate hosting metrics.
- **Who inside the organization can see what:** access is need-to-know by role and
  enforced at the database layer (Row Level Security), not merely in the interface.
  A parent sees only their own children; a tutor sees only the classes they are
  assigned to; a student with their own login sees only their own record, and cannot change it. (A student who *also* assists with a class — a student assistant — may record for that class like any other tutor of it, and not for themselves: TAD ADR-020, enforced by ADR-023. Until migration 013 the second half of that sentence was true only of an assistant whose own record sat in a *different* class; it now holds for every evaluative write, and since ADR-025 the register leaves their own row out of what it submits too, so their own attendance is recorded by a co-tutor or an admin like anybody else's — see R7 for what remains. Read-only follows from the relationships a person holds, not from the label on their account. PPME has decided that assisting is **not** age-gated; whether a santri can hold the login in the first place is Google's threshold rather than one this app enforces — ADR-021, and an **[IT TEAM]** item in checklist §6.) **The `admin`
  role is the exception: it can read *and* modify every student's attendance,
  homework, Yanbu'a/Quran/Murajaah progress and year-end reports, across the whole
  TPA.** That was always true of the database policies; since TAD ADR-014 it is also
  true of the application, which previously hid those screens from admin.

  **One person may hold more than one of these positions** — a tutor whose own child
  attends, an administrator who also teaches — and the access that results is the
  union of what each position grants, never more — except where one of those
  positions is `admin`, whose access is unconditional by design and therefore
  absorbs the others (TAD ADR-019). This is not a new
  state of affairs: the policies have always been written against the relationship a
  person holds (parent of this child, tutor of this class) rather than against a
  role label, so nothing about it depends on the application asking the right
  question. It is now asserted directly in the test suite (test-plan.md §3,
  RLS-28…RLS-41), including that each half keeps its own limits — a tutor-parent
  cannot record progress for their own child, and cannot see their own child's
  unpublished report merely because they teach someone else's — and including
  the admin exception above, which is asserted in the same explicit terms rather
  than left as an unstated consequence.

  **One arrangement is the exception to that sentence, by decision** (TAD
  ADR-024, RLS-36). Those limits hold because a tutor-parent's own child is in a
  class they do *not* teach. Where the child is in the class they **do** teach —
  the ordinary case at a small TPA, where a teacher teaches their own children —
  the tutor grant already contains that child, so the parent-half limits do not
  apply to them: the account records that child's progress and writes that
  child's year-end report, which means seeing it before it is published. PPME
  decided this is correct rather than a gap to close. It is bounded by class, not
  by relationship — the same account is still refused for a second child of
  theirs enrolled elsewhere — and it is disclosed to families in the privacy
  policy rather than left as an unstated consequence. The narrower case of a
  santri who assists their own class was *not* accepted and is closed by
  migration 013 (ADR-023, R7).

  **Notifications follow the same principle, and did not until ADR-022.** Who is
  told about a child was decided by `users.role` rather than by the relationship,
  with two consequences pointing in opposite directions. In the direction that
  matters for minimisation the answer was right — a tutor is told nothing about
  the children they teach, and no push endpoint is stored for an account nothing
  would send to — and it is now a property of the audience query itself rather
  than of a filter beside it: recipients come from the child's own `parent_id`
  and `user_id`, columns a tutor does not appear in for their pupils. In the
  other direction it was simply a failure: a tutor or admin whose own child
  attends the TPA was told nothing about **their own child** either, and could
  not even store a subscription to be told with. That is not minimisation; it is
  a parent not being informed, silently. Both halves are now asserted live
  against a real push service, and in the database (NC-12…NC-16).

  This is assessed as proportionate for a ~200-student community programme with a
  handful of volunteer administrators: someone has to be able to cover a session for
  an absent tutor, correct a mis-recorded absence, and finish a year-end report at
  the end of term, and the alternative — an administrator who can enrol a child but
  cannot fix a single record about them — pushed that work into email and paper,
  outside any access control at all. It is a *breadth* decision, not a *category*
  one: admin sees the same educational-progress data everyone else does, no new
  field is collected, and nothing is disclosed outside the organization.

  Two boundaries are kept deliberately, and both are about attribution rather than
  confidentiality: only a parent can confirm that a child practised at home (the
  record means "a parent watched this"), and only the tutor who wrote a year-end
  report can publish it to the family. **[IT TEAM]** should keep the number of admin
  accounts small and named (not shared), require 2FA on the Google accounts behind
  them, and treat admin offboarding at least as promptly as tutor offboarding
  (R11). Note that the app keeps no audit log, so an administrative correction is
  not attributable after the fact.

  One limit of the parent-only confirmation is worth stating plainly, since it is
  inherent rather than fixable: a child under 16 has no credential of their own —
  `students.parent_id` links a student *record* to a parent's account and is not an
  account itself, and a Google sign-in with no matching `public.users` row reaches
  the "contact admin" screen and no data (ADR-021). What the app cannot see is who
  is *holding* a signed-in parent's device. A murajaah confirmation therefore means
  "recorded from the parent's account", which is the strongest claim any
  password-less household app can make about it.
- **Lawful basis:** **[IT TEAM]** to confirm: consent by parent at enrollment
  (recommended for clarity given the community context) vs. legitimate interest.
  For under-16 students, parental consent is obtained at enrollment regardless.
- **Special category data (art. 9):** The app does not record religious beliefs as a
  data field. However, enrollment in an Islamic educational program could allow an
  inference of religious affiliation. **[IT TEAM]** should document the position that
  processing is limited to members' educational administration within a religious
  not-for-profit body (cf. art. 9(2)(d) GDPR) and that data is never disclosed
  outside the organization without consent.
- **Proportionality of monitoring:** Progress tracking mirrors what tutors already
  record on paper today; the app digitizes an existing practice rather than creating
  new surveillance.

## 4. Risks & mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Cross-family data leakage (parent A sees parent B's child) | Low (if tested) | High | Row Level Security at DB layer for every table; automated RLS test suite in CI asserting negative access (test-plan.md §3); policies reviewed before real data entry |
| R2 | Unauthorized account gets access (compromised Google account) | Low | High | Auth delegated to Google (2FA available); role stored server-side, not client-claimable; users cannot change their own role (enforced in RLS) |
| R3 | Data breach at processor | Low | High | EU-region processors with DPAs; AES-256 at rest, TLS 1.3 in transit; no secrets in repo; breach-notification duties in DPA. **[IT TEAM]**: define internal breach response (who notifies AP within 72h) |
| R4 | Absence "reason" field collects health data (e.g. "sakit") | Medium | Medium | Keep field optional and short; UI offers preset non-specific reasons (Sakit/Izin) instead of free text; exclude reason field from any export shared beyond parent+tutor; note in privacy policy. The absence *notification* is one such export and excludes it — see R6: the reason is not merely omitted from the message, it is never sent out of the database |
| R5 | Data kept longer than needed | Medium | Medium | Scheduled retention job deletes/anonymizes records N years post-enrollment (**[IT TEAM]** confirm N=3); right-to-erasure cascade implemented and tested. **Partly implemented as of ADR-017**, for the one table that needed it first: the in-app notification centre (`public.notifications`) is the only store here that grows because *time passed* rather than because someone recorded something — three scheduled Functions between them can write a row per child per day regardless of activity. `prune-notifications` deletes past **90 days**, a window chosen to outlast the longest-lived reason to open the list (a year-end report notification a parent may not act on for weeks), and reports its cutoff and delete count so a review has something to read. It is a separate job rather than folded into the weekly digest precisely because retention is an obligation and the digest is a courtesy. The broader N-years question for progress data is still open and still **[IT TEAM]**'s |
| R6 | Push notification content leaks child data on lock screens | Medium | Low | **Implemented and tested** (TAD ADR-015). Notification text limited to first name + event type; no progress details or reasons in push payloads. Three controls, deliberately layered so none of them is the only one: (a) *structural* — the payload builder accepts no parameter that could carry a reason, grade or position, so there is no channel through which one could reach a lock screen even by mistake, and it takes a full name and reduces it to the first token; (b) *the copy itself* — lock-screen strings live in their own `notifications.push.*` block, and a unit test rejects any string there that interpolates anything other than the child's name, so the limit survives a future event type being added; the richer wording the Notification Spec drafted (jilid number, surah name) is kept for the in-app list, shown only after sign-in; (c) *the wire* — the database webhook sends only the changed row's id, so the absence `reason` never leaves Postgres at all (asserted as WH-06 in the pgTAP suite, and WH-09 for the assignment title). All **eight** notification types now live are held to the same limit — no absence reason, no jilid number, no surah name, no assignment title, no grades, no attendance percentage — and each is verified live with the sensitive value actually present on the triggering row (test-plan §6). The weekly digest (ADR-016(g)) is where this bit hardest: the Scheduler table had specified a push carrying "attendance %, new progress", which is the single figure a family would least like read over their shoulder, so the notification says only that a summary is ready and the summary itself lives behind the login, on the dashboard. Two further controls were added in ADR-016 after they turned out to be missing: (d) *the dedup tag now identifies the child*, so a parent of two absent children is told about both rather than one silently replacing the other — a fix to a delivery bug, but it is also what makes the notification's own promise true; and (e) *no Function's HTTP response carries a dedup tag*, since a tag is `event:userId:studentId:date` and the scheduled Functions answer unauthenticated requests in at least one environment. Residual: the child's first name does appear on an unlocked-but-idle screen, which is the point of the notification; a family that considers even that too much can turn notifications off per account.<br><br>**R6 does not extend to the in-app notification centre, deliberately** (ADR-017(h)). Its threat model is a lock screen; the centre's rows are readable only by an authenticated recipient, so they carry the richer wording the Notification Spec originally drafted — the jilid number, the surah, the assignment title. That is the two-tier split ADR-015(b) promised, and the unit suite now enforces it in both directions: every in-app string is checked to name the child, and every push string is rejected if it interpolates `{{number}}`, `{{surah}}`, `{{title}}`, `{{date}}` or `{{count}}`. The centre adds three access-control facts of its own, each asserted in pgTAP: only the addressee reads a notification (NC-01/NC-02), **admin reads none addressed to anyone else** — the one place ADR-014's super admin does not reach, since an inbox of every family's messages adds nothing to running the TPA (NC-09, and NC-14 for an admin who is also a parent) — and no client role can create or delete one (NC-06/NC-07), so nobody can put words in the TPA's mouth on another parent's screen.<br><br>**Who a notification is addressed to is a relationship, not a role** (ADR-022), and the data-minimisation argument that used to be carried by the role check is now carried by the audience query itself. Recipients are resolved from the child's own `students.parent_id` and `students.user_id`, so a tutor is in neither column for the children they teach and no notification about a pupil can reach them — the point of the original rule, and it now holds structurally rather than by a filter that could be removed. What the role check additionally did was silence a tutor or admin about **their own** child, which is not minimisation but a delivery failure: `push-subscribe` refused to store their subscription and `buildAudiences` dropped them, so a parent who happens to teach at the TPA was told nothing at all, indistinguishably from a quiet week. Fixed, and asserted live against a real push service in both directions (test-plan §6): the tutor-parent and the admin-parent receive their own child's absence, and receive nothing when a pupil in the class they teach is marked absent |
| R7 | 16+ student self-login sees more than intended | Low | Medium | Student RLS scope is limited to own `student_id`, and carries no write grant of its own; automated tests cover sibling and classmate isolation. A student who *also* assists with a class holds that class's tutor grants as well (ADR-020, RLS-35) — assigning a student to `classes.tutor_ids` is therefore an enrolment decision with an access consequence, and is admin-only like every other one. Their own record is not writable for any **evaluation** — Yanbu'a and Quran progress, memorization targets, homework verdicts and year-end reports all exclude it (`fn_my_recordable_students()`, ADR-023, RLS-37), including the draft report about themselves that the tutor grant previously made readable. **The `attendance` gap is now closed in the interface (ADR-025), and this entry is rewritten rather than removed because the shape of the mitigation changed.** `attendance` is still deliberately not narrowed in SQL, for the reason ADR-023(c) gives: the register is submitted as a single upsert of the whole roster, so a policy refusing that one row would stop the assistant marking anybody in the class — a worse failure than the exposure. What this entry previously relied on was that *no screen routed an assistant to a register at all*, which stopped being true when ADR-025 gave them the class scope. The register therefore now omits their own record from what it submits (`recordableStudents`), while still showing the row so they can see whether they have been marked and the next tutor sees it waiting. **Who marks them present: a co-tutor, or an admin** — and that is an answer rather than a hope, because ADR-014 gives an admin the class shape on every class, so even a class with no second tutor has somebody who can complete it. **Residual risk, accepted and scoped:** the mitigation is a screen rather than a policy, so a caller going directly to the API with their own JWT can still write their own attendance row. That is materially weaker than recording one's own mastery — it is a present/late/absent flag on a class they demonstrably attended — and RLS-37 continues to assert the data-layer behaviour so it cannot be quietly assumed closed. `scripts/verify-push.mjs` §9 takes the register as the assistant for real and asserts the row is absent afterwards, so a regression in the screen fails a run rather than going unnoticed. Their own classmates stay invisible unless they teach that class.<br><br>**Age is not part of this at the technical layer** (ADR-021): PPME allows an under-16 santri to assist, the app enforces no age rule, and `date_of_birth` is stored without ever being consulted. What limits a young santri's *account* is Google's own minimum age, applied before they reach this app — a strong default rather than an enforced boundary, since a supervised child account can complete an OAuth sign-in. **[IT TEAM]**: confirm the current Dutch threshold and whether a supervised account may be linked; note that an assistant with a login processes other children's data, which is the consent question worth being explicit about when that assistant is themselves a child |
| R8 | Volunteer tutors access data after leaving | Medium | Medium | Admin offboarding procedure: remove tutor from `classes.tutor_ids` immediately on departure; **[IT TEAM]**: add to volunteer onboarding/offboarding checklist |
| R11 | **A privileged (`admin`) account is retained after the holder leaves, or is compromised** | Low–Medium | **High** | The larger version of R8: an admin reads and writes every student's data across the whole TPA, so the same lapse that costs one class's data for a departed tutor costs all of it here. Controls: (a) keep admin accounts few and individually named — never a shared committee login; (b) require 2FA on the underlying Google account (the app has no password of its own, so account security *is* Google account security — R2); (c) offboarding is a role change or profile deletion in `public.users` and must happen the same day, ahead of tutor offboarding in the checklist; (d) periodic review — **[IT TEAM]** to set a cadence — of who currently holds `role = 'admin'`. Residual: there is no audit log, so an administrative read is invisible and an administrative write is only attributable where the row records who created it. **[IT TEAM]**: decide whether an audit trail is required before launch, or accepted as residual risk for a volunteer-run community app |
| R9 | Community-built app lacks continuity (single maintainer) | Medium | Medium | Documentation set (PRD/TAD/API contract/migrations) maintained in repo owned by PPME IT team account, not a personal account |
| R12 | **An admin attaches the wrong account to a child's record, now that the pickers offer more than one role** | Low | Medium | Until ADR-028 the enrolment screens filtered their pickers by `users.role`: a child's parent contact could only be an account whose role said `parent`, and a class tutor only one whose role said `tutor`. That was never a security control — `students.parent_id` is a plain FK and `classes.tutor_ids` a plain uuid array, neither role-constrained, and every RLS policy is written against the relationship rather than the column (ADR-019, RLS-28…RLS-34) — but it did mean **the arrangements PPME has explicitly decided it wants could not be created through the interface at all**: a tutor who is a parent of a child in the class they teach (ADR-024), and a 16+ santri who assists (ADR-020, whose entitlement ADR-020(d) recorded as unreachable). Every such account in this project was created by hand in SQL. The pickers are therefore widened, and this row records what that changes.<br><br>**What is new is reach, not privilege.** Only an admin sees these screens (`RequireAdmin`, `fn_is_admin()`), and an admin already holds unconditional access to every row (ADR-014) — so nothing here grants the *admin* anything. What it grants is the ability to attach a **different** account to a child, and the consequence lands on that account: naming somebody as a child's parent gives them that child's full family view, and naming them in `tutor_ids` gives them the class. Both are exactly the grants RLS already derives from those columns; the change is that a screen can now write them.<br><br>**Mitigations.** The link remains admin-only and audited by the same `updated_at`/`created_at` trail as any other enrolment edit. Each option is labelled with the account's current role ("Ustadzah Aminah · Ustadz"), so an admin choosing between similar names can see what they are picking rather than inferring it. The lists are a named pair of constants in `src/lib/enrolmentLinks.ts` with an exhaustive unit sweep over all four roles, so a future edit that widens them has to change a test that says why. And one omission is deliberate: **a `student` account is not offered as another child's parent** — the database permits it, nothing in the record asks for it, and attaching a child's whole record to a teenager should follow a decision rather than a mis-click. Adding it would need an ADR and an amendment to this row.<br><br>**Residual risk, accepted:** an admin can still make a mistake, as they always could with the class and parent fields themselves. This is an enrolment error, correctable in the same screen, and it is bounded by the fact that every candidate is already an account PPME's admin created |
| R10 | Year-end report PDF, once downloaded, is outside the app's access controls (parent can forward/print/share it freely) | Medium | Low-Medium | Inherent to any exportable document; mitigated by minimizing PDF content to what's appropriate for the parent to already hold (educational grades/narrative, no other students' data, no internal tutor-only notes); PDF is watermarked with recipient context (student name + academic year) implicitly via its content, deterring casual redistribution; accepted residual risk — flag for **[IT TEAM]** awareness rather than a technical control |

## 5. Data subject rights implementation

| Right | Implementation |
|---|---|
| Access / portability (art. 15/20) | Parent-facing CSV export of all data for their child(ren) |
| Rectification (art. 16) | Admin edits student records *and* the operational records about them (attendance, progress, report narratives and grades) directly in the app since ADR-014 — previously only enrolment fields were correctable without a database intervention; users edit own profile |
| Erasure (art. 17) | Admin-triggered cascade delete of student + all related records (attendance, progress, murajaah, year-end reports); DB-level `on delete cascade` handles table rows automatically, but the year-end report PDF lives in Supabase **Storage**, which cascade does not reach — the erasure procedure must explicitly delete the corresponding Storage object(s) as a separate step; verified by test |
| Objection / restriction | Handled manually via **[contact email]**; documented procedure **[IT TEAM]** |

## 6. Consultation & sign-off

- [ ] **[IT TEAM]** Review Supabase DPA and sub-processor list — record conclusion in §2
- [ ] **[IT TEAM]** Resend: DPA in place, EU region confirmed selected, and the sending domain verified — all three before the first real invitation is sent (TAD ADR-018). Domain verification is done (`ppmedenhaag.nl`, confirmed by a live send — ADR-031); DPA and EU region are still open. The region in particular cannot be fixed after the fact for mail already delivered
- [ ] **[IT TEAM]** Chapter V transfer assessment for Web Push delivery via the browser's push service (Firebase Cloud Messaging for Chrome/Android) — see §2 "Transfers outside EU". Notifications are opt-in and off by default, and the payload is encrypted and content-limited, but the transfer is real and should be documented rather than assumed away
- [ ] **[IT TEAM]** Confirm lawful basis (§3) and retention period (§2)
- [ ] **[IT TEAM]** Confirm breach-response owner (§4 R3)
- [ ] **[IT TEAM]** Sign off on the super-admin role (§3, §4 R11) — number of admin accounts, 2FA requirement, offboarding cadence, and whether an audit log is required before launch. **This one gates real student data**, not just the DPIA
- [ ] **[IT TEAM]** Parent representative consulted (recommended: brief the parent community before launch)
- [ ] Sign-off: name, role, date: `[...]`
- [ ] Review date: `[launch + 12 months]`
