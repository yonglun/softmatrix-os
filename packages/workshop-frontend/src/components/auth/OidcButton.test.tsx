// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OidcLoginAttempt, PublicApi } from "@gadgets/workshop-shared/api";
import type { RpcStub } from "capnweb";
import OidcButton from "./OidcButton";
import { renderWithLocale } from "../../test/renderWithLocale";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("OidcButton", () => {
  it("localizes a domain rejection and includes the correlation id", async () => {
    const dispose = vi.fn();
    const attempt = {
      wait: vi.fn(async () => ({
        ok: false as const,
        error: { code: "EMAIL_DOMAIN_NOT_ALLOWED" as const, correlationId: "auth-123" },
      })),
      [Symbol.dispose]: dispose,
    } as unknown as RpcStub<OidcLoginAttempt>;
    const rpcStub = {
      startOidcLogin: vi.fn(async () => ({ url: "https://id.example.com/authorize", attempt })),
    } as unknown as RpcStub<PublicApi>;
    vi.spyOn(window, "open").mockReturnValue({ closed: false } as Window);
    const rendered = renderWithLocale(
      <OidcButton rpcStub={rpcStub} config={{ displayName: "Company SSO" }} />,
      "zh-CN",
    );

    const button = rendered.container.querySelector("button")!;
    expect(button.textContent).toContain("使用 Company SSO 继续");
    await act(async () => { button.click(); });

    const alert = rendered.container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("此邮箱域名不允许登录");
    expect(alert.textContent).toContain("auth-123");
    expect(dispose).toHaveBeenCalled();
    rendered.unmount();
  });

  it("stores a successful session token", async () => {
    const attempt = {
      wait: vi.fn(async () => ({ ok: true as const, token: "alice:secret" })),
      [Symbol.dispose]: vi.fn(),
    } as unknown as RpcStub<OidcLoginAttempt>;
    const onSuccess = vi.fn();
    const rpcStub = {
      startOidcLogin: vi.fn(async () => ({ url: "https://id.example.com/authorize", attempt })),
    } as unknown as RpcStub<PublicApi>;
    vi.spyOn(window, "open").mockReturnValue({ closed: false } as Window);
    const rendered = renderWithLocale(
      <OidcButton rpcStub={rpcStub} config={{ displayName: "Company SSO" }} onSuccess={onSuccess} />,
      "en",
    );

    const button = rendered.container.querySelector("button")!;
    expect(button.textContent).toContain("Continue with Company SSO");
    await act(async () => { button.click(); });
    expect(localStorage.getItem("authToken")).toBe("alice:secret");
    expect(onSuccess).toHaveBeenCalledOnce();
    rendered.unmount();
  });
});
