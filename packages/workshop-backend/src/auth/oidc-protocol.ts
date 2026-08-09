import * as oauth from "oauth4webapi";
import type { AuthorizationServer, JWKSCacheInput } from "oauth4webapi";
import type { OidcLoginErrorCode } from "@gadgets/workshop-shared/api";
import type { OidcConfig } from "./config.js";

export const OIDC_ATTEMPT_TTL_MS = 5 * 60 * 1000;

export type StoredOidcRequest = {
  codeVerifier: string;
  nonce: string;
  createdAt: number;
  /** Bound to the login-attempt capability; the callback must echo this exact value. */
  state?: string;
};

export type VerifiedOidcIdentity = {
  email: string;
  subject: string;
};

export type OidcFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type OidcProtocolOptions = {
  fetch?: OidcFetch;
  now?: () => number;
};

export class OidcProtocolError extends Error {
  constructor(public readonly code: OidcLoginErrorCode, message?: string) {
    super(message ?? code);
    this.name = "OidcProtocolError";
  }
}

type DiscoveryCacheEntry = {
  authorizationServer: AuthorizationServer;
  expiresAt: number;
  jwksCache: JWKSCacheInput;
};

const DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_DISCOVERY_CACHE_ENTRIES = 8;
const discoveryCache = new Map<string, DiscoveryCacheEntry>();

function fetchFor(options?: OidcProtocolOptions): OidcFetch {
  return options?.fetch ?? ((input, init) => globalThis.fetch(input, init));
}

function customFetch(fetcher: OidcFetch) {
  return (url: string, options: { body?: unknown; headers: Record<string, string>; method: string; redirect: string; signal?: AbortSignal }) =>
    fetcher(url, options as RequestInit);
}

function rememberDiscovery(key: string, entry: DiscoveryCacheEntry): void {
  if (discoveryCache.size >= MAX_DISCOVERY_CACHE_ENTRIES && !discoveryCache.has(key)) {
    const oldest = discoveryCache.keys().next().value;
    if (oldest) discoveryCache.delete(oldest);
  }
  discoveryCache.delete(key);
  discoveryCache.set(key, entry);
}

function protocolError(code: OidcLoginErrorCode, message?: string): OidcProtocolError {
  return new OidcProtocolError(code, message);
}

async function discover(config: OidcConfig, options?: OidcProtocolOptions): Promise<DiscoveryCacheEntry> {
  const issuer = new URL(config.issuer);
  const key = issuer.href;
  const now = options?.now?.() ?? Date.now();
  const cached = discoveryCache.get(key);
  if (cached && cached.expiresAt > now) return cached;
  if (cached) discoveryCache.delete(key);

  try {
    const response = await oauth.discoveryRequest(issuer, {
      [oauth.customFetch]: customFetch(fetchFor(options)),
    });
    const authorizationServer = await oauth.processDiscoveryResponse(issuer, response);
    if (!authorizationServer.authorization_endpoint
        || !authorizationServer.token_endpoint
        || !authorizationServer.jwks_uri) {
      throw new Error("OIDC discovery omitted a required endpoint.");
    }
    const entry: DiscoveryCacheEntry = {
      authorizationServer,
      expiresAt: now + DISCOVERY_CACHE_TTL_MS,
      jwksCache: {},
    };
    rememberDiscovery(key, entry);
    return entry;
  } catch (error) {
    if (error instanceof OidcProtocolError) throw error;
    throw protocolError("OIDC_PROVIDER_UNAVAILABLE", "OIDC provider discovery failed.");
  }
}

function clientFor(config: OidcConfig): oauth.Client {
  return { client_id: config.clientId };
}

