# Softmatrix Entra Tenant UPN Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit Workforce Microsoft Entra OIDC mode that authenticates users with tenant-bound `tid + oid`, stores UPN as the user-facing profile identity, and preserves the existing verified-email OIDC behavior by default.

**Architecture:** Keep generic OIDC unchanged behind the default `verified-email` mode. Add a typed `entra-tenant` branch in configuration and token validation; route new Entra sessions through a delimiter-safe `entra-<tid>-<oid>` User Durable Object name while storing the normalized UPN only in the profile. Remove backend assumptions that `DurableObjectId.name` is an email by resolving the stored profile before user-facing operations.

**Tech Stack:** Cloudflare Workers/ Durable Objects, TypeScript, `oauth4webapi`, Vitest, Node VM release scripts, Markdown deployment documentation.

## Global Constraints

- `OIDC_IDENTITY_MODE=verified-email` remains the default and requires `email` plus `email_verified === true`.
- `OIDC_IDENTITY_MODE=entra-tenant` requires exact token `tid`, non-empty `oid`, non-empty `upn`, and a non-empty exact UPN-domain allowlist.
- The Entra account key is `entra-<tid>-<oid>`; UPN is never a Durable Object name or session security key.
- Existing password, Cloudflare Access, gatekeeper, generic OIDC, and email-keyed Durable Objects remain compatible and are not migrated.
- Token, tenant, UPN, and client-secret values must not be exposed in public responses, release manifests, diagnostics, or logs.
- Every implementation task is TDD: add a failing focused test, implement the minimum behavior, run the focused test, then commit.

---

### Task 1: Add the identity-mode configuration contract and VM preflight validation

**Files:**
- Modify: `packages/workshop-backend/src/auth/config.ts`
- Modify: `packages/workshop-backend/src/env.d.ts`
- Modify: `scripts/vm/vm-config.mjs`
- Modify: `scripts/vm/vm-config.test.js`
- Modify: `scripts/vm/build-release.mjs`
- Test: `packages/workshop-backend/__tests__/oidc-config.test.ts`

**Interfaces:**
- Produces `OidcIdentityMode = "verified-email" | "entra-tenant"`.
- Extends `OidcConfig` with `identityMode: OidcIdentityMode` and `entraTenantId?: string`.
- VM `loadVmConfig().oidc` exposes the same non-secret mode and tenant fields.

- [ ] **Step 1: Write failing backend and VM tests.** Add assertions for the default mode, valid Entra mode, missing tenant ID, empty Entra domain allowlist, and unknown mode:

```ts
expect(getOidcConfig(oidcEnv()).identityMode).toBe("verified-email");
expect(getOidcConfig(oidcEnv({
  OIDC_IDENTITY_MODE: "entra-tenant",
  OIDC_ENTRA_TENANT_ID: "7551a691-532e-4a93-9292-faed619dd82f",
  OIDC_ALLOWED_EMAIL_DOMAINS: "example.com",
})).entraTenantId).toBe("7551a691-532e-4a93-9292-faed619dd82f");
expect(() => getOidcConfig(oidcEnv({ OIDC_IDENTITY_MODE: "unknown" }))).toThrow("OIDC_IDENTITY_MODE");
expect(() => getOidcConfig(oidcEnv({
  OIDC_IDENTITY_MODE: "entra-tenant",
  OIDC_ENTRA_TENANT_ID: "tenant",
}))).toThrow("OIDC_ALLOWED_EMAIL_DOMAINS");
```

```js
assert.equal(loadVmConfig({ ...validEnv, OIDC_IDENTITY_MODE: "verified-email" }).oidc.identityMode, "verified-email");
assert.equal(loadVmConfig({ ...validEnv, OIDC_IDENTITY_MODE: "entra-tenant", OIDC_ENTRA_TENANT_ID: "tenant", OIDC_ALLOWED_EMAIL_DOMAINS: "example.com" }).oidc.entraTenantId, "tenant");
assert.throws(() => loadVmConfig({ ...validEnv, OIDC_IDENTITY_MODE: "entra-tenant" }), /OIDC_ENTRA_TENANT_ID/);
```

- [ ] **Step 2: Run the focused tests and confirm they fail.**

Run: `pnpm --filter workshop-backend exec vitest run __tests__/oidc-config.test.ts` and `node --test scripts/vm/vm-config.test.js`

Expected: FAIL because the mode fields and validation do not exist.

- [ ] **Step 3: Implement the typed backend parser.** Add the mode fields and validate mode-specific values before returning:

