import type { AiChatAuthorInfo, AiModelConfig, AiModelProvider } from "@gadgets/workshop-shared/api";

const MAX_MODELS = 20;
const MAX_SECRET_BYTES = 5 * 1024;
const PROVIDERS = new Set<AiModelProvider>(["openai", "anthropic", "google", "cloudflare", "ollama"]);

export type OrganizationModelRecord = {
  profile: AiChatAuthorInfo;
  config: AiModelConfig;
  contextWindow: number;
  outputLimit?: number;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ORG_AI_MODELS must contain model objects.");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`ORG_AI_MODELS model ${field} must be a non-empty string.`);
  }
  return value.trim();
}

function parseUrl(value: unknown, dev: boolean): string | undefined {
  if (value === undefined) return undefined;
  let raw = requiredString(value, "apiUrl");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("ORG_AI_MODELS model apiUrl must be a valid URL.");
  }
  if (url.protocol !== "https:" && !(dev && url.protocol === "http:")) {
    throw new Error("ORG_AI_MODELS model apiUrl must use HTTPS outside DEV.");
  }
  return url.toString();
}

function parseModel(value: unknown, dev: boolean): OrganizationModelRecord {
  let raw = object(value);
  let allowedFields = new Set(["id", "name", "provider", "model", "contextWindow", "outputLimit", "apiToken", "accountId", "apiUrl"]);
  for (let field of Object.keys(raw)) {
    if (!allowedFields.has(field)) throw new Error(`ORG_AI_MODELS model contains unknown field: ${field}.`);
  }
  let id = requiredString(raw.id, "id");
  let name = requiredString(raw.name, "name");
  let providerValue = requiredString(raw.provider, "provider");
  if (!PROVIDERS.has(providerValue as AiModelProvider)) {
    throw new Error(`ORG_AI_MODELS model provider is unsupported: ${providerValue}.`);
  }
  let provider = providerValue as AiModelProvider;
  let model = requiredString(raw.model, "model");
  if (typeof raw.contextWindow !== "number" || !Number.isSafeInteger(raw.contextWindow)
      || raw.contextWindow <= 0) {
    throw new Error("ORG_AI_MODELS model contextWindow must be a positive integer.");
  }
  let outputLimit: number | undefined;
  if (raw.outputLimit !== undefined) {
    if (typeof raw.outputLimit !== "number" || !Number.isSafeInteger(raw.outputLimit)
        || raw.outputLimit <= 0) {
      throw new Error("ORG_AI_MODELS model outputLimit must be a positive integer.");
    }
    outputLimit = raw.outputLimit;
  }
  let apiToken = raw.apiToken === undefined ? "" : requiredString(raw.apiToken, "apiToken");
  if (provider !== "ollama" && !apiToken) {
    throw new Error(`ORG_AI_MODELS model ${id} requires apiToken.`);
  }
  let accountId: string | undefined;
  if (raw.accountId !== undefined) accountId = requiredString(raw.accountId, "accountId");
  if (provider === "cloudflare" && !accountId) {
    throw new Error(`ORG_AI_MODELS Workers AI model ${id} requires accountId.`);
  }
  let apiUrl = parseUrl(raw.apiUrl, dev);
  let profile: AiChatAuthorInfo = { type: "agent", id, name };
  let config: AiModelConfig = { provider, model, apiToken };
  if (accountId) config.accountId = accountId;
  if (apiUrl) config.apiUrl = apiUrl;
  return { profile, config, contextWindow: raw.contextWindow, ...(outputLimit === undefined ? {} : {outputLimit}) };
}

/** Parse the deployment-only organization catalog without returning secret-bearing data. */
export function getOrganizationModels(env: Cloudflare.Env): Map<string, OrganizationModelRecord> {
  let raw = env.ORG_AI_MODELS;
  if (raw === undefined || raw.trim() === "") return new Map();
  if (new TextEncoder().encode(raw).byteLength > MAX_SECRET_BYTES) {
    throw new Error("ORG_AI_MODELS exceeds the 5 KiB deployment limit.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("ORG_AI_MODELS must be valid JSON.");
  }
  if (!Array.isArray(parsed)) throw new Error("ORG_AI_MODELS must be a JSON array.");
  if (parsed.length > MAX_MODELS) throw new Error(`ORG_AI_MODELS supports at most ${MAX_MODELS} models.`);
  let result = new Map<string, OrganizationModelRecord>();
  for (let value of parsed) {
    let model = parseModel(value, !!(env as Cloudflare.Env & { DEV?: boolean }).DEV);
    if (result.has(model.profile.id)) throw new Error(`ORG_AI_MODELS contains duplicate model id: ${model.profile.id}.`);
    result.set(model.profile.id, model);
  }
  return result;
}

/** Resolve the deployment hard policy; unset preserves legacy BYOK behavior. */
export function isUserByokAllowed(env: Cloudflare.Env): boolean {
  return env.ALLOW_USER_BYOK !== "false";
}
