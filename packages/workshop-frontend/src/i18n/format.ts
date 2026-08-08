import type { SupportedLocale } from "@gadgets/workshop-shared/api";

type DateInput = Date | number | string | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateValue(
  value: DateInput,
  locale: SupportedLocale,
  options: Intl.DateTimeFormatOptions,
): string {
  if (value == null) return "";
  const date = toDate(value);
  if (!date) return "Invalid Date";
  return new Intl.DateTimeFormat(locale, options).format(date);
}

const DATE_COMPONENT_KEYS = [
  "weekday",
  "era",
  "year",
  "month",
  "day",
  "dayPeriod",
  "hour",
  "minute",
  "second",
  "fractionalSecondDigits",
  "timeZoneName",
] as const;

function hasDateComponents(options: Intl.DateTimeFormatOptions): boolean {
  return DATE_COMPONENT_KEYS.some((key) => options[key] !== undefined);
}

/** Format a date using the selected locale and a medium date by default. */
export function formatDate(
  value: DateInput,
  locale: SupportedLocale,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const dateOptions: Intl.DateTimeFormatOptions = { dateStyle: "medium", ...options };
  if (!options.dateStyle && hasDateComponents(options)) delete dateOptions.dateStyle;
  return formatDateValue(value, locale, dateOptions);
}

/** Format a time using the selected locale and a short time by default. */
export function formatTime(
  value: DateInput,
  locale: SupportedLocale,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const timeOptions: Intl.DateTimeFormatOptions = { timeStyle: "short", ...options };
  if (!options.timeStyle && hasDateComponents(options)) delete timeOptions.timeStyle;
  return formatDateValue(value, locale, timeOptions);
}

/** Format a date and time using the selected locale and short styles by default. */
export function formatDateTime(
  value: DateInput,
  locale: SupportedLocale,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const dateTimeOptions: Intl.DateTimeFormatOptions = {
    dateStyle: "short",
    timeStyle: "short",
    ...options,
  };
  if (!options.dateStyle && !options.timeStyle && hasDateComponents(options)) {
    delete dateTimeOptions.dateStyle;
    delete dateTimeOptions.timeStyle;
  }
  return formatDateValue(value, locale, dateTimeOptions);
}

/** Format a number using the selected locale. */
export function formatNumber(
  value: number | null | undefined,
  locale: SupportedLocale,
  options: Intl.NumberFormatOptions = {},
): string {
  if (value == null) return "";
  return new Intl.NumberFormat(locale, options).format(value);
}

/** Format a currency amount using the selected locale and currency code. */
export function formatCurrency(
  value: number | null | undefined,
  locale: SupportedLocale,
  currency = "USD",
  options: Intl.NumberFormatOptions = {},
): string {
  if (value == null) return "";
  return new Intl.NumberFormat(locale, { style: "currency", currency, ...options }).format(value);
}
