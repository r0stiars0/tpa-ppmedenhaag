# Test Plan — TPA PPME Den Haag

*Version 1.0 draft · Stack: Vitest (unit), Supabase CLI + pgTAP or SQL scripts (RLS), Playwright (E2E). CI: Netlify build + GitHub Actions.*

## 1. Scope & priorities

Priority order reflects risk, not feature order:

1. **RLS isolation** (children's data — a failure here is a GDPR incident, not a bug)
2. **Core flows** (attendance, progress recording — daily-use correctness)
3. **Streak & milestone logic** (edge-case-heavy)
4. **Notifications** (cross-platform quirks, silent failures)
5. **Offline/PWA behavior** — offline writes are in scope and built (TAD ADR-029): §6's rows below are no longer conditional, and the manual devtools-offline click-through is the one outstanding case, alongside the rest of §6's real-device matrix
6. **i18n completeness**

Out of scope for MVP testing: load/performance (200 users on Supabase free tier is trivial), penetration testing (basic OWASP checklist only).

## 2. Environments

| Env | Purpose | Data |
|---|---|---|
| Local (Supabase CLI) | Unit + RLS tests, migration validation (`supabase db reset` must run 001→004 cleanly) | Synthetic fixtures only |
| Netlify Preview + Supabase branch/staging project | E2E per PR | Synthetic fixtures only |
| Production | Smoke tests post-deploy + a read-only schema check (below) | Real data — **never** used in tests |

**Rule: no real student data in any test environment, ever.** The
converse binds too, and had been left implicit: **no test fixtures in the
real-data environment.** The RLS suite inserts fixture families, classes
and `auth.users` rows, so it belongs on `--local`, in CI, or on a
Supabase branch — never on the linked project, whatever the rollback
guarantees. Its header claimed the opposite until ADR-023's follow-up;
that claim was never true in either sense (pgTAP lives in the
`extensions` schema, which a linked run's login role cannot resolve, so
the suite died on `no_plan()` before its first assertion).

**The post-deploy schema check.** What a production run was reaching for
— *does the deployed schema still match the migrations the suite was
proven against?* — has a read-only answer that writes nothing:

```bash
supabase db diff --linked --schema public
```

Run it after any `supabase db push`. Empty means production matches, and
it is also how a policy edited by hand in the Supabase dashboard would
surface, which migration history alone cannot show. One class of false
positive to expect: a block of `REVOKE MAINTAIN, REFERENCES …` /
`ALTER DEFAULT PRIVILEGES …` lines is a Postgres 17 privilege baseline
mismatch between the shadow database and the remote, not drift — real
drift appears as `CREATE`/`DROP`/`ALTER POLICY`, changed function bodies,
or table DDL. First run, immediately after migration 013 was applied to
the linked project: clean apart from that noise, with all five ADR-023
policies and `fn_my_recordable_students()` present and identical to the
migration.

This pairs with, and does not replace, the suite itself: the diff proves
the deployed schema is the same *text*, and the 231 assertions prove that
text *behaves*, against a Postgres built from the identical migrations.

### Standard fixture set (used by RLS + E2E suites)

- 1 admin, 2 tutors (T1, T2), 3 parents (P1, P2, P3), 1 student account (S16, linked to P3's child). The admin is deliberately a tutor of **no** class, so any access it has comes from `fn_is_admin()` and never from class membership
- 2 classes: Class A (tutor T1), Class B (tutor T2)
- P1 has 2 children in Class A; P2 has 1 child in Class B; P3 has 1 child (16+, user_id set) in Class B
- Sessions, attendance, assignments, and progress rows for each child
- **Two dual-role people** (added with ADR-019, used by RLS-28…RLS-33): TP (`users.role = 'parent'`) and TT (`users.role = 'tutor'`) are each a tutor of Class C *and* the parent of a child in Class D. The two role values are deliberately opposite, because the point of the cases is that the column has no bearing on what they can reach. Each one's own child sits in the class the *other* teaches, so neither can reach their own child through their tutor grant — the union of the two grants is the only way either of them sees everything they are entitled to. A fourth parent P4 has children in both classes, to give each of them a classmate they must **not** be able to reach. TAP (`users.role = 'admin'`) is the same shape again with a third relationship on top — admin *and* tutor of Class C *and* parent of a child in Class D — used by RLS-34. SA (`users.role = 'student'`) is a 16+ self-login student enrolled in Class D who tutors Class C, used by RLS-35; the two halves are deliberately disjoint classes, so no assertion about one can pass through the other
- **Six more, for the combinations the list above leaves open** (used by RLS-36…RLS-41 and NC-17/NC-18). Every dual-role persona above deliberately puts the two halves in *different* classes, which is what makes the union provable — and means the most ordinary arrangement at a small TPA, the ustadzah who teaches the class her own child sits in, was never covered. Class E and Class F carry that set: **OV** (`role = 'parent'`) teaches Class E, has one child in Class E and a second in Class D, so one account has two children on opposite sides of its own tutor grant; **OSA** (`role = 'student'`) has their own 16+ record in Class E and tutors Class E, the student assistant assigned to their own class; **AP** (`role = 'admin'`) is a parent in Class E and named in no `tutor_ids` anywhere, the plain admin-parent that NC-14's TAP is not; **AT** (`role = 'admin'`) teaches Class E and is nobody's parent; **MC** (`role = 'tutor'`) teaches Class E *and* Class F, the only tutor in the suite holding more than one class; **NONE** (`role = 'tutor'`) holds no relationship of any kind, the state every account passes through between `invite-user` and enrolment
- These rows are created inside the RLS suite itself, after RLS-14 and the NC cases, because those assert exact fixture row counts. `supabase/dev-fixture.sql` seeds the browser-facing equivalents (Ustadzah Aminah, Bapak Hasan, the triple-role Ustadzah Laila and the student assistant Aisyah) for manual walkthroughs. Since ADR-023 two of them are also **overlap** personas, so the arrangement RLS-36 and RLS-37 describe can be clicked through rather than only asserted: Aisyah assists Grup A, where she is herself enrolled, and Bapak Hasan teaches Grup A, where his own daughter is. Both were seeded by naming an existing account in an existing class's `tutor_ids` — **no new student, class or session row** — because `scripts/verify-push.mjs` asserts exact roster sizes and class fan-out counts and has twice been broken by fixture rows added for an unrelated reason (§6)

## 3. RLS test suite (highest priority)

Run as SQL scripts with `set role authenticated; set request.jwt.claims` per persona, or via pgTAP. Every test asserts **both** the positive (allowed) and negative (denied/empty) case.

| ID | Assertion |
|---|---|
| RLS-01 | P1 SELECT students → sees exactly their 2 children; P2's child absent from results |
| RLS-02 | P1 SELECT attendance/yanbua/quran/murajaah rows of P2's child → 0 rows |
| RLS-03 | T1 SELECT students → Class A only; Class B students invisible |
| RLS-04 | T1 INSERT attendance for Class B student → rejected |
| RLS-05 | T1 INSERT yanbua_progress with tutor_id ≠ auth.uid() → rejected |
| RLS-06 | S16 SELECT own attendance/progress → rows returned; sibling/classmate rows → 0 |
| RLS-07 | S16 INSERT/UPDATE on any table → rejected. Note since ADR-020: this persona holds no relationship that grants a write, which is *why* they are refused — no policy tests for the `student` role. See RLS-35 for the same role with a tutor relationship added |
| RLS-08 | P1 INSERT murajaah_log for own child's assignment → allowed; for P2's child → rejected |
| RLS-09 | P1 INSERT murajaah_log with confirmed_by ≠ auth.uid() → rejected |
| RLS-10 | Any non-admin UPDATE users.role (own or others) → rejected |
| RLS-11 | Non-admin INSERT/DELETE on students → rejected (enrollment is admin-only) |
| RLS-12 | Anonymous (no JWT) SELECT on every table → 0 rows / 401 |
| RLS-13 | Duplicate murajaah_log (same assignment_id + date) → 409 unique violation |
| RLS-14 | Admin can SELECT/modify all tables |
| RLS-15 | Tutor (T1) SELECT year_end_reports for Class A student, status=draft → row returned (own class, draft visible to tutor) |
| RLS-16 | Parent (P1) SELECT year_end_reports for own child, status=draft → 0 rows (drafts must never leak to parents) |
| RLS-17 | Parent (P1) SELECT year_end_reports for own child, status=published → row returned |
| RLS-18 | Parent (P1) SELECT year_end_reports for P2's child, any status → 0 rows |
| RLS-19 | S16 SELECT own year_end_reports, status=published → row returned; status=draft → 0 rows |
| RLS-20 | T2 (not the authoring tutor, different class) SELECT/PATCH a Class A report → rejected |
| RLS-21 | Non-service-role client attempts to read/write `storage.objects` in the `reports` bucket directly → rejected (no client-facing policy exists) |
| RLS-22 | Admin INSERT lands on every operational table — `sessions`, `attendance`, `assignments`, `assignment_status`, `yanbua_progress`, `quran_progress`, `murajaah_assignments`, `year_end_reports` — for a class it is *not* a tutor of |
| RLS-23 | Admin UPDATE lands on rows it did not create, including another tutor's report narrative/grades (`yer_tutor_rw`'s `tutor_id = auth.uid()` WITH CHECK does not constrain `yer_admin_all`) |
| RLS-24 | An admin-recorded row carries the admin's own id in `tutor_id`, and that id is in no class's `tutor_ids` — the column means "who recorded this", not "a tutor of this class" (TAD ADR-014(b)) |
| RLS-25 | RLS *permits* an admin `murajaah_log` INSERT (`mlog_admin_all`). The parent-only rule for home-practice confirmation is application-layer by design (ADR-014(c)) — asserted so the split between "the database allows it" and "the app does not offer it" stays visible |
| RLS-26 | Admin's new rows widen nobody else: P1 sees 0 of them for P2's child, T1 sees 0 of the Class B rows, S16 sees 0 of a classmate's, anon still sees 0 |
| RLS-27 | The non-admin write boundaries are unchanged after admin gained access: T1 cannot UPDATE an admin-created Class B attendance row, a parent still cannot INSERT `yanbua_progress` for their own child (but *does* see the admin-recorded row), a 16+ student is still read-only |
| RLS-28 | TP (tutor of Class C, parent of a child in Class D) SELECT students → **exactly** the Class C roster plus their own child; their child's classmates absent, another family absent. Their `users.role` is still `parent` and `fn_is_admin()` is false, so nothing in the result came from a role check. Classes and sessions are the same union — the one they teach and the one their child attends |
| RLS-29 | TT — the identical relationships with the opposite `users.role` (`tutor`) — sees the identically-shaped set. Cross-family: neither dual-role person can see the other's child, though both children share a class |
| RLS-30 | The union holds per operational table, not just on `students`: TP reads attendance, `yanbua_progress`, `quran_progress`, `murajaah_assignments` and `murajaah_log` for a student they teach **and** for their own child, and 0 rows for their child's classmate and for an unrelated family — the rows exist and are invisible |
| RLS-31 | **The union is not a promotion.** TP records Yanbu'a for a student in the class they teach → allowed; for their own child → rejected (the parent half is read-only). TP confirms home practice for their own child → allowed; for a student in their class → rejected (teaching does not grant a parent's confirmation) |
| RLS-32 | `year_end_reports`, the sharpest form of the same rule: TP sees the draft for a student they teach, still cannot see the draft for their **own** child, does see their own child's published report, and sees none of the classmate's at any status |
| RLS-33 | The dual-role rows widen nobody: TP sees none of the four original fixture students, P1 and T1 see none of the dual-role students, S16 still sees exactly one student row (their own), anon still sees 0 |
| RLS-35 | **The student assistant** — `users.role = 'student'`, their own 16+ record in Class D, a tutor of Class C (ADR-020). Ground truth: role really is `student`, `fn_my_student_id()` set, `fn_my_classes()` exactly Class C, not an admin. They see their own record plus the roster they teach — and **none of their own classmates in Class D**, since being enrolled somewhere was never a grant. They **can** record Yanbu'a, set a murajaah target and correct attendance for the class they teach, which is the decision this case pins; they **cannot** record progress for their own record, nor touch a class they do not teach (a filtered UPDATE is silent, so that one is asserted both from inside the session and from outside RLS) |
| RLS-34 | **The triple-role person** — `users.role = 'admin'`, tutor of one class, parent of a child in another. All four capabilities are derived independently and none excludes another: `fn_is_admin()` true, `fn_my_classes()` exactly the one class they are named in, `fn_my_children()` exactly their own child, `fn_my_student_id()` null. **And the one boundary the rest of the block does not have:** with `admin` in the union, RLS-28's "nothing more" and RLS-31/RLS-32's "not a promotion" stop holding — they see all four original fixture students, *can* record Yanbu'a for their own child, *can* confirm home practice for a student they teach, and *do* see their own child's draft report, each one the mirror of a refusal above. What keeps an admin out of the parent-only actions is application-layer (ADR-014(c), RLS-25). They still widen nobody: TP cannot see their child, anon still sees 0 |
| RLS-36 | **The overlap, and PPME's decision about it** (ADR-024) — a tutor of the class their own child is in (OV), with a second child in a class they do not teach. Ground truth first: `role = 'parent'`, not an admin, `fn_my_classes()` exactly Class E, `fn_my_children()` exactly their two children. They see the Class E roster and both children **each exactly once** — two grants reaching one row is not two rows. Then the inversions, and they are per child, not per person: they **can** record Yanbu'a for the child in the class they teach (RLS-31 refused this, because there the child was elsewhere) and **cannot** for their other child; they **do** see the taught child's draft year-end report (the mirror of RLS-32, the sharpest form of the overlap) and **do not** see the other child's draft, while seeing that child's published report. The parent half is intact throughout: they still confirm home practice for the non-taught child. Class F stays invisible |
| RLS-37 | **The student assistant assigned to their own class** (OSA) — the likely arrangement, since a 16+ santri assists the group they already attend. This is the case that found the defect ADR-020 had only described: with their own record inside the class they teach, the tutor grant let them grade their own Yanbu'a and Quran, set their own memorization target, author their own year-end report and read that draft about themselves. Migration 013 closes all five, and this case is what asserts it — each refusal stated alongside the write it does **not** take away (recording for a classmate) and the read that survives (a published report). Two halves are stated rather than fixed: `attendance` stays reachable, deliberately, because the register is one upsert of the whole roster and refusing one row would stop them marking anybody (ADR-023(c)); and they do see all of their own classmates, through the tutor grant rather than through enrolment. Ends with the regression the migration could most easily have caused — `fn_my_student_id()` is null for an ordinary tutor, and the `<>` spelling of this rule would have refused every tutor write in the school |
| RLS-38 | **The plain admin-parent** (AP) — admin, a parent, and a tutor of nothing. Every admin-parent assertion before this one was made against TAP, who also holds a tutor relationship, so this is the first case where any grant an admin-parent has must be `fn_is_admin()` or parenthood and nothing else. `fn_my_classes()` is empty while the grant covers the school — the disagreement `useMyClasses` resolves on the admin branch (ADR-014) — and they record against a class they are not named in |
| RLS-39 | **The admin who teaches, and is nobody's parent** (AT) — the mirror of RLS-24. There, an admin-recorded row's `tutor_id` is in no class's `tutor_ids`; here the same id **is** in the array. `tutor_id` means "who recorded this" in both directions, and cannot be read as "an admin did" any more than as "a tutor of the class did" |
| RLS-40 | **A tutor of two classes** (MC) — the only one in the suite. `fn_my_classes()` returns a set, which every tutor policy's `in (select …)` had never been given, and the two rosters come back unioned and bounded: the Class D sibling of a child on one of those rosters is still invisible |
| RLS-41 | **The account that holds nothing** (NONE) — a `users` row, a valid JWT, and four false booleans. Reads 0 students, 0 classes (all four OR-ed branches of `classes_read` unsatisfied), 0 attendance; writes nothing, though `users.role` says `tutor`. The application-layer mirror is `NO_CAPABILITIES`, asserted in `tests/unit/capabilities.test.ts` |

