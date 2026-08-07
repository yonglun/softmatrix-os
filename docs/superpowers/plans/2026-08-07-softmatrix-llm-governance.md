# Softmatrix OS Multi-LLM Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing multi-provider and AI Gateway capabilities into a governed organization catalog with server-side shared credentials, default/enable policy, optional user BYOK, explicit source labels, and safe failure handling.

**Architecture:** Add a deployment-only organization model catalog parsed from one secret JSON binding, and keep non-secret enable/default choices in `AdminConfig`. A single `ModelPolicy` composes organization models, existing AI Gateway models, and user models. Existing chat callers continue to receive active `AiChatAuthorInfo[]`; management UI uses a separate sanitized catalog view so no credential can cross RPC.

**Tech Stack:** Existing Pi AI/model adapters, Cloudflare Workers Secrets, Durable Objects, Cap'n Web RPC, React 19, Vitest.

## Global Constraints

- Keep providers `openai`, `anthropic`, `google`, `cloudflare`, and `ollama` plus existing compatible `apiUrl` support.
- Organization credentials live only in `ORG_AI_MODELS` secret JSON or existing `CF_AI_GATEWAY_*` secrets.
- `ALLOW_USER_BYOK` is a deployment hard policy; default `true` preserves existing deployments.
- Non-secret `defaultModelId` and `disabledOrganizationModelIds` live in AdminConfig.
- Model IDs are unique across organization, AI Gateway, and personal catalogs; conflicts fail explicitly.
- Preserve the existing AI Gateway provider allowlist: BYOK cannot introduce a provider disabled by gateway/deployment policy.
- Never return `apiToken`, account credentials, or a secret-bearing `AiModelConfig` through RPC.
- Do not silently change models on provider, credential, rate-limit, or balance failure.
- Record provider/model/token/cost metadata only; never log prompts or responses.
- Preserve existing direct-provider and AI Gateway routing tests.

---

### Task 1: Define Sanitized Model Catalog and Policy Contracts

**Files:**
- Modify: `packages/workshop-shared/src/api.ts`
- Create: `packages/workshop-backend/src/model-policy/types.ts`
- Create: `packages/workshop-backend/__tests__/model-policy-types.test.ts`

**Interfaces:**
- Produces: `AiModelSource`, `AiModelCatalogItem`, `AiModelPolicyInfo`, `ModelErrorCode`, `AuthenticatedApi.listModelCatalog()`, `AuthenticatedApi.getAiModelPolicy()`.
- Consumers: policy resolver, provider UI, onboarding, admin UI.

- [ ] **Step 1: Write a failing serialization test**

```ts
it("serializes only sanitized model catalog fields", () => {
  const item = toCatalogItem(organizationRecordWithToken("secret-token"), true, true);
  expect(item).toEqual({
    id: "org-claude",
    name: "Company Claude",
    provider: "anthropic",
    source: "organization",
    enabled: true,
    isDefault: true,
    canDelete: false,
  });
  expect(JSON.stringify(item)).not.toContain("secret-token");
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `pnpm --filter @gadgets/workshop-backend test -- model-policy-types.test.ts`

Expected: FAIL because the model policy module does not exist.

- [ ] **Step 3: Add documented shared types and APIs**

```ts
/** Ownership boundary for a model displayed in management UI. */
export type AiModelSource = "organization" | "personal";

/** Secret-free model metadata returned to the authenticated management UI. */
export type AiModelCatalogItem = {
  id: string;
  name: string;
  provider: AiModelProvider;
  source: AiModelSource;
  enabled: boolean;
  isDefault: boolean;
  canDelete: boolean;
};

/** Deployment model policy visible to an authenticated user. */
export type AiModelPolicyInfo = {
  allowUserByok: boolean;
  defaultModelId: string | null;
};

/** Stable model failure categories safe to localize. */
export type ModelErrorCode =
  | "MODEL_DISABLED"
  | "MODEL_CREDENTIAL_INVALID"
  | "MODEL_RATE_LIMITED"
  | "MODEL_BALANCE_EXHAUSTED"
  | "MODEL_PROVIDER_UNAVAILABLE"
  | "BYOK_DISABLED";
