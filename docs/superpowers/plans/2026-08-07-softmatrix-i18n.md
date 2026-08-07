# Softmatrix OS Chinese and English Internationalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver complete `en` and `zh-CN` product UI, persistent locale selection, locale-aware formatting, stable localizable errors, and Agent default-language behavior.

**Architecture:** Use one application-level `LocaleProvider` backed by i18next/react-i18next. English resources are canonical and loaded synchronously; Simplified Chinese resources must have identical keys. Browser/local storage chooses the pre-login locale, the authenticated User Durable Object becomes authoritative after login, and locale is passed separately into Agent context rather than translating user data.

**Tech Stack:** React 19, i18next, react-i18next, TypeScript 5.9, Vitest/jsdom, `Intl.DateTimeFormat`/`Intl.NumberFormat`, Cap'n Web RPC.

## Global Constraints

- Supported locale union is exactly `"en" | "zh-CN"` in phase one.
- English is the final fallback; never render a raw translation key.
- Do not translate user messages, history, Gadget content, source code, model output, or connector-returned data.
- Locale storage key is `softmatrix.locale`; legacy or unknown values are ignored.
- User locale preference overrides browser detection after login.
- User-explicit language instructions override the stored Agent default language.
- Use pnpm only; adding i18next/react-i18next requires dependency review before executing Task 1.
- Every exported shared API member must have a doc comment.

---

### Task 1: Add the Locale Runtime and Typed Resource Contract

**Files:**
- Modify: `packages/workshop-frontend/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/workshop-shared/src/api.ts`
- Create: `packages/workshop-frontend/src/i18n/locales.ts`
- Create: `packages/workshop-frontend/src/i18n/resources/en.ts`
- Create: `packages/workshop-frontend/src/i18n/resources/zh-CN.ts`
- Create: `packages/workshop-frontend/src/i18n/i18n.ts`
- Test: `packages/workshop-frontend/src/i18n/i18n.test.ts`

**Interfaces:**
- Produces: shared `SupportedLocale`, frontend `SUPPORTED_LOCALES`, `detectLocale()`, and initialized `i18n`.
- Consumers: application bootstrap, settings, formatter hooks, all UI migration tasks.

- [ ] **Step 1: Obtain dependency approval and add the packages**

Run after approval: `pnpm --filter @gadgets/workshop-frontend add i18next react-i18next`

Expected: only the frontend manifest and `pnpm-lock.yaml` change; both packages resolve under Apache-2.0/MIT-compatible licensing and support React 19.

- [ ] **Step 2: Write failing locale detection and parity tests**

```ts
import { describe, expect, it } from "vitest";
import { detectLocale, isSupportedLocale } from "./locales";
import en from "./resources/en";
import zhCN from "./resources/zh-CN";

describe("locale contract", () => {
  it.each([
    ["zh-CN", "zh-CN"], ["zh-Hans", "zh-CN"], ["zh", "zh-CN"],
    ["en-US", "en"], ["fr-FR", "en"],
  ])("maps %s to %s", (input, expected) => expect(detectLocale([input])).toBe(expected));

  it("rejects persisted unknown locales", () => expect(isSupportedLocale("zh-TW")).toBe(false));
  it("keeps Chinese keys identical to English", () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
  });
});
```

- [ ] **Step 3: Run the focused test**

Run: `pnpm --filter @gadgets/workshop-frontend test -- src/i18n/i18n.test.ts`

Expected: FAIL because locale modules do not exist.

- [ ] **Step 4: Implement locale detection and i18next initialization**

```ts
/** Locales supported by the phase-one Softmatrix UI and Agent language preference. */
export type SupportedLocale = "en" | "zh-CN";
```

Add that documented type to `workshop-shared/src/api.ts`, then consume it in the frontend:

```ts
import type { SupportedLocale } from "@gadgets/workshop-shared/api";

export const SUPPORTED_LOCALES = ["en", "zh-CN"] as const;

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return value === "en" || value === "zh-CN";
}

export function detectLocale(languages: readonly string[] = navigator.languages): SupportedLocale {
  return languages.some((language) => /^zh(?:-|$)/i.test(language)) ? "zh-CN" : "en";
}
```

```ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./resources/en";
import zhCN from "./resources/zh-CN";

void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  resources: { en: { translation: en }, "zh-CN": { translation: zhCN } },
});

export default i18n;
```

Start both resource objects with identical `app`, `common`, `auth`, `errors`, `profile`, `admin`, `models`, `workspaces`, `blueprints`, `connectors`, `chat`, and `gadgets` key families.

- [ ] **Step 5: Run the focused test and commit**

Run: `pnpm --filter @gadgets/workshop-frontend test -- src/i18n/i18n.test.ts`

Expected: PASS.

```sh
git add packages/workshop-shared/src/api.ts packages/workshop-frontend/package.json packages/workshop-frontend/src/i18n pnpm-lock.yaml
git commit -m "feat: add English and Chinese locale runtime"
```

### Task 2: Bootstrap Locale Before Application Rendering

**Files:**
- Create: `packages/workshop-frontend/src/i18n/LocaleProvider.tsx`
- Create: `packages/workshop-frontend/src/test/renderWithLocale.tsx`
- Modify: `packages/workshop-frontend/src/main.tsx`
- Modify: `packages/workshop-frontend/src/routes/__root.tsx`
- Modify: `packages/workshop-frontend/src/useDocumentTitle.ts`
- Modify: `packages/workshop-frontend/index.html`
- Test: `packages/workshop-frontend/src/i18n/LocaleProvider.test.tsx`

**Interfaces:**
- Consumes: `detectLocale()`, `softmatrix.locale`, initialized i18next.
- Produces: `useLocale(): { locale, setLocale }`, synchronized `<html lang>`/document title behavior, and `renderWithLocale()` for existing createRoot-style tests.

- [ ] **Step 1: Write the failing provider test**

```tsx
it("uses a valid stored locale and updates the document language", async () => {
  localStorage.setItem("softmatrix.locale", "zh-CN");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<LocaleProvider><Probe /></LocaleProvider>));
  expect(container.textContent).toBe("zh-CN");
  expect(document.documentElement.lang).toBe("zh-CN");
  act(() => root.unmount());
  container.remove();
});
```

- [ ] **Step 2: Run the focused test**

Run: `pnpm --filter @gadgets/workshop-frontend test -- src/i18n/LocaleProvider.test.tsx`

Expected: FAIL because `LocaleProvider` does not exist.

- [ ] **Step 3: Implement the provider**

```tsx
const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const stored = localStorage.getItem("softmatrix.locale");
  const [locale, updateLocale] = useState<SupportedLocale>(
    isSupportedLocale(stored) ? stored : detectLocale(),
  );

  const setLocale = useCallback((next: SupportedLocale) => {
    localStorage.setItem("softmatrix.locale", next);
    updateLocale(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    void i18n.changeLanguage(locale);
  }, [locale]);

  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}
```

Add a test helper without introducing React Testing Library:

```tsx
export async function renderWithLocale(element: ReactElement, locale: SupportedLocale) {
  localStorage.setItem("softmatrix.locale", locale);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<LocaleProvider>{element}</LocaleProvider>));
  return {
    container,
    unmount: () => act(() => { root.unmount(); container.remove(); }),
  };
}
```

Wrap the complete root, including signed-out routes, in `LocaleProvider`. Change static HTML `lang` to `en`; runtime owns the final value. Change `useDocumentTitle` call sites to pass translated titles instead of translation keys.

- [ ] **Step 4: Run provider and title tests**

