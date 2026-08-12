// Configuration for sign-in via authentication gatekeepers (an optional, additive login feature).
//
// Authentication is provided by gatekeepers (e.g. "google", "github", "cloudflare") that advertise
// `providesAuth`. A deployment opts specific gatekeepers into the login UI via the AUTH_GATEKEEPERS
// allowlist (comma-separated vendor ids). When set, each listed, auth-capable gatekeeper gets a
// "Continue with ..." button alongside the normal username/password form (unless password auth is
// disabled). All OFF by default.

// Parse the AUTH_GATEKEEPERS allowlist into a list of gatekeeper vendor ids (lowercased). These are
// the gatekeepers permitted to drive sign-in; a vendor must also actually advertise `providesAuth`
// to be offered. Empty when unset.
export function getAuthGatekeeperAllowlist(env: Cloudflare.Env): string[] {
  const raw = (env as { AUTH_GATEKEEPERS?: string }).AUTH_GATEKEEPERS;
  if (!raw) return [];
  return raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}

// Whether the deployment has opted any gatekeeper into sign-in.
export function hasAuthGatekeepers(env: Cloudflare.Env): boolean {
  return getAuthGatekeeperAllowlist(env).length > 0;
}

/** Whether at least one configured external sign-in path can prevent a lockout. */
export function hasExternalAuthentication(env: Cloudflare.Env): boolean {
  return hasAuthGatekeepers(env) || getOidcConfig(env) !== null;
}

// Whether username/password login + signup is available. Enabled by default. An installation can
// set DISABLE_PASSWORD_AUTH=true to be OAuth-only — but that only takes effect when at least one
// auth gatekeeper is allowlisted, otherwise we'd lock everyone out, so password auth stays on.
export function isPasswordAuthEnabled(env: Cloudflare.Env): boolean {
  if (env.DISABLE_PASSWORD_AUTH !== "true") return true;
  return !hasExternalAuthentication(env);
}

/** Private OIDC configuration used by the backend protocol and login-attempt flow. */
export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  displayName: string;
  allowedEmailDomains: string[];
  redirectUri: string;
  identityMode: OidcIdentityMode;
  entraTenantId?: string;
};

export type OidcIdentityMode = "verified-email" | "entra-tenant";

const DEFAULT_OIDC_DISPLAY_NAME = "SSO";
const OIDC_PARTIAL_CONFIGURATION_ERROR =
  "OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, and PUBLIC_BASE_URL must be configured together.";

function envString(env: Cloudflare.Env, key: string): string | undefined {
  const value = (env as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isLocalDevelopment(env: Cloudflare.Env, urls: readonly URL[]): boolean {
  const extended = env as Cloudflare.Env & { DEV?: boolean; NODE_ENV?: string };
  if (extended.DEV === true || extended.NODE_ENV === "development") return true;
  return urls.every(({ hostname }) =>
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1",
  );
}

function parseUrl(value: string, label: string): URL {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) {
      throw new Error(`${label} must not contain credentials, a query, or a fragment.`);
    }
    return url;
  } catch (error) {
    if (error instanceof Error && error.message.includes("must not contain")) throw error;
    throw new Error(`${label} must be an absolute URL.`, { cause: error });
  }
}

function normalizedDomains(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(",").map(domain => domain.trim().toLowerCase()).filter(Boolean))];
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Parse the complete private OIDC environment configuration, or return null when disabled. */
export function getOidcConfig(env: Cloudflare.Env): OidcConfig | null {
  const issuerRaw = envString(env, "OIDC_ISSUER");
  const clientId = envString(env, "OIDC_CLIENT_ID");
  const clientSecret = envString(env, "OIDC_CLIENT_SECRET");
  const displayNameRaw = envString(env, "OIDC_DISPLAY_NAME");
  const allowedDomainsRaw = envString(env, "OIDC_ALLOWED_EMAIL_DOMAINS");
  const identityModeRaw = envString(env, "OIDC_IDENTITY_MODE");
  const identityMode = identityModeRaw ?? "verified-email";
  const entraTenantId = envString(env, "OIDC_ENTRA_TENANT_ID");
  const publicBaseUrlRaw = envString(env, "PUBLIC_BASE_URL");

  if (identityMode !== "verified-email" && identityMode !== "entra-tenant") {
    throw new Error("OIDC_IDENTITY_MODE must be verified-email or entra-tenant.");
  }

  // PUBLIC_BASE_URL is used by other optional features, so it alone does not enable OIDC. Any
  // OIDC-specific setting, however, opts into atomic validation of the full configuration.
  const oidcEnabled = [issuerRaw, clientId, clientSecret, displayNameRaw, allowedDomainsRaw,
    identityModeRaw, entraTenantId]
    .some(value => value !== undefined);
  if (!oidcEnabled) return null;
  if (!issuerRaw || !clientId || !clientSecret || !publicBaseUrlRaw) {
    throw new Error(OIDC_PARTIAL_CONFIGURATION_ERROR);
  }

  const issuer = parseUrl(issuerRaw, "OIDC_ISSUER");
  const publicBaseUrl = parseUrl(publicBaseUrlRaw, "PUBLIC_BASE_URL");
  if (!isLocalDevelopment(env, [issuer, publicBaseUrl])
      && (issuer.protocol !== "https:" || publicBaseUrl.protocol !== "https:")) {
    throw new Error("OIDC_ISSUER and PUBLIC_BASE_URL must use HTTPS outside local development.");
  }

  const allowedEmailDomains = normalizedDomains(allowedDomainsRaw);
  if (identityMode === "entra-tenant" && !entraTenantId) {
    throw new Error("OIDC_ENTRA_TENANT_ID is required in entra-tenant mode.");
  }
  if (identityMode === "entra-tenant" && entraTenantId && !isUuid(entraTenantId)) {
    throw new Error("OIDC_ENTRA_TENANT_ID must be a tenant GUID.");
  }
  if (identityMode === "entra-tenant" && allowedEmailDomains.length === 0) {
    throw new Error("OIDC_ALLOWED_EMAIL_DOMAINS is required in entra-tenant mode.");
  }
  if (identityMode === "verified-email" && entraTenantId) {
    throw new Error("OIDC_ENTRA_TENANT_ID requires OIDC_IDENTITY_MODE=entra-tenant.");
  }

  const redirectUri = new URL("/api/auth/oidc/callback", publicBaseUrl).toString();
  return {
    issuer: issuer.toString().replace(/\/$/, ""),
    clientId,
    clientSecret,
    displayName: displayNameRaw ?? DEFAULT_OIDC_DISPLAY_NAME,
    allowedEmailDomains,
    redirectUri,
    identityMode,
    ...(entraTenantId ? { entraTenantId } : {}),
  };
}

/** Return only the non-secret OIDC metadata safe to send to the browser. */
export function getPublicOidcConfig(env: Cloudflare.Env) {
  const config = getOidcConfig(env);
  return config ? { displayName: config.displayName } : undefined;
}
