// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedApi } from "@gadgets/workshop-shared/api";
import type { RpcStub } from "capnweb";
import { LocaleProvider, useLocale } from "./i18n/LocaleProvider";
import { LanguageControl } from "./SettingsPage";

function render(children: ReactNode): { root: Root; container: HTMLDivElement } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(createElement(LocaleProvider, null, children)));
  return { root, container };
}

function ApiRegistration({ api }: { api: RpcStub<AuthenticatedApi> }) {
  useLocale().registerAuthenticatedApi(api);
  return null;
}

afterEach(() => {
  localStorage.clear();
  document.body.replaceChildren();
});

describe("Settings language control", () => {
  it("shows exactly the supported values and updates the locale immediately", async () => {
    const { root, container } = render(
      createElement(LanguageControl),
    );
    const select = container.querySelector("select");
    expect(select).not.toBeNull();
    expect([...select!.options].map((option) => option.value)).toEqual(["en", "zh-CN"]);

    await act(async () => {
      select!.value = "zh-CN";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(select!.value).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    root.unmount();
  });

  it("surfaces a rejected authenticated persistence without rolling back locally", async () => {
    const onPersistenceError = vi.fn<() => void>();
    const api = {
      setLocale: vi.fn<() => Promise<void>>(() => Promise.reject(new Error("offline"))),
    } as unknown as RpcStub<AuthenticatedApi>;
    const { root, container } = render(
      createElement("div", null,
        createElement(ApiRegistration, { api }),
        createElement(LanguageControl, { onPersistenceError }),
      ),
    );
    const select = container.querySelector("select")!;

    await act(async () => {
      select.value = "zh-CN";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(select.value).toBe("zh-CN");
    expect(onPersistenceError).toHaveBeenCalledTimes(1);
    expect(api.setLocale).toHaveBeenCalledTimes(1);
    root.unmount();
  });
});
