# Softmatrix OS VM Self-Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Softmatrix OS on one user-owned VM using standalone `workerd`, native Worker bindings, local persistence, and a reversible release workflow without Cloudflare production services.

**Architecture:** Keep the existing Worker, Durable Object, Cap'n Web RPC, Gatekeeper, Dynamic Worker, and native workerd storage model. Add a VM production profile, local immutable release/rollback tooling, secret injection, backup/restore, and a VM acceptance harness. Do not add KV/R2 adapters or rewrite the backend unless the standalone smoke harness proves a native binding cannot be persisted or restored.

**Tech Stack:** standalone `workerd`, Wrangler build output, Node.js 22+, pnpm 11, TypeScript, SQLite Durable Object storage, local filesystem object storage, systemd or Docker Compose, Caddy/Nginx, Playwright, Node test runner.

## Global Constraints

- Production must not require a Cloudflare account, Workers, KV, R2, Cloudflare Access, or AI Gateway.
- The first release targets one VM and explicitly does not provide multi-node high availability.
- `pnpm run-local` remains a development/test command; production starts standalone `workerd` with an explicit persistent data directory.
- Preserve existing Durable Object migration order `v0` through `v3` and do not rewrite user data formats.
- Keep native workerd bindings as the source of truth; introduce a storage adapter only after a failing runtime compatibility test proves it is necessary.
- OIDC client secrets and model credentials remain outside release artifacts, manifests, logs, RPC responses, and frontend assets.
- VM production does not use Cloudflare Access or Cloudflare AI Gateway; use generic OIDC and direct/self-hosted model endpoints.
- Release artifacts include Apache-2.0 `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`, checksums, and the exact source commit.
- Every task ends with a focused test and an atomic commit; do not stage `.superpowers/` reports.

## Current execution status (2026-08-10)

Tasks 1–7 are implemented in the feature branch and covered by focused tests plus the Ubuntu
`VM Smoke` workflow. The clean-checkout release builder now generates ignored `build:app`,
`build:configurator`, and `build:format-blueprints` inputs before Wrangler collection. The latest
feature head is `9648723`; Build/Test, Lint, Chromium browser E2E, the VM network contract, public
endpoint probe, and the eight-test two-language Ubuntu VM journey pass in GitHub Actions.
The VM harness now includes a native local OIDC provider with RS256 signing, JWKS discovery, and
PKCE validation; each fixture authorization provisions an isolated identity so the bilingual
onboarding assertions are independent. It also exercises IdP cancellation and exact email-domain
denial, with localized browser-visible error mappings.

Task 8 remains intentionally open. CI now proves the local OIDC success path, but a real operator
VM still must provide the chosen production IdP's success/cancel/domain-policy evidence,
TLS/WebSocket proxy evidence, reboot persistence, log-redaction review, backup checksum and
isolated restore, release rollback, and release-owner/security sign-off. CI evidence and local
macOS rehearsal data do not satisfy those production acceptance items.