```ts
export type OidcIdentityMode = "verified-email" | "entra-tenant";
export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  displayName: string;
  allowedEmailDomains: string[];
  redirectUri: string;
  identityMode: OidcIdentityMode;
  entraTenantId?: string;
};

const identityModeRaw = envString(env, "OIDC_IDENTITY_MODE");
const modeRaw = identityModeRaw ?? "verified-email";
if (modeRaw !== "verified-email" && modeRaw !== "entra-tenant") {
  throw new Error("OIDC_IDENTITY_MODE must be verified-email or entra-tenant.");
}
const entraTenantId = envString(env, "OIDC_ENTRA_TENANT_ID");
const allowedEmailDomains = normalizedDomains(allowedDomainsRaw);
const oidcEnabled = [issuerRaw, clientId, clientSecret, displayNameRaw, allowedDomainsRaw, identityModeRaw, entraTenantId]
  .some(value => value !== undefined);
if (!oidcEnabled) return null;
if (modeRaw === "entra-tenant" && !entraTenantId) {
  throw new Error("OIDC_ENTRA_TENANT_ID is required in entra-tenant mode.");
}
if (modeRaw === "entra-tenant" && allowedEmailDomains.length === 0) {
  throw new Error("OIDC_ALLOWED_EMAIL_DOMAINS is required in entra-tenant mode.");
}
return {
  issuer: issuer.toString().replace(/\/$/, ""),
  clientId,
  clientSecret,
  displayName: displayNameRaw ?? DEFAULT_OIDC_DISPLAY_NAME,
  allowedEmailDomains,
  redirectUri,
  identityMode: modeRaw,
  ...(entraTenantId ? { entraTenantId } : {}),
};
```

- [ ] **Step 4: Mirror the contract in VM config and release bindings.** Parse and validate the same fields in `scripts/vm/vm-config.mjs`, include them in diagnostics only as non-secret metadata, and add both environment bindings in `scripts/vm/build-release.mjs`:

```js
const identityMode = optionalString(env, "OIDC_IDENTITY_MODE") ?? "verified-email";
if (identityMode !== "verified-email" && identityMode !== "entra-tenant") {
  throw new VmConfigError("VM_CONFIG_INVALID", "OIDC_IDENTITY_MODE must be verified-email or entra-tenant");
}
const entraTenantId = optionalString(env, "OIDC_ENTRA_TENANT_ID");
const allowedEmailDomains = normalizeDomains(optionalString(env, "OIDC_ALLOWED_EMAIL_DOMAINS"));
if (identityMode === "entra-tenant" && !entraTenantId) {
  throw new VmConfigError("VM_CONFIG_INVALID", "OIDC_ENTRA_TENANT_ID is required in entra-tenant mode");
}
if (identityMode === "entra-tenant" && allowedEmailDomains.length === 0) {
  throw new VmConfigError("VM_CONFIG_INVALID", "OIDC_ALLOWED_EMAIL_DOMAINS is required in entra-tenant mode");
}
```

- [ ] **Step 5: Run the focused tests and type checks.**

Run: `pnpm --filter workshop-backend exec vitest run __tests__/oidc-config.test.ts`, `node --test scripts/vm/vm-config.test.js`, and `pnpm --filter workshop-backend types:check`

Expected: all focused tests pass and no new TypeScript errors appear.

- [ ] **Step 6: Commit the configuration slice.**

```bash
git add packages/workshop-backend/src/auth/config.ts packages/workshop-backend/src/env.d.ts packages/workshop-backend/__tests__/oidc-config.test.ts scripts/vm/vm-config.mjs scripts/vm/vm-config.test.js scripts/vm/build-release.mjs
git commit -m "feat: add Entra OIDC identity mode configuration"
```

### Task 2: Validate Workforce Entra claims without weakening generic OIDC

**Files:**
- Modify: `packages/workshop-backend/src/auth/oidc-protocol.ts`
- Test: `packages/workshop-backend/__tests__/oidc-protocol.test.ts`

**Interfaces:**
- `VerifiedOidcIdentity` becomes `{ accountKey: string; profileId: string; subject: string }`.
- Generic mode returns `accountKey=email` and `profileId=email` after `email_verified === true`.
- Entra mode returns `accountKey=entra-${tid}-${oid}` and `profileId=normalized upn` without requiring `email_verified`.

