import { z } from "zod";
import { externalEventSchema } from "../contracts/calendar.ts";
import {
  CalendarNoEffect,
  type CalendarProvider,
  type CalendarAccess,
} from "./calendar-provider.ts";
import { DomainError, requireThat } from "./errors.ts";
import {
  integrationCredentialToken,
  encryptGoogleSecret,
  decryptGoogleSecret,
  hasIntegrationScopes,
} from "./google-credentials.ts";
import {
  microsoftJSON,
  MicrosoftHTTPError,
  type GoogleToken,
} from "./google-http.ts";

const base = "https://graph.microsoft.com/v1.0/me/calendars";
const resource = z.object({
  id: z.string().min(1).max(1000),
  name: z.string().min(1).max(200),
  owner: z.object({ address: z.string().nullable().optional() }).nullish(),
});
const date = z.object({
  dateTime: z
    .string()
    .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z?$/),
  timeZone: z.literal("UTC"),
});
const properties = "id,changeKey,start,end,isCancelled,showAs";
const event = z.object({
  id: z.string().min(1),
  changeKey: z.string().min(1),
  subject: z.string().nullish(),
  start: date,
  end: date,
  isCancelled: z.boolean(),
  showAs: z.string(),
});
const nextPage = z.string().max(1500).optional();
const utc = (value: z.infer<typeof date>) =>
  new Date(value.dateTime.replace(/Z?$/, "Z")).toISOString();
function segment(id: string) {
  requireThat(
    id && id !== "." && id !== ".." && !/[\r\n\0]/.test(id),
    "MICROSOFT_CALENDAR_INVALID_ID",
    400,
  );
  return encodeURIComponent(id);
}
function continuation(raw: string, path: string) {
  const target = new URL(raw);
  requireThat(
    target.origin === "https://graph.microsoft.com" &&
      target.pathname === path &&
      !target.username &&
      !target.password &&
      !target.hash,
    "MICROSOFT_CALENDAR_INVALID_PAGE",
    502,
  );
  return target;
}
function observed(e: z.infer<typeof event>) {
  return externalEventSchema.parse({
    id: e.id,
    revision: e.changeKey,
    payload: {
      title: e.subject || "(senza titolo)",
      start: utc(e.start),
      end: utc(e.end),
      timeZone: "UTC",
    },
    selfOnly: false,
    deleted: e.isCancelled,
  });
}

