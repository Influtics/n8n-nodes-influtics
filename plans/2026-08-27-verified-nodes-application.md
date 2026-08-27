# Apply to n8n Verified-Nodes Partner Program — TODO

**Status:** Ready to start. v1.0.5 is merged into `main` (commit `7d11310`) with a clean 5/5 `loadClassInIsolation` smoketest. Next stop: publish to npm with provenance, then submit.

**Goal:** Get `n8n-nodes-influtics` accepted into n8n's verified-nodes program so it appears under **Official** integrations in n8n Cloud and is auto-updated.

**Reference application URL:** https://n8n.io/integrations/become-a-partner/

---

## 1. Already done in v1.0.5 (PR #6, merged)

- [x] `n8ncommunity` keyword present in `package.json`
- [x] License: `MIT`, file committed (`LICENSE`)
- [x] `n8n.n8nNodesApiVersion: 1`
- [x] `package.json#main` resolves to existing `dist/index.js`
- [x] `n8n.nodes` / `n8n.credentials` use explicit file paths (no globs)
- [x] Lint clean, vitest green, `n8n-node build` produces a 5-file `dist/`
- [x] README: install, credential, full operations table, error codes, troubleshooting
- [x] CHANGELOG.md (Keep a Changelog format)
- [x] CI workflow runs `lint + test + build` on push to `main` and on PRs

---

## 2. Publish v1.0.5 with npm provenance (mandatory since 2026-05-01)

The verified-nodes reviewer checks the npm registry page for the **Provenance** badge. Provenance requires npm's OIDC token flow, which only works from a CI provider (GitHub Actions). Publishing locally with `--provenance` will fail with `npm error code EPROVENANCE`.

### 2.1 Add `repository`, `bugs`, `homepage` to `package.json`

```jsonc
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Influtics/n8n-nodes-influtics.git"
  },
  "bugs": {
    "url": "https://github.com/Influtics/n8n-nodes-influtics/issues"
  },
  "homepage": "https://github.com/Influtics/n8n-nodes-influtics#readme"
}
```

### 2.2 Create `.github/workflows/release.yml`

```yaml
name: Release
on:
  push:
    tags: ['v*']
permissions:
  contents: read
  id-token: write          # required for npm provenance
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
          cache: 'npm'
      - run: npm ci --ignore-scripts
      - run: npm run lint
      - run: npm test
      - run: npm run build
      - run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### 2.3 Configure the npm token

1. Log in to https://www.npmjs.com/ as the Influtics org owner.
2. **Access Tokens → Generate New Token → Granular → Read & Write** scoped to the `Influtics` org.
3. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `NPM_TOKEN`
   - Value: paste the token, then **Add secret**.

### 2.4 Cut the tag and publish

```bash
# from the main checkout
git checkout main
git pull
git tag -a v1.0.5 -m "v1.0.5"
git push origin v1.0.5
# GitHub Actions picks up the tag → runs the release job → npm publish --provenance
```

### 2.5 Verify provenance landed

```bash
npm view n8n-nodes-influtics@1.0.5 dist.provenance
# → { attestationUrl: 'https://registry.npmjs.org/-/npm/v1/attestations/...' }
```

If `dist.provenance` is missing, the `--provenance` flag silently no-ops on tag-only OIDC mismatches. Re-check the workflow `permissions` block and that `registry-url` is set.

---

## 3. Run the n8n security scanner

`@n8n/scan-community-package` is the official pre-submission audit. The verified-nodes reviewer runs it themselves — if it flags anything, the application stalls. Better to find it first.

### 3.1 One-shot local run

```bash
npx --yes @n8n/scan-community-package n8n-nodes-influtics@1.0.5
```

Expected: clean output. If anything fires, triage by severity:

- **Error** — must fix before submission.
- **Warning** — fix or document why it's acceptable.
- **Info** — review, usually OK.

### 3.2 Wire it into CI as a required check

Add to `.github/workflows/ci.yml`:

```yaml
      - run: npx --yes @n8n/scan-community-package .
```

(`@n8n/scan-community-package` accepts a local directory.)

---

## 4. README polish for the reviewer

The reviewer reads README before opening any files. Make it self-contained.

### 4.1 Required sections (verify present)

- [ ] **One-paragraph description** above the install steps (what does Influtics do, why this node).
- [ ] Install steps (already present).
- [ ] Credential setup (already present).
- [ ] Operations tables per node (already present — Video / Blogger / Trend / Account).
- [ ] Error code reference (already present).
- [ ] Public docs link: `https://docs.influtics.com/` (already present — **no internal docs/plan links anywhere**).
- [ ] Issues link: GitHub issues URL.
- [ ] License: `MIT`.
- [ ] Changelog: link to `CHANGELOG.md`.

### 4.2 Nice-to-have

- [ ] One screenshot per node in the workflow canvas (PNG, ≤ 1 MB).
- [ ] Short asciinema or animated GIF showing the Track → Get Job → By Username chain.
- [ ] "About Influtics" block with link to https://influtics.com.

### 4.3 Things NOT to add

- ❌ "Verified by n8n" badge **before** acceptance — it'll be removed if rejected, and it's misleading pre-approval.
- ❌ Links to internal docs, Slack channels, or any non-public URLs.
- ❌ Trademark violations in the node name / icon.

---

## 5. Submission

1. Open https://n8n.io/integrations/become-a-partner/ in the Influtics team account.
2. Fill the form with:
   - **Maintainer name:** Influtics
   - **Maintainer email:** `team@influtics.com` (matches `package.json#author.email`)
   - **GitHub repo:** https://github.com/Influtics/n8n-nodes-influtics
   - **npm package:** `n8n-nodes-influtics`
   - **Latest published version:** `1.0.5`
   - **Provenance attestation URL:** copy from `npm view ... dist.provenance`
   - **Category:** Marketing / Influencer analytics
   - **Description:** 2–3 sentences on what the node does and the API surface it covers.
   - **Screenshots:** attach or link to README assets.
3. Submit. Save the confirmation email — it contains a ticket id for follow-ups.

### 5.1 After submission

- [ ] Track the review SLA. n8n's verified-node review typically runs 2–4 weeks. If no reply at week 5, reply to the confirmation email with a polite bump.
- [ ] Be ready to:
  - Address any reported issue within 48h.
  - Re-run `npx @n8n/scan-community-package` after fixes.
  - Re-cut a patched version if needed (the reviewer expects a fresh `npm view`).

---

## 6. Post-acceptance checklist

- [ ] Add the official "Verified by n8n" badge to README (n8n provides the asset URL in the acceptance email).
- [ ] Update the package's `description` and npm keywords to reflect verified status.
- [ ] Add a CHANGELOG entry: `## [1.x.y] - <date> — Promoted to verified n8n community node`.
- [ ] Update https://influtics.com (landing) and https://docs.influtics.com/ to surface the n8n integration link.
- [ ] Pin a Slack/email reminder to renew any required partner-program annual attestation if applicable.

---

## 7. Reference commands (paste-ready)

```bash
# Local pre-flight
npx --yes @n8n/scan-community-package n8n-nodes-influtics@1.0.5
npm view n8n-nodes-influtics dist.provenance
npm view n8n-nodes-influtics versions --json | tail -20

# Publish flow (after release.yml is in place)
git tag -a v1.0.5 -m "v1.0.5"
git push origin v1.0.5

# Recreate the loadClassInIsolation smoketest after publish
node /tmp/v105-smoketest.cjs /tmp/v105-tarball
```