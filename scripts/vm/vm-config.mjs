import { accessSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const DISALLOWED_VM_BINDINGS = [
  "CF_ACCESS_AUD",
  "CF_ACCESS_ISS",
  "CF_AI_GATEWAY",
  "CF_AI_GATEWAY_ACCOUNT_ID",
  "CF_AI_GATEWAY_API_TOKEN",
  "WORKERS_AI",
];

export class VmConfigError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "VmConfigError";
    this.code = code;
  }
}

function requiredString(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new VmConfigError("VM_CONFIG_INVALID", `${name} is required`);
  return value;
}

function optionalString(env, name) {
  const value = env[name]?.trim();
  return value || undefined;
}

function booleanValue(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new VmConfigError("VM_CONFIG_INVALID", `${name} must be true or false`);
}

function jsonValue(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    throw new VmConfigError("VM_CONFIG_INVALID", `${name} must be valid JSON`);
  }
}

function normalizeDomains(raw) {
  return raw?.split(",").map(domain => domain.trim().toLowerCase()).filter(Boolean) ?? [];
}

function parseUrl(env, name) {
  const raw = requiredString(env, name);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new VmConfigError("VM_CONFIG_INVALID", `${name} must be an absolute HTTPS URL`);
  }
  if (url.protocol !== "https:") {
    throw new VmConfigError("VM_CONFIG_INVALID", `${name} must use HTTPS`);
  }
  return url.toString().replace(/\/$/, "");
}

function parseOidc(env) {
  const issuer = optionalString(env, "OIDC_ISSUER");
  const clientId = optionalString(env, "OIDC_CLIENT_ID");
  const clientSecret = optionalString(env, "OIDC_CLIENT_SECRET");
  const identityModeRaw = optionalString(env, "OIDC_IDENTITY_MODE");
  const identityMode = identityModeRaw ?? "verified-email";
  const entraTenantId = optionalString(env, "OIDC_ENTRA_TENANT_ID");
  if (identityMode !== "verified-email" && identityMode !== "entra-tenant") {
    throw new VmConfigError("VM_CONFIG_INVALID", "OIDC_IDENTITY_MODE must be verified-email or entra-tenant");
  }
  if (!issuer && !clientId && !clientSecret && !identityModeRaw && !entraTenantId) return null;
  if (!issuer) throw new VmConfigError("VM_CONFIG_INVALID", "OIDC_ISSUER is required when OIDC is configured");
  if (!clientId) throw new VmConfigError("VM_SECRET_MISSING", "OIDC_CLIENT_ID is required");
  if (!clientSecret) throw new VmConfigError("VM_SECRET_MISSING", "OIDC_CLIENT_SECRET is required");
  let parsedIssuer;
  try {
    parsedIssuer = new URL(issuer);
  } catch {
    throw new VmConfigError("VM_CONFIG_INVALID", "OIDC_ISSUER must be an absolute URL");
  }
  if (parsedIssuer.protocol !== "https:") {
    throw new VmConfigError("VM_CONFIG_INVALID", "OIDC_ISSUER must use HTTPS");
  }
  const allowedEmailDomains = normalizeDomains(optionalString(env, "OIDC_ALLOWED_EMAIL_DOMAINS"));
  if (identityMode === "entra-tenant" && !entraTenantId) {
    throw new VmConfigError("VM_CONFIG_INVALID", "OIDC_ENTRA_TENANT_ID is required in entra-tenant mode");
  }
  if (identityMode === "entra-tenant" && allowedEmailDomains.length === 0) {
    throw new VmConfigError("VM_CONFIG_INVALID", "OIDC_ALLOWED_EMAIL_DOMAINS is required in entra-tenant mode");
  }
  if (identityMode === "verified-email" && entraTenantId) {
    throw new VmConfigError("VM_CONFIG_INVALID", "OIDC_ENTRA_TENANT_ID requires OIDC_IDENTITY_MODE=entra-tenant");
  }
  return {
    issuer: parsedIssuer.toString().replace(/\/$/, ""),
    clientId,
    clientSecret,
    displayName: optionalString(env, "OIDC_DISPLAY_NAME") ?? "Enterprise SSO",
    allowedEmailDomains,
    identityMode,
    ...(entraTenantId ? { entraTenantId } : {}),
  };
}

export function loadVmConfig(env = process.env) {
  for (const name of DISALLOWED_VM_BINDINGS) {
    if (env[name]?.trim()) {
      throw new VmConfigError("VM_CONFIG_INVALID", `${name} is not available in the VM profile`);
    }
  }

  const oidc = parseOidc(env);
  const disablePasswordAuth = booleanValue(env, "DISABLE_PASSWORD_AUTH", false);
  if (disablePasswordAuth && !oidc) {
    throw new VmConfigError("VM_SECRET_MISSING", "OIDC configuration is required when password auth is disabled");
  }

  const orgAiModels = jsonValue(env, "ORG_AI_MODELS", []);
  if (!Array.isArray(orgAiModels)) {
    throw new VmConfigError("VM_CONFIG_INVALID", "ORG_AI_MODELS must be a JSON array");
  }
  const admins = jsonValue(env, "ADMINS", []);
  if (!Array.isArray(admins) || admins.some(value => typeof value !== "string")) {
    throw new VmConfigError("VM_CONFIG_INVALID", "ADMINS must be a JSON array of strings");
  }

  const dataDir = requiredString(env, "SOFTMATRIX_DATA_DIR");
  const objectStoreDir = requiredString(env, "SOFTMATRIX_OBJECT_STORE_DIR");
  return {
    publicBaseUrl: parseUrl(env, "PUBLIC_BASE_URL"),
    dataDir,
    objectStoreDir,
    oidc,
    disablePasswordAuth,
    orgAiModels,
    allowUserByok: booleanValue(env, "ALLOW_USER_BYOK", false),
    admins,
    diagnostics: {
      publicBaseUrl: parseUrl(env, "PUBLIC_BASE_URL"),
      dataDir,
      objectStoreDir,
      oidcIssuer: oidc?.issuer,
      oidcClientId: oidc?.clientId,
      oidcClientSecret: undefined,
      modelCount: orgAiModels.length,
      allowUserByok: booleanValue(env, "ALLOW_USER_BYOK", false),
      adminCount: admins.length,
    },
  };
}

export function validateVmConfig(config) {
  for (const [name, path] of [["SOFTMATRIX_DATA_DIR", config.dataDir], ["SOFTMATRIX_OBJECT_STORE_DIR", config.objectStoreDir]]) {
    if (!isAbsolute(path)) {
      throw new VmConfigError("VM_CONFIG_INVALID", `${name} must be an absolute path`);
    }
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      throw new VmConfigError("VM_PATH_UNWRITABLE", `${name} must be an existing directory`);
    }
    try {
      accessSync(path, constants.R_OK | constants.W_OK | constants.X_OK);
    } catch {
      throw new VmConfigError("VM_PATH_UNWRITABLE", `${name} must be readable and writable`);
    }
  }
  if (config.dataDir === config.objectStoreDir) {
    throw new VmConfigError("VM_CONFIG_INVALID", "SOFTMATRIX_DATA_DIR and SOFTMATRIX_OBJECT_STORE_DIR must differ");
  }
  return config;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const configPath = process.argv[2];
  if (configPath !== "--check") {
    console.error("Usage: node scripts/vm/vm-config.mjs --check");
    process.exitCode = 2;
  } else {
    try {
      const config = validateVmConfig(loadVmConfig());
      console.log(JSON.stringify(config.diagnostics, null, 2));
    } catch (error) {
      console.error(error.message ?? error);
      process.exitCode = 1;
    }
  }
}
