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