**Gate: all RLS tests green in CI is a merge requirement for any migration change, and a launch requirement before real data entry (DPIA risk R1).**

*RLS-22…RLS-27 were added with TAD ADR-014 (admin as super admin). They test policies that already existed and were never modified, which is the point: an unchanged-green run of RLS-01…RLS-21 alongside them is the evidence that widening the application layer did not touch the database layer. 27 cases, 64 pgTAP assertions in `supabase/tests/database/rls.test.sql`.*

*RLS-28…RLS-33 were added with TAD ADR-019 (dual-role people), and for
the same reason: they test policies that already existed and were never
modified. The claim they exist to prove is that the policies are written
against relationships rather than roles, so someone who is both a tutor
and a parent gets the union of both grants and nothing more — which is
the assumption the whole dual-role change rests on, and would have
changed all of it had it been wrong. They are worth reading in pairs:
RLS-28 and RLS-29 are the same person with opposite `users.role` values
and identical results, and RLS-31 and RLS-32 are the two places the
union deliberately does **not** widen. RLS-34 was added afterwards, to
answer "is this dual-role only, or n-ary?" — the derivation is four
independent booleans and nothing caps the count at two, but that was an
inference from the absence of a constraint until this case asserted it.
It is also the one place in the block where the union is *not* bounded
by the relationships held, and it says so. RLS-35 came last and is the
only one of these cases prompted by a product decision rather than a
proof obligation: PPME decided a student assistant should be able to
record (ADR-020), and it turned out the database had always allowed it,
because "16+ students are read-only" described a relationship nobody had
combined with another. Note that **no case varies the assistant's age**,
and deliberately so (ADR-021): the schema has no concept of age, PPME
does not gate assisting on it, and a case differing only in
`date_of_birth` would assert nothing. 53 assertions, taking the file to
157.*

*RLS-36…RLS-41 close the combination space rather than adding a feature.
Two axes had gone unvaried. The first is **which class**: every dual-role
fixture above deliberately separates the tutor half from the parent half,
which is what makes the union provable and also means the commonest
arrangement at a small TPA — teaching the class your own child is in —
had never been asserted at all. When the halves overlap the union stops
being a union, and three assertions above invert; RLS-36 and RLS-37 are
those inversions, stated so the behaviour is on the record rather than
discovered in production. PPME has since answered both, in
opposite directions. **RLS-36 is a decision** (ADR-024): a tutor may
record for their own child, and write that child's year-end report — at a
small TPA an ustadz or ustadzah teaches their own children, and a rule
against it would be a rule against how the school runs. **RLS-37 was a
defect**: a santri assigned to their own class could grade themselves,
contradicting the boundary ADR-020 states in prose, and migration 013
(ADR-023) closes it. The two look structurally identical and are different
in kind — one is a person assessing their own work, the other a teacher
assessing a pupil who happens to be theirs — which is why
`fn_my_recordable_students()` excludes the caller's own record and never
their children. RLS-37 now asserts the new rule and the one half of it
deliberately left open. The
second axis is the **empty cells of the capability lattice**: four
independent booleans have sixteen combinations, of which six were covered.
RLS-38…RLS-41 add the four that can really occur — admin+parent with no
class, admin+tutor with no child, a tutor of more than one class, and the
account that holds nothing at all. The remaining cells (an admin who is
their own 16+ student, and the three-and-four-way combinations built on
it) are not asserted here because they cannot occur, and a fixture for
them would assert nothing about the product; the derivation is swept
exhaustively at the application layer instead, in
`tests/unit/capabilities.test.ts`. 69 assertions, taking the file to 227.*

