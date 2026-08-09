// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act, type ReactNode } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toasty } from "@cloudflare/kumo";
import type { AuthenticatedApi, PublicApi, ServerConfig } from "@gadgets/workshop-shared/api";
import type { RpcStub } from "capnweb";
import LoginPage from "../LoginPage";
import SignupPage from "../SignupPage";
import OAuthButtons from "../components/auth/OAuthButtons";
import OnboardingWizard from "../OnboardingWizard";
import SettingsPage from "../SettingsPage";
import AppShell from "../components/AppShell/AppShell";
import HomeTaskSuggestions from "../components/AppShell/HomeTaskSuggestions";
import { AuthProvider } from "../AuthContext";
import { RpcContext } from "../RpcContext";
import { ServerConfigContext, ServerConfigErrorContext } from "../ServerConfigContext";
import { ThemeProvider } from "../ThemeContext";
import { renderWithLocale } from "../test/renderWithLocale";
import i18n from "./i18n";
import { useTranslation } from "react-i18next";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = () => {};
window.matchMedia = (() => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia;

const serverConfig: ServerConfig = {
  authVendors: [],
  passwordAuthEnabled: true,
  cloudflareLimitsEnabled: false,
  signupsEnabled: true,
  siteName: "Test deployment",
  announcement: "",
  banner: "",
  bannerColor: "info",
  accentColor: "",
};

function makeAuthenticatedApi(): RpcStub<AuthenticatedApi> {
  return {
    getLocale: vi.fn<() => Promise<"zh-CN">>(async () => "zh-CN"),
    setLocale: vi.fn<() => Promise<void>>(async () => {}),
    whoami: vi.fn<() => Promise<{ type: "user"; id: string; name: string }>>(async () => ({ type: "user", id: "user-1", name: "Ada" })),
    amIAdmin: vi.fn<() => Promise<boolean>>(async () => false),
    hasPasswordLogin: vi.fn<() => Promise<boolean>>(async () => false),
    getAvatar: vi.fn<() => Promise<Uint8Array | null>>(async () => null),
    listModels: vi.fn<() => Promise<never[]>>(async () => []),
    getAiConfig: vi.fn<() => Promise<{ enabled: false }>>(async () => ({ enabled: false })),
    listGatekeeperVendors: vi.fn<() => Promise<never[]>>(async () => []),
    listGatekeeperApps: vi.fn<() => Promise<never[]>>(async () => []),
    listGadgets: vi.fn<() => Promise<never[]>>(async () => []),
    subscribeConnectedAccounts: vi.fn<() => Promise<{ [Symbol.dispose](): void }>>(async () => ({ [Symbol.dispose]() {} })),
  } as unknown as RpcStub<AuthenticatedApi>;
}

function renderAuthenticated(children: ReactNode) {
  const authenticatedApi = makeAuthenticatedApi();
  const rendered = renderWithLocale(
    <ServerConfigContext.Provider value={serverConfig}>
      <ServerConfigErrorContext.Provider value={false}>
        <ThemeProvider>
          <AuthProvider authenticatedApi={authenticatedApi} onLogout={vi.fn<() => void>()}>
            <Toasty>{children}</Toasty>
          </AuthProvider>
        </ThemeProvider>
      </ServerConfigErrorContext.Provider>
    </ServerConfigContext.Provider>,
    "zh-CN",
  );
  return { ...rendered, authenticatedApi };
}

function TranslationProbe() {
  const { t } = useTranslation();
  return (
    <div>
      <span>{t("root.connectionLost")}</span>
      <span>{t("shell.home")}</span>
      <span>{t("home.getStarted")}</span>
      <span>{t("profile.loading")}</span>
      <span>{t("auth.continueWithProvider", { provider: "Acme" })}</span>
      <span>{t("onboarding.showcaseSubtitle", { siteName: "Test deployment" })}</span>
    </div>
  );
}

function makeRouter(rpcStub: RpcStub<PublicApi>, surface: ReactNode = <LoginPage rpcStub={rpcStub} />) {
  const rootRoute = createRootRoute({
    component: () => (
      <RpcContext.Provider value={{ stub: rpcStub, connectionLost: false }}>
        <ServerConfigContext.Provider value={serverConfig}>
          <ServerConfigErrorContext.Provider value={false}>
            {surface}
            <Outlet />
          </ServerConfigErrorContext.Provider>
        </ServerConfigContext.Provider>
      </RpcContext.Provider>
    ),
  });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/" });
  const signupRoute = createRoute({ getParentRoute: () => rootRoute, path: "/signup" });
  return createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: rootRoute.addChildren([indexRoute, signupRoute]),
  });
}