Run: `pnpm --filter @gadgets/workshop-frontend test -- src/i18n/LocaleProvider.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```sh
git add packages/workshop-frontend/index.html packages/workshop-frontend/src
git commit -m "feat: initialize locale across public and authenticated UI"
```

### Task 3: Persist Authenticated User Locale Through RPC

**Files:**
- Modify: `packages/workshop-shared/src/api.ts`
- Modify: `packages/workshop-backend/src/user.ts`
- Modify: `packages/workshop-backend/src/server.ts`
- Modify: `packages/workshop-frontend/src/AuthContext.tsx`
- Modify: `packages/workshop-frontend/src/i18n/LocaleProvider.tsx`
- Test: `packages/workshop-backend/__tests__/user-locale.test.ts`
- Test: `packages/workshop-frontend/src/i18n/LocaleProvider.test.tsx`

**Interfaces:**
- Produces: `AuthenticatedApi.getLocale()`, `AuthenticatedApi.setLocale(locale)`, corresponding User DO methods using the Task 1 `SupportedLocale`.
- Consumers: settings UI and Agent locale context.

- [ ] **Step 1: Add failing storage and RPC contract tests**

```ts
it("stores only supported locale values", async () => {
  await user.setLocale("zh-CN");
  await expect(user.getLocale()).resolves.toBe("zh-CN");
  await expect(user.setLocale("fr" as never)).rejects.toThrow("Unsupported locale");
});
```

- [ ] **Step 2: Run the backend focused test**

Run: `pnpm --filter @gadgets/workshop-backend test -- user-locale.test.ts`

Expected: FAIL because the methods and singleton do not exist.

- [ ] **Step 3: Add the documented shared API and User storage**

```ts
// In AuthenticatedApi, reusing SupportedLocale from Task 1:
/** Return the user's saved locale, or null when browser detection should choose it. */
getLocale(): Promise<SupportedLocale | null>;
/** Save the user's locale preference. Reject unsupported values. */
setLocale(locale: SupportedLocale): Promise<void>;
```

Add `locale: <SupportedLocale | null>null` to `makeUserStorage().singletons`. Implement strict equality validation, and proxy both methods through `AuthenticatedApiImpl`.

- [ ] **Step 4: Synchronize the authenticated preference without UI flicker**

After `AuthProvider` receives `authenticatedApi`, call `getLocale()`. If it returns a value, apply it. If it returns null, persist the provider's current detected locale once. Guard cancellation and do not place an RPC stub directly in React state.

- [ ] **Step 5: Run focused tests and commit**

Run: `pnpm --filter @gadgets/workshop-backend test -- user-locale.test.ts && pnpm --filter @gadgets/workshop-frontend test -- src/i18n/LocaleProvider.test.tsx`

Expected: PASS.

```sh
git add packages/workshop-shared/src/api.ts packages/workshop-backend/src packages/workshop-backend/__tests__ packages/workshop-frontend/src
git commit -m "feat: persist user locale preference"
```

### Task 4: Add the Language Control and Locale-Aware Formatters

**Files:**
- Create: `packages/workshop-frontend/src/i18n/format.ts`
- Modify: `packages/workshop-frontend/src/SettingsPage.tsx`
- Modify: `packages/workshop-frontend/src/utils/formatTimestamp.ts`
- Modify: `packages/workshop-frontend/src/ShareModal.tsx`
- Modify: `packages/workshop-frontend/src/Activity.tsx`
- Modify: `packages/workshop-frontend/src/components/GadgetList.tsx`
- Modify: `packages/workshop-frontend/src/ChatInterface.tsx`
- Test: `packages/workshop-frontend/src/i18n/format.test.ts`

**Interfaces:**
- Produces: `formatDate`, `formatTime`, `formatDateTime`, `formatNumber`, `formatCurrency` accepting an explicit `SupportedLocale`.

- [ ] **Step 1: Write deterministic formatter tests**

```ts
it("formats the same instant using the selected locale", () => {
  const date = new Date("2026-08-07T12:00:00Z");
  expect(formatDate(date, "en", { timeZone: "UTC" }))
    .toBe(new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(date));
  expect(formatDate(date, "zh-CN", { timeZone: "UTC" }))
    .toBe(new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "UTC" }).format(date));
  expect(formatNumber(12345, "zh-CN")).toBe(new Intl.NumberFormat("zh-CN").format(12345));
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `pnpm --filter @gadgets/workshop-frontend test -- src/i18n/format.test.ts`

Expected: FAIL because the formatter module does not exist.

- [ ] **Step 3: Implement formatters and Settings control**

```ts
export function formatDate(value: Date, locale: SupportedLocale,
    options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", ...options }).format(value);
}

export function formatNumber(value: number, locale: SupportedLocale): string {
  return new Intl.NumberFormat(locale).format(value);
}
```

