import { describe, expect, it } from "vitest";
import { DEFAULT_ADMIN_CONFIG, parseAdminConfig } from "../src/admin-config.js";

describe("admin model policy", () => {
  it("backfills model policy for legacy admin config", () => {
    expect(parseAdminConfig("{}").modelPolicy).toEqual({
      defaultModelId: "",
      disabledOrganizationModelIds: [],
    });
  });

  it("deduplicates and trims disabled model IDs", () => {
    const config = parseAdminConfig(JSON.stringify({ modelPolicy: {
      defaultModelId: " org-claude ",
      disabledOrganizationModelIds: ["org-gemini", "org-gemini", ""],
    }}));
    expect(config.modelPolicy).toEqual({
      defaultModelId: "org-claude",
      disabledOrganizationModelIds: ["org-gemini"],
    });
  });

  it("always includes a complete default policy", () => {
    expect(DEFAULT_ADMIN_CONFIG.modelPolicy).toEqual({ defaultModelId: "", disabledOrganizationModelIds: [] });
  });
});