*WH-01…WH-06 were added with TAD ADR-015 (migration 009's absence
webhook). They are not RLS assertions, but they belong to the same "what
does the database do on its own" suite: the trigger fires on every
attendance write in the product and reaches outside the database. They
assert it exists, fires on the transition into `absent` and on nothing
else (a re-saved roster must not re-notify), is completely silent in an
unconfigured environment, targets the configured URL with the configured
secret, carries the row id and **never** the absence `reason` (DPIA
R4/R6), and that no client role can execute `fn_webhook_config()` to read
the secret. pg_net queues inside the calling transaction, so a
rolled-back test can assert on what would have been sent without a
network, a listener, or anything left behind.*

*WH-07…WH-12 cover migration 010's four event triggers (ADR-015 part
2a): that the Yanbu'a trigger fires for **every** progress entry rather
than only completions — deliberately, so the completion rule has one
implementation in `src/lib/yanbua.ts` instead of a second copy in SQL —
and that the other three fire on exactly their own transition and no
other edit (re-activating a memorized murajaah target, re-publishing or
editing an already-published report). Also that the assignment title
never leaves the database in a webhook body, and that a broken webhook
path cannot fail the write it observes: `fn_post_webhook` is renamed out
from under the triggers and the writes must still succeed. Total: 93
assertions.*

### 3.1 Notification centre (NC-01…NC-18, migration 012 / ADR-017, ADR-022)

A notification is a message addressed to one named person, so the whole
table is a single access-control question asked from every direction.

- [x] NC-01/NC-02 — a parent sees exactly their own notifications; another family's are invisible rather than merely filtered by the app
- [x] NC-03 — a recipient can mark their own read
- [x] NC-04/NC-05 — and can change **nothing else**: rewriting `event` or `context` on their own row is refused. RLS has no column granularity, so this is a column-level GRANT (`update (read_at)`), not a policy
- [x] NC-06 — no client role can insert a notification, even addressed to themselves. A client that could would be able to put words in the TPA's mouth on another parent's screen
- [x] NC-07 — nor delete one: retention is central, so there is no path by which the record of what a family was told disappears early
- [x] NC-08 — a 16+ student reads their own
- [x] NC-09 — **an admin reads none at all**, the one place TAD ADR-014's super admin deliberately does not reach. True of an admin who is nobody's parent, which is every admin the base fixture has; NC-14 states the boundary exactly
- [x] NC-10 — nor a tutor, including for their own class
- [x] NC-11 — `TRUNCATE`, which RLS does **not** filter, is no longer held by `anon`/`authenticated` on any table. Found while checking the grants for this migration: it came from Supabase's own role bootstrap, and `set role authenticated; truncate public.attendance;` succeeded before migration 012 revoked it. Not reachable through PostgREST, which exposes no TRUNCATE — removed on least-privilege grounds rather than in response to a live route

**NC-12…NC-16 — the same question asked of a person who is more than one
thing (ADR-022).** NC-01…NC-11 tested accounts that were exactly one
thing each, at a time when the recipient rule was `role in
('parent','student')` — which is why a tutor whose own child attends the
TPA received nothing about their own child. The database needed no change
for the fix (`notifications_own_read` is `user_id = auth.uid()`, a
relationship and always was), so these cases pin the boundary the
application-layer rule now has to respect, stated from both sides:
satisfying either half alone is possible and useless.

- [x] NC-12 — a **tutor-parent** reads the notification about their own child, reads none about a child in the class they *teach* though a row for that child exists, and reads nothing addressed to anyone else including their co-tutor
- [x] NC-13 — the same shape with `users.role = 'tutor'` instead of `'parent'` gives the same answer, and neither tutor-parent can read the other's though their children share a class. Two rows differing only in the role column cannot be what grants either of them anything
- [x] NC-14 — an **admin-parent** reads their own child's and **still nobody else's**, asserted alongside the fact that the same account *does* read that child's classmate's `students` row through `fn_is_admin()`. So the refusal is the notification policy, not a missing row — ADR-017(d) refined, not reversed
- [x] NC-15 — a **student assistant** reads the notification about their own record and none about the class they teach: ADR-020 granted a write, never an inbox
- [x] NC-16 — nobody's inbox widened. The ordinary parent of a child taught by four co-tutors still reads exactly one, the original fixture's parent is unaffected, and `anon` still reads zero

**NC-17…NC-18 — the same question where the two halves of ADR-022 point
at the same child.** NC-12 states them against a tutor-parent whose child
is in somebody else's class, so "tell a parent about their own child" and
"never tell a tutor about their class" can be satisfied separately. In the
overlap they are one child, and only the first may win.

- [x] NC-17 — the **overlap parent** reads about both their own children and nothing else; about the overlapping child **exactly once**, though both halves of the rule have something to say about that child; and nothing addressed to the family of a child they teach — asserted alongside reading that same child's `students` row without difficulty, so the refusal is the notification policy and not a missing row
- [x] NC-18 — an account holding **no relationship at all** reads no notifications, though rows exist and it is signed in. The other end of the rule `canReceiveNotifications` answers false for and `push-subscribe` refuses to store an endpoint for; `anon` still reads zero after every row the block added

*Total after these: 227 pgTAP assertions (171 before).*

### 3.2 Schema privileges (RLS-42, ADR-027)

Everything above asks what a role may *see*. These four ask what it may
*make* — a separate gate in Postgres, and the one without 42 policies
watching it.

- [x] RLS-42 — `anon` holds no CREATE on the `public` schema, and neither does `authenticated`. `ALL ON SCHEMA public` (USAGE **and** CREATE) was granted to both at project provisioning, asked for by no migration in this repo, and found only by running `supabase db diff --linked --schema public` against Frankfurt. `anon` is the role behind the key that ships inside the app bundle; `authenticated` is every signed-in parent
- [x] …and USAGE survives for both, which migration 007 grants and PostgREST needs to resolve any table at all. Asserted because "we revoked too much" and "we revoked nothing" fail identically — with no rows and no error — in a migration that only revokes
- [x] `service_role` is asserted in neither direction, deliberately: migration 014 does not touch it, so whether it holds CREATE depends on which Supabase image provisioned the database rather than on anything here. Frankfurt grants it; a fresh `supabase start` does not

**The migration is a no-op on a fresh local stack**, because current
Supabase images no longer grant `ALL ON SCHEMA public` to the client
roles — there is nothing local to revoke, and `supabase db reset` shows
no change. Its effect lands when it reaches Frankfurt. That the
statements do what they claim was therefore confirmed separately, by
reproducing production's grants on a local stack and running them:
`anon`/`authenticated` go from CREATE to no CREATE with USAGE intact,
and an anonymous PostgREST read still answers `200 []` rather than a
permission error. The assertions earn their place regardless — they now
fail if a future migration re-grants CREATE to either role.

*Total after these: 231 pgTAP assertions (227 before).*

## 4. Unit tests (Vitest)

### 4.1 Streak logic
All done as of Milestone 7 part 2b, against `computeStreak` in
`src/lib/murajaah.ts` — a pure function over log dates, since migration
011 dropped the stored `streak_count` (TAD ADR-016(a)).

- [x] Consecutive daily confirmations increment streak (1→2→3)
- [x] Gap of 1 day resets streak to 1 — specifically to **0**, not 1: a day that is over and was missed ends the run (PRD AC-003). Today being unconfirmed does *not* break it, because today is not over
- [x] `confirmed_today` boolean correct across CET/CEST midnight. Both halves now done: `amsterdamDate`/`amsterdamHour`/`isAmsterdamHour`/`amsterdamWeekday` are tested on both 2026 switchover Sundays, on a CET date and a CEST date, and across the repeated 02:00–03:00 hour in autumn; and `computeStreak` itself is tested across both switchovers plus a month and year boundary, on date strings whose arithmetic never touches the host timezone
- [x] Best-streak derivation from log history (`computeBestStreak`), including that a still-running streak counts and an unconfirmed today does not end it
- [x] **3x_week / weekly frequency:** behaviour defined first (ADR-016(a)), then tested. The unit of a streak is the period the frequency asks for — a Mon–Sun week needing three confirmations for `3x_week`, one for `weekly` — so a `3x_week` target confirmed Mon/Wed/Fri every week is a run of *weeks*, which the old day-counting trigger scored as 1
- [x] **Assignment created mid-week:** the week a target is assigned in asks only for as many confirmations as there were days to give them, never fewer than one, and weeks before the target existed are not counted
- [x] **Reminder rule** (`needsReminder`, what `send-murajaah-reminders` decides on): remind on the last day the frequency can still be met — every unconfirmed evening for `daily`, Friday-if-none/Sunday-if-two for `3x_week`, Sunday for `weekly` — and stay quiet for a family on track

