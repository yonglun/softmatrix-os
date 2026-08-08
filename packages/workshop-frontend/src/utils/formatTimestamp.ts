import type { SupportedLocale } from "@gadgets/workshop-shared/api";
import { formatDateTime } from "../i18n/format";

/** Format a chat timestamp with an explicit locale for date/time tooltips. */
export function formatFullTimestamp(date: Date, locale: SupportedLocale): string {
  return formatDateTime(date, locale);
}