- [ ] **Step 1: Add failing protocol fixtures and tests.** Extend the signed fixture claims with `tid`, `oid`, and `upn`; add tests for a valid UPN-only token and each invalid claim:

Update the existing generic `config` fixture to include `identityMode: "verified-email"`; this keeps the fixture aligned with the new required `OidcConfig` field.

```ts
const entraConfig: OidcConfig = {
  ...config,
  identityMode: "entra-tenant",
  entraTenantId: "7551a691-532e-4a93-9292-faed619dd82f",
  allowedEmailDomains: ["example.com"],
};

expect(await exchangeAuthorizationCode(entraConfig, stored, callback("state-123"), { fetch: fetchImpl }))
  .toEqual({
    accountKey: "entra-7551a691-532e-4a93-9292-faed619dd82f-oid-123",
    profileId: "alice@example.com",
    subject: "subject-123",
  });
await expect(exchangeAuthorizationCode(entraConfig, stored, callback("state-123"), { fetch: fetchImpl("wrong-tid") }))
  .rejects.toMatchObject({ code: "OIDC_TOKEN_INVALID" });
```

Cover wrong `tid`, missing or malformed `oid`, missing or malformed `upn`, disallowed UPN domain, and retain the existing wrong issuer/audience/nonce/expiry tests. Keep the existing generic test asserting `OIDC_EMAIL_UNVERIFIED` when `email_verified` is false.

- [ ] **Step 2: Run the focused protocol tests to verify RED.**

Run: `pnpm --filter workshop-backend exec vitest run __tests__/oidc-protocol.test.ts`

Expected: the new Entra tests fail because the identity type and branch are not implemented.

- [ ] **Step 3: Implement explicit claim branching.** Validate common claims first, then branch by mode:

```ts
const subject = typeof claims.sub === "string" && claims.sub ? claims.sub : null;
if (!subject) throw protocolError("OIDC_TOKEN_INVALID", "OIDC identity claims are incomplete.");

if (config.identityMode === "entra-tenant") {
  const tid = typeof claims.tid === "string" ? claims.tid : "";
  const oid = typeof claims.oid === "string" ? claims.oid : "";
  const upn = typeof claims.upn === "string" ? claims.upn.trim().toLowerCase() : "";
  if (tid !== config.entraTenantId || !/^[0-9a-f-]{20,}$/i.test(oid) || !isValidUpn(upn)
      || !isEmailDomainAllowed(upn, config.allowedEmailDomains)) {
    throw protocolError("OIDC_TOKEN_INVALID", "OIDC identity claims are invalid.");
  }
  return { accountKey: `entra-${tid}-${oid}`, profileId: upn, subject };
}

if (typeof claims.email !== "string" || !claims.email.trim()) {
  throw protocolError("OIDC_TOKEN_INVALID", "OIDC identity claims are incomplete.");
}
if (claims.email_verified !== true) {
  throw protocolError("OIDC_EMAIL_UNVERIFIED", "The OIDC provider did not verify the email.");
}
const email = claims.email.trim().toLowerCase();
return { accountKey: email, profileId: email, subject };
```

Use a local UPN validator that rejects whitespace, control characters, missing `@`, empty local parts, and empty domains; do not include claim values in thrown messages.

- [ ] **Step 4: Run protocol tests and type checks.**

Run: `pnpm --filter workshop-backend exec vitest run __tests__/oidc-protocol.test.ts` and `pnpm --filter workshop-backend types:check`

Expected: all generic and Entra protocol tests pass.

- [ ] **Step 5: Commit the protocol slice.**

```bash
git add packages/workshop-backend/src/auth/oidc-protocol.ts packages/workshop-backend/__tests__/oidc-protocol.test.ts
git commit -m "feat: validate Workforce Entra OIDC claims"
```

### Task 3: Route stable Entra account keys through User Durable Objects

**Files:**
- Modify: `packages/workshop-backend/src/user.ts`
- Modify: `packages/workshop-backend/src/auth/oidc-login.ts`
- Modify: `packages/workshop-backend/__tests__/oidc-login.test.ts`
- Create: `packages/workshop-backend/__tests__/user-oidc.test.ts`

**Interfaces:**
- Adds `UserDurableObject.loginOrCreateViaOidc(accountKey: string, profileId: string, allowCreate: boolean): Promise<string | null>`.
- `OidcLoginDurableObject.complete()` uses `identity.accountKey` for `idFromName()` and `identity.profileId` for the profile.

