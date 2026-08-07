# Softmatrix OS Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the bilingual, OIDC, and governed multi-LLM release works end to end, contains no secret or license regressions, is deployable from the release manifest, and can safely absorb an upstream update.

**Architecture:** Keep unit/integration coverage close to each subsystem, then add a thin browser journey suite and repository-level release gates. The release candidate is built once, tested through the existing candidate/promote pipeline, and accepted only after automated checks, manual IdP/provider checks, documentation review, and rollback rehearsal.

**Tech Stack:** pnpm, Vitest, Node test runner, Playwright, Cloudflare Wrangler/workerd, existing release manifest/R2 candidate flow.

## Global Constraints

- M0–M5 plans must be complete before the final release candidate.
- Add Playwright only after dependency/license review; do not introduce a second browser framework.
- CI/release configuration changes require explicit review before execution.
- Tests must never use production OIDC tenants, API keys, Cloudflare accounts, or user data.
- Release artifacts must include Apache-2.0, upstream attribution, and third-party notices.
- No release if any key path has English leakage in `zh-CN`, raw translation keys, secret leakage, or silent model fallback.
- Production rollout must have a documented rollback to the previous release manifest.

---

### Task 1: Add a Single Repository Release-Readiness Command

**Files:**
- Modify: `package.json`
- Create: `scripts/softmatrix-release-readiness.test.js`
- Test: `scripts/softmatrix-release-readiness.test.js`

**Interfaces:**
- Produces: `pnpm verify:softmatrix`, a deterministic local/CI gate.
- Consumes: branding, compliance, i18n, existing tests, lint, and build commands.

- [ ] **Step 1: Write the failing readiness metadata test**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("root exposes the Softmatrix release gate", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts["verify:softmatrix"],
    "pnpm lint && pnpm test && pnpm build && pnpm licenses list --json");
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test scripts/softmatrix-release-readiness.test.js`

Expected: FAIL because the script is absent.

- [ ] **Step 3: Add the exact root script**

```json
"verify:softmatrix": "pnpm lint && pnpm test && pnpm build && pnpm licenses list --json"
```

Keep output generation outside tracked source; the release job stores license JSON as an artifact and transforms it into the distribution's third-party notice in Task 4.

- [ ] **Step 4: Run the metadata test and commit**

Run: `node --test scripts/softmatrix-release-readiness.test.js`

Expected: PASS.

```sh
git add package.json scripts/softmatrix-release-readiness.test.js
git commit -m "chore: define Softmatrix release readiness gate"
```

### Task 2: Add Browser Journeys for Both Locales

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `playwright.config.ts`
- Create: `scripts/run-e2e-server.mjs`
- Create: `e2e/helpers/softmatrix-fixtures.ts`
- Create: `e2e/bilingual-core.spec.ts`
- Create: `e2e/auth-modes.spec.ts`
- Create: `e2e/model-policy.spec.ts`

**Interfaces:**
- Produces: `pnpm test:e2e` and isolated browser fixtures with fake OIDC/model services.
- Consumes: `pnpm run-local`, dev-only test bindings, phase-one UI.

- [ ] **Step 1: Obtain dependency approval and add Playwright**

Run after approval: `pnpm add -D @playwright/test && pnpm exec playwright install chromium`

Expected: root package metadata/lockfile change and Chromium installed outside tracked source.

- [ ] **Step 2: Configure one worker and deterministic local server**

```ts
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:8787", trace: "retain-on-failure" },
  webServer: {
    command: "node scripts/run-e2e-server.mjs",
    url: "http://127.0.0.1:8787",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
```

`scripts/run-e2e-server.mjs` creates a state directory with `mkdtempSync(join(tmpdir(), "softmatrix-e2e-"))`, spawns `pnpm run-local -- --persist-to=<exact directory>`, and installs `SIGINT`/`SIGTERM` handlers. Cleanup resolves the real path, verifies its basename starts with `softmatrix-e2e-`, and removes only that generated directory after the child exits. Add `test:e2e: playwright test` to root scripts. Fixtures must create disposable users and never touch the normal `.wrangler` directory.

- [ ] **Step 3: Write the bilingual happy-path test**

```ts
for (const locale of ["en", "zh-CN"] as const) {
  test(`core Agent journey in ${locale}`, async ({ page }) => {
    await selectLocale(page, locale);
    await signInWithFixtureUser(page);
    await createWorkspace(page, locale === "zh-CN" ? "季度计划" : "Quarterly plan");
    await selectModel(page, "Fixture Model");
    await page.getByRole("textbox").fill(locale === "zh-CN" ? "回复：你好" : "Reply: hello");
    await page.getByRole("button", { name: locale === "zh-CN" ? "发送" : "Send" }).click();
    await expect(page.getByText(locale === "zh-CN" ? "你好" : "hello")).toBeVisible();
  });
}
```

- [ ] **Step 4: Add auth and model policy journeys**

```ts
test("enforces external auth and model policy without leaking fixture secrets", async ({ page }) => {
  const responseBodies: string[] = [];
  page.on("response", async (response) => {
    if (response.url().startsWith(baseURL)) responseBodies.push(await response.text().catch(() => ""));
  });
  await configureFixture({ passwordAuth: false, oidc: true, allowUserByok: false });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Company SSO/ })).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveCount(0);
  await signInWithFixtureOidc(page);
  await expect(page.getByText("Organization")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add provider" })).toHaveCount(0);
  expect(responseBodies.join("\n")).not.toContain("fixture-oidc-secret");
  expect(responseBodies.join("\n")).not.toContain("fixture-model-secret");
});
```

Add separate tests for OIDC cancel/domain rejection, BYOK allowed credential failure, and explicit manual model switch.

- [ ] **Step 5: Run E2E and commit**

Run: `pnpm test:e2e`

Expected: all Chromium journeys pass in both locales.

```sh
git add package.json pnpm-lock.yaml playwright.config.ts e2e
git commit -m "test: cover bilingual auth and model journeys"
```

### Task 3: Add Security Regression and Secret-Leak Gates

**Files:**
- Create: `scripts/secret-surface.test.js`
- Modify: `packages/workshop-backend/__tests__/oidc-protocol.test.ts`
- Modify: `packages/workshop-backend/__tests__/oidc-login.test.ts`
- Modify: `packages/workshop-backend/__tests__/model-credentials.test.ts`
- Modify: `packages/workshop-backend/__tests__/client-errors.test.ts`

**Interfaces:**
- Produces: deterministic negative tests for protocol attacks and secret-bearing response/log surfaces.

- [ ] **Step 1: Add a repository artifact scan**

```js
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