function validateAttemptState(config: OidcConfig, stored: StoredOidcRequest, callbackUrl: string, now: number): URL {
  if (!Number.isFinite(stored.createdAt)
      || now - stored.createdAt > OIDC_ATTEMPT_TTL_MS
      || stored.createdAt > now + 60_000
      || !stored.state) {
    throw protocolError("OIDC_STATE_INVALID", "OIDC login state is invalid or expired.");
  }

  let callback: URL;
  try {
    callback = new URL(callbackUrl);
  } catch {
    throw protocolError("OIDC_STATE_INVALID", "OIDC callback URL is invalid.");
  }
  const expectedRedirect = new URL(config.redirectUri);
  if (callback.origin !== expectedRedirect.origin || callback.pathname !== expectedRedirect.pathname
      || callback.searchParams.getAll("state").length !== 1
      || callback.searchParams.getAll("code").length !== 1
      || callback.searchParams.get("state") !== stored.state) {
    throw protocolError("OIDC_STATE_INVALID", "OIDC login state is invalid or expired.");
  }
  return callback;
}

/** Build a standards-compliant Authorization Code + PKCE request. */
export async function createAuthorizationRequest(
  config: OidcConfig,
  state: string,
  options?: OidcProtocolOptions,
): Promise<{ url: URL; stored: StoredOidcRequest }> {
  if (!state.trim()) throw protocolError("OIDC_STATE_INVALID", "OIDC login state is empty.");
  const entry = await discover(config, options);
  const codeVerifier = oauth.generateRandomCodeVerifier();
  const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
  const nonce = oauth.generateRandomNonce();
  const url = new URL(entry.authorizationServer.authorization_endpoint!);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
  }).toString();
  return {
    url,
    stored: { codeVerifier, nonce, createdAt: options?.now?.() ?? Date.now(), state },
  };
}

/** Exchange a callback code and return only the verified identity claims needed by the login flow. */
export async function exchangeAuthorizationCode(
  config: OidcConfig,
  stored: StoredOidcRequest,
  callbackUrl: string,
  options?: OidcProtocolOptions,
): Promise<VerifiedOidcIdentity> {
  const now = options?.now?.() ?? Date.now();
  const callback = validateAttemptState(config, stored, callbackUrl, now);
  const entry = await discover(config, options);
  const client = clientFor(config);
  const fetcher = fetchFor(options);

  try {
    const callbackParameters = oauth.validateAuthResponse(
      entry.authorizationServer,
      client,
      callback,
      stored.state,
    );
    const tokenResponse = await oauth.authorizationCodeGrantRequest(
      entry.authorizationServer,
      client,
      oauth.ClientSecretPost(config.clientSecret),
      callbackParameters,
      config.redirectUri,
      stored.codeVerifier,
      { [oauth.customFetch]: customFetch(fetcher) },
    );
    const processed = await oauth.processAuthorizationCodeResponse(
      entry.authorizationServer,
      client,
      tokenResponse,
      { expectedNonce: stored.nonce, requireIdToken: true },
    );
    await oauth.validateApplicationLevelSignature(entry.authorizationServer, tokenResponse, {
      [oauth.customFetch]: customFetch(fetcher),
      [oauth.jwksCache]: entry.jwksCache,
    });
    const claims = oauth.getValidatedIdTokenClaims(processed);
    if (!claims || typeof claims.sub !== "string" || !claims.sub
        || typeof claims.email !== "string" || !claims.email.trim()) {
      throw protocolError("OIDC_TOKEN_INVALID", "OIDC identity claims are incomplete.");
    }
    const nowSeconds = Math.floor(now / 1000);
    if (typeof claims.exp !== "number" || claims.exp <= nowSeconds
        || typeof claims.iat !== "number" || claims.iat > nowSeconds + 60) {
      throw protocolError("OIDC_TOKEN_INVALID", "OIDC token timestamps are invalid.");
    }
    if (claims.email_verified !== true) {
      throw protocolError("OIDC_EMAIL_UNVERIFIED", "The OIDC provider did not verify the email.");
    }
    return { email: claims.email.trim().toLowerCase(), subject: claims.sub };
  } catch (error) {
    if (error instanceof OidcProtocolError) throw error;
    throw protocolError("OIDC_TOKEN_INVALID", "OIDC token validation failed.");
  }
}