- [ ] **Step 1: Write the failing User DO tests.** Use the existing `Object.create(UserDurableObject.prototype)` plus the mock typed storage helper to prove first sign-in creates a UPN profile, later sign-in preserves a custom display name, and a disabled signup returns `null` without creating storage:

```ts
const token = await user.loginOrCreateViaOidc("entra-tenant-oid", "alice@example.com", true);
expect(token).toEqual(expect.any(String));
expect(await user.whoami()).toMatchObject({ id: "alice@example.com", name: "alice" });
await user.setOwnDisplayName("Alice Custom");
await user.loginOrCreateViaOidc("entra-tenant-oid", "renamed@example.com", true);
expect((await user.whoami()).name).toBe("Alice Custom");
```

Add an OIDC login test that asserts the session token prefix is the stable account key rather than the UPN.

- [ ] **Step 2: Run the focused tests and verify RED.**

Run: `pnpm --filter workshop-backend exec vitest run __tests__/user-oidc.test.ts __tests__/oidc-login.test.ts`

Expected: FAIL because the method and identity fields are not wired.

- [ ] **Step 3: Implement the dedicated User DO method and login wiring.** Keep `loginOrCreateViaGatekeeper()` unchanged for existing email-keyed accounts, and add a boundary-validated OIDC method:

```ts
async loginOrCreateViaOidc(accountKey: string, profileId: string, allowCreate: boolean): Promise<string | null> {
  const isEntraKey = /^entra-[0-9a-f-]+-[0-9a-f-]+$/i.test(accountKey);
  const isGenericOidcKey = /^[^@\s]+@[^@\s]+$/.test(accountKey);
  if ((!isEntraKey && !isGenericOidcKey) || !isValidProfileId(profileId)) {
    throw new Error("Invalid OIDC identity.");
  }
  if (!this.storage.created.get()) {
    if (!allowCreate) return null;
    this.storage.created.put(true);
    this.storage.profile.put({ type: "user", name: profileId.split("@", 1)[0], id: profileId });
  }
  return this.#newSessionToken();
}
```

In `oidc-login.ts`, replace the email-specific normalization/routing with `identity.accountKey`, `identity.profileId`, and `user.loginOrCreateViaOidc(...)`. Generic OIDC must call the same method only after its existing verified-email branch, using its email account key; do not alter gatekeeper login.

- [ ] **Step 4: Run focused tests and type checks.**

Run: `pnpm --filter workshop-backend exec vitest run __tests__/user-oidc.test.ts __tests__/oidc-login.test.ts` and `pnpm --filter workshop-backend types:check`

Expected: all tests pass and session tokens route by account key.

- [ ] **Step 5: Commit the account-routing slice.**

```bash
git add packages/workshop-backend/src/user.ts packages/workshop-backend/src/auth/oidc-login.ts packages/workshop-backend/__tests__/user-oidc.test.ts packages/workshop-backend/__tests__/oidc-login.test.ts
git commit -m "feat: route OIDC sessions by stable account key"
```

### Task 4: Remove backend assumptions that the Durable Object name is the profile ID

**Files:**
- Modify: `packages/workshop-backend/src/server.ts`
- Create: `packages/workshop-backend/__tests__/server-profile-identity.test.ts`

**Interfaces:**
- Adds one private cached profile lookup inside `AuthenticatedApiImpl` that calls `this.user.whoami()` once per RPC target.
- Exports `getAuthenticatedIdentityIds(user, internalUserId)` and `isConfiguredAdmin(admins, profileId)` as small pure/testable boundaries used by the implementation.
- `#isAdmin`, `setAvatar`, `getUiFeatureFlags`, gadget opening, gatekeeper app startup, `amIAdmin`, and `getAdminApi` use the stored profile ID; internal workspace/analytics IDs continue using `this.user.id.toString()`.

- [ ] **Step 1: Write the failing profile-identity tests.** Build a fake authenticated user whose DO name is `entra-tenant-oid` and whose `whoami()` returns `{ id: "alice@example.com", ... }`; assert admin matching, feature-flag key, avatar key, and gatekeeper admin user ID use the profile ID:

```ts
const profile = { type: "user" as const, name: "Alice", id: "alice@example.com" };
const fakeUser = { whoami: vi.fn().mockResolvedValue(profile) };
await expect(getAuthenticatedIdentityIds(fakeUser, "do-id")).resolves.toEqual({
  internalUserId: "do-id",
  profileId: "alice@example.com",
});
expect(isConfiguredAdmin(["alice@example.com"], "alice@example.com")).toBe(true);
expect(isConfiguredAdmin(["admin@example.com"], "alice@example.com")).toBe(false);
expect(fakeUser.whoami).toHaveBeenCalledTimes(1);
```

