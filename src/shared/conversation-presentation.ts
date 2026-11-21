export function initials(name: string) {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  return parts.length
    ? [parts[0], ...(parts.length > 1 ? [parts.at(-1)!] : [])]
        .map((part) => Array.from(part)[0])
        .join("")
        .toLocaleUpperCase("it-IT")
    : "?";
}
export function messageDay(value: string, locale = "it") {
  return new Date(value).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function chatClock(value: string, locale = "it") {
  return new Date(value).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
export function mobileDayLabel(value: string, now = new Date(), locale = "it") {
  const date = new Date(value);
  const monday = new Date(now);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  monday.setHours(0, 0, 0, 0);
  return date >= monday && date <= now
    ? date.toLocaleDateString(locale, { weekday: "long" })
    : date.toLocaleDateString(locale, {
        day: "numeric",
        month: "short",
        ...(date.getFullYear() !== now.getFullYear()
          ? { year: "numeric" as const }
          : {}),
      });
}
export function startsReadingInterval(earlier: string, later: string) {
  return Date.parse(later) - Date.parse(earlier) >= 2 * 60 * 60 * 1000;
}
