# Softmatrix OS Generic OIDC SSO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure single-provider generic OIDC login with JIT provisioning, verified-email identity, domain policy, account deduplication, localized failures, and compatibility with existing Access/OAuth/password modes.

**Architecture:** Add a dedicated OIDC protocol module and short-lived Durable Object for each login attempt. `PublicApi.startOidcLogin()` returns an authorization URL plus a capability used by the initiating browser to await the result; `/api/auth/oidc/callback` completes the attempt. The callback normalizes a verified email and reuses the existing User Durable Object/session mechanism. Authentication secrets remain environment bindings and never enter `ServerConfig`.

**Tech Stack:** Cloudflare Workers, Durable Objects, Cap'n Web RPC, oauth4webapi, TypeScript 5.9, Vitest Workers pool, React 19.

## Global Constraints

- Phase one supports at most one OIDC issuer per deployment.
- Use Authorization Code + PKCE S256, unpredictable `state`, and `nonce`.
- Validate discovery issuer, ID Token signature, issuer, audience, time claims, nonce, and `email_verified === true`.
- Canonical account key is `email.trim().toLowerCase()` for OIDC, Cloudflare Access, and auth-capable Gatekeepers.
- JIT creation obeys `AdminConfig.signupsEnabled` and optional domain allowlist; existing users may log in when signups are closed.
- OIDC secrets are environment bindings only and must never enter AdminConfig, RPC, logs, analytics, or frontend assets.
- OIDC group claims and role mapping are out of scope.
- Any cached discovery/JWKS data must expire; validation must fail closed when no valid cache is available.
- Adding oauth4webapi requires dependency/license/Workers compatibility review before Task 2 execution.

---

### Task 1: Define Public OIDC Configuration and Stable Result Types

**Files:**
- Modify: `packages/workshop-shared/src/api.ts`
- Modify: `packages/workshop-backend/src/env.d.ts`
- Modify: `packages/workshop-backend/src/auth/config.ts`
- Modify: `packages/workshop-backend/src/deployment-config.ts`
- Create: `packages/workshop-backend/__tests__/oidc-config.test.ts`

**Interfaces:**
- Produces: `OidcPublicConfig`, `OidcLoginErrorCode`, `OidcLoginResult`, `OidcLoginAttempt`, `ServerConfig.oidc`, `PublicApi.startOidcLogin()`.
- Consumers: OIDC attempt DO, callback route, login UI.

- [ ] **Step 1: Write failing configuration tests**

```ts
function oidcEnv(overrides: Partial<Cloudflare.Env> = {}): Cloudflare.Env {
  return {
    OIDC_ISSUER: "https://id.example.com",
    OIDC_CLIENT_ID: "softmatrix",
    OIDC_CLIENT_SECRET: "fixture-secret",
    PUBLIC_BASE_URL: "https://softmatrix.example",
    ...overrides,
  } as Cloudflare.Env;
}

it("publishes display metadata without secrets", async () => {
  const env = oidcEnv({
    OIDC_ISSUER: "https://id.example.com",
    OIDC_CLIENT_ID: "softmatrix",
    OIDC_CLIENT_SECRET: "never-public",
    OIDC_DISPLAY_NAME: "Company SSO",
  });
  expect(getPublicOidcConfig(env)).toEqual({ displayName: "Company SSO" });
  expect(JSON.stringify(getPublicOidcConfig(env))).not.toContain("never-public");
});

it("rejects a partial OIDC configuration", () => {
  expect(() => getOidcConfig(oidcEnv({ OIDC_CLIENT_SECRET: undefined })))
    .toThrow("OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, and PUBLIC_BASE_URL");
});
```

- [ ] **Step 2: Run the test and verify missing symbols**

Run: `pnpm --filter @gadgets/workshop-backend test -- oidc-config.test.ts`

Expected: FAIL because OIDC config functions/types do not exist.

- [ ] **Step 3: Add documented shared types**

