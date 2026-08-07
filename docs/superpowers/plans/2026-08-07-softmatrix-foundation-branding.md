# Softmatrix OS Foundation, Branding, and Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the Softmatrix OS fork identity, centralized product metadata, Apache-2.0 compliance controls, and a low-conflict upstream synchronization workflow.

**Architecture:** Keep deployment-specific `siteName` and `siteLogo` behavior intact while changing only the product defaults and factual repository metadata. Put immutable product constants in `workshop-shared`, keep admin branding in `AdminConfig`, and enforce attribution/brand regressions with small Node tests rather than a repository-wide blind replacement.

**Tech Stack:** TypeScript 5.9, React 19, Cloudflare Workers, Node test runner, pnpm 11, Apache License 2.0.

## Global Constraints

- Upstream baseline is `0eaec6c5e8fc6b3298ea1aa73bf5c3e47b923c7f`.
- Keep the root `LICENSE` byte-for-byte Apache-2.0 and retain upstream attribution.
- Do not rename factual third-party products such as Cloudflare Access, Cloudflare Workers, Workers AI, or Cloudflare AI Gateway.
- Do not imply that Cloudflare sponsors or endorses Softmatrix OS.
- Preserve admin-configurable `siteName`, `siteLogo`, theme, and accent behavior.
- Use pnpm only; run `pnpm lint`, `pnpm test`, and `pnpm build` before milestone completion.
- Keep Workshop Backend Kernel and shared RPC changes minimal and separately reviewable.

---

### Task 1: Record Fork Provenance and License Obligations

**Files:**
- Create: `NOTICE`
- Create: `docs/upstream-sync.md`
- Modify: `README.md`
- Test: `scripts/softmatrix-compliance.test.js`

**Interfaces:**
- Consumes: root `LICENSE`, upstream remote URL, upstream baseline commit.
- Produces: human-readable provenance plus an automated `node --test` compliance contract.

