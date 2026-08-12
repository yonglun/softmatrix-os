import * as oauth from "oauth4webapi";
import type { AuthorizationServer, JWKSCacheInput } from "oauth4webapi";
import type { OidcLoginErrorCode } from "@gadgets/workshop-shared/api";
import type { OidcConfig } from "./config.js";
import { isEmailDomainAllowed } from "./email-identity.js";

export const OIDC_ATTEMPT_TTL_MS = 5 * 60 * 1000;

export type StoredOidcRequest = {
  codeVerifier: string;
  nonce: string;
  createdAt: number;
  /** Bound to the login-attempt capability; the callback must echo this exact value. */
  state?: string;
};

export type VerifiedOidcIdentity = {
  accountKey: string;
  profileId: string;
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

/** oauth4webapi rejects HTTP endpoints by default. Permit HTTP only for loopback dev fixtures;
 * production OIDC remains HTTPS-only through getOidcConfig's URL validation. */
function allowInsecureLocalRequests(config: OidcConfig): boolean {
  const urls = [new URL(config.issuer), new URL(config.redirectUri)];
  return urls.every(url => url.protocol === "http:"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1"
      || url.hostname === "::1" || url.hostname === "[::1]"));
}

function protocolRequestOptions(config: OidcConfig, fetcher: OidcFetch) {
  return {
    [oauth.customFetch]: customFetch(fetcher),
    ...(allowInsecureLocalRequests(config) ? { [oauth.allowInsecureRequests]: true } : {}),
  };
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeUpn(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  const at = normalized.indexOf("@");
  if (at <= 0 || at !== normalized.lastIndexOf("@") || at === normalized.length - 1
      || [...normalized].some(character => /\s/u.test(character)
        || character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f)) {
    return null;
  }
  return normalized;
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
      ...protocolRequestOptions(config, fetchFor(options)),
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
  const codeCount = callback.searchParams.getAll("code").length;
  const errorCount = callback.searchParams.getAll("error").length;
  if (callback.origin !== expectedRedirect.origin || callback.pathname !== expectedRedirect.pathname
      || callback.searchParams.getAll("state").length !== 1
      || (codeCount !== 1 && errorCount !== 1)
      || (codeCount === 1 && errorCount === 1)
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
  if (callback.searchParams.has("error")) {
    throw protocolError("OIDC_PROVIDER_UNAVAILABLE", "The OIDC provider did not complete sign-in.");
  }
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
      protocolRequestOptions(config, fetcher),
    );
    const processed = await oauth.processAuthorizationCodeResponse(
      entry.authorizationServer,
      client,
      tokenResponse,
      { expectedNonce: stored.nonce, requireIdToken: true },
    );
    await oauth.validateApplicationLevelSignature(entry.authorizationServer, tokenResponse, {
      ...protocolRequestOptions(config, fetcher),
      [oauth.jwksCache]: entry.jwksCache,
    });
    const claims = oauth.getValidatedIdTokenClaims(processed);
    if (!claims || typeof claims.sub !== "string" || !claims.sub) {
      throw protocolError("OIDC_TOKEN_INVALID", "OIDC identity claims are incomplete.");
    }
    const nowSeconds = Math.floor(now / 1000);
    if (typeof claims.exp !== "number" || claims.exp <= nowSeconds
        || typeof claims.iat !== "number" || claims.iat > nowSeconds + 60) {
      throw protocolError("OIDC_TOKEN_INVALID", "OIDC token timestamps are invalid.");
    }
    if (config.identityMode === "entra-tenant") {
      const tenantId = typeof claims.tid === "string" ? claims.tid : "";
      const objectId = typeof claims.oid === "string" ? claims.oid : "";
      const upn = normalizeUpn(claims.upn);
      if (tenantId !== config.entraTenantId || !isUuid(objectId) || !upn
          || !isEmailDomainAllowed(upn, config.allowedEmailDomains)) {
        throw protocolError("OIDC_TOKEN_INVALID", "OIDC identity claims are invalid.");
      }
      return {
        accountKey: `entra-${tenantId}-${objectId}`,
        profileId: upn,
        subject: claims.sub,
      };
    }

    if (typeof claims.email !== "string" || !claims.email.trim()) {
      throw protocolError("OIDC_TOKEN_INVALID", "OIDC identity claims are incomplete.");
    }
    if (claims.email_verified !== true) {
      throw protocolError("OIDC_EMAIL_UNVERIFIED", "The OIDC provider did not verify the email.");
    }
    const email = claims.email.trim().toLowerCase();
    return { accountKey: email, profileId: email, subject: claims.sub };
  } catch (error) {
    if (error instanceof OidcProtocolError) throw error;
    throw protocolError("OIDC_TOKEN_INVALID", "OIDC token validation failed.");
  }
}
