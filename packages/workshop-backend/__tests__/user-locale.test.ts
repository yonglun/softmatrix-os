import { describe, expect, it } from "vitest";
import type { SupportedLocale } from "@gadgets/workshop-shared/api";
import { UserDurableObject } from "../src/user.js";

function makeUser(backing = { value: null as SupportedLocale | null }) {
  const user = Object.create(UserDurableObject.prototype) as UserDurableObject;
  Object.assign(user, {
    env: {},
    storage: {
      profile: {
        get: () => ({ type: "user", name: "Test user", id: "test@example.com" }),
      },
      locale: {
        get: () => backing.value,
        put: (value: SupportedLocale | null) => { backing.value = value; },
      },
      quickModel: { get: () => null },
    },
  });
  return { user, backing };
}

describe("UserDurableObject locale preference", () => {
  it("defaults to null for a legacy user with no locale value", async () => {
    const { user } = makeUser();

    await expect(user.getLocale()).resolves.toBeNull();
  });

  it("stores supported locale values", async () => {
    const { user, backing } = makeUser();

    await user.setLocale("zh-CN");

    expect(backing.value).toBe("zh-CN");
    await expect(user.getLocale()).resolves.toBe("zh-CN");
  });

  it("rejects unsupported locale values without overwriting the preference", async () => {
    const { user, backing } = makeUser({ value: "en" });

    await expect(user.setLocale("fr-FR" as SupportedLocale)).rejects.toThrow(
      "Unsupported locale",
    );
    expect(backing.value).toBe("en");
  });

  it("keeps the preference after a User DO reload", async () => {
    const backing = { value: null as SupportedLocale | null };
    const first = makeUser(backing).user;
    await first.setLocale("zh-CN");

    const reloaded = makeUser(backing).user;
    await expect(reloaded.getLocale()).resolves.toBe("zh-CN");
  });

  it("includes the supported locale in Agent chat context with an English legacy fallback", async () => {
    const legacy = makeUser();
    await expect(legacy.user.getChatContext(null)).resolves.toMatchObject({ locale: "en" });

    const chinese = makeUser({ value: "zh-CN" });
    await expect(chinese.user.getChatContext(null)).resolves.toMatchObject({ locale: "zh-CN" });
  });
});
