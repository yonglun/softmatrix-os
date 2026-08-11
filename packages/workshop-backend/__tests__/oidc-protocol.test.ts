import { afterEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { OidcConfig } from "../src/auth/config.js";
import {
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  OidcProtocolError,
  type StoredOidcRequest,
} from "../src/auth/oidc-protocol.js";

const ISSUER = "https://id.example.com";
const DISCOVERY = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  jwks_uri: `${ISSUER}/jwks`,
  response_types_supported: ["code"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"],
  token_endpoint_auth_methods_supported: ["client_secret_post"],
};

const config: OidcConfig = {
  issuer: ISSUER,
  clientId: "softmatrix",
  clientSecret: "fixture-secret",
  displayName: "Company SSO",
  allowedEmailDomains: [],
  redirectUri: "https://softmatrix.example/api/auth/oidc/callback",
  identityMode: "verified-email",
};

const entraConfig: OidcConfig = {
  ...config,
  identityMode: "entra-tenant",
  entraTenantId: "7551a691-532e-4a93-9292-faed619dd82f",
  allowedEmailDomains: ["example.com"],
};

let fixtureKeys: Promise<{ privateKey: CryptoKey; publicKey: CryptoKey }> | undefined;

function callback(state: string, code = "fixture-code"): string {
  const url = new URL(config.redirectUri);
  url.searchParams.set("code", code);
  url.searchParams.set("state", state);
  return url.href;
}

async function fixtureFetch(invalid?: string) {
  fixtureKeys ??= generateKeyPair("RS256");
  const { privateKey, publicKey } = await fixtureKeys;
  const jwk = await exportJWK(publicKey);
  jwk.kid = "fixture-key";
  let expectedNonce = "fixture-nonce";

  const fetchImpl = vi.fn(async (url: string, options: {
    body?: URLSearchParams;
    headers?: Record<string, string>;
    method?: string;
  }) => {
    if (url.endsWith("/.well-known/openid-configuration")) {
      const discovery = invalid === "issuer" ? { ...DISCOVERY, issuer: "https://other.example.com" } : DISCOVERY;
      return Response.json(discovery);
    }
    if (url.endsWith("/jwks")) return Response.json({ keys: [jwk] });
    if (url.endsWith("/token")) {
      expect(options.method).toBe("POST");
      expect(options.body?.get("client_id")).toBe(config.clientId);
      expect(options.body?.get("client_secret")).toBe(config.clientSecret);
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        iss: invalid === "issuer" ? "https://other.example.com" : ISSUER,
        sub: "subject-123",
        aud: invalid === "audience"
          ? "different-client"
          : invalid === "multiple-audience"
            ? [config.clientId, "another-client"]
            : config.clientId,
        azp: invalid === "multiple-audience" ? undefined : config.clientId,
        iat: invalid === "not-yet-valid" ? now + 120 : now - 10,
        exp: invalid === "expired" ? now - 1 : now + 300,
        nonce: invalid === "nonce" ? "different-nonce" : expectedNonce,
        email: " Alice@Example.COM ",
        email_verified: invalid === "email_verified" ? undefined : true,
        tid: invalid === "wrong-tid" ? "other-tenant" : entraConfig.entraTenantId,
        oid: invalid === "missing-oid"
          ? undefined
          : invalid === "bad-oid"
            ? "not-an-object-id"
            : "11111111-2222-4333-8444-555555555555",
        upn: invalid === "missing-upn"
          ? undefined
          : invalid === "bad-upn"
            ? "Alice Example.COM"
            : invalid === "disallowed-domain"
              ? "alice@other.example"
              : " Alice@Example.COM ",
      };
      const idToken = await new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "fixture-key" })
        .sign(privateKey);
      return Response.json({ access_token: "fixture-access-token", token_type: "Bearer", id_token: idToken });
    }
    throw new Error(`unexpected fixture request: ${url}`);
  });

  return { fetchImpl, publicKey, setExpectedNonce: (nonce: string) => { expectedNonce = nonce; } };
}

afterEach(() => vi.restoreAllMocks());