Add a Settings “Language / 语言” select whose values are exactly `en` and `zh-CN`; call `setLocale()` immediately and `authenticatedApi.setLocale()` with an error toast on persistence failure.

- [ ] **Step 4: Replace direct locale formatting in the listed files**

Remove module-level `Intl` caches that ignore a changed locale. Obtain locale from `useLocale()` and use formatter helpers; keep source timestamps and numeric data unchanged.

- [ ] **Step 5: Run formatter/component tests and commit**

Run: `pnpm --filter @gadgets/workshop-frontend test -- src/i18n/format.test.ts src/ShareModal.test.tsx`

Expected: PASS.

```sh
git add packages/workshop-frontend/src
git commit -m "feat: add language settings and locale-aware formatting"
```

### Task 5: Localize Authentication, Onboarding, Profile, and Shell Surfaces

**Files:**
- Modify: `packages/workshop-frontend/src/LoginPage.tsx`
- Modify: `packages/workshop-frontend/src/SignupPage.tsx`
- Modify: `packages/workshop-frontend/src/OnboardingWizard.tsx`
- Modify: `packages/workshop-frontend/src/SettingsPage.tsx`
- Modify: `packages/workshop-frontend/src/routes/__root.tsx`
- Modify: `packages/workshop-frontend/src/components/auth/OAuthButtons.tsx`
- Modify: `packages/workshop-frontend/src/components/AppShell/AppShell.tsx`
- Modify: `packages/workshop-frontend/src/components/AppShell/AppSidebar.tsx`
- Modify: `packages/workshop-frontend/src/components/UserMenu.tsx`
- Modify: `packages/workshop-frontend/src/i18n/resources/en.ts`
- Modify: `packages/workshop-frontend/src/i18n/resources/zh-CN.ts`
- Test: `packages/workshop-frontend/src/i18n/auth-surfaces.test.tsx`

**Interfaces:**
- Consumes: `useTranslation()`, `useLocale()`, existing authentication callbacks.
- Produces: localized public/authenticated entry flow without changing auth authority.

- [ ] **Step 1: Write a failing Chinese login assertion**

```tsx
it("renders the login form in Simplified Chinese", async () => {
  const { container, unmount } = await renderLoginWithLocale("zh-CN", {
    passwordAuthEnabled: true, authVendors: [], siteName: "Softmatrix OS",
  });
  expect(container.querySelector("h1")?.textContent).toBe("Softmatrix OS");
  expect(container.querySelector('input[autocomplete="username"]')
    ?.closest("label")?.textContent).toContain("用户名");
  expect([...container.querySelectorAll("button")].some((button) =>
    button.textContent?.trim() === "登录")).toBe(true);
  unmount();
});
```

`renderLoginWithLocale()` must compose `renderWithLocale()` with real `ServerConfigContext`,
`ServerConfigErrorContext`, and a non-lost `RpcContext`; its `rpcStub` is a typed object whose
`login` and `startGatekeeperLogin` members are `vi.fn()` and no network call occurs.

- [ ] **Step 2: Run the focused test**

Run: `pnpm --filter @gadgets/workshop-frontend test -- src/i18n/auth-surfaces.test.tsx`

Expected: FAIL with English-only content.

- [ ] **Step 3: Replace literal UI strings with stable keys**

Use complete phrases, not string concatenation:

```tsx
const { t } = useTranslation();
useDocumentTitle(t("auth.signIn.title"));
<Button>{t("auth.signIn.submit")}</Button>
<Button>{t("auth.oauth.continueWith", { provider: vendor.displayName })}</Button>
```

Add matching English and Chinese values for every label, placeholder, validation error, loading state, navigation item, tooltip, ARIA label, toast, and empty state in the listed files.

- [ ] **Step 4: Run focused tests and commit**

Run: `pnpm --filter @gadgets/workshop-frontend test -- src/i18n/auth-surfaces.test.tsx`

Expected: PASS in both locales.

```sh
git add packages/workshop-frontend/src
git commit -m "feat: localize account and application shell"
```

### Task 6: Localize Workspaces, Blueprints, Outputs, and Gadget Editor