```

Add a backend-only error that carries only the stable code and correlation ID across RPC/stream boundaries:

```ts
export class ModelPolicyError extends Error {
  constructor(readonly code: ModelErrorCode, readonly correlationId: string) {
    super(code);
    this.name = "ModelPolicyError";
  }
}
```

Add documented `listModelCatalog()` and `getAiModelPolicy()` methods without changing existing `listModels()`.

- [ ] **Step 4: Implement `toCatalogItem` with an explicit output object**

Never spread a secret-bearing record. Construct every public property by name and use `satisfies AiModelCatalogItem` so future secret fields cannot leak accidentally.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @gadgets/workshop-backend test -- model-policy-types.test.ts && pnpm --filter @gadgets/workshop-shared types:check`

Expected: PASS.

```sh
git add packages/workshop-shared/src/api.ts packages/workshop-backend/src/model-policy packages/workshop-backend/__tests__/model-policy-types.test.ts
git commit -m "feat: define sanitized model governance contracts"
```

### Task 2: Parse and Validate Organization Model Secrets

**Files:**
- Modify: `packages/workshop-backend/src/env.d.ts`
- Create: `packages/workshop-backend/src/model-policy/organization-models.ts`
- Create: `packages/workshop-backend/__tests__/organization-models.test.ts`

**Interfaces:**
- Produces: `OrganizationModelRecord`, `getOrganizationModels(env)`, `isUserByokAllowed(env)`.
- Consumers: policy resolver and inference context.

- [ ] **Step 1: Write failing strict-parser tests**

```ts
function envWithModels(models: unknown[]): Cloudflare.Env {
  return { ORG_AI_MODELS: JSON.stringify(models), ALLOW_USER_BYOK: "true" } as Cloudflare.Env;
}

function validModel(overrides: Record<string, unknown> = {}) {
  return {
    id: "org-claude", name: "Company Claude", provider: "anthropic",
    model: "claude-sonnet-5", contextWindow: 1_000_000, apiToken: "secret-token",
    ...overrides,
  };
}

const INVALID_MODELS: Record<string, unknown[]> = {
  "duplicate id": [validModel({ id: "same" }), validModel({ id: "same" })],
  "unknown provider": [validModel({ provider: "unknown" })],
  "missing token": [validModel({ apiToken: "" })],
  "invalid URL": [validModel({ apiUrl: "file:///tmp/model" })],
  "invalid window": [validModel({ contextWindow: 0 })],
};

it("parses a complete organization model without exposing its token", () => {
  const models = getOrganizationModels(envWithModels([{
    id: "org-claude",
    name: "Company Claude",
    provider: "anthropic",
    model: "claude-sonnet-5",
    contextWindow: 1_000_000,
    apiToken: "secret-token",
  }]));
  expect(models.get("org-claude")!.config.apiToken).toBe("secret-token");
});

it.each(["duplicate id", "unknown provider", "missing token", "invalid URL", "invalid window"])(
  "rejects %s", (fixture) =>
    expect(() => getOrganizationModels(envWithModels(INVALID_MODELS[fixture]))).toThrow(),
);
```

The fixture is local to the test file and never reads environment secrets.

- [ ] **Step 2: Run the focused test**

Run: `pnpm --filter @gadgets/workshop-backend test -- organization-models.test.ts`

Expected: FAIL because parser functions do not exist.

- [ ] **Step 3: Implement a strict secret schema without adding another dependency**

```ts
export type OrganizationModelRecord = {
  profile: AiChatAuthorInfo;
  config: AiModelConfig;
  contextWindow: number;
  outputLimit?: number;
};

export function isUserByokAllowed(env: Cloudflare.Env): boolean {
  return env.ALLOW_USER_BYOK !== "false";
}
```

Parse `ORG_AI_MODELS` as a JSON array. Reject extra/unknown providers, blank IDs/names/models, duplicate IDs, non-positive integer windows, non-HTTPS remote `apiUrl` outside `DEV`, missing Workers AI `accountId`, and missing token except Ollama. Bound phase one to 20 models and reject input larger than 5 KiB so it stays within the deployment binding budget.

