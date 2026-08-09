import { describe, expect, it } from "vitest";
import { ModelPolicy } from "../src/model-policy/model-policy.js";

function record(id: string, source?: "organization" | "personal") {
  return {
    profile: { type: "agent" as const, id, name: id },
    config: { provider: "anthropic" as const, model: id, apiToken: source === "personal" ? "user" : "org" },
    ...(source ? { source } : {}),
  };
}

describe("ModelPolicy", () => {
  it("resolves organization and personal models and rejects collisions", () => {
    const policy = new ModelPolicy([record("shared")], [record("mine", "personal")]);
    expect(policy.resolve("shared").source).toBe("organization");
    expect(policy.resolve("mine").source).toBe("personal");
    expect(() => new ModelPolicy([record("same")], [record("same", "personal")]))
      .toThrow("Duplicate model id: same");
  });

  it("never silently replaces a disabled requested model", () => {
    let policy = new ModelPolicy([record("org-claude")], [record("mine", "personal")], {
      disabledOrganizationModelIds: ["org-claude"],
    });
    try {
      policy.resolve("org-claude");
      throw new Error("expected disabled model resolution to fail");
    } catch (error) {
      expect(error).toMatchObject({ code: "MODEL_DISABLED" });
    }
    expect(policy.effectiveDefault("org-claude")).toBe("mine");
  });

  it("uses valid preference, admin default, then first active model", () => {
    let policy = new ModelPolicy([record("org-a"), record("org-b")], [record("mine", "personal")], {
      defaultModelId: "org-b",
    });
    expect(policy.effectiveDefault("mine")).toBe("mine");
    expect(policy.effectiveDefault("missing")).toBe("org-b");
    let disabled = new ModelPolicy([record("org-a"), record("org-b")], [], {
      defaultModelId: "org-b", disabledOrganizationModelIds: ["org-b"],
    });
    expect(disabled.effectiveDefault(null)).toBe("org-a");
  });

  it("returns sanitized catalog rows and preserves disabled visibility", () => {
    let policy = new ModelPolicy([record("org-a")], [record("mine", "personal")], {
      defaultModelId: "org-a", disabledOrganizationModelIds: ["org-a"],
    });
    expect(policy.listCatalog()).toEqual([
      { id: "org-a", name: "org-a", provider: "anthropic", source: "organization", enabled: false, isDefault: true, canDelete: false },
      { id: "mine", name: "mine", provider: "anthropic", source: "personal", enabled: true, isDefault: false, canDelete: true },
    ]);
    expect(JSON.stringify(policy.listCatalog())).not.toContain('"apiToken"');
  });
});