```ts
/** Non-secret OIDC metadata shown on login and signup pages. */
export type OidcPublicConfig = { displayName: string };

/** Stable reasons a generic OIDC login can fail. */
export type OidcLoginErrorCode =
  | "OIDC_STATE_INVALID"
  | "OIDC_TOKEN_INVALID"
  | "OIDC_EMAIL_UNVERIFIED"
  | "SIGNUP_NOT_ALLOWED"
  | "EMAIL_DOMAIN_NOT_ALLOWED"
  | "OIDC_PROVIDER_UNAVAILABLE";

/** Result delivered to the browser that owns an OIDC login attempt capability. */
export type OidcLoginResult =
  | { ok: true; token: string }
  | { ok: false; error: { code: OidcLoginErrorCode; correlationId: string } };

/** Capability for awaiting exactly one OIDC login result. */
export interface OidcLoginAttempt extends RpcTarget {
  /** Wait for success/failure; dispose the stub to abandon the attempt. */
  wait(): Promise<OidcLoginResult>;
}
```

Add `oidc?: OidcPublicConfig` to `ServerConfig` and `startOidcLogin()` to `PublicApi`.

- [ ] **Step 4: Parse complete environment configuration atomically**

Add `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_DISPLAY_NAME`, and `OIDC_ALLOWED_EMAIL_DOMAINS` to `env.d.ts`. A configuration is disabled only when all four required fields are absent; partial configuration throws. Require HTTPS issuer and public base URL outside local development. `getServerConfig()` returns display name only.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @gadgets/workshop-backend test -- oidc-config.test.ts && pnpm --filter @gadgets/workshop-shared types:check`

Expected: PASS.

```sh
git add packages/workshop-shared/src/api.ts packages/workshop-backend/src packages/workshop-backend/__tests__/oidc-config.test.ts
git commit -m "feat: define generic OIDC configuration contract"
```

### Task 2: Implement Protocol Helpers with Strict Validation

**Files:**
- Modify: `packages/workshop-backend/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/workshop-backend/src/auth/oidc-protocol.ts`
- Create: `packages/workshop-backend/__tests__/oidc-protocol.test.ts`

**Interfaces:**
- Consumes: private `OidcConfig` from `auth/config.ts`.
- Produces: `createAuthorizationRequest(config, state)`, `exchangeAuthorizationCode(config, stored, callbackUrl)`, `VerifiedOidcIdentity`.

- [ ] **Step 1: Review and add oauth4webapi**

After dependency approval, run: `pnpm --filter @gadgets/workshop-backend add oauth4webapi`

Expected: only backend package metadata and lockfile change; package uses Web APIs supported by Workers and has a compatible license.

- [ ] **Step 2: Write failing protocol tests with a fake issuer**

```ts
const config = getOidcConfig({
  OIDC_ISSUER: "https://id.example.com",
  OIDC_CLIENT_ID: "softmatrix",
  OIDC_CLIENT_SECRET: "fixture-secret",
  PUBLIC_BASE_URL: "https://softmatrix.example",
} as Cloudflare.Env)!;