Also assert the internal workspace owner argument remains `do-id` while the profile argument is `alice@example.com`.

- [ ] **Step 2: Run the focused server test and confirm RED.**

Run: `pnpm --filter workshop-backend exec vitest run __tests__/server-profile-identity.test.ts`

Expected: FAIL because the current server reads `this.user.id.name` and treats the stable account key as a username.

- [ ] **Step 3: Implement the cached profile helper and async admin checks.** Use a single promise cache to avoid repeated DO reads and update all affected call sites:

```ts
export async function getAuthenticatedIdentityIds(
  user: Pick<DurableObjectStub<UserDurableObject>, "whoami">,
  internalUserId: string,
): Promise<{ internalUserId: string; profileId: string }> {
  return { internalUserId, profileId: (await user.whoami()).id };
}

export function isConfiguredAdmin(admins: unknown, profileId: string): boolean {
  if (!admins) return false;
  if (typeof admins === "string") admins = JSON.parse(admins);
  if (!Array.isArray(admins) || admins.some(value => typeof value !== "string")) {
    throw new TypeError("ADMINS must be configured as an array of usernames.");
  }
  return admins.includes(profileId);
}

  #profilePromise?: Promise<AiChatAuthorInfo>;
  #profile(): Promise<AiChatAuthorInfo> {
    return this.#profilePromise ??= this.user.whoami();
  }
  async #isAdmin(): Promise<boolean> {
    return isConfiguredAdmin(this.env.ADMINS, (await this.#profile()).id);
  }
```

Make `getGatekeeperApp`, `amIAdmin`, and `getAdminApi` await `#isAdmin()`. Make `setAvatar`, `getUiFeatureFlags`, and `#openGadgetInternal` await `#profile()`; pass `this.user.id.toString()` as the internal `userId` and `profile.id` as `profileId`.

- [ ] **Step 4: Run server tests, backend types, and the existing admin/gadget tests.**

Run: `pnpm --filter workshop-backend exec vitest run __tests__/server-profile-identity.test.ts __tests__/feature-flags.test.ts __tests__/open-gadget-errors.test.ts`, then `pnpm --filter workshop-backend types:check`.

Expected: all tests pass and no async RPC return type regressions appear.

- [ ] **Step 5: Commit the profile-identity slice.**

```bash
git add packages/workshop-backend/src/server.ts packages/workshop-backend/__tests__/server-profile-identity.test.ts
git commit -m "fix: separate OIDC account keys from user profiles"
```

### Task 5: Document Entra VM configuration and rollback

**Files:**
- Modify: `docs/oidc-sso.md`
- Modify: `docs/softmatrix/vm-deployment.en.md`
- Modify: `docs/softmatrix/vm-deployment.zh-CN.md`
- Modify: `deploy/vm/softmatrix.env.example`
- Test: existing documentation/branding compliance checks

**Interfaces:**
- Documents the exact `entra-tenant` environment contract, Entra optional `upn` ID-token claim, UPN domain allowlist, admin configuration using UPN, and rollback to `verified-email`.

- [ ] **Step 1: Add the exact operator configuration block.** Include this snippet in both English and Chinese VM deployment docs, with no secret values:

```dotenv
OIDC_IDENTITY_MODE=entra-tenant
OIDC_ENTRA_TENANT_ID=<workforce-tenant-guid>
OIDC_ALLOWED_EMAIL_DOMAINS=example.com
OIDC_ISSUER=https://login.microsoftonline.com/<workforce-tenant-guid>/v2.0
OIDC_CLIENT_ID=<application-id>
OIDC_CLIENT_SECRET=<secret-value>
```

Explain that the Entra app registration must emit the `upn` ID-token optional claim, `ADMINS` should contain the normalized UPN, and changing these values requires `vm-config.mjs --check` followed by `systemctl restart softmatrix`.

- [ ] **Step 2: Document rollback and compatibility.** State that removing Entra variables or setting `OIDC_IDENTITY_MODE=verified-email` restores generic OIDC behavior, preserves existing data, and does not link UPN accounts to old email-keyed accounts.

- [ ] **Step 3: Run docs/compliance checks.**

Run: `pnpm test:branding` and `git diff --check`.

Expected: all compliance tests pass and no whitespace errors are reported.

