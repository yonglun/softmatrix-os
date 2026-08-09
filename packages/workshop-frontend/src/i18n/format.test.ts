import { describe, expect, it, vi } from "vitest";
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

  it("does not mutate custom options and forces currency formatting", () => {
    const dateOptions: Intl.DateTimeFormatOptions = { dateStyle: "full", timeZone: "UTC" };
    const originalDateOptions = { ...dateOptions };
    formatDate(instant, "en", dateOptions);
    expect(dateOptions).toEqual(originalDateOptions);

    const currencyOptions: Intl.NumberFormatOptions = {
      style: "decimal",
      minimumFractionDigits: 3,
    };
    const originalCurrencyOptions = { ...currencyOptions };
    expect(formatCurrency(12.5, "en", "EUR", currencyOptions)).toBe(
      new Intl.NumberFormat("en", {
        ...currencyOptions,
        style: "currency",
        currency: "EUR",
      }).format(12.5),
    );
    expect(currencyOptions).toEqual(originalCurrencyOptions);
  });

  it("caches date-time and number formatters by locale and stable options", () => {
    const originalDateTimeFormat = Intl.DateTimeFormat;
    const dateTimeSpy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      (function DateTimeFormat(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
        return new originalDateTimeFormat(locales, options);
      }) as typeof Intl.DateTimeFormat,
    );
    const dateOptions: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "Pacific/Apia",
    };
    formatDate(instant, "zh-CN", dateOptions);
    formatDate(instant, "zh-CN", { timeZone: "Pacific/Apia", day: "2-digit", year: "numeric", month: "2-digit" });
    expect(dateTimeSpy).toHaveBeenCalledTimes(1);
    dateTimeSpy.mockRestore();

    const originalNumberFormat = Intl.NumberFormat;
    const numberSpy = vi.spyOn(Intl, "NumberFormat").mockImplementation(
      (function NumberFormat(locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
        return new originalNumberFormat(locales, options);
      }) as typeof Intl.NumberFormat,
    );
    const numberOptions: Intl.NumberFormatOptions = {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
      useGrouping: false,
    };
    formatNumber(1.25, "zh-CN", numberOptions);
    formatNumber(2.5, "zh-CN", { useGrouping: false, maximumFractionDigits: 3, minimumFractionDigits: 3 });
    expect(numberSpy).toHaveBeenCalledTimes(1);
    numberSpy.mockRestore();
  });
});