it("creates S256 PKCE, state, nonce, and the exact redirect URI", async () => {
  const request = await createAuthorizationRequest(config, "state-123");
  expect(request.url.searchParams.get("response_type")).toBe("code");
  expect(request.url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(request.url.searchParams.get("state")).toBe("state-123");
  expect(request.url.searchParams.get("nonce")).toBe(request.stored.nonce);
  expect(request.url.searchParams.get("redirect_uri"))
    .toBe("https://softmatrix.example/api/auth/oidc/callback");
});

it.each(["issuer", "audience", "nonce", "expired", "email_verified"])(
  "rejects an invalid %s claim", async (claim) => {
    await expect(exchangeFixture({ invalid: claim })).rejects.toMatchObject({
      code: claim === "email_verified" ? "OIDC_EMAIL_UNVERIFIED" : "OIDC_TOKEN_INVALID",
    });
  },
);
```

`exchangeFixture({ invalid })` stubs discovery, JWKS, token endpoint, and the ID Token signer using
a test-only key pair. It invokes the real `exchangeAuthorizationCode()` with a callback URL whose
code/state are valid and mutates exactly the named claim; no network call leaves the test isolate.

- [ ] **Step 3: Run the test and verify failure**

Run: `pnpm --filter @gadgets/workshop-backend test -- oidc-protocol.test.ts`

Expected: FAIL because protocol helpers do not exist.

- [ ] **Step 4: Implement the strict protocol boundary**

```ts
export type StoredOidcRequest = {
  codeVerifier: string;
  nonce: string;
  createdAt: number;
};

export type VerifiedOidcIdentity = {
  email: string;
  subject: string;
};

export async function createAuthorizationRequest(
    config: OidcConfig, state: string): Promise<{ url: URL; stored: StoredOidcRequest }> {
  const codeVerifier = oauth.generateRandomCodeVerifier();
  const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
  const nonce = oauth.generateRandomNonce();
  const server = await discover(config);
  const url = new URL(server.authorization_endpoint!);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
  }).toString();
  return { url, stored: { codeVerifier, nonce, createdAt: Date.now() } };
}
```

Use oauth4webapi discovery and authorization-code response processing. Enforce a five-minute attempt TTL and a bounded standards-aware cache for discovery/JWKS. Map external error descriptions to internal log fields only; return stable codes.

- [ ] **Step 5: Run protocol tests and commit**

Run: `pnpm --filter @gadgets/workshop-backend test -- oidc-protocol.test.ts`

Expected: PASS for valid fixture and all negative claim cases.

```sh
git add packages/workshop-backend/package.json packages/workshop-backend/src/auth packages/workshop-backend/__tests__/oidc-protocol.test.ts pnpm-lock.yaml
git commit -m "feat: validate OIDC authorization code flow"
```

### Task 3: Normalize Verified Email Across Every External Login

**Files:**
- Create: `packages/workshop-backend/src/auth/email-identity.ts`
- Modify: `packages/workshop-backend/src/auth/login-flow.ts`
- Modify: `packages/workshop-backend/src/server.ts`
- Modify: `packages/workshop-backend/src/user.ts`
- Create: `packages/workshop-backend/__tests__/email-identity.test.ts`

**Interfaces:**
- Produces: `normalizeVerifiedEmail(email)`, `isEmailDomainAllowed(email, allowlist)`.
- Consumers: Cloudflare Access, Gatekeeper login callback, OIDC completion.

- [ ] **Step 1: Write failing normalization and domain tests**

```ts
it.each([
  [" Alice@Example.COM ", "alice@example.com"],
  ["用户@例子.公司", "用户@例子.公司"],
])("canonicalizes %s", (input, expected) => {
  expect(normalizeVerifiedEmail(input)).toBe(expected);
});

it("matches exact normalized domains and rejects suffix tricks", () => {
  expect(isEmailDomainAllowed("a@example.com", ["example.com"])).toBe(true);
  expect(isEmailDomainAllowed("a@example.com.evil.test", ["example.com"])).toBe(false);
});
```

- [ ] **Step 2: Run the focused test**

Run: `pnpm --filter @gadgets/workshop-backend test -- email-identity.test.ts`

Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Implement one canonical identity boundary**

```ts
export function normalizeVerifiedEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1 || normalized.includes("\0")) {
    throw new Error("Verified identity did not contain a valid email address.");
  }
  return normalized;
}

