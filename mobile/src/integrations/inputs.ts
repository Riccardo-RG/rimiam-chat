import type { CalendarPayload } from "../../../src/contracts/calendar";
import type { EmailEnvelope } from "../../../src/contracts/email";

export const localDay = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

export function localMoment(date: Date) {
  return (
    localDay(date) +
    " " +
    String(date.getHours()).padStart(2, "0") +
    ":" +
    String(date.getMinutes()).padStart(2, "0")
  );
}

function dateFromLocal(value: string) {
  if (!/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(value)) return null;
  const date = new Date(value.replace(" ", "T") + ":00");
  return !Number.isNaN(date.getTime()) && localMoment(date) === value
    ? date
    : null;
}
export function monthFrom(day: string) {
  const start = dateFromLocal(day + " 00:00");
  if (!start) return null;
  const end = new Date(start);
  end.setDate(start.getDate() + 30);
  return { start: start.toISOString(), end: end.toISOString() };
}
export function eventPayload(
  title: string,
  start: string,
  end: string,
): CalendarPayload | null {
  const first = dateFromLocal(start),
    last = dateFromLocal(end);
  if (!title.trim() || !first || !last || last <= first) return null;
  return {
    title: title.trim(),
    start: first.toISOString(),
    end: last.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export const addresses = (value: string) =>
  value
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
export const newEnvelope = (sender: string): EmailEnvelope => ({
  sender,
  to: [],
  cc: [],
  bcc: [],
  subject: "",
  body: "",
  attachments: [],
  kind: "new",
  target: null,
});

export function launchUrl(
  raw: string,
  origin: string,
  provider: "google" | "microsoft",
) {
  const url = new URL(raw);
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== "/api/v1/integrations/" + provider + "/launch" ||
    !url.searchParams.get("ticket")
  ) {
    throw new Error("Indirizzo di collegamento non riconosciuto.");
  }
  return url.href;
}
