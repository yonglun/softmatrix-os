// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from "react";
import { Toasty } from "@cloudflare/kumo";
import type { AuthenticatedApi, GadgetMetadataWithTimestamps } from "@gadgets/workshop-shared/api";
import type { RpcStub } from "capnweb";
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import GadgetList from "../components/GadgetList";
import { AuthProvider } from "../AuthContext";
import { renderWithLocale } from "../test/renderWithLocale";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeAuthenticatedApi(
  listGadgets: () => Promise<GadgetMetadataWithTimestamps[]>,
  locale: "en" | "zh-CN",
): RpcStub<AuthenticatedApi> {
  return {
    getLocale: vi.fn<() => Promise<"en" | "zh-CN">>(async () => locale),
    setLocale: vi.fn<() => Promise<void>>(async () => {}),
    whoami: vi.fn<() => Promise<{ type: "user"; id: string; name: string }>>(async () => ({ type: "user", id: "user-1", name: "Ada" })),
    amIAdmin: vi.fn<() => Promise<boolean>>(async () => false),
    listGadgets: vi.fn<() => Promise<GadgetMetadataWithTimestamps[]>>(listGadgets),
    listFeaturedBlueprints: vi.fn<() => Promise<never[]>>(async () => []),
  } as unknown as RpcStub<AuthenticatedApi>;
}

function renderWorkspaceList(
  locale: "en" | "zh-CN",
  listGadgets: () => Promise<GadgetMetadataWithTimestamps[]>,
  withRouter = false,
) {
  const authenticatedApi = makeAuthenticatedApi(listGadgets, locale);
  const content = (
    <AuthProvider authenticatedApi={authenticatedApi} onLogout={vi.fn<() => void>()}>
      <Toasty>
        <GadgetList />
      </Toasty>
    </AuthProvider>
  );
  if (!withRouter) {
    const rendered = renderWithLocale(content, locale);
    return { ...rendered, authenticatedApi };
  }
  const rootRoute = createRootRoute({ component: () => content });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/" });
  const workspaceRoute = createRoute({ getParentRoute: () => rootRoute, path: "/workspace/$id" });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: rootRoute.addChildren([indexRoute, workspaceRoute]),
  });
  const rendered = renderWithLocale(
    <RouterProvider router={router} />,
    locale,
  );
  return { ...rendered, authenticatedApi, router };
}

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("workspace surfaces localization", () => {
  it("renders the English empty workspace state", async () => {
    const rendered = renderWorkspaceList("en", async () => []);
    await act(async () => {});

    await vi.waitFor(() => expect(rendered.container.textContent).toContain("Your workspaces"));
    expect(rendered.container.textContent).toContain("You haven't created any workspaces yet");
    expect(rendered.container.textContent).not.toMatch(/workspaces\.[a-zA-Z]/);
    rendered.unmount();
  });

  it("renders the Chinese empty workspace state", async () => {
    const rendered = renderWorkspaceList("zh-CN", async () => []);
    await act(async () => {});

    await vi.waitFor(() => expect(rendered.container.textContent).toContain("你的工作区"));
    expect(rendered.container.textContent).toContain("你还没有创建任何工作区");
    expect(rendered.container.textContent).not.toMatch(/workspaces\.[a-zA-Z]/);
    rendered.unmount();
  });

  it("keeps dynamic workspace titles and owner names verbatim", async () => {
    const title = "客户 · Q3/2026";
    const owner = "李小龙 / Ada";
    const rendered = renderWorkspaceList("zh-CN", async () => [{
      id: "workspace-1",
      title,
      owner: { type: "user", id: "owner-1", name: owner },
      created: new Date("2026-08-01T00:00:00Z"),
      lastActive: new Date("2026-08-08T00:00:00Z"),
    }], true);
    await act(async () => {});

    await vi.waitFor(() => expect(rendered.container.textContent).toContain(title));
    expect(rendered.container.textContent).toContain(owner);
    rendered.unmount();
  });
});