export function isEmailDomainAllowed(email: string, domains: readonly string[]): boolean {
  if (domains.length === 0) return true;
  const domain = email.slice(email.lastIndexOf("@") + 1);
  return domains.some((allowed) => domain === allowed.trim().toLowerCase());
}
```

Call the helper before `idFromName()` and before token prefix construction in Access and Gatekeeper flows. Preserve existing display names; only initialize a new user's display name from canonical email local-part.

- [ ] **Step 4: Run identity and existing Access tests**

Run: `pnpm --filter @gadgets/workshop-backend test -- email-identity.test.ts access.test.ts user-verifier.test.ts`

Expected: PASS and no duplicate DO key for email case differences.

- [ ] **Step 5: Commit**

```sh
git add packages/workshop-backend/src packages/workshop-backend/__tests__/email-identity.test.ts
git commit -m "fix: canonicalize verified login identities"
```

### Task 4: Add the Short-Lived OIDC Login Durable Object

**Files:**
- Create: `packages/workshop-backend/src/auth/oidc-login.ts`
- Modify: `packages/workshop-backend/src/server.ts`
- Modify: `packages/workshop-backend/wrangler.jsonc`
- Modify: `packages/workshop-backend/vitest.config.ts`
- Create: `packages/workshop-backend/__tests__/oidc-login.test.ts`

**Interfaces:**
- Consumes: protocol helpers, email identity helpers, `UserDurableObject.loginOrCreateViaGatekeeper()` semantics, `AdminConfig.signupsEnabled`.
- Produces: `OidcLoginDurableObject.begin()`, `.complete(callbackUrl)`, `.awaitResult()`, and one-time result delivery.

- [ ] **Step 1: Write failing state-machine tests**

```ts
function validCallback(state: string): string {
  const url = new URL("https://softmatrix.example/api/auth/oidc/callback");
  url.searchParams.set("code", "fixture-code");
  url.searchParams.set("state", state);
  return url.href;
}

it("delivers one result and refuses callback replay", async () => {
  const id = env.TEST_OIDC_LOGIN.newUniqueId();
  const state = id.toString();
  const attempt = env.TEST_OIDC_LOGIN.get(id);
  const { url } = await attempt.begin();
  expect(url).toContain(`state=${state}`);
  await attempt.complete(validCallback(state));
  await expect(attempt.awaitResult()).resolves.toMatchObject({ ok: true });
  await expect(attempt.complete(validCallback(state))).rejects.toThrow("already completed");
});

it("fails closed after five minutes", async () => {
  vi.setSystemTime(new Date("2026-08-07T00:00:00Z"));
  const id = env.TEST_OIDC_LOGIN.newUniqueId();
  const state = id.toString();
  const attempt = env.TEST_OIDC_LOGIN.get(id);
  await attempt.begin();
  vi.setSystemTime(new Date("2026-08-07T00:06:00Z"));
  await expect(attempt.complete(validCallback(state))).resolves.toMatchObject({
    ok: false, error: { code: "OIDC_STATE_INVALID" },
  });
});
```

- [ ] **Step 2: Run the test and verify missing DO**

Run: `pnpm --filter @gadgets/workshop-backend test -- oidc-login.test.ts`

Expected: FAIL because the Durable Object is absent.

- [ ] **Step 3: Implement persisted protocol state and one-time completion**

Store only `StoredOidcRequest`, completion flag, and bounded result metadata. Do not store ID/access/refresh tokens after validation. On success, canonicalize email, check domain allowlist, read `signupsEnabled`, call the User DO login-or-create method, and deliver `${email}:${secret}`. Generate a random correlation ID for logs and public error result.

```ts
type OidcAttemptState = {
  request: StoredOidcRequest;
  completed: boolean;
  result?: OidcLoginResult;
};
```

- [ ] **Step 4: Export and migrate the DO**

Export `OidcLoginDurableObject` from `server.ts` and append a new migration tag after `v2`:

```json
{ "tag": "v3", "new_sqlite_classes": ["OidcLoginDurableObject"] }
```

Add a test-only SQLite binding in `vitest.config.ts`:

```ts
TEST_OIDC_LOGIN: { className: "OidcLoginDurableObject", useSQLite: true },
```

- [ ] **Step 5: Run DO tests and commit**

Run: `pnpm --filter @gadgets/workshop-backend test -- oidc-login.test.ts`

Expected: PASS for success, expiry, replay, invalid token, unverified email, closed signups, and domain rejection.

```sh
git add packages/workshop-backend/src/auth/oidc-login.ts packages/workshop-backend/src/server.ts packages/workshop-backend/wrangler.jsonc packages/workshop-backend/vitest.config.ts packages/workshop-backend/__tests__/oidc-login.test.ts
git commit -m "feat: add one-time OIDC login attempts"
```

### Task 5: Wire RPC Start and HTTP Callback Endpoints

**Files:**
- Modify: `packages/workshop-backend/src/server.ts`
- Modify: `packages/router/src/index.ts` comments only
- Modify: `packages/router/__tests__/router.test.ts`
- Create: `packages/workshop-backend/__tests__/oidc-callback.test.ts`

**Interfaces:**
- Implements: `PublicApi.startOidcLogin()` and `GET /api/auth/oidc/callback`.
- Produces: popup-closing HTML with no token in URL/body.

- [ ] **Step 1: Write failing route tests**

```ts
it("routes the OIDC callback through the backend API prefix", async () => {
  expect(await route(makeEnv({ ASSETS: stubFetcher("assets") }),
    "/api/auth/oidc/callback?code=x&state=y")).toBe("backend");
});