### 4.2 Milestone detection
- [x] Yanbu'a entry at page == jilid page_count with mastery `lancar` → jilid-complete event fires
- [x] Same page with mastery `kurang_lancar`/`ulang` → no event
- [x] Jilid 7 completion → program-complete variant (`nextJilid` returns null)

*Implemented in `tests/unit/yanbua.test.ts`. Since ADR-015 part 2a these
same assertions cover the **notification** path too, because
`notify-milestone` imports `isJilidComplete` rather than reimplementing
it — there is one rule with two callers (the Yanbu'a screen and the
Function), not two rules to keep in step. Both branches are also
exercised live: a completing entry produces a push, and a last page at
`kurang_lancar` produces none (§6).*

### 4.2b Transactional email (TAD ADR-018)

*Implemented in `tests/unit/email.test.ts` (16 cases).* **Every test
injects a fake transport**, so the suite cannot reach a real inbox —
§1's "no real student data in any test environment, ever" extends to not
mailing real people while developing.

- [x] The Resend request is shaped correctly: endpoint, bearer key from `process.env`, JSON body, `text` omitted rather than sent empty when there is none
- [x] A missing `RESEND_API_KEY` returns `not-configured` **and attempts nothing** — the assertion that matters is that no request was made
- [x] `429` is its own outcome, with the `retry-after` hint parsed, and with a sane result when the header is missing. The free tier is 100/day, 3,000/month, 2/sec, and the per-second limit is the one a class-sized loop would hit
- [x] An API error surfaces Resend's own message (e.g. the unverified-domain 403), so the deployment prerequisite diagnoses itself
- [x] **It never throws** — a transport that explodes still resolves to a value, which is what stops a mail failure from taking down its caller
- [x] The API key never appears in a returned result
- [x] All four roles × both locales exist, each with `{{app_url}}`; the four role bodies are asserted *different* from each other, since that is the entire reason for keying by role
- [x] Every placeholder is substituted with none left behind; an unknown placeholder is left intact rather than blanked
- [x] Locale comes from the recipient and falls back to `id` rather than failing — a missing locale should send a slightly-wrong-language email, never no email
- [x] **HTML injection**: a full name containing markup is escaped in the HTML part and left readable in the plain-text part
- [x] The Islamic greeting is present in both languages, and the `Bapak/Ibu` honorific in the Indonesian parent template

**Verified live** against the local stack and the real Resend API,
without sending mail: an admin invite with no `RESEND_API_KEY` returns
`201` with `invitation_email: "not-configured"` and the user still
created; the same invite with a deliberately invalid key reaches Resend,
comes back `401 API key is invalid`, is mapped to `failed`, logged, and
the invite still returns `201`. That is the non-blocking property proven
end to end rather than argued.

**Not verified, and cannot be here:** that a real message arrives in a
real inbox, that the HTML renders acceptably in Gmail/Outlook/Apple
Mail, and that the EU region and domain verification are actually
configured. All four need the Resend account and a verified domain, and
the first two need a real recipient. Someone with the account should run
them before the first real invitation.

### 4.3 Notification payload builder

*Implemented in `tests/unit/notifications.test.ts` (20 assertions).*

- [x] Absence, new-assignment, due-tomorrow, milestone, reminder, report-ready and weekly-digest payloads render correctly in **both locales** based on recipient's `users.locale` — all eight event types are built, tested, and have a sender wired to them (TAD ADR-015 part 2b)
- [x] Payload contains first name only, no progress details (DPIA risk R6). Asserted three ways: a full name is reduced to its first token; a serialized payload contains none of a set of sample reasons, grades and positions; and — the one that will still hold when someone adds an event type in a year — every string under `notifications.push` is rejected if it interpolates any placeholder other than `{{name}}`. The builder's own signature is the primary control: it accepts no field that *could* carry a reason or a grade
- [x] Dedup tag generated per (user, event-type, **child**, date), and differs when any of the four differs. The child was added in ADR-016(f): without it, two siblings shared a tag and the browser showed one notification instead of two. Asserted both ways — two siblings get distinct tags, and a repeated run for the same child on the same day still collapses, which is what the hourly cron depends on
- [x] Known and pinned: the tag being per (user, event, date) means a parent with two children absent on one day sees one notification, not two. That is the spec's dedup unit; per-child detail belongs in the in-app list (part 3), not on a lock screen
- [x] Deep-link URLs carry no data of their own

Also tested alongside it:

- `tests/unit/enrolmentLinks.test.ts` (8) — who an admin may be *offered* when attaching a person to a child's record or a class (ADR-028). Not an authorization boundary and tested as one anyway, because the lists are the only thing standing between an administrator and a link the schema would happily store: `students.parent_id` and `classes.tutor_ids` carry no role constraint, so getting these wrong makes a screen unhelpful rather than unsafe — and unhelpful is what stopped every multi-relationship persona in the fixture from being creatable through the interface. All four roles are swept against both predicates rather than sampled. The asymmetry is asserted as a relationship — every parent-eligible role is tutor-eligible, and the tutor list is strictly longer — so reversing one list fails here rather than in a screenshot; `student` is pinned out of the parent list (the one deliberate omission, DPIA R12) and into the tutor list (ADR-020, RLS-35); and no listed role may be absent from the enum, because a typo'd role narrows a picker silently — `in ('tutorr')` returns nobody and the screen just looks empty
- `tests/unit/push.test.ts` (13) — subscription validation (rejects non-HTTPS endpoints, missing keys, oversized values, junk), the normalization that keeps client-supplied extras out of the `jsonb` column, and the `push-subscribe` rate limiter. The key pair is now checked by **decoded length** — 65 bytes for the P-256 point, 16 for the auth secret, the two RFC 8291 fixes — because a wrong-length key is refused by `web-push` *locally*, before any request and with no status code, which `sendPush` can only record as `failed` and never as `gone`: nothing clears it, and the account pays a doomed send on every notification it is ever owed. Both base64 alphabets are accepted, padded or not, since browsers and client libraries differ there and the difference says nothing about the key; base64 that only *starts* valid is rejected by a round-trip, because Node's decoder stops at the first bad character rather than throwing. The same predicate runs over every **stored** value in `buildAudiences`, so a malformed row written before this check existed stops being pushed to rather than failing forever
- `tests/unit/pushServiceWorker.test.ts` (8) — `public/push-sw.js` loaded into a VM and driven with the browser's own event shapes: it renders the payload, never re-alerts on a replaced notification, still shows *something* when the payload is missing or unparseable (otherwise Android substitutes its own "site updated in the background" notice), and routes a click to an already-open tab rather than opening a second one
- `tests/unit/pushCapability.test.ts` (13) — platform detection, including the iOS branch this project cannot verify on hardware (see §6)
- `tests/unit/notificationRecipients.test.ts` (20) — the recipient rule on its own (ADR-022): the predicate, the derivation from a set of student rows, and the query `push-subscribe` asks. A tutor with no child of their own is not a recipient even when the children they teach are among the rows they can read; a 16+ santri is a recipient through their own record and is not thereby a parent of themselves; and a failed lookup throws rather than reporting "not a recipient", because a swallowed error there 403s a real parent and looks exactly like the rule working
- `tests/unit/notifyStudent.test.ts` (30) — **who receives what**, the highest-risk logic in the feature. A two-family class roster must resolve each child to their own parent and no one else; the 16+ student is added only for a "family" audience; an account with no usable subscription stays in the audience with nothing to push to, without dropping the rest of the roster. Since ADR-022 the cases that matter most are the dual-role ones: a **tutor-parent** and an **admin-parent** are recipients for their own child, a **tutor is never a recipient for a child in the class they teach**, and both hold at once for the same account in the same audience. `UserRow` no longer carries a role at all, so those cases cannot regress without the data coming back first Plus the fan-out dispatch: one payload per recipient in that recipient's own locale, a dead subscription cleared without costing anyone else their notification, a failed send not mistaken for an expired one, and delivery bounded to a fixed concurrency — none of which can be produced on demand against a real push service, which is why they are injected here rather than left to the live run

### 4.4 Year-end report generation
- `generate-year-end-drafts` computes `attendance_present/absent/late` and `attendance_rate` that exactly match a hand-computed value from fixture attendance rows for the academic year window
- Re-running for an academic year that already has drafts/reports for a student does not create duplicates (unique constraint respected; function reports `skipped_existing` count)
- `publish-report`: status only flips to `published` after successful PDF generation; a simulated PDF-generation failure leaves status as `draft` (no partial state)
- `publish-report` on an already-published report (post-edit regeneration case) overwrites the existing `pdf_path` rather than creating a second object
- PDF content smoke test: generated PDF contains the student's name, academic year, attendance rate, and all three subject grades (basic text-extraction check, not visual regression)
- **Header logo**: with the inlined brand asset present, the header wordmark is *drawn* (so "PPME Den Haag" does not appear as extractable text); with the asset missing (`logo: null`) or corrupt (a non-PNG Buffer), the render falls back to the typographic header and still succeeds — a publish must never fail over branding
- **Admin edit vs. stale PDF (ADR-014(e))**: an admin may PATCH a published report's narrative/grades but `publish-report` returns 403 for admin, so the stored PDF keeps the pre-edit text until the authoring tutor re-publishes. Asserted live against `netlify dev`: edit → fetch the signed URL → the object does *not* contain the new text → tutor re-publishes → the same object now does, with `published_at` preserved and still exactly one object in the bucket. The UI counterpart (publish button hidden for admin, "the PDF will not update until *[tutor]* re-publishes" notice shown) is covered in the §5 click-through