- [ ] **Step 1: Write the failing compliance test**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Softmatrix distribution retains Apache-2.0 and upstream attribution", async () => {
  const [license, notice, readme] = await Promise.all([
    readFile(new URL("../LICENSE", import.meta.url), "utf8"),
    readFile(new URL("../NOTICE", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(notice, /derived from Cloudflare OS/i);
  assert.match(notice, /https:\/\/github\.com\/cloudflare\/cloudflare-os/);
  assert.match(readme, /^# Softmatrix OS/m);
  assert.match(readme, /Apache License 2\.0/);
});
```

- [ ] **Step 2: Run the test and confirm the missing NOTICE/README changes fail**

Run: `node --test scripts/softmatrix-compliance.test.js`

Expected: FAIL because `NOTICE` does not exist or README does not identify Softmatrix OS.

- [ ] **Step 3: Add exact provenance text and sync policy**

Create `NOTICE` with:

```text
Softmatrix OS
Copyright 2026 Softmatrix OS contributors

This product is derived from Cloudflare OS:
https://github.com/cloudflare/cloudflare-os

Cloudflare OS is licensed under the Apache License, Version 2.0. Softmatrix OS retains
the upstream license and attribution. Softmatrix OS is an independent project and is not
affiliated with, sponsored by, or endorsed by Cloudflare, Inc.
```

Add to `README.md` an opening paragraph that states the derivative relationship, links the upstream repository, and links `LICENSE` and `NOTICE`. Add to `docs/upstream-sync.md`:

```sh
git remote rename origin upstream
git remote set-url --push upstream DISABLED
git fetch upstream --prune --tags
git switch main
git merge --no-ff upstream/main
pnpm install --frozen-lockfile
pnpm lint && pnpm test && pnpm build
```

The rename command applies to this checkout because its current `origin` is the Cloudflare repository.
Document that the repository owner must add the independently chosen Softmatrix fork URL as `origin`
before the first push; do not invent or hard-code a hosting organization in source. Also document that
`packages/workshop-backend/src/server.ts`, `packages/workshop-shared/src/api.ts`, authentication, and
model policy are conflict hotspots requiring manual review.

- [ ] **Step 4: Run the compliance test**

Run: `node --test scripts/softmatrix-compliance.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add NOTICE README.md docs/upstream-sync.md scripts/softmatrix-compliance.test.js
git commit -m "docs: record Softmatrix OS fork provenance"
```

### Task 2: Centralize Immutable Product Metadata

**Files:**
- Create: `packages/workshop-shared/src/product.ts`
- Modify: `packages/workshop-shared/package.json`
- Modify: `packages/workshop-shared/src/api.ts`
- Modify: `packages/workshop-frontend/index.html`
- Modify: `package.json`
- Test: `packages/workshop-frontend/src/productMetadata.test.ts`

**Interfaces:**
- Produces: `PRODUCT_NAME`, `UPSTREAM_REPOSITORY_URL`, and `DEFAULT_SITE_NAME`.
- Consumers: frontend document metadata, admin defaults, server-generated prose, later i18n resources.

- [ ] **Step 1: Write the failing metadata test**

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_SITE_NAME } from "@gadgets/workshop-shared/api";
import { PRODUCT_NAME, UPSTREAM_REPOSITORY_URL } from "@gadgets/workshop-shared/product";

describe("Softmatrix product metadata", () => {
  it("uses Softmatrix OS while preserving factual upstream attribution", () => {
    expect(PRODUCT_NAME).toBe("Softmatrix OS");
    expect(DEFAULT_SITE_NAME).toBe(PRODUCT_NAME);
    expect(UPSTREAM_REPOSITORY_URL).toBe("https://github.com/cloudflare/cloudflare-os");
  });
});
```

- [ ] **Step 2: Run the focused test and verify the missing export failure**

Run: `pnpm --filter @gadgets/workshop-frontend test -- productMetadata.test.ts`

Expected: FAIL because `@gadgets/workshop-shared/product` is not exported.

- [ ] **Step 3: Add the product module and export map**

```ts
/** Immutable upstream-independent product name used when a deployment has no custom site name. */
export const PRODUCT_NAME = "Softmatrix OS";

/** Upstream project from which this distribution is derived. */
export const UPSTREAM_REPOSITORY_URL = "https://github.com/cloudflare/cloudflare-os";
```

Add `./product` to `packages/workshop-shared/package.json#exports`, import `PRODUCT_NAME` in `api.ts`, and define `DEFAULT_SITE_NAME = PRODUCT_NAME`. Change the root package name to `softmatrix-os` and the static HTML title to `Softmatrix OS`.

- [ ] **Step 4: Run focused and shared type tests**

Run: `pnpm --filter @gadgets/workshop-frontend test -- productMetadata.test.ts && pnpm --filter @gadgets/workshop-shared types:check`

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add package.json packages/workshop-shared packages/workshop-frontend/index.html
git commit -m "feat: centralize Softmatrix product metadata"
```

### Task 3: Replace Default Visual Assets Without Breaking Tenant Branding

**Files:**
- Modify: `packages/workshop-frontend/public/favicon.svg`
- Create: `packages/workshop-frontend/src/components/SoftmatrixMark.tsx`
- Modify: `packages/workshop-frontend/src/components/SiteLogo.tsx`
- Modify: `packages/workshop-frontend/src/components/SiteLogo.test.tsx`
- Modify: `packages/workshop-frontend/src/LoginPage.tsx`
- Modify: `packages/workshop-frontend/src/components/AppShell/AppShell.tsx`
- Modify: `packages/workshop-frontend/src/AdminPage.tsx`
- Modify: `packages/workshop-frontend/src/useWorkspaceOpen.test.tsx`

**Interfaces:**
- Consumes: `ServerConfig.siteLogo` and `ServerConfig.siteName`.
- Produces: a Softmatrix fallback mark while retaining uploaded tenant logo precedence and failure fallback.

- [ ] **Step 1: Extend `SiteLogo` tests with an explicit Softmatrix fallback assertion**

```tsx
it("renders the supplied Softmatrix fallback when no deployment logo exists", () => {
  render();
  expect(container!.querySelector("[data-softmatrix-mark]")).not.toBeNull();
  expect(container!.querySelector("img")).toBeNull();
});
```

Update the test helper fallback to `<span data-fallback data-softmatrix-mark>SM</span>`.

- [ ] **Step 2: Run the focused test**

Run: `pnpm --filter @gadgets/workshop-frontend test -- src/components/SiteLogo.test.tsx`

Expected: FAIL until all default call sites provide the Softmatrix mark.

- [ ] **Step 3: Replace fallback logo call sites and favicon**

Use the same accessible decorative behavior already present in `SiteLogo`; the fallback SVG/React mark must have `data-softmatrix-mark`, use `currentColor`, contain no Cloudflare trademark, and remain overridden by `serverConfig.siteLogo`.

```tsx
<SiteLogo size={40} className="mb-3">
  <SoftmatrixMark data-softmatrix-mark aria-hidden="true" size={40} />
</SiteLogo>
```

Change only default visuals and copy that says “default Cloudflare OS mark”; do not alter custom upload/reset behavior.

- [ ] **Step 4: Run branding component tests**

Run: `pnpm --filter @gadgets/workshop-frontend test -- src/components/SiteLogo.test.tsx src/siteLogoUtils.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add packages/workshop-frontend
git commit -m "feat: apply Softmatrix default visual identity"
```

### Task 4: Add a Targeted Brand Regression Guard

**Files:**
- Create: `scripts/softmatrix-branding.test.js`
- Modify: `package.json`
- Modify: `packages/workshop-shared/src/api.ts`
- Modify: `packages/workshop-frontend/src/AdminPage.tsx`
- Modify: `packages/gatekeeper-cloudflare/src/cloudflare.ts`
- Modify: `packages/gatekeeper-confluence/src/confluence.ts`
- Modify: `packages/gatekeeper-email/src/email.ts`
- Modify: `packages/gatekeeper-github/src/github.ts`
- Modify: `packages/gatekeeper-google/src/google.ts`
- Modify: `packages/gatekeeper-homeassistant/src/homeassistant.ts`
- Modify: `packages/gatekeeper-linear/src/linear.ts`
- Modify: `packages/gatekeeper-notion/src/notion.ts`
- Modify: `packages/gatekeeper-slack/src/slack.ts`
- Modify: `packages/gatekeeper-spotify/src/spotify.ts`
- Modify: `packages/gatekeeper-supabase/src/supabase.ts`
- Modify: `packages/gatekeeper-zoominfo/src/zoominfo.ts`
- Modify: `packages/gatekeeper-context/app/ContextLibraryPage.tsx`
- Modify: `packages/gatekeeper-context/src/description-extractors.ts`
- Modify: `packages/mcp-shared/src/endpoint.ts`

**Interfaces:**
- Produces: a deterministic allowlist-based test included by the existing `node --test scripts/*.test.js` command.

- [ ] **Step 1: Write the failing guard**

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const ALLOWED = new Set([
  "NOTICE",
  "README.md",
  "docs/upstream-sync.md",
  "scripts/softmatrix-branding.test.js",
]);

test("Cloudflare OS appears only in factual attribution", () => {
  const output = execFileSync("rg", ["-l", "Cloudflare OS", ".", "--glob", "!.git/**"], {
    encoding: "utf8",
  });
  const unexpected = output.trim().split("\n").filter(Boolean).filter((file) =>
    !ALLOWED.has(file) && !file.startsWith("docs/superpowers/"));
  assert.deepEqual(unexpected, []);
});
```

- [ ] **Step 2: Run the guard and capture the exact unexpected file list**

Run: `node --test scripts/softmatrix-branding.test.js`

Expected: FAIL and list only current product-copy occurrences.

- [ ] **Step 3: Replace product references deliberately**

Replace “Cloudflare OS” with “Softmatrix OS” only where it names this installation or product. Keep “Cloudflare Access”, “Cloudflare Workers”, “Cloudflare AI Gateway”, provider names, upstream history, license attribution, and comparison text intact. Add any intentionally factual occurrence to `ALLOWED` with a one-line comment explaining why.

- [ ] **Step 4: Run the guard and milestone verification**

Run: `node --test scripts/softmatrix-branding.test.js scripts/softmatrix-compliance.test.js && pnpm lint && pnpm test && pnpm build`

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```sh
git add scripts package.json packages README.md docs
git commit -m "chore: guard Softmatrix branding and attribution"
```