it("callback never renders a session token", async () => {
  const response = await handleOidcCallback(callbackRequest, env, ctx);
  expect(await response.text()).not.toContain("session-token");
  expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
});
```

- [ ] **Step 2: Run route/callback tests**

Run: `pnpm --filter @gadgets/router test -- router.test.ts && pnpm --filter @gadgets/workshop-backend test -- oidc-callback.test.ts`

Expected: callback test FAIL before handler implementation.

- [ ] **Step 3: Implement start and callback methods**

`startOidcLogin()` must reject when OIDC is disabled, create a unique OIDC DO, call `begin()`, and return a `LoginAttemptImpl`-style wrapper without exposing secrets. The HTTP callback accepts GET only, validates one `state` and one `code`, resolves the DO with `idFromString(state)`, completes it, and returns static popup-closing HTML.

```html
<!doctype html><meta charset="utf-8"><title>Sign-in complete</title>
<script>window.close()</script>
```

Set `Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff`.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm --filter @gadgets/router test -- router.test.ts && pnpm --filter @gadgets/workshop-backend test -- oidc-callback.test.ts oidc-login.test.ts`

Expected: PASS.

```sh
git add packages/workshop-backend packages/router
git commit -m "feat: connect OIDC login RPC and callback"
```

### Task 6: Add Localized OIDC Login UI and Password-Mode Safety

**Files:**
- Create: `packages/workshop-frontend/src/components/auth/OidcButton.tsx`
- Modify: `packages/workshop-frontend/src/LoginPage.tsx`
- Modify: `packages/workshop-frontend/src/SignupPage.tsx`
- Modify: `packages/workshop-frontend/src/i18n/resources/en.ts`
- Modify: `packages/workshop-frontend/src/i18n/resources/zh-CN.ts`
- Modify: `packages/workshop-backend/src/auth/config.ts`
- Test: `packages/workshop-frontend/src/components/auth/OidcButton.test.tsx`
- Test: `packages/workshop-backend/__tests__/oidc-config.test.ts`

**Interfaces:**
- Consumes: `ServerConfig.oidc`, `PublicApi.startOidcLogin()`, `OidcLoginResult`.
- Produces: localized SSO button and result mapping; password disable safety considers OIDC as a valid external method.

- [ ] **Step 1: Write failing UI/result tests**

```tsx
it("stores the successful token and localizes domain rejection", async () => {
  attempt.wait.mockResolvedValueOnce({ ok: false, error: {
    code: "EMAIL_DOMAIN_NOT_ALLOWED", correlationId: "auth-123",
  }});
  const { container, unmount } = await renderOidcButton("zh-CN", attempt);
  const button = container.querySelector("button")!;
  expect(button.textContent).toContain("使用 Company SSO 继续");
  await act(async () => button.click());
  const alert = container.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("此邮箱域名不允许登录");
  expect(alert.textContent).toContain("auth-123");
  unmount();
});
```

