# Softmatrix OS Phase-One Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Softmatrix OS phase one as an Apache-2.0, bilingual, enterprise-authenticated, multi-LLM-governed distribution of Cloudflare OS in ten weeks.

**Architecture:** Execute five independently reviewable subplans in dependency order. Foundation and i18n establish shared product contracts; OIDC and model governance then proceed in parallel behind server-enforced policy boundaries; release hardening integrates all paths without broad Kernel rewrites.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Kumo UI, Cloudflare Workers/Durable Objects, Cap'n Web RPC, Pi AI, Vitest, Node test runner, pnpm 11, Playwright for final browser journeys.

## Global Constraints

- Source specification: `docs/superpowers/specs/2026-08-07-softmatrix-os-design.md`.
- Upstream baseline: `0eaec6c5e8fc6b3298ea1aa73bf5c3e47b923c7f`.
- License remains Apache-2.0; preserve upstream attribution and do not imply Cloudflare endorsement.
- Phase-one locales are exactly `en` and `zh-CN`; English is fallback.
- Phase-one enterprise SSO is one generic OIDC issuer plus existing Cloudflare Access/OAuth/password modes.
- Organization models and optional personal BYOK coexist; administrators control hard policy server-side.
- SAML, SCIM, group-role mapping, multi-tenancy, automatic model routing/failover, and workerd feature development are out of scope.
- Use pnpm only. Keep Kernel/shared RPC diffs small and separately reviewable.
- New dependencies, Durable Object migrations, public RPC, CI, and release-manifest changes receive explicit review before execution.
- The external deployment service must pass OIDC and organization-model instance state through its existing `backendExtraVars` mechanism; this repository documents and tests the boundary but cannot implement that external service.

---

## Subplans and Dependency Order

| Order | Plan | PRD milestone | Depends on | Can run in parallel with |
|---:|---|---|---|---|
| 1 | [Foundation, Branding, Compliance](2026-08-07-softmatrix-foundation-branding.md) | M0–M1 | Approved PRD | Nothing until product constants exist |
| 2 | [Chinese and English Internationalization](2026-08-07-softmatrix-i18n.md) | M2–M3 | Foundation Tasks 1–3 | Backend portions of OIDC after i18n Tasks 1–3 |
| 3 | [Generic OIDC SSO](2026-08-07-softmatrix-oidc-sso.md) | M4 | Foundation; i18n error/locale runtime | Multi-LLM governance |
| 4 | [Multi-LLM Governance](2026-08-07-softmatrix-llm-governance.md) | M5 | Foundation; i18n error/locale runtime | OIDC SSO |
| 5 | [Release Hardening](2026-08-07-softmatrix-release-hardening.md) | M6 | All earlier plans | Documentation can begin during M4/M5 |

## Program Execution Checkpoints

### Task 1: Establish the Reviewable Fork Baseline

**Files:**
- Plan: `docs/superpowers/plans/2026-08-07-softmatrix-foundation-branding.md`
- Evidence: `NOTICE`, `docs/upstream-sync.md`, product metadata tests.

**Interfaces:**
- Produces: product name, attribution, default visual identity, upstream sync policy.
- Required by: every later plan.

- [ ] **Step 1: Execute all four foundation tasks in order**

Use the exact red-green-commit steps in the linked plan. Do not bulk-replace factual Cloudflare product/provider names.

- [ ] **Step 2: Run the M1 checkpoint**

Run: `node --test scripts/softmatrix-compliance.test.js scripts/softmatrix-branding.test.js && pnpm lint && pnpm test && pnpm build`

Expected: exit 0; `DEFAULT_SITE_NAME` and static document title are Softmatrix OS; uploaded deployment branding still overrides defaults.

- [ ] **Step 3: Review commit boundaries**

Expected commits: provenance/docs, product metadata, visual identity, brand guard. No authentication, locale, or model-policy behavior is mixed into these commits.

### Task 2: Complete the Bilingual Product Contract

**Files:**
- Plan: `docs/superpowers/plans/2026-08-07-softmatrix-i18n.md`
- Evidence: locale parity/coverage tests, bilingual core UI, saved User locale, Agent locale test.

**Interfaces:**
- Produces: `SupportedLocale`, locale runtime, formatting helpers, localized UI/error keys, User locale RPC.
- Required by: localized OIDC and model management errors.

- [ ] **Step 1: Execute internationalization Tasks 1–4 sequentially**

These establish runtime, application bootstrap, persistence, and formatters. Review the new dependencies before Task 1.

- [ ] **Step 2: Execute surface migration Tasks 5–7 by route group**

Do not merge a route group unless its English/Chinese test passes and user/external content preservation assertions pass.

- [ ] **Step 3: Execute Agent/coverage Task 8 and run M3 checkpoint**

Run: `node --test scripts/i18n-coverage.test.js && pnpm --filter @gadgets/workshop-frontend test && pnpm --filter @gadgets/workshop-backend test -- agent-locale.test.ts && pnpm lint && pnpm build`

