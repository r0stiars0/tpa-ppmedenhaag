# GitHub + Supabase + Netlify Setup Guide — TPA PPME Den Haag

*Recommended approach: **bootstrap now, transfer ownership later.** Create the organization/team container on each platform now — named for PPME (e.g. `ppme-denhaag`), not personal — with you as sole owner today. This unblocks development immediately instead of waiting on PPME IT's availability. Before real student data enters the system, invite PPME IT as owners on each platform and remove yourself — because everything already lives inside a PPME-named container rather than a personal account, this is a role change, not a project migration: no downtime, no re-doing environment variables or DNS. Get an informal nod from PPME leadership that this bootstrap arrangement is the plan, for the DPIA record (PPME IT remains the operational GDPR owner throughout).*

Each step below shows the manual (dashboard) path, plus a **💡 Efficient commands** block where that step can be scripted instead. **Org/team creation itself is web-UI-only on all three platforms** — that's a genuine platform limitation (billing/verification requirements), not a gap in this guide — but almost everything after that point is scriptable, which matters since you'll likely repeat variations of this for staging environments or future projects.

---

## Part 1 — Create the GitHub account & repository

### 1.1 Account/organization

1. Go to **github.com** → **Sign up** (or sign in with your existing account).
2. Create a **GitHub Organization**: **+** icon → **New organization** → **Free** plan → name it `ppme-denhaag`, not anything personal → you're sole **Owner** for now.
3. Later (Part 9): invite PPME IT as Owners and remove yourself.

> Organization creation has no CLI/API equivalent on GitHub — it's tied to account verification and billing setup, so this one step has to happen in the browser.

### 1.2 Create the repository