describe("OIDC authorization-code protocol", () => {
  it("creates S256 PKCE, state, nonce, and the exact redirect URI", async () => {
    const { fetchImpl } = await fixtureFetch();
    const request = await createAuthorizationRequest(config, "state-123", { fetch: fetchImpl });

    expect(request.url.searchParams.get("response_type")).toBe("code");
    expect(request.url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(request.url.searchParams.get("state")).toBe("state-123");
    expect(request.url.searchParams.get("nonce")).toBe(request.stored.nonce);
    expect(request.url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(request.stored.state).toBe("state-123");
  });

  it("allows loopback HTTP fixtures without weakening production HTTPS checks", async () => {
    const { fetchImpl: baseFetch } = await fixtureFetch();
    const localConfig = {
      ...config,
      issuer: "http://127.0.0.1:43123",
      redirectUri: "http://127.0.0.1:8787/api/auth/oidc/callback",
    };
    const fetchImpl = vi.fn(async (url: string, options: Parameters<typeof baseFetch>[1]) => {
      if (url.endsWith("/.well-known/openid-configuration")) {
        return Response.json({
          ...DISCOVERY,
          issuer: localConfig.issuer,
          authorization_endpoint: `${localConfig.issuer}/authorize`,
          token_endpoint: `${localConfig.issuer}/token`,
          jwks_uri: `${localConfig.issuer}/jwks`,
        });
      }
      return baseFetch(url, options);
    });
    const request = await createAuthorizationRequest(localConfig, "state-local", { fetch: fetchImpl });
    expect(request.url.protocol).toBe("http:");
    expect(request.url.searchParams.get("redirect_uri")).toBe(localConfig.redirectUri);
  });

  it("exchanges a valid callback and returns only a verified identity", async () => {
    const { fetchImpl, setExpectedNonce } = await fixtureFetch();
    const { stored } = await createAuthorizationRequest(config, "state-123", { fetch: fetchImpl });
    setExpectedNonce(stored.nonce);
    const identity = await exchangeAuthorizationCode(config, stored, callback("state-123"), { fetch: fetchImpl });

    expect(identity).toEqual({
      accountKey: "alice@example.com",
      profileId: "alice@example.com",
      subject: "subject-123",
    });
  });

  it("accepts an Entra token with UPN and no email_verified claim", async () => {
    const { fetchImpl, setExpectedNonce } = await fixtureFetch("email_verified");
    const { stored } = await createAuthorizationRequest(entraConfig, "state-entra", { fetch: fetchImpl });
    setExpectedNonce(stored.nonce);
    await expect(exchangeAuthorizationCode(
      entraConfig,
      stored,
      callback("state-entra"),
      { fetch: fetchImpl },
    )).resolves.toEqual({
      accountKey: "entra-7551a691-532e-4a93-9292-faed619dd82f-11111111-2222-4333-8444-555555555555",
      profileId: "alice@example.com",
      subject: "subject-123",
    });
  });

  it.each(["wrong-tid", "missing-oid", "bad-oid", "missing-upn", "bad-upn", "disallowed-domain"])(
    "rejects an invalid Entra %s claim",
    async invalid => {
      const { fetchImpl, setExpectedNonce } = await fixtureFetch(invalid);
      const { stored } = await createAuthorizationRequest(entraConfig, `state-${invalid}`, { fetch: fetchImpl });
      setExpectedNonce(stored.nonce);
      await expect(exchangeAuthorizationCode(
        entraConfig,
        stored,
        callback(`state-${invalid}`),
        { fetch: fetchImpl },
      )).rejects.toMatchObject({ code: "OIDC_TOKEN_INVALID" });
    },
  );

  it("rejects a callback with the wrong state or an expired attempt", async () => {
    const { fetchImpl } = await fixtureFetch();
    const { stored } = await createAuthorizationRequest(config, "state-123", { fetch: fetchImpl });

    await expect(exchangeAuthorizationCode(config, stored, callback("wrong-state"), { fetch: fetchImpl }))
      .rejects.toMatchObject({ code: "OIDC_STATE_INVALID" });

    const expired: StoredOidcRequest = { ...stored, createdAt: Date.now() - 301_000 };
    await expect(exchangeAuthorizationCode(config, expired, callback("state-123"), { fetch: fetchImpl }))
      .rejects.toMatchObject({ code: "OIDC_STATE_INVALID" });
  });

  it("turns a provider cancellation into a stable provider error", async () => {
    const { fetchImpl, setExpectedNonce } = await fixtureFetch();
    const { stored } = await createAuthorizationRequest(config, "state-123", { fetch: fetchImpl });
    setExpectedNonce(stored.nonce);
    await expect(exchangeAuthorizationCode(
      config,
      stored,
      `${config.redirectUri}?error=access_denied&state=state-123`,
      { fetch: fetchImpl },
    )).rejects.toMatchObject({ code: "OIDC_PROVIDER_UNAVAILABLE" });
  });

  it.each(["issuer", "audience", "multiple-audience", "nonce", "expired", "not-yet-valid"])(
    "rejects an invalid %s ID Token claim",
    async (invalid) => {
      const { fetchImpl, setExpectedNonce } = await fixtureFetch(invalid);
      const { stored } = await createAuthorizationRequest(config, "state-123", { fetch: fetchImpl });
      setExpectedNonce(stored.nonce);
      await expect(exchangeAuthorizationCode(config, stored, callback("state-123"), { fetch: fetchImpl }))
        .rejects.toMatchObject({ code: "OIDC_TOKEN_INVALID" });
    },
  );

  it("returns a stable email-unverified error without exposing provider details", async () => {
    const { fetchImpl, setExpectedNonce } = await fixtureFetch("email_verified");
    const { stored } = await createAuthorizationRequest(config, "state-123", { fetch: fetchImpl });
    setExpectedNonce(stored.nonce);
    const error = await exchangeAuthorizationCode(config, stored, callback("state-123"), { fetch: fetchImpl })
      .catch(value => value);

    expect(error).toBeInstanceOf(OidcProtocolError);
    expect(error).toMatchObject({ code: "OIDC_EMAIL_UNVERIFIED" });
    expect(JSON.stringify(error)).not.toContain("fixture-secret");
  });

  it("rejects duplicate callback state or code parameters", async () => {
    const { fetchImpl } = await fixtureFetch();
    const { stored } = await createAuthorizationRequest(config, "state-123", { fetch: fetchImpl });

    await expect(exchangeAuthorizationCode(
      config,
      stored,
      `${config.redirectUri}?code=one&code=two&state=state-123`,
      { fetch: fetchImpl },
    )).rejects.toMatchObject({ code: "OIDC_STATE_INVALID" });
    await expect(exchangeAuthorizationCode(
      config,
      stored,
      `${config.redirectUri}?code=one&state=state-123&state=state-123`,
      { fetch: fetchImpl },
    )).rejects.toMatchObject({ code: "OIDC_STATE_INVALID" });
  });

  it("rejects an attempt created in the future", async () => {
    const { fetchImpl } = await fixtureFetch();
    const { stored } = await createAuthorizationRequest(config, "state-123", { fetch: fetchImpl });
    const future: StoredOidcRequest = { ...stored, createdAt: Date.now() + 61_000 };
    await expect(exchangeAuthorizationCode(config, future, callback("state-123"), { fetch: fetchImpl }))
      .rejects.toMatchObject({ code: "OIDC_STATE_INVALID" });
  });
});