export function microsoftCalendarProvider(
  token: GoogleToken = (id, signal) =>
    integrationCredentialToken(id, "calendar", signal, fetcher, "microsoft"),
  fetcher: typeof fetch = fetch,
): CalendarProvider {
  async function authorized(account: string, signal: AbortSignal) {
    const auth = await token(account, signal);
    requireThat(
      hasIntegrationScopes("microsoft", "calendar", auth.scopes),
      "MICROSOFT_SCOPE_REQUIRED",
      403,
    );
    return auth;
  }
  function get(url: URL | string, bearer: string, signal: AbortSignal) {
    return microsoftJSON(
      url,
      {
        signal,
        headers: {
          Authorization: "Bearer " + bearer,
          Prefer: 'outlook.timezone="UTC", IdType="ImmutableId"',
        },
      },
      fetcher,
    );
  }
  const rights = (r: z.infer<typeof resource>) => ({
    id: r.id,
    label: r.name,
    canRead: true,
    canWriteSelf: false,
  });
  async function owned(access: CalendarAccess, signal: AbortSignal) {
    const auth = await authorized(access.accountRef, signal);
    const r = resource.parse(
      await get(
        base + "/" + segment(access.resourceId) + "?$select=id,name,owner",
        auth.accessToken,
        signal,
      ),
    );
    requireThat(
      r.id === access.resourceId &&
        r.owner?.address?.toLowerCase() === auth.email.toLowerCase(),
      "MICROSOFT_CALENDAR_ACCESS_CHANGED",
      403,
    );
    return { r, auth };
  }
  async function readOnly(): Promise<never> {
    throw new CalendarNoEffect("MICROSOFT_CALENDAR_READ_ONLY");
  }
  return {
    key: "microsoft-calendar",
    async discover(account, signal) {
      const auth = await authorized(account, signal),
        list = [];
      let url: URL | undefined = new URL(
        base + "?$select=id,name,owner&$top=100",
      );
      const visited = new Set<string>();
      while (url) {
        requireThat(
          !visited.has(url.href) && visited.size < 5,
          "MICROSOFT_CALENDAR_DISCOVERY_TOO_LARGE",
          422,
        );
        visited.add(url.href);
        const page = z
          .object({
            value: z.array(resource).max(200),
            "@odata.nextLink": nextPage,
          })
          .parse(await get(url, auth.accessToken, signal));
        list.push(
          ...page.value
            .filter(
              (r) =>
                r.owner?.address?.toLowerCase() === auth.email.toLowerCase(),
            )
            .map(rights),
        );
        requireThat(
          list.length <= 200,
          "MICROSOFT_CALENDAR_DISCOVERY_TOO_LARGE",
          422,
        );
        url = page["@odata.nextLink"]
          ? continuation(page["@odata.nextLink"], new URL(base).pathname)
          : undefined;
      }
      return list;
    },
    async checkAccess(access, signal) {
      return rights((await owned(access, signal)).r);
    },
    async read(access, input, signal) {
      const { auth } = await owned(access, signal);
      const url = new URL(
        base + "/" + segment(access.resourceId) + "/calendarView",
      );
      const purpose = JSON.stringify([
        "microsoft-calendar-page",
        access.connectionId,
        access.resourceId,
        input.start,
        input.end,
        input.mode,
      ]);
      url.searchParams.set("startDateTime", input.start);
      url.searchParams.set("endDateTime", input.end);
      url.searchParams.set(
        "$select",
        input.mode === "events" ? properties + ",subject" : properties,
      );
      url.searchParams.set("$top", "100");
      let request = url;
      if (input.cursor) {
        try {
          request = continuation(
            decryptGoogleSecret(input.cursor, purpose),
            url.pathname,
          );
        } catch {
          throw new DomainError("MICROSOFT_CALENDAR_INVALID_PAGE", 400);
        }
      }
      const page = z
        .object({ value: z.array(event).max(200), "@odata.nextLink": nextPage })
        .parse(await get(request, auth.accessToken, signal));
      const rows = page.value.filter((e) => !e.isCancelled);
      const cursor = page["@odata.nextLink"]
        ? encryptGoogleSecret(
            continuation(page["@odata.nextLink"], url.pathname).href,
            purpose,
          )
        : null;
      requireThat(
        !cursor || cursor.length <= 2000,
        "MICROSOFT_CALENDAR_INVALID_PAGE",
        502,
      );
      return {
        events: input.mode === "events" ? rows.map(observed) : [],
        busy:
          input.mode === "availability"
            ? rows
                .filter((e) => e.showAs !== "free")
                .map((e) => ({
                  start: utc(e.start),
                  end: utc(e.end),
                  timeZone: "UTC",
                }))
            : [],
        complete: cursor === null,
        nextCursor: cursor,
      };
    },
    async fetch(access, id, signal) {
      const { auth } = await owned(access, signal);
      try {
        const e = event.parse(
          await get(
            base +
              "/" +
              segment(access.resourceId) +
              "/events/" +
              segment(id) +
              "?$select=" +
              properties +
              ",subject",
            auth.accessToken,
            signal,
          ),
        );
        return e.isCancelled ? null : observed(e);
      } catch (e) {
        if (e instanceof MicrosoftHTTPError && e.httpStatus === 404)
          return null;
        throw e;
      }
    },
    create: readOnly,
    update: readOnly,
    reconcile: readOnly,
  };
}