async function listFiles(roots) {
  const files = [];
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  for (const root of roots) await walk(root);
  return files;
}

test("built frontend and release manifests contain no fixture secrets", async () => {
  const forbidden = ["oidc-client-secret-fixture", "org-model-secret-fixture", "byok-secret-fixture"];
  for (const file of await listFiles(["packages/workshop-frontend/dist", "release-out"])) {
    const text = await readFile(file, "utf8").catch(() => "");
    for (const secret of forbidden) assert.equal(text.includes(secret), false, `${secret} in ${file}`);
  }
});
```

- [ ] **Step 2: Expand protocol attack cases**

Add separate tests for forged signature, wrong issuer, wrong/multiple audience, expired/not-yet-valid token, missing/false `email_verified`, nonce mismatch, state mismatch, authorization-code replay, expired attempt, duplicate callback parameters, open redirect input, and discovery/JWKS outage with expired cache.

- [ ] **Step 3: Expand model leak/error cases**

Inject unique fixture secrets into organization and BYOK configs. Capture structured logs, RPC results, client error payloads, analytics records, serialized errors, and catalog results. Assert fixture secrets and prompt/response bodies are absent; assert stable error code and correlation ID are present.

- [ ] **Step 4: Run focused security tests and commit**

Run: `node --test scripts/secret-surface.test.js && pnpm --filter @gadgets/workshop-backend test -- oidc-protocol.test.ts oidc-login.test.ts model-credentials.test.ts client-errors.test.ts`

Expected: PASS.

```sh
git add scripts/secret-surface.test.js packages/workshop-backend/__tests__
git commit -m "test: guard identity and model secret surfaces"
```

### Task 4: Produce Bilingual Documentation and Complete Release Compliance Artifacts

**Files:**
- Create: `docs/softmatrix/deployment.en.md`
- Create: `docs/softmatrix/deployment.zh-CN.md`
- Create: `docs/softmatrix/operations.en.md`
- Create: `docs/softmatrix/operations.zh-CN.md`
- Create: `docs/softmatrix/upgrade.en.md`
- Create: `docs/softmatrix/upgrade.zh-CN.md`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `scripts/release/legal-artifacts.mjs`
- Create: `scripts/release-legal-artifacts.test.js`
- Modify: `README.md`
- Modify: `scripts/release/build-release.mjs`
- Modify: `scripts/release/upload-release.mjs`
- Modify: `scripts/release/promote-release.mjs`

**Interfaces:**
- Produces: mirrored English/Chinese install, SSO, model, operation, rollback, and upstream-sync
  runbooks, plus immutable release artifacts that always carry `LICENSE`, `NOTICE`, and
  `THIRD_PARTY_NOTICES.md`.

- [ ] **Step 1: Generate and review the dependency license inventory**

Run: `pnpm licenses list --json`

Expected: valid JSON inventory. Capture it as a CI artifact through the CI runner's artifact mechanism rather than shell redirection. Review any `UNKNOWN`, copyleft, custom, or missing license before proceeding; do not copy raw command output into the repository without normalization.

- [ ] **Step 2: Create the third-party notice**

List production dependency name, installed version, license identifier, copyright/notice text when required, and source URL. Retain upstream NOTICE entries. Do not claim that all dependencies are Apache-2.0.

- [ ] **Step 3: Add legal files to build, upload, and promotion atomically**

Extract legal-artifact hashing and validation into `scripts/release/legal-artifacts.mjs`.
`build-release.mjs` must copy the exact root `LICENSE`, `NOTICE`, and
`THIRD_PARTY_NOTICES.md` into `release-out/legal/` and write `legal-manifest.json` with each
filename, SHA-256, and byte size. A missing or empty file is a hard build failure.

`upload-release.mjs` must upload the legal files and `legal-manifest.json` under the candidate or
release ID before uploading `manifest.json`. `promote-release.mjs` must validate the candidate legal
manifest, copy all three legal files plus the legal manifest to the published release prefix, and
only then copy the release `manifest.json`. This preserves the existing manifest-last visibility
contract and ensures rollback to any release ID also restores its matching legal material. Do not
add unknown fields to the deploy-service manifest schema; keep compliance metadata in the validated
sidecar.

- [ ] **Step 4: Test legal artifact completeness and publication order**

Add `scripts/release-legal-artifacts.test.js` with temporary fixtures that prove: all three exact
filenames are required; hashes and sizes detect tampering; direct and candidate uploads publish
legal objects before `manifest.json`; promotion refuses an incomplete candidate and publishes its
legal objects before the release manifest. Refactor upload entry points to be importable with mocked
fetch/storage while keeping their CLI behavior unchanged.

Run: `node --test scripts/release-legal-artifacts.test.js`

Expected: PASS, including the ordering and missing-file cases.

- [ ] **Step 5: Write paired documentation with identical heading IDs**

Each language must include prerequisites, install, environment/Secrets table, Cloudflare Access, OIDC, model catalog/BYOK, backup, monitoring, secret rotation, common failures, upgrade, rollback, and support boundaries. Commands must be executable and identical between language versions.

- [ ] **Step 6: Add a documentation parity test to the existing compliance test**

Parse Markdown headings and assert English/Chinese files have the same ordered heading anchors. Assert every documented environment variable occurs in `env.d.ts` or release manifest code.

- [ ] **Step 7: Run compliance and release-artifact tests, then commit**

Run: `node --test scripts/softmatrix-compliance.test.js scripts/release-legal-artifacts.test.js`

Expected: PASS.

```sh
git add README.md THIRD_PARTY_NOTICES.md docs/softmatrix scripts/softmatrix-compliance.test.js \
  scripts/release scripts/release-legal-artifacts.test.js
