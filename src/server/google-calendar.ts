import { z } from "zod";
import type {
  CalendarProvider,
  CalendarAccess,
  CalendarEffect,
} from "./calendar-provider.ts";
import { CalendarNoEffect } from "./calendar-provider.ts";
import {
  calendarPayloadSchema,
  externalEventSchema,
} from "../contracts/calendar.ts";
import { requireThat } from "./errors.ts";
import {
  googleJSON,
  GoogleHTTPError,
  googleHash,
  type GoogleToken,
} from "./google-http.ts";
import { googleCredentialToken } from "./google-credentials.ts";

const resourceSchema = z.object({
  id: z.string(),
  summary: z.string().optional(),
  accessRole: z.string(),
  timeZone: z.string().optional(),
});
const dateSchema = z.object({
  dateTime: z.string().optional(),
  date: z.string().optional(),
  timeZone: z.string().optional(),
});
const eventSchema = z.object({
  id: z.string(),
  etag: z.string(),
  summary: z.string().optional(),
  status: z.string().optional(),
  start: dateSchema.optional(),
  end: dateSchema.optional(),
  eventType: z.string().optional(),
  attendees: z.array(z.unknown()).optional(),
  organizer: z.object({ self: z.boolean().optional() }).optional(),
  recurrence: z.array(z.string()).optional(),
  recurringEventId: z.string().optional(),
  conferenceData: z.unknown().optional(),
  hangoutLink: z.string().optional(),
  transparency: z.string().optional(),
  reminders: z
    .object({
      useDefault: z.boolean().optional(),
      overrides: z.array(z.unknown()).optional(),
    })
    .optional(),
  extendedProperties: z
    .object({ private: z.record(z.string(), z.string()).optional() })
    .optional(),
});
// All-day observations retain local midnight boundaries, including daylight-saving offsets.
function midnight(day: string, timeZone: string) {
  requireThat(
    /^\d{4}-\d{2}-\d{2}$/.test(day),
    "GOOGLE_CALENDAR_TIME_UNSUPPORTED",
    502,
  );
  const desired = Date.parse(`${day}T00:00:00Z`);
  let instant = desired;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(instant)
        .map((p) => [p.type, p.value]),
    );
    const represented = Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
    );
    instant += desired - represented;
  }
  return new Date(instant).toISOString();
}
function toEvent(raw: unknown, zone = "UTC") {
  const e = eventSchema.parse(raw);
  requireThat(e.start && e.end, "GOOGLE_CALENDAR_TIME_UNSUPPORTED", 502);
  const timeZone = e.start.timeZone ?? zone;
  const payload = calendarPayloadSchema.parse({
    title: e.summary || "(senza titolo)",
    start: e.start.dateTime ?? midnight(e.start.date!, timeZone),
    end: e.end.dateTime ?? midnight(e.end.date!, timeZone),
    timeZone,
  });
  return externalEventSchema.parse({
    id: e.id,
    revision: e.etag,
    payload,
    operationKey: e.extendedProperties?.private?.miriamOperation,
    selfOnly:
      !e.attendees?.length &&
      e.organizer?.self === true &&
      !e.recurringEventId &&
      !e.recurrence?.length &&
      !e.conferenceData &&
      !e.hangoutLink &&
      (!e.eventType || e.eventType === "default"),
    deleted: e.status === "cancelled",
  });
}
const path = (id: string) =>
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events`;
const same = (
  a: z.infer<typeof calendarPayloadSchema>,
  b: z.infer<typeof calendarPayloadSchema>,
) =>
  a.title === b.title &&
  Date.parse(a.start) === Date.parse(b.start) &&
  Date.parse(a.end) === Date.parse(b.end) &&
  a.timeZone === b.timeZone;
export function googleCalendarProvider(
  token: GoogleToken = (id, signal) =>
    googleCredentialToken(id, "calendar", signal),
  fetcher: typeof fetch = fetch,
): CalendarProvider {
  async function request(
    account: string,
    url: string | URL,
    signal: AbortSignal,
    init: RequestInit = {},
  ) {
    const auth = await token(account, signal);
    return googleJSON(
      url,
      {
        ...init,
        signal,
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      },
      fetcher,
    );
  }
  async function resource(access: CalendarAccess, signal: AbortSignal) {
    const r = resourceSchema.parse(
      await request(
        access.accountRef,
        `https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(access.resourceId)}`,
        signal,
      ),
    );
    requireThat(
      r.id === access.resourceId && r.accessRole === "owner",
      "GOOGLE_CALENDAR_OWNER_REQUIRED",
      403,
    );
    return r;
  }
  async function fetchRaw(
    access: CalendarAccess,
    id: string,
    signal: AbortSignal,
  ) {
    try {
      return eventSchema.parse(
        await request(
          access.accountRef,
          `${path(access.resourceId)}/${encodeURIComponent(id)}`,
          signal,
        ),
      );
    } catch (error) {
      if (
        error instanceof GoogleHTTPError &&
        [404, 410].includes(error.httpStatus)
      )
        return null;
      throw error;
    }
  }
  async function write(
    access: CalendarAccess,
    effect: CalendarEffect,
    signal: AbortSignal,
  ) {
    let auth,
      previous: z.infer<typeof eventSchema> | null = null;
    try {
      await resource(access, signal);
      auth = await token(access.accountRef, signal);
      if (effect.operation === "update") {
        requireThat(
          effect.externalId && effect.expectedRevision,
          "GOOGLE_CALENDAR_PRECONDITION_REQUIRED",
          400,
        );
        previous = await fetchRaw(access, effect.externalId, signal);
        requireThat(
          previous &&
            previous.etag === effect.expectedRevision &&
            toEvent(previous).selfOnly &&
            previous.reminders?.useDefault !== true &&
            !previous.reminders?.overrides?.length,
          "GOOGLE_CALENDAR_PRECONDITION_FAILED",
          409,
        );
      }
    } catch {
      throw new CalendarNoEffect("GOOGLE_CALENDAR_PREFLIGHT_FAILED");
    }
    const id = effect.externalId ?? googleHash(effect.operationKey);
    const payload = {
      summary: effect.payload.title,
      start: {
        dateTime: effect.payload.start,
        timeZone: effect.payload.timeZone,
      },
      end: { dateTime: effect.payload.end, timeZone: effect.payload.timeZone },
      extendedProperties: {
        private: {
          ...previous?.extendedProperties?.private,
          miriamOperation: effect.operationKey,
        },
      },
      ...(effect.operation === "create"
        ? { id, reminders: { useDefault: false, overrides: [] } }
        : {}),
    };
    const url = new URL(
      effect.operation === "create"
        ? path(access.resourceId)
        : `${path(access.resourceId)}/${encodeURIComponent(id)}`,
    );
    url.searchParams.set("sendUpdates", "none");
    try {
      const raw = await googleJSON(
        url,
        {
          method: effect.operation === "create" ? "POST" : "PATCH",
          signal,
          headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            "Content-Type": "application/json",
            ...(effect.expectedRevision
              ? { "If-Match": effect.expectedRevision }
              : {}),
          },
          body: JSON.stringify(payload),
        },
        fetcher,
      );
      return toEvent(raw, effect.payload.timeZone);
    } catch (error) {
      if (
        error instanceof GoogleHTTPError &&
        error.httpStatus === 409 &&
        effect.operation === "create"
      ) {
        const existing = await fetchRaw(access, id, signal);
        if (existing) {
          const e = toEvent(existing, effect.payload.timeZone);
          if (
            e.operationKey === effect.operationKey &&
            same(e.payload, effect.payload) &&
            e.selfOnly &&
            !e.deleted
          )
            return e;
        }
      }
      if (
        error instanceof GoogleHTTPError &&
        [400, 401, 403, 404, 412, 413, 429].includes(error.httpStatus)
      )
        throw new CalendarNoEffect(
          error.httpStatus === 412
            ? "GOOGLE_CALENDAR_PRECONDITION_FAILED"
            : error.code,
        );
      throw error; // Any possible application/response loss remains OUTCOME_UNKNOWN.
    }
  }
  return {
    key: "google-calendar",
    async discover(account, signal) {
      const list = z
        .object({
          items: z.array(resourceSchema).max(200).optional(),
          nextPageToken: z.string().optional(),
        })
        .parse(
          await request(
            account,
            "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=owner&maxResults=200",
            signal,
          ),
        );
      requireThat(
        !list.nextPageToken,
        "GOOGLE_CALENDAR_DISCOVERY_TOO_LARGE",
        422,
      );
      return (list.items ?? [])
        .filter((r) => r.accessRole === "owner")
        .map((r) => ({
          id: r.id,
          label: r.summary ?? r.id,
          canRead: true,
          canWriteSelf: true,
        }));
    },
    async checkAccess(access, signal) {
      const r = await resource(access, signal);
      return {
        id: r.id,
        label: r.summary ?? r.id,
        canRead: true,
        canWriteSelf: true,
      };
    },
    async read(access, input, signal) {
      const r = await resource(access, signal),
        url = new URL(path(access.resourceId));
      url.searchParams.set("timeMin", input.start);
      url.searchParams.set("timeMax", input.end);
      url.searchParams.set("singleEvents", "true");
      url.searchParams.set("maxResults", "100");
      url.searchParams.set("orderBy", "startTime");
      if (input.cursor) url.searchParams.set("pageToken", input.cursor);
      const raw = z
        .object({
          items: z.array(eventSchema).max(100).optional(),
          nextPageToken: z.string().optional(),
        })
        .parse(await request(access.accountRef, url, signal));
      const events = (raw.items ?? [])
        .filter((e) => e.status !== "cancelled")
        .filter(
          (e) =>
            input.mode !== "availability" || e.transparency !== "transparent",
        )
        .map((e) => toEvent(e, r.timeZone));
      return {
        events: input.mode === "events" ? events : [],
        busy:
          input.mode === "availability"
            ? events.map((e) => ({
                start: e.payload.start,
                end: e.payload.end,
                timeZone: e.payload.timeZone,
              }))
            : [],
        complete: !raw.nextPageToken,
        nextCursor: raw.nextPageToken ?? null,
      };
    },
    async fetch(access, id, signal) {
      const owner = await resource(access, signal);
      const r = await fetchRaw(access, id, signal);
      return r && r.status !== "cancelled" ? toEvent(r, owner.timeZone) : null;
    },
    create: write,
    update: write,
    async reconcile(access, effect, signal) {
      await resource(access, signal);
      const raw = await fetchRaw(
        access,
        effect.externalId ?? googleHash(effect.operationKey),
        signal,
      );
      if (raw && raw.status !== "cancelled") {
        const e = toEvent(raw, effect.payload.timeZone);
        if (
          e.operationKey === effect.operationKey &&
          e.selfOnly &&
          same(e.payload, effect.payload)
        )
          return { outcome: "applied", event: e };
      }
      // Absence cannot exclude an in-flight insert/update, and changed metadata is not proof.
      return { outcome: "unknown" };
    },
  };
}