*Implemented in `tests/unit/reports.test.ts`. Two notes for anyone extending these: the publish ordering is tested through `publishReportFlow`'s injected dependencies (a `renderPdf`/`uploadPdf` that throws must leave `markPublished` uncalled), which is why that ordering lives in its own module rather than inline in the Function; and the smoke test renders with `compress: false` and decodes pdfkit's hex `TJ` runs, since a plain substring search over a normal (FlateDecode) PDF finds only the `/Info` metadata.*

### 4.5 Capability derivation (TAD ADR-019)

Implemented in `tests/unit/capabilities.test.ts`, against
`src/lib/capabilities.ts`. Half of these test the *queries* rather than
their results, using a faked supabase client that records what was
asked, because the defect ADR-019 fixes was a query that asked a wider
question than the screen meant — a result-only test would have passed on
the broken version.

- [x] `familyLinkFilter` asks for **both** family links (`parent_id.eq` and `user_id.eq`). The second is a 16+ self-login student's only link to their own record, and dropping it empties every screen they have
- [x] …and refuses anything that is not a UUID. PostgREST's `or=` takes a filter *expression* as a string, so a value containing a comma would add a disjunct rather than be compared against
- [x] `deriveCapabilities` for each single-role person — a parent of two, a tutor of one class, a 16+ student (whose own row's `parent_id` is their parent's id, so appearing in a `students` row must not read as parenthood) — and for an admin, with and without a child of their own
- [x] …for the dual-role person: the union of both capabilities, from a `users.role` of `parent`, exactly as RLS-28 does it
- [x] …for the student assistant: a `role='student'` account that also tutors gets the self *and* tutor capabilities, neither implying the other (ADR-020)
- [x] …and a `role='tutor'` account an admin has not yet put in a class is **not** a tutor of any class. This is the case that makes swapping the existing role checks for capabilities a behaviour change rather than a refactor
- [x] `fetchFamilyLinks` applies the relationship filter, selects both link columns, and rethrows a Postgrest error instead of reporting an empty family (a swallowed error here is indistinguishable on screen from "you have no children")
- [x] `fetchTutorClassCount` asks whether the caller is in `tutor_ids`, counting without fetching rows — not "how many classes RLS returns", which for a parent is their children's classes and for an admin is all of them
- [x] `fetchTaughtClasses` filters on `tutor_ids` for a tutor and returns **every** class for an admin, who is in no `tutor_ids` array and would otherwise get an empty picker on every recording screen
- [x] **All sixteen combinations**, swept rather than selected. The cases above are the ones somebody thought to name; four independent booleans have sixteen, and the claim ADR-019 rests on is that none of them implies, suppresses, or substitutes for another. Each cell is built from the relationship that is allowed to produce it, and for every non-admin cell `users.role` is set to something the capabilities must not echo — so a future short-circuit ("an admin obviously isn't a parent", "a student can't be a tutor") fails here rather than on a family's screen. The cells that cannot occur in the database are still asserted here, because the derivation is a pure function and nothing about it knows they are unlikely
- [x] …and the two family booleans are never read out of each other's row: a santri whose own record is misread as parenthood gets a ChildPicker over themselves, and a parent whose child has a self-login gets a santri's screens
- [x] …and the overlap (pgTAP RLS-36) stays one boolean: two grants reaching the same student row, or three rows reaching one parent, is not a different answer from one
- [x] `fetchViewerRelationships`, the wrapper the app actually calls and the one thing nothing reached: the two relationship queries are issued **together** rather than in sequence (two round trips on the critical path of the first screen a family sees, on the connection they are most likely to have), the role passes through without implying anything else, and a failure in **either** query rejects rather than resolving into a smaller capability set — a swallowed error there is indistinguishable from "this person is nobody", which is a family locked out of their own child's screens with no error to explain it

### 4.5b View scope selection (TAD ADR-025)

Implemented in `tests/unit/viewScope.test.ts`, against
`src/lib/viewScope.ts`. The decision about *which* of the two shapes a
screen renders lives in a library rather than in the six `.tsx` files
that used to make it, for the reason §4.7 gives: coverage is scoped to
`src/lib/**`, so a selection rule written inside a component is
invisible to the gate. The components render the result and decide
nothing.

- [x] **All sixteen capability combinations against all four roles — sixty-four cells**, swept rather than selected, for the reason §4.5 sweeps its own lattice. The property is conditional and a hand-picked list cannot show it: `users.role` may decide the four cells where the person holds no relationship at all, and must be ignored in the other sixty. Each non-empty cell is additionally resolved under **every** role, asserting the answer does not move — which is the claim, since for most of those cells the role column says the opposite of the relationships
- [x] `scopeFallbackForRole` reproduces the pre-ADR-025 expression (`role === 'tutor' || role === 'admin'`) verbatim. This is the branch that keeps an invited-but-unassigned tutor on the screens they have today; a purely capability-derived answer would move them to the family views and take those screens away (the case §4.5 already flags as making the swap a behaviour change rather than a refactor)
- [x] `canSwitchScope` is false for each of the four single-relationship personas, false for an account holding **no** relationship, and false when two capabilities point at the *same* scope — an admin who also teaches has two capabilities and one scope, and counting capabilities instead of scopes would have shown them a control with one button
- [x] …and true for the disjoint tutor-parent, the overlap tutor-parent, the triple-role admin and the student assistant
- [x] `resolveScope` honours a remembered scope only while the relationship behind it survives: an ustadzah removed from her last class falls back to the family shape rather than being stranded on an empty class picker
- [x] `scopeLabelKey` can only ever return a key in the `scope.` namespace, asserted against the full set of `roles.` keys. This is what keeps PRD §70 honest in the test suite: a caption naming a role would be the switcher that note rejects, whatever the code beneath it derives. The family label follows the relationship — "my child" for a parent, "myself" for a 16+ self-login, and a neutral "my family" for the account that is both, whose picker holds their children *and* their own record
- [x] `scopeAppliesTo` covers every entry in `NAV_TABS` plus `/reports`, pinned against the tab set rather than restated, so adding a two-shaped screen without teaching the switch about it fails here; and stays off the dashboard, the notification screens and `/admin/*`, where a family half does not exist
- [x] `capabilityLabelKeys` renders exactly the label that was there before for every single-relationship account and for the not-yet-assigned tutor, and lists all of them in a fixed order for a multi-role one. The dashboard line was the most visible place the app still asserted a person is one thing

### 4.5c The recordable roster (TAD ADR-023(c), closed by ADR-025)

Implemented in `tests/unit/roster.test.ts`, against `src/lib/roster.ts` —
the app-side mirror of `fn_my_recordable_students()`.

- [x] `recordableStudents` subtracts the caller's **own** `students` record and nothing else
- [x] …and **never** a tutor-parent's own child. ADR-024(c) warns that the two overlaps look structurally identical and are different in kind; a tidy-up that merged them would forbid the ordinary arrangement at a small TPA, on screens rather than in policies, where no RLS test would catch it
- [x] …and is a no-op whenever `selfStudentId` is null, which is every account in the TPA but one
- [x] `selfStudentId` reads `user_id` rather than `parent_id`, so it is null for a parent however many children they have — reading the wrong column would return a *child's* id and make the register silently stop submitting that child's row
- [x] `isSelfRecord` is false for a null student id, because the family screens render before the ChildPicker has a value and "nothing selected" is not "this is me"
- [x] …and it now decides the **attendance** heading too, which was the one family screen still naming itself from the scope rather than from the student on it. `AttendancePage` rendered `attendance.myTitle` for the whole family scope, so Ibu Siti read "Kehadiranku" — *my* attendance — above her son Ali's record, in both languages. A page cannot answer that question: which child is on screen is not known until one is picked, and it is picked inside the view. The heading therefore moved into the two views, as it already had in the other five (`QuranPage` carries the note explaining why), and the family one asks the same per-student predicate: "Kehadiran Ali" for a parent, "Kehadiranku" for the 16+ santri reading their own record, "Kehadiran" for the class shape. Verified on the rendered screens at 390px in both locales rather than from the code
- [x] `fetchRecordableRoster` applies the predicate to what the query returned, and rethrows rather than reporting a short roster

### 4.6 Access control and delivery inside the Functions

The three modules that decide who may make a Function act, and what
happens to what it sends. Every Function in this project holds the
service-role key, which bypasses RLS entirely — so for the duration of a
request these are the access control, and the database will not catch a
mistake made here.