Expected: exit 0; resource keys match; no unapproved core literals; Agent defaults to saved locale without translating code or quoted content.

### Task 3: Implement OIDC and Model Governance as Parallel Workstreams

**Files:**
- Plan: `docs/superpowers/plans/2026-08-07-softmatrix-oidc-sso.md`
- Plan: `docs/superpowers/plans/2026-08-07-softmatrix-llm-governance.md`

**Interfaces:**
- OIDC produces: verified email identity, JIT/domain policy, session token through a one-time capability.
- Model governance produces: sanitized catalog, organization/BYOK resolver, Admin policy, credential test.
- Shared dependency: i18n stable keys and existing User/Admin/RPC boundaries.

- [ ] **Step 1: Execute OIDC Tasks 1–5 with security review after protocol and DO commits**

Run after Task 5: `pnpm --filter @gadgets/workshop-backend test -- oidc-config.test.ts oidc-protocol.test.ts email-identity.test.ts oidc-login.test.ts oidc-callback.test.ts`

Expected: exit 0 for success plus negative signature/claim/state/replay/JIT/domain cases.

- [ ] **Step 2: Execute model governance Tasks 1–5 with security review after resolver and credential commits**

Run after Task 5: `pnpm --filter @gadgets/workshop-backend test -- model-policy-types.test.ts organization-models.test.ts admin-model-policy.test.ts model-policy.test.ts model-credentials.test.ts ai-models.test.ts ai-gateway.test.ts`

Expected: exit 0; no catalog/RPC/log response contains test secrets; disabled or failed requested models never silently fall back.

- [ ] **Step 3: Execute OIDC Tasks 6–7 and model governance Tasks 6–7**

Run: `pnpm lint && pnpm test && pnpm build`

Expected: exit 0; both Admin/user UIs are bilingual and consume sanitized server policy rather than reconstructing authority client-side.

### Task 4: Complete Release Hardening and Acceptance

**Files:**
- Plan: `docs/superpowers/plans/2026-08-07-softmatrix-release-hardening.md`
- Evidence: browser traces on failure, license inventory, sync report, candidate manifest, QA/security approvals.

**Interfaces:**
- Consumes: complete M0–M5 code.
- Produces: release candidate, rollback point, operational documentation.

- [ ] **Step 1: Execute release Tasks 1–5**

Review Playwright and CI/release changes before applying them. Keep fixture credentials unique and non-production.

- [ ] **Step 2: Run the final automated gate**

Run: `pnpm verify:softmatrix && pnpm test:e2e`

Expected: exit 0 from a clean checkout.

- [ ] **Step 3: Execute release Task 6 candidate/promote workflow**

Promotion requires QA and security sign-off plus a recorded previous release ID. Stop and roll back on login failure, secret exposure, policy bypass, bilingual core-flow regression, or Gatekeeper authorization regression.

## PRD Requirement Traceability

| PRD requirements | Implemented by |
|---|---|
| BR-01, BR-02, BR-03, BR-04, BR-05 | Foundation Tasks 1–4; Release Tasks 4–5 |
| I18N-01, I18N-02, I18N-03, I18N-04, I18N-05, I18N-06 | i18n Tasks 1–4 |
| I18N-07 | i18n Tasks 5–7 |
| I18N-08 | i18n Task 8 |
| I18N-09 | i18n Tasks 1 and 8; Release Task 2 |
| SSO-01, SSO-02, SSO-03 | OIDC Tasks 1–3 |
| SSO-04, SSO-05, SSO-06 | OIDC Tasks 3–4 |
| SSO-07 | OIDC Tasks 1–2 and 7; Release Task 3 |
| SSO-08, SSO-09 | OIDC Tasks 5–6 |
| SSO-10 | OIDC Task 7; Release Tasks 2 and 6 |
| LLM-01 | Model Tasks 2 and 4; existing adapter regression tests |
| LLM-02, LLM-03 | Model Tasks 2–4 and 7 |
| LLM-04 | Model Tasks 2, 5–7 |
| LLM-05, LLM-06, LLM-07 | Model Tasks 1, 5–6 |
| LLM-08, LLM-09 | Model Tasks 5–6; Release Tasks 2–3 |
| LLM-10 | Model Tasks 4–5; Release Task 3 |
| License/trademark | Foundation Tasks 1 and 4; Release Task 4 |
| Upstream maintainability | Foundation Task 1; Release Task 5 |
| Full quality/release gate | Release Tasks 1–6 |

## Program Done Definition

- All linked task checkboxes are complete with one independently reviewable commit per task.
- `pnpm verify:softmatrix` and `pnpm test:e2e` pass from a clean checkout.
- Key English and Chinese journeys pass for login, workspace creation, model selection, Agent response, and policy errors.
- Two target OIDC providers pass end-to-end integration and negative security cases.
- Organization and personal model modes pass real provider smoke tests without credential leakage or silent fallback.
- Apache-2.0, upstream attribution, third-party notices, deployment/operation/upgrade docs, sync report, and rollback procedure are present.
- QA and security approve the exact immutable release candidate before promotion.
