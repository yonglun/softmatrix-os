import { describe, expect, it } from "vitest";
import { getOrganizationModels, isUserByokAllowed } from "../src/model-policy/organization-models.js";

function envWithModels(models: unknown[], extra: Record<string, unknown> = {}): Cloudflare.Env {
  return { ORG_AI_MODELS: JSON.stringify(models), ALLOW_USER_BYOK: "true", ...extra } as Cloudflare.Env;
}

function validModel(overrides: Record<string, unknown> = {}) {
  return {
    id: "org-claude", name: "Company Claude", provider: "anthropic",
    model: "claude-sonnet-5", contextWindow: 1_000_000, apiToken: "secret-token",
    ...overrides,
  };
}

const INVALID_MODELS: Record<string, unknown[]> = {
  "duplicate id": [validModel({ id: "same" }), validModel({ id: "same" })],
  "unknown provider": [validModel({ provider: "unknown" })],
  "missing token": [validModel({ apiToken: "" })],
  "invalid URL": [validModel({ apiUrl: "file:///tmp/model" })],
  "invalid window": [validModel({ contextWindow: 0 })],
};

describe("organization model secret parser", () => {
  it("parses a complete organization model without exposing its token from the public shape", () => {
    const models = getOrganizationModels(envWithModels([validModel()]));
    expect(models.get("org-claude")!.config.apiToken).toBe("secret-token");
    expect(models.get("org-claude")!.profile).toEqual({ type: "agent", id: "org-claude", name: "Company Claude" });
  });

  it.each(["duplicate id", "unknown provider", "missing token", "invalid URL", "invalid window"])(
    "rejects %s", (fixture) =>
      expect(() => getOrganizationModels(envWithModels(INVALID_MODELS[fixture]))).toThrow(),
  );

  it("allows local HTTP endpoints only in DEV and requires Workers AI account IDs", () => {
    expect(() => getOrganizationModels(envWithModels([validModel({ apiUrl: "http://localhost:8787" })])))
      .toThrow(/HTTPS/);
    expect(getOrganizationModels(envWithModels([validModel({ apiUrl: "http://localhost:8787" })], { DEV: true } as any)))
      .toHaveProperty("size", 1);
    expect(() => getOrganizationModels(envWithModels([validModel({ provider: "cloudflare" })])))
      .toThrow(/accountId/);
  });

  it("bounds the deployment secret and preserves the legacy BYOK default", () => {
    expect(() => getOrganizationModels({ ORG_AI_MODELS: "x".repeat(5 * 1024 + 1) } as Cloudflare.Env))
      .toThrow(/5 KiB/);
    expect(isUserByokAllowed({} as Cloudflare.Env)).toBe(true);
    expect(isUserByokAllowed({ ALLOW_USER_BYOK: "false" } as Cloudflare.Env)).toBe(false);
  });
});
