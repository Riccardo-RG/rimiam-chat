import { localizedDate } from "./i18n/date.ts";
import type { UiLocale } from "./i18n/locale";

export function initials(name: string) {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  return parts.length
    ? [parts[0], ...(parts.length > 1 ? [parts.at(-1)!] : [])]
        .map((part) => Array.from(part)[0])
        .join("")
        .toLocaleUpperCase("it-IT")
    : "?";
}
const fullDate = localizedDate({
  day: "numeric",
  month: "long",
  year: "numeric",
});
const clock = localizedDate({ hour: "2-digit", minute: "2-digit" });
const weekday = localizedDate({ weekday: "long" });
const dateInYear = localizedDate({ day: "numeric", month: "short" });
const dateWithYear = localizedDate({
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatted(date: Date, formatter: Intl.DateTimeFormat) {
  // Preserve the Date methods' invalid-date fallback for older source records.
  return Number.isNaN(date.getTime())
    ? date.toString()
    : formatter.format(date);
}

export function messageDay(value: string, locale: UiLocale = "it") {
  return formatted(new Date(value), fullDate(locale));
}
export function chatClock(value: string, locale: UiLocale = "it") {
  return formatted(new Date(value), clock(locale));
}
export function mobileDayLabel(
  value: string,
  now = new Date(),
  locale: UiLocale = "it",
) {
  const date = new Date(value);
  const monday = new Date(now);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  const format =
    date >= monday && date <= now
      ? weekday
      : date.getFullYear() === now.getFullYear()
        ? dateInYear
        : dateWithYear;
  return formatted(date, format(locale));
}
export function startsReadingInterval(earlier: string, later: string) {
  return Date.parse(later) - Date.parse(earlier) >= 2 * 60 * 60 * 1000;
}
