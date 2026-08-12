import { describe, expect, it, vi } from "vitest";
import {
  getAuthenticatedIdentityIds,
  isConfiguredAdmin,
} from "../src/server.js";

describe("authenticated profile identity", () => {
  it("keeps the Durable Object id for internal ownership and uses the stored profile id for UI identity", async () => {
    const profile = { type: "user" as const, name: "Alice", id: "alice@example.com" };
    const user = { whoami: vi.fn().mockResolvedValue(profile) };

    await expect(getAuthenticatedIdentityIds(user, "do:entra-account")).resolves.toEqual({
      internalUserId: "do:entra-account",
      profileId: "alice@example.com",
    });
    expect(user.whoami).toHaveBeenCalledTimes(1);
  });

  it("matches configured admins against the stored profile id", () => {
    expect(isConfiguredAdmin(["alice@example.com"], "alice@example.com")).toBe(true);
    expect(isConfiguredAdmin(["admin@example.com"], "alice@example.com")).toBe(false);
    expect(isConfiguredAdmin('["alice@example.com"]', "alice@example.com")).toBe(true);
  });
});
