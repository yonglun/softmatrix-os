// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicApi, ServerConfig } from "@gadgets/workshop-shared/api";
import type { RpcStub } from "capnweb";
import LoginPage from "../LoginPage";
import { RpcContext } from "../RpcContext";
import { ServerConfigContext, ServerConfigErrorContext } from "../ServerConfigContext";
import { renderWithLocale } from "../test/renderWithLocale";
import i18n from "./i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = () => {};

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

function makeRouter(rpcStub: RpcStub<PublicApi>) {
  const rootRoute = createRootRoute({
    component: () => (
      <RpcContext.Provider value={{ stub: rpcStub, connectionLost: false }}>
        <ServerConfigContext.Provider value={serverConfig}>
          <ServerConfigErrorContext.Provider value={false}>
            <LoginPage rpcStub={rpcStub} />
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
});