- [ ] **Step 4: Declare environment bindings and run tests**

Add `ORG_AI_MODELS?: string` and `ALLOW_USER_BYOK?: string` to `env.d.ts` with explicit secret/hard-policy comments.

Run: `pnpm --filter @gadgets/workshop-backend test -- organization-models.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add packages/workshop-backend/src/env.d.ts packages/workshop-backend/src/model-policy packages/workshop-backend/__tests__/organization-models.test.ts
git commit -m "feat: load organization models from deployment secrets"
```

### Task 3: Persist Non-Secret Enable and Default Policy in AdminConfig

**Files:**
- Modify: `packages/workshop-backend/src/admin-config.ts`
- Modify: `packages/workshop-backend/src/admin-settings.ts`
- Modify: `packages/workshop-shared/src/api.ts`
- Modify: `packages/workshop-backend/__tests__/admin-config.test.ts`
- Create: `packages/workshop-backend/__tests__/admin-model-policy.test.ts`

**Interfaces:**
- Produces: `AdminConfig.modelPolicy`, `AdminSettingsView.modelPolicy`, `AdminApi.setDefaultModel()`, `AdminApi.setOrganizationModelEnabled()`.
- Consumers: unified resolver and Admin UI.

- [ ] **Step 1: Add failing backward-compatibility tests**

```ts
it("backfills model policy for legacy admin config", () => {
  expect(parseAdminConfig("{}").modelPolicy).toEqual({
    defaultModelId: "",
    disabledOrganizationModelIds: [],
  });
});

it("deduplicates and bounds disabled model IDs", () => {
  const config = parseAdminConfig(JSON.stringify({ modelPolicy: {
    defaultModelId: " org-claude ",
    disabledOrganizationModelIds: ["org-gemini", "org-gemini", ""],
  }}));
  expect(config.modelPolicy).toEqual({
    defaultModelId: "org-claude",
    disabledOrganizationModelIds: ["org-gemini"],
  });
});
```

- [ ] **Step 2: Run admin tests and verify failure**

Run: `pnpm --filter @gadgets/workshop-backend test -- admin-config.test.ts admin-model-policy.test.ts`

Expected: FAIL because `modelPolicy` and setters do not exist.

- [ ] **Step 3: Add the non-secret configuration shape**

```ts
export type AdminModelPolicy = {
  defaultModelId: string;
  disabledOrganizationModelIds: string[];
};

export const DEFAULT_ADMIN_MODEL_POLICY: AdminModelPolicy = {
  defaultModelId: "",
  disabledOrganizationModelIds: [],
};
```

Validate IDs against the current deployment catalog in Admin API setters. Reject a disabled/unknown default model. When disabling the current default, clear the default in the same AdminSettings write.

- [ ] **Step 4: Run admin tests and commit**

Run: `pnpm --filter @gadgets/workshop-backend test -- admin-config.test.ts admin-model-policy.test.ts`

Expected: PASS, including legacy config round-trip.

```sh
git add packages/workshop-backend/src/admin-config.ts packages/workshop-backend/src/admin-settings.ts packages/workshop-backend/__tests__ packages/workshop-shared/src/api.ts
git commit -m "feat: persist organization model policy"
```

### Task 4: Build the Single Server-Side Model Resolver

**Files:**
- Create: `packages/workshop-backend/src/model-policy/model-policy.ts`
- Modify: `packages/workshop-backend/src/user.ts`
- Modify: `packages/workshop-backend/src/server.ts`
- Modify: `packages/workshop-backend/src/ai-models.ts`
- Modify: `packages/workshop-backend/src/agent.ts`
- Modify: `packages/workshop-backend/src/ai-gateway.ts`
- Create: `packages/workshop-backend/__tests__/model-policy.test.ts`
- Modify: `packages/workshop-backend/__tests__/ai-models.test.ts`