`renderOidcButton()` composes the i18n plan's `renderWithLocale()` with a typed fake `PublicApi`.
Stub `window.open()` with `{ closed: false, close: vi.fn() }` and clear the polling interval during
unmount so the test leaves no timer or RPC stub alive.

- [ ] **Step 2: Run focused tests**

Run: `pnpm --filter @gadgets/workshop-frontend test -- src/components/auth/OidcButton.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement popup lifecycle and stable error mapping**

Mirror `OAuthButtons` cleanup: track interval, attempt stub, and mounted state; dispose the stub on unmount or popup close. Use `t(\`errors.${result.error.code}\`, { correlationId })`; never display provider error text.

- [ ] **Step 4: Make password disable safe with either OIDC or Gatekeepers**

Replace `hasAuthGatekeepers()` as the safety predicate with:

```ts
export function hasExternalAuthentication(env: Cloudflare.Env): boolean {
  return hasAuthGatekeepers(env) || getOidcConfig(env) !== null;
}
```

Keep password enabled when no usable external method exists, preventing deployment lockout.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @gadgets/workshop-frontend test -- src/components/auth/OidcButton.test.tsx && pnpm --filter @gadgets/workshop-backend test -- oidc-config.test.ts`

Expected: PASS.

```sh
git add packages/workshop-frontend/src packages/workshop-backend/src/auth packages/workshop-backend/__tests__/oidc-config.test.ts
git commit -m "feat: expose localized enterprise OIDC sign-in"
```

### Task 7: Document Deployment and Complete Security Verification

**Files:**
- Create: `docs/oidc-sso.md`
- Modify: `packages/workshop-frontend/README.md`
- Modify: `scripts/release-manifest.test.js`
- Modify: `scripts/testdata/golden-manifest.json`

**Interfaces:**
- Produces: exact environment setup and the backend-extra-vars integration contract for OIDC.

- [ ] **Step 1: Add the migration-manifest test before changing the golden file**

Assert the backend migration list contains `v3` and `OidcLoginDurableObject`. Also assert OIDC values do not appear as manifest-templated vars: this repository's existing release contract requires the external deploy service to inject backend instance state through `backendExtraVars`.

- [ ] **Step 2: Run the manifest test**

Run: `node --test scripts/release-manifest.test.js`

Expected: FAIL until migration `v3` is represented in the golden manifest.

- [ ] **Step 3: Add deployment documentation**

Document exact redirect URI `<PUBLIC_BASE_URL>/api/auth/oidc/callback`, required scopes `openid email profile`, claim requirements, Keycloak/Entra/Okta setup tables, domain allowlist syntax, password-disable rollback, secret rotation, and troubleshooting by correlation ID. Specify that a deployment service must inject non-secret `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_DISPLAY_NAME`, `OIDC_ALLOWED_EMAIL_DOMAINS` and secret `OIDC_CLIENT_SECRET` through its backend instance-state mechanism; this repository never serializes the secret into a release manifest. Never include live credentials.

- [ ] **Step 4: Regenerate and review the golden manifest**

Run: `UPDATE_GOLDEN=1 node --test scripts/release-manifest.test.js`

Expected: PASS; diff contains only migration `v3` and its new Durable Object class, with no OIDC secret value or new manifest placeholder.

- [ ] **Step 5: Run the SSO milestone gate**

Run: `pnpm lint && pnpm test && pnpm build`

Expected: all commands exit 0. Then manually verify two of Keycloak, Entra ID, and Okta using throwaway test tenants, including success, unverified email, wrong audience, expired state, closed signups, disallowed domain, replay, and popup cancellation.

- [ ] **Step 6: Commit**

```sh
git add docs packages/workshop-frontend/README.md scripts/release-manifest.test.js scripts/testdata/golden-manifest.json
git commit -m "docs: add generic OIDC deployment guide"
```
