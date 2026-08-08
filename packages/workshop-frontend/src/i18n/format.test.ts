import { describe, expect, it } from "vitest";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatTime,
} from "./format";

describe("locale-aware formatters", () => {
  const instant = new Date("2026-08-07T12:00:00Z");

  it("uses the explicit locale for dates, times, and date-times", () => {
    expect(formatDate(instant, "en", { timeZone: "UTC" })).toBe(
      new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(instant),
    );
    expect(formatDate(instant, "zh-CN", { timeZone: "UTC" })).toBe(
      new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "UTC" }).format(instant),
    );
    expect(formatTime(instant, "en", { timeZone: "UTC" })).toBe(
      new Intl.DateTimeFormat("en", { timeStyle: "short", timeZone: "UTC" }).format(instant),
    );
    expect(formatDateTime(instant, "zh-CN", { timeZone: "UTC" })).toBe(
      new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(instant),
    );
  });

  it("formats numbers and currencies with the explicit locale", () => {
    expect(formatNumber(12345.6, "zh-CN")).toBe(new Intl.NumberFormat("zh-CN").format(12345.6));
    expect(formatCurrency(1234.5, "en", "USD")).toBe(
      new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(1234.5),
    );
  });

  it("returns an empty string for absent values and preserves invalid dates", () => {
    expect(formatDate(null, "en")).toBe("");
    expect(formatTime(undefined, "zh-CN")).toBe("");
    expect(formatDate(new Date("invalid"), "en")).toBe("Invalid Date");
    expect(formatNumber(null, "en")).toBe("");
    expect(formatCurrency(undefined, "en")).toBe("");
  });
});
