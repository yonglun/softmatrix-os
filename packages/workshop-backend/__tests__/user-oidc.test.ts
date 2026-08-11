import { describe, expect, it } from "vitest";
import { UserDurableObject } from "../src/user.js";

type Profile = { type: "user"; name: string; id: string };

function makeUser(initial?: { created?: boolean; profile?: Profile }) {
  let created = initial?.created ?? false;
  let profile = initial?.profile ?? { type: "user" as const, name: "User", id: "user@example.com" };
  const user = Object.create(UserDurableObject.prototype) as UserDurableObject;
  Object.assign(user, {
    storage: {
      created: {
        get: () => created,
        put: (value: boolean) => { created = value; },
      },
      profile: {
        get: () => structuredClone(profile),
        put: (value: Profile) => { profile = structuredClone(value); },
      },
      sessions: {
        put: () => undefined,
      },
    },
  });
  return { user, getCreated: () => created };
}

describe("UserDurableObject OIDC identity routing", () => {
  const accountKey = "entra-7551a691-532e-4a93-9292-faed619dd82f-11111111-2222-4333-8444-555555555555";

  it("creates an Entra profile using UPN while routing by the stable account key", async () => {
    const { user } = makeUser();

    const token = await user.loginOrCreateViaOidc(
      "entra-7551a691-532e-4a93-9292-faed619dd82f-11111111-2222-4333-8444-555555555555",
      "alice@example.com",
      true,
    );

    expect(token).toEqual(expect.any(String));
    await expect(user.whoami()).resolves.toEqual({
      type: "user",
      name: "alice",
      id: "alice@example.com",
    });
  });

  it("preserves the existing UPN and custom display name on later sign-in", async () => {
    const { user } = makeUser();
    await user.loginOrCreateViaOidc(accountKey, "alice@example.com", true);
    await user.setOwnDisplayName("Alice Custom");

    await user.loginOrCreateViaOidc(accountKey, "renamed@example.com", true);

    await expect(user.whoami()).resolves.toEqual({
      type: "user",
      name: "Alice Custom",
      id: "alice@example.com",
    });
  });

  it("does not create an OIDC account when signups are disabled", async () => {
    const { user, getCreated } = makeUser();

    await expect(user.loginOrCreateViaOidc(accountKey, "alice@example.com", false))
      .resolves.toBeNull();
    expect(getCreated()).toBe(false);
  });
});
