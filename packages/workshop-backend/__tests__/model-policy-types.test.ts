import { describe, expect, it } from "vitest";
import { toCatalogItem } from "../src/model-policy/types.js";

function organizationRecordWithToken() {
  return {
    profile: { type: "agent" as const, id: "org-claude", name: "Company Claude" },
    config: { provider: "anthropic" as const, model: "claude-sonnet-5", apiToken: "secret-token" },
  };
}

describe("model policy catalog types", () => {
  it("serializes only sanitized model catalog fields", () => {
    const item = toCatalogItem(organizationRecordWithToken(), true, true);
    expect(item).toEqual({
      id: "org-claude",
      name: "Company Claude",
      provider: "anthropic",
      source: "organization",
      enabled: true,
      isDefault: true,
      canDelete: false,
    });
    expect(JSON.stringify(item)).not.toContain("secret-token");
  });

  it("marks personal records as deletable without exposing config", () => {
    const item = toCatalogItem({ ...organizationRecordWithToken(), source: "personal" }, true, false);
    expect(item.source).toBe("personal");
    expect(item.canDelete).toBe(true);
    expect(item).not.toHaveProperty("config");
  });
});