- `tests/unit/functionAuth.test.ts` (17) — `authenticateCaller` proves a **person**: the token is validated against GoTrue and the role is then read from `public.users`, never taken from the JWT, and the id filtered on is the one GoTrue returned rather than anything the request supplied. The service-role client is **not built at all** for a request whose token failed, which is the ordering the two-step shape exists for. A valid token with no profile row is 403 and not 401 (a real state: between an accepted invitation and a completed registration), a failed profile read is 500 rather than degrading into a plausible "not an admin", and a missing environment variable refuses every request. `verifyWebhookSecret` proves a **channel**: a wrong secret of the *same* length is refused by the digest rather than by the length check, a different length does not throw (which would surface as a 500 and leak the expected length), and every wrong shape returns the identical body. Unset, it fails closed — an open endpoint here can address any family in the TPA
- `tests/unit/notifySend.test.ts` (13) — `notifyStudents`, the sequence all six senders share and the piece both existing notification suites reach past. The in-app row is written **before** the push, asserted as an ordering and not a count: a crash between them must not leave a family with a lock-screen notice and nothing to open. The four outcomes a Netlify log shows are distinguished — no such student, no recipient account, no push subscription, and a real send — because this feature's failures are silent and "nothing happened" otherwise looks like "nothing was supposed to happen". Plus `sendPush`: a 404/410 means *throw the subscription away* and anything else means *keep it*, and getting that backwards either drops a working subscription on a transient error or burns a request on a dead one forever
- `tests/unit/pushClient.test.ts` (21) — the browser half, previously uncovered because it imports the Supabase singleton and touches four browser APIs. `subscriptionState` is keyed on what the **server** holds, so a browser that kept its subscription object after a sender cleared `users.push_sub` reads as off rather than showing "notifications are on" to a family who can never receive another; a failed read is off for the same reason. `subscribe` stores server-side before reporting success, sends the caller's JWT (so `push-subscribe` can apply ADR-022), reuses an existing browser subscription rather than minting a second, treats a declined permission as an outcome rather than an error, and gives up after 60s on a push service that never answers — observed for real with FCM, and set well clear of the 32s a successful subscribe once took. `unsubscribe` clears the server first, and leaves the browser alone if that fails
- `tests/unit/weeklyActivity.test.ts` (10) — `fetchWeeklyActivity`, behind both the dashboard card and the Friday digest. The timezone narrowing is the point: an entry made at 00:30 Monday in Amsterdam is 23:30 Sunday in UTC, so the range asked of Postgres is deliberately a day wide on each side and the decision is made in the family's own timezone afterwards. Also that home-practice logs are attributed through `murajaah_assignments` to the right child (the one count that can silently land on a sibling), that a week with no sessions issues no attendance query, and that a row for a child that was not asked about is dropped — the digest runs on the service-role client, so its own filtering is the only thing keeping one family's numbers out of another's summary
- `tests/unit/roster.test.ts` (3), `tests/unit/supabaseClient.test.ts` (3) — the class roster filters on `class_id` rather than leaning on RLS to scope it, which since ADR-019 is what keeps a tutor-parent's own child out of the register they are marking; and the browser client's guard clause names both variables and the file to copy, because the person reading it is setting the project up for the first time

### 4.7 Coverage

`npm run test:coverage` (v8, configured in `vitest.config.ts`) reports on
`src/lib/**` and `netlify/functions/lib/**` — the logic modules this suite
is for. Components are exercised by Playwright and by
`scripts/verify-push.mjs` against a real browser, so including them would
report a number about the wrong thing; the generated
`src/lib/database.types.ts` is excluded because there is no behaviour in
it.

Coverage is a way of finding untested decisions, not a target. It is
quoted here because the gaps it found were not obscure: `authenticateCaller`
was at 9% of lines and `verifyWebhookSecret` at 35%, which is to say the
two functions that decide who may operate the service-role key were the
least tested code in the repository.

| | Before | After ADR-019…ADR-024 | After ADR-025 | After ADR-029…ADR-032 |
|---|---|---|---|---|
| Statements | 67.6% | 97.3% | 97.5% | 93.0% |
| Branches | 58.1% | 90.8% | 91.7% | 90.5% |
| Lines | 71.0% | 98.9% | 99.0% | 94.6% |
| Unit tests | 246 | 346 | 447 | 486 |

ADR-025 moved coverage up rather than down, which is the point of
putting the view-selection decision in `src/lib/viewScope.ts` instead of
in the six components that used to make it: a rule written inside a
`.tsx` would have left the gate reporting the same number about strictly
more untested logic.

**The last column's dip is one file, and it is deliberate rather than a
regression.** `src/lib/offlineQueue.ts` (ADR-029, the offline write-queue)
sits at 25.5% statements / 25% branches, and its own module comment says
why: `createOfflineQueue`'s logic — enqueue, ordering, retry bookkeeping —
is fully exercised in `tests/unit/offlineQueue.test.ts` against a fake
in-memory `QueueStore`, but the real `indexedDbStore()`/`openDb()` adapter
is excluded on purpose, the same call §4.6 already makes for
`supabaseClient.test.ts`'s guard clause: jsdom has no IndexedDB, so that
adapter is verified live (§6's offline write-queue rows) rather than faked
in a unit test that would prove nothing about the real one. Pull that one
file out and the rest of the suite is unchanged from the ADR-025 column.
38 of the 39 new tests came with ADR-029…ADR-032's own feature work
(offline queue, transactional email, self-login account linking); the
39th is this section's own hardcoded-string check (§7). None of the 39
add coverage to `offlineQueue.ts`'s IndexedDB adapter, which is why the
unit-test count rose while the coverage percentage fell.

## 5. E2E flows (Playwright)

Run against Preview deploys with fixture data; auth mocked via Supabase test JWTs (bypasses live Google OAuth — OAuth itself covered once in a manual smoke test).

| ID | Flow | Persona |
|---|---|---|
| E2E-01 | Mark attendance for full class (mixed statuses) → submit → counters update → parent sees status | Tutor → Parent |
| E2E-02 | Create assignment → appears for class → parent + student views show it → tutor marks completed | Tutor → Parent → Student |
| E2E-03 | Record Yanbu'a progress → history timeline updates → jilid completion triggers milestone card | Tutor → Parent |
| E2E-04 | Record Quran tilawah with quality rating → position card updates | Tutor → Parent |
| E2E-05 | Parent confirms murajaah → streak increments → duplicate confirm same day blocked with friendly error | Parent |
| E2E-06 | 16+ student logs in → sees only own data across all 5 tabs → no write controls rendered | Student |
| E2E-07 | Language toggle ID↔NL → all visible strings switch, Arabic terms unchanged | All |
| E2E-08 | Unregistered Google account signs in → sees "contact admin" screen, no data | — |
| E2E-09 | Admin generates drafts for a class → tutor sees draft list → tutor writes narrative + sets 3 subject grades → publishes → parent receives notification and can view + download PDF; student (S16) can independently view + download the same report | Admin → Tutor → Parent → Student |
| E2E-10 | Tutor edits a published report's narrative → re-publish → PDF updates (old download link still resolves but now serves the new content, per FR-006's single-current-version model) | Tutor → Parent |
| E2E-11 | Admin opens each of the 6 feature tabs on a class it does not tutor → records attendance / progress / a homework verdict → the affected family sees the change in their own view, and no other family does (TAD ADR-014) | Admin → Parent |
| E2E-12 | Admin opens a draft report, edits narrative + grades, saves; no publish button is offered and the "only *[tutor]* can publish this" notice is shown. On a *published* report the notice instead warns the PDF will not update until the authoring tutor re-publishes | Admin |
| E2E-13 | Admin's bottom nav is the same five operational tabs as every other role (never the enrollment set), "Kelola" reaches `/admin/*`, and a non-admin visiting `/admin` or `/admin/classes` is redirected home | Admin, Tutor |
| E2E-14 | Admin invites a new account by email with role Santri (or registers one from the pending-sign-ins list) → opens the *existing*, previously-unlinked student record on Kelola → Santri → Ubah → picks that account under "Tautkan Akun Login Mandiri" → saves → the row shows "Akun sendiri" → that account signs in and sees its own data across all 5 tabs, and nothing belonging to another student (TAD ADR-032) | Admin → Student |

## 6. Notification & PWA test matrix (manual, real devices)

| Case | Android Chrome | iOS Safari (16.4+, installed to home screen) | Desktop Chrome |
|---|---|---|---|
| Permission prompt & subscribe | ☑ | ☐ | ☑ |
| Notification shows the PPME mark, not a white block or Chrome's logo | ☐ | ☐ | ☑ |
| Absence push received | ☑ | ☐ | ☑ |
| Milestone push received | ☐ | ☐ | ☑ |
| New-homework push received (class fan-out) | ☐ | ☐ | ☑ |
| Report-ready push received (parent + 16+ student) | ☐ | ☐ | ☑ |
| Scheduled Murajaah reminder at 18:00 local (check after DST switch too) | ☐ | ☐ | ☑ |
| Scheduled homework-due reminder at 08:00 local | ☐ | ☐ | ☑ |
| Weekly digest, Friday 08:00 local, and the dashboard summary it links to | ☐ | ☐ | ☑ (push leg on a Thu/Fri run — see below) |
| Two children absent → two notifications, one per child (ADR-016(f)) | ☐ | ☐ | ☑ |
| Tapping a push opens the app on the right screen | ☐ | ☐ | ☑ |
| Notification centre lists the same events, with the in-app detail | ☐ | ☐ | ☑ |
| Bell badge shows the unread count and clears on opening the centre | ☐ | ☐ | ☑ |
| Push switched off → centre still fills (the case the centre exists for) | ☐ | ☐ | ☑ |
| Dedup: same event twice → one notification | ☐ | ☐ | ☑ |
| iOS not-installed state → graceful explanation, no broken prompt | — | ☐ | — |
| App installable (manifest valid, icons 192/512/maskable) | ☐ | ☐ | ☐ |
| **Installed** PWA: notification is attributed to "TPA PPME Den Haag", not to Chrome | ☐ | ☐ | n/a |
| Offline: app shell loads, cached data visible, clear offline banner | ☐ | ☐ | ☐ |
| Offline write-queue (ADR-029, in scope and built): attendance/murajaah recorded offline queues, shows "will sync", and replays once online; a genuine rejection (not a network failure) still surfaces immediately rather than queuing | ☐ | ☐ | ☑ |
| Offline write-queue, Yanbu'a/Quran recording (ADR-030, `client_ref` idempotency): same queue/replay/"will sync" behavior as the row above, plus a replay whose response was lost after the write already committed must not create a duplicate progress row | ☐ | ☐ | ☐ |