💡 **Efficient commands** (replaces manual "New repository" clicks entirely):
```bash
# Install GitHub CLI first if you don't have it: https://cli.github.com
gh auth login

gh repo create ppme-denhaag/tpa-ppme-denhaag \
  --private \
  --gitignore Node \
  --description "TPA PPME Den Haag — progress tracking PWA" \
  --clone

cd tpa-ppme-denhaag
```
This creates the repo, adds a Node `.gitignore`, and clones it locally in one command — no need to add a license (private repos don't need one).

### 1.3 Repository structure

💡 **Efficient commands:**
```bash
mkdir -p src netlify/functions supabase/migrations public/locales docs
touch .env.example
git add -A && git commit -m "Initial repo structure" && git push
```

Lay it out to match what's already been designed:

```
tpa-ppme-denhaag/
├── src/                    # React/Vite app source
├── netlify/functions/      # The 8 Netlify Functions from the TAD/OpenAPI spec
├── supabase/
│   └── migrations/         # 001_enums.sql → 005_year_end_reports.sql
├── public/
│   └── locales/
│       ├── id.json
│       └── nl.json
├── docs/                   # PRD.md, TAD.md, openapi.yaml, test-plan.md,
│                            # privacy-policy-draft.md, dpia-draft.md
├── .env.example
├── .gitignore
└── README.md
```

Copy the migration files, i18n locale files, `openapi.yaml`, and the docs already prepared into their folders, then commit — that gives the repo a working starting point instead of an empty shell:
```bash
# from wherever you downloaded the prepared deliverables
cp path/to/migrations/*.sql supabase/migrations/
cp path/to/i18n/id.json path/to/i18n/nl.json public/locales/
cp path/to/openapi.yaml path/to/*.md docs/
git add -A && git commit -m "Add prepared migrations, i18n, and docs" && git push
```

### 1.4 Access & branch protection

💡 **Efficient commands:**
```bash
# Add a collaborator with write access (not org-level admin)
gh api repos/ppme-denhaag/tpa-ppme-denhaag/collaborators/GITHUB_USERNAME \
  --method PUT -f permission=push

# Branch protection on main — write the rules to a file first, it's more
# reliable than trying to pass nested JSON as inline flags
cat > /tmp/branch-protection.json << 'EOF'
{
  "required_status_checks": null,
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null
}
EOF

gh api repos/ppme-denhaag/tpa-ppme-denhaag/branches/main/protection \
  --method PUT --input /tmp/branch-protection.json

# Enable Dependabot alerts + automated security PRs
gh api repos/ppme-denhaag/tpa-ppme-denhaag/vulnerability-alerts --method PUT
gh api repos/ppme-denhaag/tpa-ppme-denhaag/automated-security-fixes --method PUT

mkdir -p .github
cat > .github/dependabot.yml << 'EOF'
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
EOF
git add .github/dependabot.yml && git commit -m "Add Dependabot config" && git push
```
(`required_approving_review_count: 0` keeps this workable solo — raise it once a second developer is reviewing PRs.)

---

## Part 2 — Create the Supabase account & project

💡 **Efficient commands** (replaces steps 1–4 of the manual dashboard flow entirely):
```bash
npm install -g supabase
supabase login

# Interactive — prompts for an organization name; enter "PPME Den Haag"
supabase orgs create

# Note the org id this prints (or run `supabase orgs list` to see it again)
supabase orgs list

# Generate a strong DB password and save it immediately — save this
# output to a password manager, it is not retrievable later
DB_PASSWORD=$(openssl rand -base64 24)
echo "SAVE THIS PASSWORD NOW: $DB_PASSWORD"

supabase projects create tpa-ppme-denhaag \
  --org-id <org-id-from-above> \
  --region eu-central-1 \
  --db-password "$DB_PASSWORD"

# Note the project ref this prints (or run `supabase projects list`)
supabase projects list

# Get the API keys
supabase projects api-keys --project-ref <project-ref>
```

`--region eu-central-1` is the confirmed decision (Frankfurt, GDPR data residency, TAD ADR) — don't substitute a different value here.

The manual dashboard path if you'd rather click through:
1. **supabase.com** → **Start your project** → sign up.
2. Create an **Organization** if prompted (name it "PPME Den Haag").
3. **New project** → name `tpa-ppme-denhaag` → generate/save DB password → **Region: Frankfurt (eu-central-1)** → **Create new project**.
4. **Settings → API** → note the **Project URL**, **anon/public key**, and **service_role/secret key** (⚠️ the service_role key bypasses RLS — never expose it client-side or commit it to the repo).

## Part 3 — Run the project's migrations

💡 **Efficient commands:**
```bash
supabase link --project-ref <project-ref>
supabase db push
supabase migration list --linked   # verify all 5 files show as applied
```

If you'd rather not use the CLI yet, paste each migration file's contents into the dashboard's **SQL Editor** and run them in order (001 → 005).

Verify: **Table Editor** should show all 13 tables, **Database → Policies** should show the RLS policies from migrations 003 and 005, and **Storage** should show the private `reports` bucket (created by migration 005's SQL — no separate manual step needed).

## Part 4 — Create the Netlify site

1. **netlify.com** → sign up/log in.
2. Create a **Team** (Netlify's org-equivalent) named for PPME — same bootstrap pattern as Parts 1–2. **Team creation is web-UI only**, same platform-limitation reason as GitHub.

💡 **Efficient commands** (once the Team exists, this replaces the rest of the manual flow):
```bash
npm install -g netlify-cli
netlify login

# Interactive: choose "Create & configure a new site", select the PPME
# team, connect to GitHub, select ppme-denhaag/tpa-ppme-denhaag, confirm
# build command/publish directory (e.g. `npm run build` / `dist` for Vite)
netlify init
```
`netlify init` handles the GitHub authorization, repo selection, and initial deploy configuration in one interactive flow — it's the single most time-saving command in this whole guide.

## Part 5 — Connect Netlify to Supabase

Use both options — the extension only covers the public/client-side keys.

### Option A — Netlify's official Supabase extension (web-UI only)

No CLI equivalent — it's an OAuth authorization flow by nature:
1. Netlify **Extensions** page → search **Supabase** → **Install**.
2. Site → **Project configuration → General → Supabase** → **Connect** → authorize.
3. Select the Supabase project from Part 2. This auto-creates the client-side env vars.

### Option B — Manually add the server-side secret (required regardless of Option A)

💡 **Efficient commands:**
```bash
netlify env:set SUPABASE_URL "https://<project-ref>.supabase.co"
netlify env:set SUPABASE_SERVICE_ROLE_KEY "<secret-key-from-part-2>" --context production

npx web-push generate-vapid-keys   # prints a public/private key pair

netlify env:set VAPID_PUBLIC_KEY "<public-key>"
netlify env:set VAPID_PRIVATE_KEY "<private-key>" --context production

netlify env:list   # verify everything landed
```
Some Netlify plans support scoping a variable to Functions only (not exposed to the client build) — check `netlify env:set --help` for a `--scope` flag on your plan; if it's not available, restrict who has dashboard access instead of relying on scoping alone.

**Never** commit any of these to the repo — `.env` is already in `.gitignore` from the Node template in Part 1.2.

## Part 6 — Trigger a redeploy and verify

💡 **Efficient commands:**
```bash
netlify deploy --prod
netlify open:site                      # opens the live URL
netlify logs:function push-subscribe   # check for auth errors
```

Smoke test: sign in with Google OAuth, confirm the app reads/writes to Supabase, confirm the Function runs cleanly.

## Part 7 — Domain (once the above is working)

This stays a dashboard step — domain/DNS setup isn't reliably scriptable across Netlify CLI versions, and the actual DNS record has to go to PPME IT manually regardless:

1. Netlify: **Project configuration → Domain management → Add a domain** → `tpa.ppmedenhaag.nl`.
2. Netlify shows the exact CNAME record needed (e.g. `tpa CNAME {your-site}.netlify.app`).
3. Send that record to whoever manages `ppmedenhaag.nl`'s DNS at PPME IT.
4. Once it propagates, Netlify auto-provisions HTTPS — no separate action needed.

---

## Part 8 — Ongoing source code maintenance

### Branching & commits
- **`main`** is always deployable — Netlify's Production context builds from it.
- Work on short-lived feature branches; open a **pull request** even solo — this triggers Netlify's automatic **Preview deploy**.
- Commit messages: short imperative summary (`Add RLS policy tests for year_end_reports`).

### What never gets committed
- `.env`, the `service_role`/secret key, VAPID private key, DB password.
- If a secret is committed by accident: **rotate it immediately** — removing it in a later commit does not remove it from Git history.

### Keeping the docs in sync
- `docs/PRD.md`, `docs/TAD.md`, `docs/openapi.yaml` live in the repo so a schema change and its documentation update happen in the same PR.
- New SQL migrations get a new numbered file (`006_...sql`), never an edit to an already-applied one.

### CI (recommended once `test-plan.md`'s test suite exists)

💡 **Starter workflow** — expand this once the RLS/unit tests are written, then set it as a required status check in the branch protection rule from Part 1.4:
```bash
mkdir -p .github/workflows
cat > .github/workflows/test.yml << 'EOF'
name: Tests
on: [pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm test
EOF
git add .github/workflows/test.yml && git commit -m "Add CI test workflow" && git push
```

---

## Part 9 — Handing off ownership to PPME IT

Do this **before real student data enters the system** — synthetic fixture data during build/test doesn't need it, but go-live does.

1. **GitHub:**
   💡 `gh api orgs/ppme-denhaag/memberships/PPME_IT_USERNAME --method PUT -f role=admin`
   — or **Organization → People → Invite member → role: Owner** in the dashboard.
2. **Supabase:** dashboard only — the CLI's `orgs` command group only supports `create`/`list`, no member management. **Organization → Settings → Team** → invite PPME IT → role **Owner**.
3. **Netlify:** dashboard only, same reason. **Team settings → Members** → invite PPME IT → role **Owner**.
4. **Google Cloud:** **IAM & Admin → IAM** → add PPME IT as Project Owners — or migrate to a Workspace/Cloud project they already have by creating a new OAuth client there and updating `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` via `netlify env:set`.
5. **Confirm access before stepping back:** have someone at PPME IT actually log into each platform and verify visibility before you remove your own ownership.
6. **Update the DPIA sign-off record** (`docs/dpia-draft.md` §6) with the handoff date.
