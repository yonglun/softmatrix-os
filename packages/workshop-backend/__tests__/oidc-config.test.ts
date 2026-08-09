import { describe, expect, it } from "vitest";
import { getOidcConfig, getPublicOidcConfig } from "../src/auth/config.js";
import { getServerConfig } from "../src/deployment-config.js";

function oidcEnv(overrides: Partial<Cloudflare.Env> = {}): Cloudflare.Env {
  return {
    OIDC_ISSUER: "https://id.example.com",
    OIDC_CLIENT_ID: "softmatrix",
    OIDC_CLIENT_SECRET: "fixture-secret",
    PUBLIC_BASE_URL: "https://softmatrix.example",
    ...overrides,
  } as Cloudflare.Env;
}

describe("OIDC deployment configuration", () => {
  it("publishes display metadata without secrets", () => {
    const env = oidcEnv({
      OIDC_DISPLAY_NAME: "Company SSO",
      OIDC_CLIENT_SECRET: "never-public",
    });

    expect(getPublicOidcConfig(env)).toEqual({ displayName: "Company SSO" });
    expect(JSON.stringify(getPublicOidcConfig(env))).not.toContain("never-public");
  });

  it("includes only public metadata in the deployment ServerConfig", async () => {
    const config = await getServerConfig({
      ...oidcEnv({ OIDC_CLIENT_SECRET: "server-only-secret" }),
      BLUEPRINTS: { get: async () => null },
    } as unknown as Cloudflare.Env);

    expect(config.oidc).toEqual({ displayName: "SSO" });
    expect(JSON.stringify(config)).not.toContain("server-only-secret");
  });

  it("returns no configuration when OIDC is not configured", () => {
    expect(getOidcConfig({ PUBLIC_BASE_URL: "https://softmatrix.example" } as Cloudflare.Env))
      .toBeNull();
    expect(getPublicOidcConfig({} as Cloudflare.Env)).toBeUndefined();
  });

  it("rejects a partial OIDC configuration", () => {
    expect(() => getOidcConfig(oidcEnv({ OIDC_CLIENT_SECRET: undefined })))
      .toThrow("OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, and PUBLIC_BASE_URL");
  });

  it("normalizes display name and the exact domain allowlist", () => {
    const config = getOidcConfig(oidcEnv({
      OIDC_DISPLAY_NAME: "  Company SSO  ",
      OIDC_ALLOWED_EMAIL_DOMAINS: "Example.COM, example.org , ,",
    }));

    expect(config).toMatchObject({
      displayName: "Company SSO",
      allowedEmailDomains: ["example.com", "example.org"],
      redirectUri: "https://softmatrix.example/api/auth/oidc/callback",
    });
  });

  it("requires HTTPS outside local development", () => {
    expect(() => getOidcConfig(oidcEnv({
      OIDC_ISSUER: "http://id.example.com",
    }))).toThrow("HTTPS");

    expect(getOidcConfig(oidcEnv({
      OIDC_ISSUER: "http://localhost:8788",
      PUBLIC_BASE_URL: "http://localhost:8787",
    }))).not.toBeNull();
  });
});
