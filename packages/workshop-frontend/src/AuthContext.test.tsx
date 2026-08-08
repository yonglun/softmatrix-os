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

describe("AuthProvider locale integration", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    localStorage.clear();
    container = document.body.appendChild(document.createElement("div"));
  });

  afterEach(() => {
    root?.unmount();
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
});