function makeShellRouter() {
  const rootRoute = createRootRoute({
    component: () => <AppShell><span>shell content</span></AppShell>,
  });
  const paths = ["/", "/workspaces", "/blueprints", "/outputs", "/explore", "/gatekeepers", "/profile", "/providers", "/admin"] as const;
  const routes = paths.map((path) => createRoute({ getParentRoute: () => rootRoute, path }));
  return createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: rootRoute.addChildren(routes),
  });
}

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("authentication surfaces localization", () => {
  it("renders Chinese login labels and translated document title", async () => {
    const rpcStub = { login: vi.fn<() => Promise<string | null>>() } as unknown as RpcStub<PublicApi>;
    const router = makeRouter(rpcStub);
    const rendered = renderWithLocale(<RouterProvider router={router} />, "zh-CN");
    await act(async () => { await router.load(); });
    await act(async () => { await i18n.changeLanguage("zh-CN"); });

    expect(rendered.container.textContent).toContain("登录到你的账户");
    expect(rendered.container.textContent).toContain("用户名");
    expect(rendered.container.textContent).toContain("密码");
    expect(document.title).toBe("登录 - Test deployment");
    rendered.unmount();
  });

  it("keeps the English login surface as the canonical parity fixture", async () => {
    const rpcStub = { login: vi.fn<() => Promise<string | null>>() } as unknown as RpcStub<PublicApi>;
    const router = makeRouter(rpcStub);
    const rendered = renderWithLocale(<RouterProvider router={router} />, "en");
    await act(async () => { await router.load(); });

    expect(rendered.container.textContent).toContain("Sign in to your account");
    expect(rendered.container.textContent).toContain("Username");
    expect(rendered.container.textContent).toContain("Password");
    expect(document.title).toBe("Sign in - Test deployment");
    rendered.unmount();
  });

  it("covers the Chinese signup and OAuth surfaces without rendering raw keys", async () => {
    const rpcStub = { createAccount: vi.fn<() => Promise<string | null>>() } as unknown as RpcStub<PublicApi>;
    const router = makeRouter(rpcStub, <SignupPage rpcStub={rpcStub} />);
    const rendered = renderWithLocale(<RouterProvider router={router} />, "zh-CN");
    await act(async () => { await router.load(); await i18n.changeLanguage("zh-CN"); });
    expect(rendered.container.textContent).toContain("创建你的账户");
    expect(rendered.container.textContent).toContain("确认密码");
    expect(rendered.container.textContent).not.toMatch(/auth\.|signup\./);
    rendered.unmount();

    const oauth = renderWithLocale(
      <OAuthButtons
        rpcStub={{} as RpcStub<PublicApi>}
        vendors={[{ vendorId: "acme", displayName: "Acme" }]}
      />,
      "zh-CN",
    );
    await act(async () => { await i18n.changeLanguage("zh-CN"); });
    expect(oauth.container.textContent).toContain("使用 Acme 继续");
    expect(oauth.container.textContent).not.toContain("auth.continueWithProvider");
    oauth.unmount();
  });

  it("covers Chinese onboarding and profile loading copy with dynamic values intact", async () => {
    const onboarding = renderAuthenticated(<OnboardingWizard onComplete={vi.fn<() => void>()} />);
    await vi.waitFor(() => expect(onboarding.container.textContent).toContain("创建你的资料"));
    expect(onboarding.container.textContent).toContain("选择模型");
    onboarding.unmount();

    const settings = renderAuthenticated(<SettingsPage />);
    await vi.waitFor(() => expect(settings.container.textContent).toContain("个人资料"));
    expect(settings.container.textContent).not.toContain("profile.loading");
    settings.unmount();
  });

  it("covers root and shell Chinese translations plus interpolation", async () => {
    const probe = renderWithLocale(<TranslationProbe />, "zh-CN");
    await act(async () => { await i18n.changeLanguage("zh-CN"); });
    expect(probe.container.textContent).toContain("连接已断开");
    expect(probe.container.textContent).toContain("首页");
    expect(probe.container.textContent).toContain("Test deployment");
    expect(probe.container.textContent).not.toMatch(/(?:root|shell|home|profile)\.[a-zA-Z]/);
    probe.unmount();

    const home = renderWithLocale(<HomeTaskSuggestions onPick={vi.fn<() => void>()} />, "zh-CN");
    await act(async () => { await i18n.changeLanguage("zh-CN"); });
    expect(home.container.textContent).toContain("开始使用");
    expect(home.container.textContent).not.toMatch(/home\./);
    home.unmount();

    const shellRouter = makeShellRouter();
    const shell = renderAuthenticated(<RouterProvider router={shellRouter} />);
    await act(async () => { await shellRouter.load(); await i18n.changeLanguage("zh-CN"); });
    expect(shell.container.textContent).toContain("工作区");
    expect(shell.container.textContent).toContain("探索");
    expect(shell.container.querySelector('[aria-label="连接器"]')).not.toBeNull();
    shell.unmount();
  });
});