**Interfaces:**
- Produces: `ModelPolicy.listActiveModels(userModels)`, `.listCatalog(userModels)`, `.resolve(modelId, userModels)`, `.effectiveDefault(userPreference)`.
- Consumers: `UserDurableObject.listModels()`, `getChatContext()`, external-message context, management RPC.

- [ ] **Step 1: Write precedence and denial tests**

```ts
it("resolves enabled organization models and rejects collisions", () => {
  const policy = makePolicy({ organization: [org("shared")], personal: [personal("mine")] });
  expect(policy.resolve("shared").source).toBe("organization");
  expect(policy.resolve("mine").source).toBe("personal");
  expect(() => makePolicy({ organization: [org("same")], personal: [personal("same")] }))
    .toThrow("Duplicate model id: same");
});

it("never silently replaces a disabled requested model", () => {
  try {
    disabledPolicy.resolve("org-claude");
    throw new Error("expected disabled model resolution to fail");
  } catch (error) {
    expect(error).toMatchObject({ code: "MODEL_DISABLED" });
  }
});
```

- [ ] **Step 2: Run the focused test**

Run: `pnpm --filter @gadgets/workshop-backend test -- model-policy.test.ts`

Expected: FAIL because the resolver does not exist.

- [ ] **Step 3: Implement one composition order**

Compose organization secret models and existing AI Gateway suggested models as `organization`, then personal models. Reject cross-source ID collisions. Filter disabled organization IDs from active lists. `effectiveDefault()` chooses, in order: valid user preference, valid admin default, first active organization model, first active personal model, or null. `resolve(requestedId)` never falls back.

```ts
export type ResolvedModel = {
  source: AiModelSource;
  record: UserAiModelRecord;
};
```

- [ ] **Step 4: Replace duplicated list/resolve logic in User DO**

`listModels()`, `listModelCatalog()`, `getAiModelPolicy()`, `setPreferredModel()`, `getChatContext()`, and `getExternalMessageChatContext()` must all call the same resolver. Keep `AiGatewayConfig` responsible only for gateway transport configuration and derived gateway model records.

- [ ] **Step 5: Run model routing tests and commit**

Run: `pnpm --filter @gadgets/workshop-backend test -- model-policy.test.ts ai-models.test.ts ai-gateway.test.ts`

Expected: PASS; direct and gateway request URLs/headers remain unchanged.

```sh
git add packages/workshop-backend/src packages/workshop-backend/__tests__
git commit -m "refactor: centralize model selection policy"
```

### Task 5: Enforce BYOK Policy and Add Credential Testing

**Files:**
- Modify: `packages/workshop-shared/src/api.ts`
- Modify: `packages/workshop-backend/src/user.ts`
- Modify: `packages/workshop-backend/src/server.ts`
- Create: `packages/workshop-backend/src/model-policy/test-connection.ts`
- Create: `packages/workshop-backend/__tests__/model-credentials.test.ts`

**Interfaces:**
- Produces: `AuthenticatedApi.testModelConnection(profile, config)`, `ModelConnectionTestResult`, `classifyModelError(error)`; enforces `ALLOW_USER_BYOK` in `addModel()` and model use.
- Consumers: Add Model UI.

- [ ] **Step 1: Write failing policy and redaction tests**

```ts
it("rejects add and use when BYOK is disabled but still allows deletion", async () => {
  await expect(user.addModel(profile, config)).rejects.toMatchObject({ code: "BYOK_DISABLED" });
  await expect(user.getChatContext(profile.id)).rejects.toMatchObject({ code: "BYOK_DISABLED" });
  await expect(user.deleteModel(profile.id)).resolves.toBeUndefined();
});

it("never returns or logs the submitted token", async () => {
  const result = await testModelConnection(env, profile, { ...config, apiToken: "top-secret" });
  expect(JSON.stringify(result)).not.toContain("top-secret");
  expect(logSink).not.toContain("top-secret");
});
```

- [ ] **Step 2: Run focused tests**

Run: `pnpm --filter @gadgets/workshop-backend test -- model-credentials.test.ts`

Expected: FAIL before enforcement/test endpoint exists.