The repository now includes `pnpm init:vm:evidence` and `pnpm collect:vm:evidence`. The initializer
seeds an explicitly `NO-GO` report from immutable release and host facts without inventing production
evidence; the collector can add only directly observed HTTPS/WSS, loopback, and runtime facts and
still keeps the report `NO-GO`. The recorded release-artifact milestone is covered by [CI run 31388086502](https://github.com/yonglun/softmatrix-os/actions/runs/31388086502)
and [VM Smoke run 31388086580](https://github.com/yonglun/softmatrix-os/actions/runs/31388086580).
The current evidence-collector head `bbf2966` is additionally covered by [CI run 31394159764](https://github.com/yonglun/softmatrix-os/actions/runs/31394159764)
and [VM Smoke run 31394159436](https://github.com/yonglun/softmatrix-os/actions/runs/31394159436).

---

## File and Boundary Map

| Boundary | Files | Responsibility |
|---|---|---|
| VM profile | `deploy/vm/workerd.capnp`, `deploy/vm/softmatrix.env.example`, `deploy/vm/softmatrix.service` | Standalone runtime, persistent paths, process lifecycle, non-secret config template |
| VM config | `scripts/vm/vm-config.mjs`, `scripts/vm/vm-config.test.js` | Validate paths, required settings, profiles, and secret references before startup |
| Build | `scripts/vm/build-release.mjs`, `scripts/vm/build-release.test.js` | Produce immutable VM release directory from an exact commit |
| Install/rollback | `scripts/vm/install-release.mjs`, `scripts/vm/healthcheck.mjs`, `scripts/vm/install-release.test.js` | Atomic `current`/`previous` switch, readiness checks, rollback |
| Data safety | `scripts/vm/backup-data.mjs`, `scripts/vm/restore-data.mjs`, `scripts/vm/vm-data.test.js` | Snapshot, checksum, isolated restore, and validation |
| Acceptance | `scripts/run-vm-e2e.mjs`, `e2e/vm-self-hosting.spec.ts`, `scripts/vm/operator-probe.mjs`, `scripts/vm/release-evidence*.mjs`, `scripts/vm/log-redaction-audit.mjs` | VM runtime, restart persistence, bilingual, OIDC, model, Gatekeeper journeys, public HTTP/WebSocket probe, host-fact collection, log-redaction audit, and evidence completeness |
| Documentation | `docs/softmatrix/vm-deployment.en.md`, `docs/softmatrix/vm-deployment.zh-CN.md`, `docs/softmatrix/vm-operations.en.md`, `docs/softmatrix/vm-operations.zh-CN.md` | Installation, configuration, backup, monitoring, upgrade, rollback, support boundaries |
| Root commands | `package.json` | Stable `build:vm`, `install:vm`, `healthcheck:vm`, `backup:vm`, `restore:vm`, `test:e2e:vm` entry points |

## Task 1: Prove the Native Standalone Runtime Contract

**Files:**
- Create: `scripts/vm/workerd-smoke.mjs`
- Create: `scripts/vm/workerd-smoke.test.js`
- Create: `deploy/vm/fixtures/minimal-workerd.capnp`
- Modify: `package.json`

**Interfaces:**
- Produces `runWorkerdSmoke({ configPath, dataDir, port }) -> Promise<{ status, body, persisted }>`.
- Consumes the checked-in Worker bundle and native workerd bindings.

- [ ] **Step 1: Write the failing persistence test**

```js
test("standalone workerd keeps native durable state across restart", async () => {
  const result = await runWorkerdSmoke({
    configPath: fixtureConfig,
    dataDir: tempDataDir,
    port: 8788,
  });
  assert.equal(result.status, 200);
  assert.equal(result.persisted, true);
});
```

- [ ] **Step 2: Run the test and confirm the missing harness failure**

Run: `node --test scripts/vm/workerd-smoke.test.js`

Expected: FAIL because `scripts/vm/workerd-smoke.mjs` and the standalone fixture do not exist.

- [ ] **Step 3: Implement the minimal smoke runner**

The runner must spawn `workerd serve <configPath>`, set `SOFTMATRIX_DATA_DIR` to the exact
temporary directory, wait for an HTTP 200 readiness response, write one durable value, stop the
process, start it again against the same directory, and assert that the value is still present.
It must reject a data path whose basename is not generated by the test and must kill the child on
SIGINT/SIGTERM.

- [ ] **Step 4: Run the smoke test and type/lint checks**

Run: `node --test scripts/vm/workerd-smoke.test.js && pnpm lint`

Expected: PASS with no production Cloudflare credentials required.

- [ ] **Step 5: Commit**

```sh
git add scripts/vm/workerd-smoke.mjs scripts/vm/workerd-smoke.test.js \
  deploy/vm/fixtures/minimal-workerd.capnp package.json
git commit -m "test: prove standalone workerd persistence contract"
```

## Task 2: Add the VM Runtime Profile and Secret Contract

**Files:**
- Create: `deploy/vm/workerd.capnp`
- Create: `deploy/vm/softmatrix.env.example`
- Create: `deploy/vm/softmatrix.service`
- Create: `scripts/vm/vm-config.mjs`
- Create: `scripts/vm/vm-config.test.js`
- Modify: `package.json`

**Interfaces:**
- `loadVmConfig(env) -> { publicBaseUrl, dataDir, objectStoreDir, oidc, models, admins }`.
- `validateVmConfig(config) -> void`, throwing stable codes `VM_CONFIG_INVALID`, `VM_SECRET_MISSING`, or `VM_PATH_UNWRITABLE`.
- The profile keeps native Worker/KV/R2/DO binding semantics and does not emit `$ACCOUNT_ID`, `$KV_*`, `$R2_*`, `$WORKERS_AI`, or R2 deployment placeholders.

- [ ] **Step 1: Write configuration boundary tests**

Cover: missing `PUBLIC_BASE_URL`, invalid HTTPS URL, missing OIDC secret when OIDC is enabled,
invalid `ORG_AI_MODELS` JSON, writable data/object directories, `DISABLE_PASSWORD_AUTH=true`
without OIDC, and absence of Cloudflare production bindings in the VM profile.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `node --test scripts/vm/vm-config.test.js`

Expected: FAIL because the loader, validator, and VM profile do not exist.

- [ ] **Step 3: Implement the loader and standalone profile**

The loader must parse only documented environment variables, normalize booleans and JSON once,
and return a redacted diagnostic object. The `workerd.capnp` profile must bind the router,
backend, Gatekeepers, loader, native Durable Object SQLite storage, frontend assets, and the
explicit persistent directories. The systemd unit must run as a non-root service user, restart on
failure, and read secrets from a protected environment file or systemd credential.

- [ ] **Step 4: Run tests and inspect the rendered profile**

Run: `node --test scripts/vm/vm-config.test.js && node scripts/vm/vm-config.mjs --check deploy/vm/workerd.capnp`

Expected: PASS; diagnostics contain names and status only, never secret values.

- [ ] **Step 5: Commit**

```sh
git add deploy/vm scripts/vm/vm-config.mjs scripts/vm/vm-config.test.js package.json
git commit -m "feat: add single-vm workerd production profile"
```

## Task 3: Build an Immutable VM Release

**Files:**
- Create: `scripts/vm/build-release.mjs`
- Create: `scripts/vm/build-release.test.js`
- Modify: `package.json`
- Reuse: `scripts/release/legal-artifacts.mjs`, `scripts/release/hash-lib.mjs`, existing Worker build commands

**Interfaces:**
- `buildVmRelease({ outDir, releaseId, commit }) -> { manifest, runtimeConfig, workers, assets, legalManifest }`, where `manifest` contains `releaseId` and `commit`.
- Output contains no Cloudflare R2 upload instructions or account-specific placeholders.

- [ ] **Step 1: Write manifest and legal-artifact tests**

```js
test("VM release records commit, worker hashes, legal files, and runtime config", async () => {
  const release = await buildVmRelease({ outDir, releaseId: "softmatrix-vm-test", commit: "fixture" });
  assert.equal(release.manifest.releaseId, "softmatrix-vm-test");
  assert.equal(release.manifest.commit, "fixture");
  assert.deepEqual(release.legalManifest.files.map(file => file.filename), [
    "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md",
  ]);
  assert.equal(JSON.stringify(release.manifest).includes("$R2_"), false);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test scripts/vm/build-release.test.js`

Expected: FAIL because the VM builder does not exist.

- [ ] **Step 3: Implement the builder**

Build frontend and every deployable Worker with the pinned Wrangler toolchain, copy the exact
legal files, write `manifest.json`, `legal-manifest.json`, `runtime/workerd.capnp`, and a SHA-256
index. Reject a dirty source tree unless `--allow-dirty` is explicitly supplied for local tests.
The VM manifest stores local module paths and hashes, not `$KV_*`, `$R2_*`, `$SECRET(...)`, or
Cloudflare account identifiers.

- [ ] **Step 4: Add the root command and verify artifact scans**

Add `build:vm: node scripts/vm/build-release.mjs --out release-out` to `package.json` and run:

```sh
node scripts/vm/build-release.mjs --out release-out --release-id softmatrix-vm-test
node --test scripts/vm/build-release.test.js scripts/secret-surface.test.js \
  scripts/release-legal-artifacts.test.js
```

Expected: PASS; `release-out` contains legal files, runtime config, hashes, workers, and frontend
assets, with no fixture or production secret.

- [ ] **Step 5: Commit**

```sh
git add scripts/vm/build-release.mjs scripts/vm/build-release.test.js package.json
git commit -m "feat: build immutable vm release artifacts"
```

## Task 4: Install, Health-Check, and Roll Back Atomically

**Files:**
- Create: `scripts/vm/install-release.mjs`
- Create: `scripts/vm/healthcheck.mjs`
- Create: `scripts/vm/install-release.test.js`
- Modify: `package.json`

**Interfaces:**
- `installVmRelease({ releaseDir, rootDir, service, clock }) -> { releaseId, previousReleaseId }`.
- `healthcheckVm({ baseUrl, timeoutMs }) -> { ok, checks }`.
- `rollbackVmRelease({ rootDir, releaseId }) -> { releaseId }`.

- [ ] **Step 1: Write symlink, path-safety, and failure tests**

Cover: install creates `releases/<id>`, `current` switches only after validation, `previous`
records the old target, a path outside the configured release root is rejected, failed readiness
leaves `current` unchanged, and rollback refuses an unknown release ID.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test scripts/vm/install-release.test.js`

Expected: FAIL because installer, health-check, and rollback functions do not exist.

- [ ] **Step 3: Implement validation and atomic switching**

Validate legal manifest hashes, worker/module hashes, runtime config, directory ownership, and
free disk space before stopping the service. Write a temporary symlink, run health checks, then
rename it atomically to `current`; only after success update `previous`. On any failure, preserve
the old `current` link and return a stable error code.

- [ ] **Step 4: Add commands and run tests**

Add:

```json
"install:vm": "node scripts/vm/install-release.mjs",
"healthcheck:vm": "node scripts/vm/healthcheck.mjs",
"rollback:vm": "node scripts/vm/install-release.mjs --rollback"
```

Run: `node --test scripts/vm/install-release.test.js && pnpm lint`

Expected: PASS; a simulated failed health check never changes the active release.

- [ ] **Step 5: Commit**

```sh
git add scripts/vm/install-release.mjs scripts/vm/healthcheck.mjs \
  scripts/vm/install-release.test.js package.json
git commit -m "feat: add atomic vm install and rollback"
```

## Task 5: Add Backup and Isolated Restore

**Files:**
- Create: `scripts/vm/backup-data.mjs`
- Create: `scripts/vm/restore-data.mjs`
- Create: `scripts/vm/vm-data.test.js`
- Modify: `package.json`

**Interfaces:**
- `backupVmData({ dataDir, objectStoreDir, outDir, releaseId }) -> { archive, checksum, releaseId }`.
- `restoreVmData({ archive, targetDir, expectedChecksum }) -> { releaseId, checksum }`.

- [ ] **Step 1: Write backup and restore tests**

Create a temporary SQLite/DO data fixture and object fixture, make a backup, tamper with a byte,
assert checksum rejection, restore the untampered archive into an empty directory, and assert the
data plus release/migration metadata are present.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test scripts/vm/vm-data.test.js`

Expected: FAIL because backup and restore commands do not exist.

- [ ] **Step 3: Implement consistent snapshot and checksum validation**

Stop writes or use the runtime's supported checkpoint boundary, copy the SQLite durable state and
object store into a staging archive, write a manifest containing release ID, migration version,
file sizes and SHA-256, then atomically rename the completed archive. Restore must unpack into an
isolated directory, verify every checksum, and refuse to overwrite the active data directory.

- [ ] **Step 4: Add commands and verify**

Add:

```json
"backup:vm": "node scripts/vm/backup-data.mjs",
"restore:vm": "node scripts/vm/restore-data.mjs"
```

Run: `node --test scripts/vm/vm-data.test.js && pnpm lint`

Expected: PASS; tampered archives are rejected without changing active data.

- [ ] **Step 5: Commit**

```sh
git add scripts/vm/backup-data.mjs scripts/vm/restore-data.mjs \
  scripts/vm/vm-data.test.js package.json
git commit -m "feat: add vm backup and isolated restore"
```

## Task 6: Add VM Runtime and Recovery Browser Journeys

**Files:**
- Create: `scripts/run-vm-e2e.mjs`
- Create: `e2e/vm-self-hosting.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `pnpm test:e2e:vm`.
- Uses a disposable persistent data directory and the same fake OIDC/model services as existing E2E tests.

- [ ] **Step 1: Write failing VM journey tests**

Cover: clean install, English and Chinese login/workspace/chat, explicit model selection, OIDC
error mapping, Gatekeeper availability, process restart with persisted workspace, and rollback
from release B to release A while preserving the workspace.

- [ ] **Step 2: Run the focused suite and verify failure**

Run: `pnpm test:e2e:vm`

Expected: FAIL because the VM runner and test project do not exist.

- [ ] **Step 3: Implement the VM runner and Playwright project**

The runner must start standalone `workerd` with a generated temporary config and persistent state
directory, never use the normal `.wrangler` directory, expose a health URL, and clean up only its
own generated directory. The restart test must stop and start the same runtime with the same data
directory rather than resetting fixtures.

- [ ] **Step 4: Run VM E2E and full automated gates**

Run:

```sh
CI=true pnpm test:e2e:vm -- --workers=1
CI=true pnpm verify:softmatrix
```

Expected: all VM journeys pass and the existing Cloudflare-compatible test suite remains green.

- [ ] **Step 5: Commit**

```sh
git add scripts/run-vm-e2e.mjs e2e/vm-self-hosting.spec.ts \
  playwright.config.ts package.json
git commit -m "test: cover vm persistence and rollback journeys"
```

## Task 7: Document VM Installation and Operations

**Files:**
- Create: `docs/softmatrix/vm-deployment.en.md`
- Create: `docs/softmatrix/vm-deployment.zh-CN.md`
- Create: `docs/softmatrix/vm-operations.en.md`
- Create: `docs/softmatrix/vm-operations.zh-CN.md`
- Modify: `README.md`
- Modify: `scripts/softmatrix-compliance.test.js`

**Interfaces:**
- English and Chinese documents have identical ordered heading IDs.
- Commands in both languages call the stable root commands from Tasks 3–6.

- [ ] **Step 1: Add documentation parity tests first**

Assert that each English/Chinese pair has identical headings and documents `PUBLIC_BASE_URL`,
OIDC settings, model settings, data paths, backup commands, health checks, upgrade, rollback,
secret rotation, monitoring, and support boundaries.

- [ ] **Step 2: Run the parity test and verify failure**

Run: `node --test scripts/softmatrix-compliance.test.js`

Expected: FAIL because the VM documents do not exist.

- [ ] **Step 3: Write executable bilingual runbooks**

Document a clean VM install, systemd/Docker startup, Caddy/Nginx TLS, OIDC callback registration,
direct/self-hosted model configuration, data directories, backup/restore, health checks, upgrade,
rollback, incident triggers, and the fact that Cloudflare services are not production dependencies.

- [ ] **Step 4: Run compliance and documentation checks**

Run: `node --test scripts/softmatrix-compliance.test.js scripts/i18n-coverage.test.js && git diff --check`

Expected: PASS; no undocumented environment variable or language parity regression exists.

- [ ] **Step 5: Commit**

```sh
git add README.md docs/softmatrix/vm-deployment.* docs/softmatrix/vm-operations.* \
  scripts/softmatrix-compliance.test.js
git commit -m "docs: add bilingual vm self-hosting runbooks"
```

## Task 8: Execute the First VM Release Rehearsal

**Files:**
- Create: `docs/softmatrix/vm-release-rehearsal.md`
- Modify: `docs/softmatrix/vm-operations.en.md`
- Modify: `docs/softmatrix/vm-operations.zh-CN.md`

**Interfaces:**
- Produces an auditable report containing source commit, release ID, checksums, runtime versions,
  backup checksum, test output, restart result, restore result, rollback result, and operator sign-off.

- [ ] **Step 1: Provision a clean single VM**

Install only documented prerequisites, create the non-root service user, persistent data volume,
secret provider, TLS proxy, and backup destination. Record OS, Node, pnpm, workerd, Docker/systemd,
and proxy versions.

- [ ] **Step 2: Build and install a candidate**

Run:

```sh
pnpm install --frozen-lockfile
pnpm verify:softmatrix
pnpm test:e2e:vm
pnpm build:vm -- --release-id softmatrix-vm-v1-rc1
pnpm install:vm -- --release release-out
pnpm healthcheck:vm
```

Expected: the candidate starts without a Cloudflare account or Cloudflare service binding.

- [ ] **Step 3: Perform manual acceptance**

Verify bilingual login, OIDC success/cancel/domain denial, workspace persistence, model policy,
BYOK behavior, Gatekeeper approval, attachment/Blueprint storage, log redaction, and public HTTPS.
The automated local fixture covers only OIDC success; cancellation and domain denial must be
replayed against the production IdP on the operator VM.

- [ ] **Step 4: Reboot, restore, and roll back**

Create a backup, restart the VM, verify the same workspace and model preference, restore a copy into
an isolated directory, install a second release, force a readiness failure, roll back, and verify
the original workspace remains available.

- [ ] **Step 5: Record the rehearsal and final go/no-go decision**

Record all checksums, timestamps, failure observations, backup age, recovery time, and operator
approval. Do not publish if any secret appears in artifacts/logs, data is not persistent, restore
fails, or rollback changes the wrong release.

- [ ] **Step 6: Commit only the rehearsal report and documentation corrections**

```sh
git add docs/softmatrix/vm-release-rehearsal.md docs/softmatrix/vm-operations.en.md \
  docs/softmatrix/vm-operations.zh-CN.md
git commit -m "docs: record first vm release rehearsal"
```

## Checkpoints

### Checkpoint A: Runtime and Config (after Tasks 1–2)

- [ ] Native standalone workerd smoke and restart persistence pass.
- [ ] VM profile starts with no Cloudflare account or production service binding.
- [ ] Secret and path validation fail closed.

### Checkpoint B: Release Safety (after Tasks 3–5)

- [ ] Release artifact has legal files and checksums.
- [ ] Install is atomic and rollback is path-safe.
- [ ] Backup/restore detects tampering and never overwrites active data.

### Checkpoint C: Acceptance (after Tasks 6–8)

- [ ] VM E2E, existing automated gates, and documentation parity pass.
- [ ] Clean VM install, reboot persistence, isolated restore, and rollback are evidenced.
- [ ] First release has an operator-owned rollback ID and backup checksum.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| standalone workerd binding behavior differs from local Wrangler | High | Task 1 fails early with a real runtime harness; do not add adapters preemptively |
| release builder accidentally retains Cloudflare placeholders | High | VM manifest test rejects `$ACCOUNT_ID`, `$KV_*`, `$R2_*`, `$SECRET(...)`, and `$WORKERS_AI` |
| single VM disk loss | High | Independent backup destination plus isolated restore rehearsal |
| production secrets leak through service config | High | Protected secret provider, redacted diagnostics, artifact/log scans |
| Dynamic Worker/Facet or Gatekeeper fails only after deploy | High | VM browser journey and clean-VM rehearsal cover all deployable workers |
| model provider outage | Medium | Explicit error and operator-selected model; no silent fallback |

## Done Definition

- [ ] Tasks 1–8 are complete with focused commits.
- [ ] `pnpm verify:softmatrix` and `pnpm test:e2e:vm` pass from a clean checkout.
- [ ] A clean single VM can install, start, restart, back up, restore, upgrade, and roll back the release.
- [ ] No production step requires Cloudflare credentials or Cloudflare managed services.
- [ ] Bilingual OIDC, model governance, Gatekeeper, Blueprint, and workspace journeys pass.
- [ ] Apache-2.0/legal artifacts, checksums, runbooks, and rehearsal report are present.
- [ ] The release owner has recorded the exact release ID, backup checksum, and rollback target.
