import { describe, expect, it } from "vitest";
import i18n from "./i18n";
import { detectLocale, isSupportedLocale } from "./locales";
import en from "./resources/en";
import zhCN from "./resources/zh-CN";

function resourcePaths(resource: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(resource).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? resourcePaths(value as Record<string, unknown>, path)
      : [path];
  });
}

describe("locale contract", () => {
  it("initializes English resources synchronously", () => {
    expect(i18n.language).toBe("en");
    expect(i18n.t("common.save")).toBe("Save");
  });

  it("never renders a missing translation key", () => {
    expect(i18n.t("missing.translation.key")).toBe("");
  });

  it("uses Chinese resources and falls back to English", () => {
    expect(i18n.t("common.save", { lng: "zh-CN" })).toBe("保存");

    i18n.removeResourceBundle("zh-CN", "translation");
    try {
      expect(i18n.t("common.save", { lng: "zh-CN" })).toBe("Save");
    } finally {
      i18n.addResourceBundle("zh-CN", "translation", zhCN, true, true);
    }
  });

  it.each([
    ["zh-CN", "zh-CN"],
    ["zh-Hans", "zh-CN"],
    ["zh", "zh-CN"],
    ["en-US", "en"],
    ["fr-FR", "en"],
  ] as const)("maps %s to %s", (input, expected) => {
    expect(detectLocale([input])).toBe(expected);
  });

  it("rejects persisted unknown locales", () => {
    expect(isSupportedLocale("zh-TW")).toBe(false);
  });

  it("keeps Chinese keys identical to English", () => {
    expect(resourcePaths(zhCN).sort()).toEqual(resourcePaths(en).sort());
  });
});