**Files:**
- Modify: `packages/workshop-frontend/src/routes/index.tsx`
- Modify: `packages/workshop-frontend/src/routes/workspaces.tsx`
- Modify: `packages/workshop-frontend/src/routes/blueprints.tsx`
- Modify: `packages/workshop-frontend/src/routes/blueprint.$id.tsx`
- Modify: `packages/workshop-frontend/src/routes/outputs.tsx`
- Modify: `packages/workshop-frontend/src/components/GadgetList.tsx`
- Modify: `packages/workshop-frontend/src/BlueprintLandingPage.tsx`
- Modify: `packages/workshop-frontend/src/BlueprintModal.tsx`
- Modify: `packages/workshop-frontend/src/BlueprintsPage.tsx`
- Modify: `packages/workshop-frontend/src/GadgetEditor.tsx`
- Modify: `packages/workshop-frontend/src/GadgetCodeInterface.tsx`
- Modify: `packages/workshop-frontend/src/FileSidebar.tsx`
- Modify: locale resource files
- Test: `packages/workshop-frontend/src/i18n/workspace-surfaces.test.tsx`

**Interfaces:**
- Consumes: translation and formatter hooks.
- Produces: localized create/browse/open/edit flows; preserves user titles, filenames, and code verbatim.

- [ ] **Step 1: Add failing English/Chinese empty-state tests**

```tsx
it.each([
  ["en", "No workspaces yet"],
  ["zh-CN", "还没有工作区"],
] as const)("localizes workspace empty state in %s", async (locale, emptyTitle) => {
  const { container, unmount } = await renderWorkspaceFixture(locale, []);
  expect(container.textContent).toContain(emptyTitle);
  expect(container.textContent).not.toContain("客户 Q3 Plan");
  unmount();
});

it("preserves user-provided workspace titles", async () => {
  const { container, unmount } = await renderWorkspaceFixture("zh-CN", [
    { id: "w1", title: "客户 Q3 Plan" },
  ]);
  expect(container.textContent).toContain("客户 Q3 Plan");
  unmount();
});
```

`renderWorkspaceFixture()` uses `renderWithLocale()` and a typed fake `AuthenticatedApi.listGadgets()`
return; it must not translate or alter the supplied title.

- [ ] **Step 2: Run the focused test**

Run: `pnpm --filter @gadgets/workshop-frontend test -- src/i18n/workspace-surfaces.test.tsx`

Expected: FAIL on untranslated English literals.

- [ ] **Step 3: Migrate the listed surfaces by complete semantic key**

```tsx
<EmptyState
  title={t("workspaces.empty.title")}
  description={t("workspaces.empty.description")}
  actionLabel={t("workspaces.empty.create")}
/>
```

Translate application chrome and action copy only. Do not pass workspace titles, Blueprint author content, filenames, code, or imported Gadget metadata through `t()`.

- [ ] **Step 4: Run focused tests and commit**

Run: `pnpm --filter @gadgets/workshop-frontend test -- src/i18n/workspace-surfaces.test.tsx src/WorkpiecePicker.test.tsx`

Expected: PASS.

```sh
git add packages/workshop-frontend/src
git commit -m "feat: localize workspace and gadget flows"
```

### Task 7: Localize Chat, Connectors, Models, and Admin

**Files:**
- Modify: `packages/workshop-frontend/src/ChatInterface.tsx`
- Modify: `packages/workshop-frontend/src/Connections.tsx`
- Modify: `packages/workshop-frontend/src/ConnectAccountModal.tsx`
- Modify: `packages/workshop-frontend/src/GatekeeperModal.tsx`
- Modify: `packages/workshop-frontend/src/ResourcePicker.tsx`
- Modify: `packages/workshop-frontend/src/routes/gatekeepers.tsx`
- Modify: `packages/workshop-frontend/src/routes/providers.tsx`
- Modify: `packages/workshop-frontend/src/AddModelModal.tsx`
- Modify: `packages/workshop-frontend/src/AdminPage.tsx`
- Modify: locale resource files
- Test: `packages/workshop-frontend/src/i18n/management-surfaces.test.tsx`

**Interfaces:**
- Consumes: translation/formatter hooks and dynamic provider/vendor display names.
- Produces: localized platform-generated chat chrome, connector flows, model management, and admin UI.

