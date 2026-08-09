// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedApi } from "@gadgets/workshop-shared/api";
import type { RpcStub } from "capnweb";
import { AuthProvider } from "./AuthContext";
import { LocaleProvider, useLocale } from "./i18n/LocaleProvider";

function Probe() {
  return createElement("span", null, useLocale().locale);
}

function apiWithLocale(
  getLocale: () => Promise<"en" | "zh-CN" | null>,
  setLocale: () => Promise<void>,
): RpcStub<AuthenticatedApi> {
  return {
    getLocale,
    setLocale,
    whoami: async () => ({ type: "user" as const, name: "Test", id: "test@example.com" }),
    amIAdmin: async () => false,
  } as unknown as RpcStub<AuthenticatedApi>;
}

describe("AuthProvider locale integration", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    localStorage.clear();
    container = document.body.appendChild(document.createElement("div"));
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    localStorage.clear();
  });

  it("waits for the authenticated preference before rendering children", async () => {
    let resolveLocale!: (locale: "en" | "zh-CN") => void;
    let reads = 0;
    const authenticatedApi = {
      getLocale: () => {
        reads++;
        return new Promise<"en" | "zh-CN">((resolve) => { resolveLocale = resolve; });
      },
      setLocale: async () => {},
      whoami: async () => ({ type: "user" as const, name: "Test", id: "test@example.com" }),
      amIAdmin: async () => false,
    } as unknown as RpcStub<AuthenticatedApi>;

    root = createRoot(container!);
    act(() => {
      root!.render(
        <LocaleProvider>
          <AuthProvider authenticatedApi={authenticatedApi} onLogout={() => {}}>
            <Probe />
          </AuthProvider>
        </LocaleProvider>,
      );
    });
    expect(container!.textContent).toBe("");

    await act(async () => {});
    await act(async () => { resolveLocale("zh-CN"); });

    expect(container!.textContent).toBe("zh-CN");
    expect(reads).toBe(1);
  });

  function renderAuthenticated(authenticatedApi: RpcStub<AuthenticatedApi>) {
    root = createRoot(container!);
    act(() => {
      root!.render(
        <LocaleProvider>
          <AuthProvider authenticatedApi={authenticatedApi} onLogout={() => {}}>
            <Probe />
          </AuthProvider>
        </LocaleProvider>,
      );
    });
  }

  it("migrates a null server preference once using the local locale", async () => {
    let writes = 0;
    renderAuthenticated(apiWithLocale(async () => null, async () => { writes++; }));

    await act(async () => {});

    expect(container!.textContent).toBe("en");
    expect(writes).toBe(1);
  });

  it("applies an existing server preference without writing it back", async () => {
    let writes = 0;
    renderAuthenticated(apiWithLocale(async () => "zh-CN", async () => { writes++; }));

    await act(async () => {});

    expect(container!.textContent).toBe("zh-CN");
    expect(writes).toBe(0);
  });

  it("renders children when the locale read rejects", async () => {
    renderAuthenticated(apiWithLocale(async () => { throw new Error("offline"); }, async () => {}));

    await act(async () => {});

    expect(container!.textContent).toBe("en");
  });

  it("retries a settled locale read after remounting with the same stub", async () => {
    let reads = 0;
    const api = apiWithLocale(async () => {
      reads++;
      if (reads === 1) throw new Error("offline");
      return "zh-CN";
    }, async () => {});
    renderAuthenticated(api);
    await act(async () => {});
    expect(container!.textContent).toBe("en");

    act(() => root!.unmount());
    root = createRoot(container!);
    act(() => {
      root!.render(
        <LocaleProvider>
          <AuthProvider authenticatedApi={api} onLogout={() => {}}>
            <Probe />
          </AuthProvider>
        </LocaleProvider>,
      );
    });
    await act(async () => {});

    expect(reads).toBe(2);
    expect(container!.textContent).toBe("zh-CN");
  });
});