**The offline write-queue's Desktop Chrome column is now ticked for attendance/murajaah, verified live** against the local Postgres stack (`npx supabase start`, dev fixture loaded) and `npm run dev`, not just unit-tested. Signed in as Ustadz Ahmad (tutor), Chrome DevTools' Network throttling set to "Offline": marking attendance for Grup A showed the queued "will sync" banner instead of an error, and the entry appeared in IndexedDB (`tpa-offline-queue`). Switching throttling back to "No throttling" fired the `online` event, the entry replayed and cleared from IndexedDB, and the rows appeared in `attendance` in Supabase Studio. Repeated as Ibu Siti (parent) confirming a murajaah target assigned for the test: same queued banner, same replay-and-clear on reconnect, row landed in `murajaah_log`. A second same-day confirmation attempt while online correctly surfaced the red rejection banner rather than being queued, confirming the network-vs-server-rejection distinction holds under real conditions, not just in the mocked unit tests. Android and iOS remain unticked below, for the same reason as the rest of the matrix — no device available.

**The Yanbu'a/Quran row is unticked in every column, and that is accurate rather than merely cautious.** `client_ref`'s idempotency was verified against the same local Postgres+RLS stack, but at the REST layer directly — a fixture tutor's JWT minted the same way `DevAuthSwitcher` does it, not a browser click-through: a fresh `client_ref` insert into `yanbua_progress` returned `201`; resubmitting the identical `client_ref` — simulating a replay of an entry whose response was lost after the write had already committed — returned `409`/`23505`, and a follow-up read confirmed exactly one row existed for it, not two; a `tutor_id` not matching the caller's own returned `403`/`42501` (RLS); an out-of-range `ayah_to < ayah_from` on `quran_progress` returned `400`/`23514` (check constraint) — both genuine rejections, distinct from a network error, so the real UI's `isNetworkError` check would not have queued either. What this did **not** exercise is the actual browser: no automation tool was available in the session that built this, so the "will sync" banner, the IndexedDB entry, and replay-on-reconnect have not been driven through `npm run dev` for these two screens the way they were for attendance/murajaah above. That click-through — Chrome DevTools Network set to "Offline", record a Yanbu'a session and a Quran recitation as a tutor, confirm both queue and show the banner, go back online, confirm both replay and land in Supabase Studio — is the one remaining step before this row can be ticked.

**Two Android rows are now ticked, from a real device.** A reviewer with an
Android phone ran the permission prompt, subscribed, and received a real
absence push over a local HTTPS origin (a LAN cert, so the origin is a
secure context — plain `http://<lan-ip>` is not, and neither the service
worker nor `crypto.subtle` is available there). That run is also what
caught the notification badge: Android masks the badge slot by its alpha
channel, so the opaque `icon-192.png` it pointed at rendered as a white
block, and where the browser fell back it showed Chrome's own logo. Fixed
with a transparent silhouette (`icons/badge-96.png`); **the fix itself is
not yet confirmed on the device**, so that row stays unticked until it is.

**The rest of Android, and all of iOS Safari, are still unverified, and are
not being recorded as anything else.** No physical Android or iOS device is available to this
project, and both columns need one — iOS especially, since its whole point
is behaviour that only appears after "Add to Home Screen", which cannot be
emulated. Someone with a phone needs to run those two columns before
launch. What *is* known about iOS is that the app detects an iPhone in a
Safari tab and shows the install explanation rather than a broken prompt
(§4.3, `pushCapability.test.ts`) — that is the code path being right, not
the platform being tested.

**Desktop Chrome is genuinely run**, not inspected: `scripts/verify-push.mjs`
drives real Chromium profiles (a parent with two children in one class, a
second family in the same class, a 16+ student with their own account, and —
since ADR-022 — a tutor whose own child attends and an admin whose own child
attends) against a real push service, and asserts on what each browser
displayed. 218 checks (63 before part 2b, 104 before part 3, 130 before
ADR-022, 158 before ADR-025, 191 before the child-picker fix, 217 before
the subscription-key check).

**Section 9 is ADR-025's, and it is here rather than in Playwright for
the reason section 7 is:** a scope switch that renders for the wrong
person shows them a screen that is not theirs, and no unit test over
`viewScope.ts` can prove a component consulted it. It asserts that each
of the four single-relationship personas gets **no** control at all —
the whole regression bar of that change — that each of the four
multi-relationship personas gets one captioned by subject rather than by
role (which is what keeps PRD §70 honest against a future edit), and
that the student assistant can take the register for the class she is
enrolled in: the save succeeds, her own attendance row is **not** in the
table afterwards, and a tutor-parent's own child's row is (ADR-024).
That last group is the live half of closing ADR-023(c), asserted against
the database rather than against a payload, because a payload that looks
right is the entire failure mode.

**Section 10 is the child picker's, and it exists because the bug it
pins was invisible to every other kind of test.** `ChildPicker` returns
`null` for a family with one child, and all six family views used to
draw the white card around it themselves — so a single-child family got
an empty white box above their content on all six screens. TypeScript
cannot see it, there is no unit test that renders a component (the
project has no `@testing-library/react`), and Playwright was not
asserting on empty chrome. Only a rendered DOM can answer it, so the
check is a DOM query: on each of the six family routes, no
`div.rounded-lg.bg-white` may have empty text content. Both halves are
asserted, because "delete the picker" would also pass the first one —
the 16+ santri (one record) sees no picker and no empty card, and Ibu
Siti (three children) still sees the picker, still inside a card of its
own. The card now belongs to `ChildPicker`, so the component's own
`null` takes its chrome with it.

**The harness used to fail after 20:00, and the reason was its own
clock.** `scripts/invoke-scheduled.mjs` pins `Date` globally so the
Europe/Amsterdam gate can be driven to any hour — and `web-push` reads
the same `new Date()` to stamp the `exp` of the VAPID JWT it signs every
request with. A run pinned to 08:00 therefore signed a token that had
expired at 20:00, and every push in that job came back `403 Received
unexpected response code`. The suite was green before ~20:00 Amsterdam
and nine checks red after it, with nothing about the code different:
§4g's 18:00 job passed in the same run where §4h's 08:00 job failed,
which is the shape of the bug seen from outside.

It was invisible for two compounding reasons. The scheduled Functions
run in their own node process rather than through `netlify dev`, so
`dispatch`'s `console.error('notify: push failed', …)` never reached the
dev-server log — and `invokeScheduled` passes `stdio: ['ignore', 'pipe',
'ignore']`, which discards that process's stderr. The counts said
`failed: 5` and the reason was thrown away. Running
`node scripts/invoke-scheduled.mjs homework-due-reminders <instant>`
by hand is what surfaced it.

`getVapidHeaders` already takes an explicit expiration and `web-push`
simply never passes one, so the harness now fills it in from the **real**
clock, bounded by what `validateExpiration` accepts against the pinned
one (strictly less than pinned + 24h). The fix is entirely on the
harness side: the Functions gain no test hook, and production still
signs with the ordinary default — which is the property the top of
`invoke-scheduled.mjs` exists to protect.

**Last run: the subscription-key check, 217/218** — the single failure
being §9's own date assertion, fixed in the same change (it compared a
row the browser writes with `todayLocalDate()` in Amsterdam against
Postgres's `current_date` in UTC, so it failed for two hours after local
midnight while the register had written every row correctly, one day
further on).

**Live push delivery is genuinely unreliable when the suite is run
repeatedly**, and it is worth knowing what that looks like before
reading a red run as a defect. Across a dozen runs in one evening the
failures moved between sections — §2's absence push, §4b/§4c's
milestones, §4m's tutor-parent, §4h's homework — rather than settling on
one, and no check failed twice for the same reason. The clearest single
piece of evidence is inside §4h, where a first 08:00 run reported
`{"sent":3,"failed":2}` and the immediately following identical run
reported `{"sent":5,"failed":0}`: the same five subscriptions, the same
code, one retry apart. **A delivery failure that moves is the push
service; one that stays is the code.** Re-run before diagnosing, and
prefer a first run of the day.

**Previous run: ADR-025, 191/191** (158 + 33 new).
**And before that: after ADR-024 (`main` at the dev-fixture overlap personas),
158/158.** Re-run specifically to close the gap ADR-023's and ADR-024's
pull requests both declared: neither could exercise this harness, so each
argued from the shape of its change that the harness was unaffected —
ADR-023 touched only policies, and the overlap personas were seeded by
adding a uuid to `tutor_ids` rather than a row, precisely so no roster
size or fan-out count would move. The argument was right, and it is now a
green run rather than an argument. The re-run also exercises the five
narrowed policies from migration 013 through the real recording paths,
since the harness records progress as tutors throughout.

Beyond the ticked rows above it also covers:

- the subscription is stored, with exactly the three fields we use
- **cross-family isolation live** — the other parent's browser received nothing (§1's highest-risk property). Checked on every event type, and hardest on the class fan-out: one assignment notifies both families in the class, each naming only their own child
- **the "family" audience**: a published report reaches the parent *and* the 16+ student, as two separate deliveries with their own tags
- the milestone rules behave the same server-side as on screen: a completing entry notifies, a mid-jilid entry and a last page still needing repetition do not, and re-activating a memorized murajaah target notifies nobody
- a draft report notifies nobody; publishing notifies once; re-publishing or editing a published report notifies nobody again
- the body renders in the *recipient's* locale (verified in both `id` and `nl`)
- DPIA R6 live: an absence carrying a reason (`demam tinggi` / `griep`) produces a payload with no trace of it, and neither the jilid number, the surah name nor the assignment title reaches a lock screen
- re-saving an already-absent roster notifies nobody a second time
- unsubscribe clears `users.push_sub`, and a later absence then produces nothing at all
- zero console errors and zero failed requests, for both parents, the 16+ student, tutor and admin
- accounts no student row points at (a tutor of two classes, an admin) are told plainly that this account is linked to no santri, and are offered no toggle
- endpoint authorization: `push-subscribe` 403s a tutor and an admin **with no child of their own** and 201s a tutor and an admin **whose own child attends**, 400s a non-HTTPS endpoint and junk, 401s without a session; `notify-absence` 401s a missing or wrong webhook secret and 405s a GET
- **the tutor-parent and the admin-parent, end to end (ADR-022)** — the bug this addressed was silent, so it is proven rather than inferred. Each opens a real browser, is offered the toggle, stores a subscription (both were 403'd before), is pushed a real absence about their **own** child with the right dedup tag, and gets the in-app row. Then a pupil in the class they **teach** is marked absent and they receive nothing at all — no push, no row — asserted in the same breath as that pupil's own parent receiving it, so the negative cannot pass because the pipeline went quiet. Their notification centre lists their own child and names no other child in the school, which for the admin is the live form of ADR-017(d): the same account reads every student row and no other family's inbox
- **two children, two notifications** — a parent whose children are both absent receives one notification per child, on distinct tags. This is the regression ADR-016(f) fixed: keyed without the child, the second replaced the first and the parent was told about one of them
- **the three scheduled Functions, driven at a chosen instant** by `scripts/invoke-scheduled.mjs`, which pins the clock from outside the process (there is deliberately no test hook inside the Function). For each: the Europe/Amsterdam gate opens at 18:00 local on a **CET** date and at 18:00 local on a **CEST** date — an hour apart in UTC — and the same 17:00 UTC that is 18:00 in winter is correctly refused as 19:00 in summer; the **second, idempotent run** reports the same sends and adds no notification; a family already on track, a morning with nothing due, and a week with no activity each send nothing; a student who has marked homework `completed` drops out of the run; the Friday digest refuses a Thursday and refuses 09:00
- **the in-app notification centre** (ADR-017): every event above also leaves a row; every row belongs to a child of that family and no other; the centre carries the detail the lock screen may not — the jilid number, the surah, the assignment title and deadline — while the child's name is never stored on the row; a repeated scheduled run updates its row rather than adding a second; **every row is addressed to that child's own parent or to the child themselves and to nobody else** (this read "no tutor or admin is given a row at all" until ADR-022, which was asserting the bug rather than the property — a tutor whose own child attends *should* have rows, and the invariant underneath holds whatever role anyone has); **and a family with push switched off is still recorded**, which is who the centre is for, with the sender reporting `recorded` separately from `sent`
- **the centre on screen**: the list renders in the recipient's own language, names both of a parent's children and neither of the other family's, opening it clears the unread count, the TopNav bell appears for a parent, for a tutor-parent and for an admin-parent and not for a tutor with no child of their own, and a tutor who navigates to `/notifications` directly is told plainly that this account is linked to no santri rather than shown an empty list. The bell is now gated on a relationship, which is a round trip rather than a value already in the auth context, so the harness waits for it — and settles before counting zero, since counting too early would pass the negative for the wrong reason
- **retention** (DPIA R5): `prune-notifications` deletes past the 90-day window, leaves everything inside it, reports its cutoff and count, deletes nothing on a second run, and does nothing outside its hour
- **the scheduled Functions disclose nothing to an unauthenticated caller.** They carry no shared secret — Netlify's scheduler cannot send one — and under `netlify dev` they answer plain HTTP. Asserted: a hostile POST naming another family's child gets a response containing no dedup tags and no identifiers, and the posted body is not read at all (ADR-016(d)/(e))

**Two things the harness itself had wrong, found by running it.** Both
were assertions about the fixture rather than about the product, and both
are the reason it must actually be run rather than assumed:

- **Stale roster arithmetic.** The class fan-out checks counted the
  Grup A roster as it stood before ADR-019's dev-fixture additions —
  `sent === 4`, one notification for the second family — while the class
  had gained two children, one of them a second child of that same
  second family. They now assert five sends and two notifications, and
  name who each is for.
- **The weekly digest's Friday could not always carry a push.** The
  digest is the only delivery here whose instant is not "today": the
  clock is pinned to this week's Friday, and `web-push` signs its VAPID
  JWT from that pinned clock, so run on a Saturday the JWT had expired
  eleven hours before the request was made and every send came back
  `failed` — a failure with nothing to do with the digest. That is the
  caveat `invoke-scheduled.mjs` documents and this section did not
  respect. The digest's own decisions (weekday gate, hour gate, which
  children have a week worth summarising, idempotency, the recorded
  rows) are now asserted on **any** day; the push leg runs when a valid
  JWT can exist for that Friday and is otherwise taken out of play
  explicitly, with a line in the output saying so. The identical
  `dispatch` path is exercised against the real push service by the
  murajaah and homework reminders in the same run.

**One thing this could not check.** Netlify's own types describe a
deployed scheduled function as "Not reachable via HTTP". That is
unverified here and is *not* being recorded as verified: deploy previews
on this project are password-protected and 401 every path including
`health`, so there is no deployed environment available to curl. The
local answer is the opposite — they are ordinary endpoints — which is
why the jobs are built to be safe with no platform boundary at all.
Someone with production access should confirm which behaviour the live
site has.

One more thing it learned, worth knowing before trusting its output: a
`requestfailed` event is **not** the same as a failed request. The
TopNav bell fetches its unread count on every route change, and a
navigation while that is in flight produces `net::ERR_ABORTED` — normal
browser behaviour, and initially reported here as a failure on every
family's browser. The harness now separates the two and only fails on
the rest, which is what keeps the check useful for what it exists to
find: a 4xx the UI swallows.

Two things that harness learned the hard way, both written into the README:
Playwright's default headless shell has no push implementation at all
(`Notification.permission` is permanently `denied`), so it must launch
with `channel: 'chromium'`; and FCM throttles repeated registrations from
one host, after which `pushManager.subscribe()` stops settling rather than
rejecting — which is what prompted bounding that wait in the app. Part 2b
added a third: that bound must be set against FCM's real latency, not a
guess. At 30s it was rejecting subscriptions FCM went on to serve — one
was measured taking **32 seconds** — so a family on a slow day was shown
"the push service is not responding" for something that worked. It is
60s now, and the harness waits longer than the app does.

## 7. i18n completeness (automated)

- [x] CI script asserts `id.json` and `nl.json` have identical key sets (`tests/unit/i18n-parity.test.ts`)
- [x] No hardcoded UI strings: `tests/unit/i18nHardcodedStrings.test.ts` parses every `src/**/*.tsx`/`.ts` file (via `@babel/parser`, `src/dev/**` exempt as a local-only, deliberately unlocalized fixture switcher) and flags any JSX text or string literal that exactly matches a translated leaf value from either locale file — the case where a string was pasted in place of `t(...)`. Matching against real locale content rather than a keyword list means it needs no maintenance as strings are added or changed
- [x] Pseudo-locale render test: `e2e/pseudo-locale.spec.ts` builds a synthetic locale — for every key, whichever of the two real shipped translations is longer, padded ~35% further — and asserts no clipping (`scrollWidth`/`scrollHeight` vs `clientWidth`/`clientHeight`) and no shrinkage below the 44px tap-target minimum, at 390px viewport width. **Scoped to the sign-in screen only**, the one screen reachable without a mocked Supabase session — the same limitation `e2e/sign-in.spec.ts` documents. Extending this to the family/tutor/admin screens waits on the same fixture-auth wiring the rest of the E2E-01…E2E-14 suite needs

## 8. Compliance verification (pre-launch gate)

- [ ] Right-to-erasure: deleting a fixture student cascades to all 9 related tables (incl. `year_end_reports`) — verified by row counts before/after
- [ ] Right-to-erasure also removes the student's PDF object(s) from the `reports` Storage bucket, not just the DB row. **Procedure (README → "Right to erasure"): delete the Storage object *first*, while `year_end_reports.pdf_path` can still be read, then delete the student** — `on delete cascade` reaches every table but never Storage, so doing it in the other order orphans the PDF with nothing left pointing at it. Verify with `select count(*) from storage.objects where bucket_id='reports' and name like '<student-uuid>/%'` → 0
- [ ] CSV export contains all and only the requesting parent's children's data
- [ ] Privacy policy link blocks first login until accepted
- [ ] Retention job dry-run: correctly identifies (does not yet delete) records past cutoff

## 9. Entry / exit criteria

**MVP (Milestone 1) exit:** RLS suite 100% green · E2E-01, E2E-03, E2E-07, E2E-08 green · notification matrix passed on ≥1 Android + 1 iOS device · compliance gate §8 items 1–3 done.

**GA (Milestone 5) exit:** full E2E suite green · full device matrix · §8 complete incl. retention dry-run · DPIA signed off by PPME IT team.

**Year-End Reports (Milestone 6) exit:** RLS-15 through RLS-21 green · E2E-09 and E2E-10 green · §4.4 unit tests green · PDF Storage erasure step (§8) verified · at least one real tutor has produced and published one report as a dry run before the actual academic year-end rollout.
