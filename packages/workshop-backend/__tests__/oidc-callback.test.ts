import { describe, expect, it, vi } from "vitest";
import { handleOidcCallback } from "../src/server.js";

function callbackContext(complete = vi.fn(async () => ({ ok: true, token: "session-token" }))) {
  const id = { toString: () => "attempt-id" };
  const attemptNamespace = {
    idFromString: vi.fn(() => id),
    get: vi.fn(() => ({ complete })),
  };
  return {
    ctx: { exports: { OidcLoginDurableObject: attemptNamespace } },
    complete,
    attemptNamespace,
  };
}

describe("OIDC callback endpoint", () => {
  it("completes the attempt and returns static popup-closing HTML", async () => {
    const fixture = callbackContext();
    const response = await handleOidcCallback(
      new Request("https://softmatrix.example/api/auth/oidc/callback?code=x&state=attempt-id"),
      {} as never,
      fixture.ctx as never,
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain("session-token");
    expect(body).not.toContain("attempt-id");
    expect(fixture.complete).toHaveBeenCalledWith(
      "https://softmatrix.example/api/auth/oidc/callback?code=x&state=attempt-id",
    );
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("canonicalizes callbacks received over HTTP behind a TLS-terminating proxy", async () => {
    const fixture = callbackContext();
    const response = await handleOidcCallback(
      new Request("http://127.0.0.1:8787/api/auth/oidc/callback?code=x&state=attempt-id", {
        headers: {
          Host: "os.softmatrix.io",
          "X-Forwarded-Proto": "https",
        },
      }),
      {
        OIDC_ISSUER: "https://login.microsoftonline.com/tenant/v2.0",
        OIDC_CLIENT_ID: "client-id",
        OIDC_CLIENT_SECRET: "client-secret",
        PUBLIC_BASE_URL: "https://os.softmatrix.io",
      } as never,
      fixture.ctx as never,
    );

    expect(response.status).toBe(200);
    expect(fixture.complete).toHaveBeenCalledWith(
      "https://os.softmatrix.io/api/auth/oidc/callback?code=x&state=attempt-id",
    );
  });

  it("rejects malformed callbacks without resolving a login attempt", async () => {
    const fixture = callbackContext();
    const response = await handleOidcCallback(
      new Request("https://softmatrix.example/api/auth/oidc/callback?state=attempt-id"),
      {} as never,
      fixture.ctx as never,
    );

    expect(response.status).toBe(400);
    expect(fixture.complete).not.toHaveBeenCalled();
  });

  it("forwards a provider cancellation with state to the attempt", async () => {
    const fixture = callbackContext();
    const response = await handleOidcCallback(
      new Request("https://softmatrix.example/api/auth/oidc/callback?error=access_denied&state=attempt-id"),
      {} as never,
      fixture.ctx as never,
    );
    expect(response.status).toBe(200);
    expect(fixture.complete).toHaveBeenCalled();
  });

  it("accepts only GET callbacks", async () => {
    const fixture = callbackContext();
    const response = await handleOidcCallback(
      new Request("https://softmatrix.example/api/auth/oidc/callback?code=x&state=attempt-id", {
        method: "POST",
      }),
      {} as never,
      fixture.ctx as never,
    );
    expect(response.status).toBe(405);
    expect(fixture.complete).not.toHaveBeenCalled();
  });
});