- [ ] **Step 4: Commit the documentation slice.**

```bash
git add docs/oidc-sso.md docs/softmatrix/vm-deployment.en.md docs/softmatrix/vm-deployment.zh-CN.md deploy/vm/softmatrix.env.example
git commit -m "docs: document Workforce Entra UPN login"
```

### Task 6: Run release verification and manual single-VM acceptance

**Files:**
- Modify only if verification reveals a concrete defect; otherwise no source changes.
- Evidence: `.superpowers/sdd/task-entra-upn-report.md` remains untracked and must not be staged.

**Interfaces:**
- Produces a verified VM release artifact with the new environment bindings and a manual acceptance checklist for the user's single-VM deployment.

- [ ] **Step 1: Run the complete automated verification set.**

Run:

```bash
pnpm --filter workshop-backend exec vitest run __tests__/oidc-config.test.ts __tests__/oidc-protocol.test.ts __tests__/oidc-login.test.ts __tests__/user-oidc.test.ts __tests__/server-profile-identity.test.ts
pnpm --filter workshop-backend types:check
node --test scripts/vm/vm-config.test.js scripts/vm/build-release.test.js scripts/vm/install-release.test.js scripts/vm/healthcheck.test.js
pnpm types:check
pnpm lint:check
pnpm test:branding
git diff --check
```

Expected: all focused and repository checks pass; pre-existing non-blocking lint warnings may be recorded but no new errors are accepted.

- [ ] **Step 2: Build a release artifact and inspect its runtime configuration.**

Run:

```bash
pnpm build:vm -- --release-id softmatrix-entra-upn
grep -n 'OIDC_IDENTITY_MODE\|OIDC_ENTRA_TENANT_ID' /tmp/softmatrix-entra-upn/runtime/workerd.capnp
```

Expected: the generated worker bindings include both environment names and the runtime config passes `node scripts/vm/vm-config.mjs --check` with the VM `.env` file.

- [ ] **Step 3: Perform the manual VM acceptance.** On the single VM, with a backup of `/var/lib/softmatrix`, run `vm-config.mjs --check`, restart `softmatrix.service`, sign in with Workforce Entra using a token that omits `email_verified` but includes valid `tid`, `oid`, `upn`, and an allowlisted domain, then verify the UI profile ID is the UPN and the session survives a UPN display rename. Confirm a wrong tenant, wrong domain, or missing UPN fails closed; confirm password-auth rollback works after setting `OIDC_IDENTITY_MODE=verified-email`.

- [ ] **Step 4: Commit only verification-related source fixes, if any.**

```bash
git status --short
git diff --check
git add packages/workshop-backend/src/auth packages/workshop-backend/src/user.ts packages/workshop-backend/src/server.ts packages/workshop-backend/__tests__ scripts/vm docs/softmatrix deploy/vm/softmatrix.env.example
git commit -m "test: verify Entra tenant login release"
```

Do not stage `.pnpm-store/`, `.superpowers/`, `test-results/`, VM secrets, or release artifacts.

### Task 7: Publish the branch and update the existing draft PR

**Files:**
- No source files; GitHub metadata only.

- [ ] **Step 1: Review the final diff and commit history.**

Run: `git status --short`, `git log --oneline --decorate -12`, and `git diff origin/main...HEAD --stat`.

Expected: only intentional Entra identity/configuration/docs/tests are included; generated artifacts and secrets are absent.

- [ ] **Step 2: Push the existing feature branch.**

```bash
git push origin feature/softmatrix-foundation
```

- [ ] **Step 3: Update draft PR #4 with the acceptance summary.** Include the new mode, stable `tid/oid` account key, UPN profile semantics, automated checks, and the single-VM manual acceptance status. Keep the PR draft until the user confirms the VM login flow.

- [ ] **Step 4: Report the release operator commands.** Provide the exact VM commands for config check, service restart, healthcheck, rollback, and backup; never include the actual client secret or token.

## Self-review against the specification

- Default generic OIDC and strict `email_verified`: Tasks 1–3 and Task 6.
- Explicit Entra mode, exact tenant/domain checks, and no claim leakage: Tasks 1–2.
- Stable `tid + oid` routing with UPN profile persistence: Task 3.
- Existing backend APIs no longer infer profile identity from DO names: Task 4.
- VM env bindings, operator setup, and rollback: Tasks 1, 5, and 6.
- Automated and manual acceptance evidence: Task 6.
- GitHub publication without secrets/artifacts: Task 7.