- [ ] **Step 3: Add a stable test result**

```ts
/** Secret-free result of testing a user-supplied model connection. */
export type ModelConnectionTestResult =
  | { ok: true }
  | { ok: false; error: { code: ModelErrorCode; correlationId: string } };
```

Validate the config, create the existing `getModel()` handle, and perform one bounded non-thinking request with an output limit of one token and a ten-second timeout. Classify 401/403 as credential invalid, 402 as balance exhausted, 429 as rate limited, and network/5xx as provider unavailable. Do not store the config in the test method.

Use the same `classifyModelError()` in live Agent failures. Emit stable `ModelErrorCode` plus correlation ID to the client and log provider/model/status with the package logger; never include request headers, prompt, response body, or credential-bearing SDK objects.

- [ ] **Step 4: Enforce policy at every server chokepoint**

Reject new personal models and personal `getChatContext()` resolution when BYOK is disabled. Continue allowing deletion so administrators can remove dormant credentials. Existing organization models remain usable.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm --filter @gadgets/workshop-backend test -- model-credentials.test.ts model-policy.test.ts ai-models.test.ts`

Expected: PASS.

```sh
git add packages/workshop-shared/src/api.ts packages/workshop-backend/src packages/workshop-backend/__tests__/model-credentials.test.ts
git commit -m "feat: enforce BYOK policy and test credentials"
```

### Task 6: Build Organization/Personal Model Management UI

**Files:**
- Modify: `packages/workshop-frontend/src/routes/providers.tsx`
- Modify: `packages/workshop-frontend/src/AddModelModal.tsx`
- Modify: `packages/workshop-frontend/src/OnboardingWizard.tsx`
- Modify: `packages/workshop-frontend/src/modelSelection.ts`
- Modify: `packages/workshop-frontend/src/ChatInterface.tsx`
- Modify: locale resource files
- Create: `packages/workshop-frontend/src/routes/providers.test.tsx`
- Create: `packages/workshop-frontend/src/AddModelModal.test.tsx`
- Create: `packages/workshop-frontend/src/ChatInterface.model-errors.test.tsx`

**Interfaces:**
- Consumes: `listModelCatalog()`, `getAiModelPolicy()`, `testModelConnection()`, existing add/delete/preferred APIs.
- Produces: source labels, BYOK-aware actions, default/selected model behavior, localized failure recovery.

- [ ] **Step 1: Write failing UI policy tests**

```tsx
it("labels organization models and hides BYOK creation when disabled", async () => {
  api.listModelCatalog.mockResolvedValue([
    { id: "org-claude", name: "Company Claude", provider: "anthropic",
      source: "organization", enabled: true, isDefault: true, canDelete: false },
  ]);
  api.getAiModelPolicy.mockResolvedValue({ allowUserByok: false, defaultModelId: "org-claude" });
  const { container, unmount } = await renderProviders(api);
  expect(container.textContent).toContain("Organization");
  expect([...container.querySelectorAll("button")].some((button) =>
    button.textContent?.trim() === "Add provider")).toBe(false);
  unmount();
});