- [ ] **Step 1: Add failing tests for plural/interpolation boundaries**

```tsx
expect(t("chat.tokens", { count: 1200 })).toContain("1,200");
expect(t("connectors.continueWith", { provider: "GitHub" })).toContain("GitHub");
```

Also assert that a Gatekeeper-provided description remains byte-for-byte unchanged.

- [ ] **Step 2: Run the focused test**

Run: `pnpm --filter @gadgets/workshop-frontend test -- src/i18n/management-surfaces.test.tsx`

Expected: FAIL before migration.

- [ ] **Step 3: Migrate platform copy and preserve external data**

Use `t()` for buttons, tabs, warnings, confirmations, status labels, system-generated chat messages, validation, toasts, tooltips, and ARIA labels. Treat provider names, model names, vendor descriptions, user prompts, model responses, action payloads, and connector data as untrusted dynamic values that must not become translation keys.

- [ ] **Step 4: Run affected tests and commit**

Run: `pnpm --filter @gadgets/workshop-frontend test -- src/i18n/management-surfaces.test.tsx src/ChatInterface.markdown.test.ts src/ObserverConfigModal.test.tsx`

Expected: PASS.

```sh
git add packages/workshop-frontend/src
git commit -m "feat: localize chat and management surfaces"
```

### Task 8: Apply Locale to Agent Defaults and Add CI Coverage Guard

**Files:**
- Modify: `packages/workshop-backend/src/user.ts`
- Modify: `packages/workshop-backend/src/agent.ts`
- Create: `packages/workshop-backend/__tests__/agent-locale.test.ts`
- Create: `scripts/i18n-coverage.test.js`
- Modify: `packages/workshop-frontend/src/i18n/resources/en.ts`
- Modify: `packages/workshop-frontend/src/i18n/resources/zh-CN.ts`

**Interfaces:**
- Consumes: saved `SupportedLocale` from Task 3.
- Produces: `UserChatContext.locale` and CI failures for resource parity or new core JSX literals.

- [ ] **Step 1: Write the failing Agent locale test**

```ts
it("adds a default response language without overriding explicit user instructions", () => {
  expect(buildLocaleInstruction("zh-CN")).toContain("Simplified Chinese");
  expect(buildLocaleInstruction("en")).toContain("English");
  expect(buildLocaleInstruction("zh-CN")).toContain("explicit language request");
});
```

- [ ] **Step 2: Run the focused test**

Run: `pnpm --filter @gadgets/workshop-backend test -- agent-locale.test.ts`

Expected: FAIL because `buildLocaleInstruction` does not exist.

- [ ] **Step 3: Implement the bounded Agent instruction**

```ts
export function buildLocaleInstruction(locale: SupportedLocale): string {
  const language = locale === "zh-CN" ? "Simplified Chinese" : "English";
  return `Default to ${language} for user-facing prose. ` +
      "If the user explicitly requests another language, follow that request. " +
      "Never translate source code, identifiers, quoted user content, or external data unless asked.";
}
```

Add `locale` to `UserChatContext`, populate it from user storage with `en` fallback, and append this bounded instruction to the system context without modifying user messages.

- [ ] **Step 4: Add an AST-based resource/JSX coverage test**

Use the existing TypeScript dependency from Node to parse frontend `.tsx` files. Fail on non-empty JSX text or literal `aria-label`, `title`, `placeholder`, and toast titles outside tests, samples, code-editor data, and `src/i18n/resources`. Keep an explicit allowlist with file, exact text, and reason; reject wildcard allowlists.

- [ ] **Step 5: Run full internationalization verification**

Run: `node --test scripts/i18n-coverage.test.js && pnpm --filter @gadgets/workshop-frontend test && pnpm --filter @gadgets/workshop-backend test -- agent-locale.test.ts && pnpm lint && pnpm build`

Expected: all commands exit 0; the coverage test reports identical English/Chinese keys and zero unapproved core literals.

- [ ] **Step 6: Commit**

```sh
git add packages/workshop-backend packages/workshop-frontend scripts/i18n-coverage.test.js
git commit -m "feat: complete bilingual product experience"
```