git commit -m "docs: add bilingual Softmatrix operations guides"
```

### Task 5: Rehearse Upstream Synchronization and Migration Safety

**Files:**
- Modify: `docs/upstream-sync.md`
- Create: `docs/softmatrix/upstream-sync-report.md`
- Modify: tests only if a real upstream conflict reveals a missing contract.

**Interfaces:**
- Produces: repeatable evidence that the fork can merge the latest upstream without losing Softmatrix boundaries.

- [ ] **Step 1: Create a disposable worktree from the release branch**

Run:

```sh
git fetch upstream --prune --tags
git worktree add /tmp/softmatrix-upstream-rehearsal -b chore/upstream-rehearsal HEAD
```

Expected: isolated worktree with no changes to the release branch.

- [ ] **Step 2: Merge the current upstream main in the rehearsal worktree**

Run in the rehearsal worktree: `git merge --no-commit --no-ff upstream/main`

Expected: conflicts, if any, are limited to documented hotspots. Record each conflict and resolution rule; do not merge the rehearsal branch into the release solely to satisfy this task.

- [ ] **Step 3: Verify invariants after resolving rehearsal conflicts**

Run: `pnpm install --frozen-lockfile && pnpm verify:softmatrix && pnpm test:e2e`

Expected: all commands exit 0; OIDC migration tags remain monotonic; model and locale storage remain backward compatible.

- [ ] **Step 4: Record and discard only the disposable rehearsal worktree**

Write upstream SHA, conflicts, resolutions, test output, and follow-up actions to `docs/softmatrix/upstream-sync-report.md`. Then remove the explicit temporary worktree with `git worktree remove /tmp/softmatrix-upstream-rehearsal`; do not delete the main workspace or user data.

- [ ] **Step 5: Commit the report**

```sh
git add docs/upstream-sync.md docs/softmatrix/upstream-sync-report.md
git commit -m "docs: record upstream synchronization rehearsal"
```

### Task 6: Build, Verify, Promote, and Roll Back a Release Candidate

**Files:**
- Modify: release documentation only when rehearsal finds an inaccurate command.
- Runtime artifact: `release-out/` (gitignored and not committed).

**Interfaces:**
- Consumes: the compliance-aware `build-release.mjs`, `upload-release.mjs`, and
  `promote-release.mjs` pipeline from Task 4.
- Produces: verified candidate manifest, matching legal sidecar and files, and recorded rollback point.

- [ ] **Step 1: Run the complete local gate**

Run: `pnpm verify:softmatrix && pnpm test:e2e`

Expected: all commands exit 0 from a clean checkout.

- [ ] **Step 2: Build the immutable release candidate**

Run: `node scripts/release/build-release.mjs --out release-out --release-id softmatrix-v1-rc1`

Expected: release manifest, content-addressed worker/frontend artifacts, `legal-manifest.json`, and
`legal/LICENSE`, `legal/NOTICE`, and `legal/THIRD_PARTY_NOTICES.md`; `git status --short` remains clean
except ignored output. Verify the three legal-file hashes against `legal-manifest.json` before upload.

- [ ] **Step 3: Scan artifacts and upload as candidate only**

Run: `node --test scripts/secret-surface.test.js scripts/release-legal-artifacts.test.js`

Expected: PASS. With approved test R2 credentials, run `node scripts/release/upload-release.mjs --release release-out --candidate`.

Expected: candidate legal objects and both manifests are stored under
`candidates/softmatrix-v1-rc1/`, with `manifest.json` written last; no production release pointer
changes.

- [ ] **Step 4: Run acceptance against an isolated staging deployment**

Verify English/Chinese core journey, password/OAuth/Access/OIDC modes, JIT/domain policy, organization/BYOK models, disabled-policy enforcement, Gatekeeper approval, logging redaction, and deployment restart. Obtain QA and security sign-off.

- [ ] **Step 5: Record rollback and promote**

Record the currently promoted release ID. Run `node scripts/release/promote-release.mjs --release-id softmatrix-v1-rc1` only after sign-off. Verify production smoke checks. Roll back by promoting the recorded previous manifest if any stop condition occurs.

- [ ] **Step 6: Commit only documentation corrections**

```sh
git status --short
git add docs
git commit -m "docs: finalize Softmatrix release procedure"
```

Expected: no `release-out/`, credentials, local state, traces, or screenshots are staged.