it("keeps the failed model selected until the user switches", async () => {
  const { container, selectModel, unmount } = await renderChatWithModelError({
    code: "MODEL_RATE_LIMITED", modelId: "org-claude",
  });
  expect((container.querySelector('[role="combobox"][aria-label="Model"]') as HTMLInputElement)
    .value).toBe("org-claude");
  expect([...container.querySelectorAll("button")].some((button) =>
    button.textContent?.trim() === "Switch model")).toBe(true);
  expect(selectModel).not.toHaveBeenCalled();
  unmount();
});
```

Both render helpers use the i18n plan's `renderWithLocale()` and typed fake RPC methods. Resolve
the initial catalog/policy promises inside `act()` before assertions; do not add React Testing Library.

- [ ] **Step 2: Run frontend focused tests**

Run: `pnpm --filter @gadgets/workshop-frontend test -- src/routes/providers.test.tsx src/AddModelModal.test.tsx`

Expected: FAIL on current flat personal/gateway model UI.

- [ ] **Step 3: Render the sanitized catalog**

Group or label rows by `source`; show provider, enabled/default status, and delete only when `canDelete`. Hide Add Model entirely when BYOK is disabled and show a localized organization-policy notice. Never infer source from model ID or `SUGGESTED_MODELS` client-side.

- [ ] **Step 4: Test credentials before saving**

The Add Model submit flow calls `testModelConnection()` first. On `{ok:false}`, keep the modal open and localize the stable code plus correlation ID; on success, call `addModel()` and clear credential fields. Never put the API token in toast text, console output, URL, or component error objects.

- [ ] **Step 5: Update selection defaults and run tests**

Use server-ordered active models and `defaultModelId`; preserve explicit “No agent”. A failed selected model remains selected and surfaces a switch action rather than silently choosing another model.

Map live stable model errors to localized messages in `ChatInterface` and render “Retry” plus “Switch model”; do not mutate the selected model until the user chooses one.

Run: `pnpm --filter @gadgets/workshop-frontend test -- src/routes/providers.test.tsx src/AddModelModal.test.tsx src/ChatInterface.model-errors.test.tsx src/homePromptFlow.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```sh
git add packages/workshop-frontend/src
git commit -m "feat: distinguish organization and personal models"
```

### Task 7: Add Admin Model Policy UI and Deployment Documentation

**Files:**
- Modify: `packages/workshop-frontend/src/AdminPage.tsx`
- Create: `packages/workshop-frontend/src/AdminModelPolicy.test.tsx`
- Create: `docs/model-governance.md`

**Interfaces:**
- Consumes: Admin settings/model policy APIs and sanitized organization catalog.
- Produces: admin enable/default controls and exact secret/deployment format.

- [ ] **Step 1: Write the failing Admin UI test**

```tsx
it("clears the default before disabling that model", async () => {
  const { container, adminApi, unmount } = await renderModelPolicy({
    defaultModelId: "org-claude",
  });
  const toggle = container.querySelector('[role="switch"][aria-label="Company Claude"]')
    as HTMLButtonElement;
  await act(async () => toggle.click());
  expect(adminApi.setDefaultModel).toHaveBeenCalledWith("");
  expect(adminApi.setOrganizationModelEnabled).toHaveBeenCalledWith("org-claude", false);
  unmount();
});
```

- [ ] **Step 2: Run the focused test**

Run: `pnpm --filter @gadgets/workshop-frontend test -- src/AdminModelPolicy.test.tsx`

Expected: FAIL before the panel exists.

- [ ] **Step 3: Add the Admin panel**

Display sanitized organization models with enabled switches and a default-model select. Show `ALLOW_USER_BYOK` as a deployment-controlled read-only status with documentation link; do not expose or edit organization credentials in the session-based Admin API.

- [ ] **Step 4: Document exact secret JSON**

```json
[
  {
    "id": "org-claude",
    "name": "Company Claude",
    "provider": "anthropic",
    "model": "claude-sonnet-5",
    "contextWindow": 1000000,
    "apiToken": "<stored only as the ORG_AI_MODELS secret>"
  }
]
```

Document `wrangler secret put ORG_AI_MODELS`, `ALLOW_USER_BYOK`, secret rotation, compatible endpoint rules, rollback, and the fact that UI/API never returns secret fields.

- [ ] **Step 5: Document the deployment-service binding contract**

Specify that the external deployment service injects `ORG_AI_MODELS` as secret backend instance state and `ALLOW_USER_BYOK` as a non-secret backend variable, matching the existing `backendExtraVars` contract. This repository's release manifest must not contain the catalog secret or introduce a `$SECRET(ORG_AI_MODELS)` placeholder.

Run: `node --test scripts/release-manifest.test.js`.

Expected: PASS with no release-manifest diff; model configuration remains deployment instance state.

- [ ] **Step 6: Run the milestone gate and commit**

Run: `pnpm lint && pnpm test && pnpm build`

Expected: all commands exit 0.

```sh
git add packages/workshop-frontend/src docs/model-governance.md
git commit -m "docs: add organization model governance workflow"
```
