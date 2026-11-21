import { expect, it, vi } from "vitest";
import { microsoftCalendarProvider } from "../src/server/microsoft-calendar";
import type { CalendarAccess } from "../src/server/calendar-provider";
const root = "https://graph.microsoft.com/v1.0/me/calendars";
const account = "reader@example.test",
  id = "primary";
const access: CalendarAccess = {
  connectionId: "a",
  accountRef: "binding",
  resourceId: id,
};
const range = {
  mode: "availability" as const,
  start: "2026-11-20T00:00:00.000Z",
  end: "2026-11-21T00:00:00.000Z",
};
const token = async () => ({
  accessToken: "test-only",
  email: account,
  scopes: ["User.Read", "Calendars.ReadBasic"],
});
const resource = { id, name: "Mine", owner: { address: account } };
const event = {
  id: "e",
  changeKey: "rev",
  start: { dateTime: "2026-11-20T09:30:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2026-11-20T10:00:00.0000000", timeZone: "UTC" },
  subject: "Sensitive subject",
  showAs: "busy",
  isCancelled: false,
};
it("requests no subject for availability, binds continuation to owner, window and mode, and forbids writes", async () => {
  let count = 0;
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    expect(init?.method ?? "GET").toBe("GET");
    const url = new URL(String(input));
    if (url.pathname.endsWith("/primary")) return Response.json(resource);
    expect(url.searchParams.get("$select") ?? "").not.toContain("subject");
    if (count++ === 0)
      return Response.json({
        value: [event, { ...event, id: "free", showAs: "free" }],
        "@odata.nextLink": root + "/primary/calendarView?$skiptoken=opaque",
      });
    return Response.json({ value: [] });
  });
  const adapter = microsoftCalendarProvider(token, fetcher),
    signal = new AbortController().signal;
  const first = await adapter.read(access, range, signal);
  expect(first.events).toEqual([]);
  expect(first.busy).toHaveLength(1);
  expect(JSON.stringify(first)).not.toContain(event.subject);
  expect(first.nextCursor).toBeTruthy();
  for (const [who, query] of [
    [{ ...access, connectionId: "else" }, range],
    [access, { ...range, mode: "events" as const }],
    [access, { ...range, start: "2026-11-20T01:00:00.000Z" }],
  ] as const) {
    await expect(
      adapter.read(who, { ...query, cursor: first.nextCursor! }, signal),
    ).rejects.toThrow("MICROSOFT_CALENDAR_INVALID_PAGE");
  }
  expect(count).toBe(1);
  expect(
    await adapter.read(access, { ...range, cursor: first.nextCursor! }, signal),
  ).toMatchObject({ complete: true, nextCursor: null });
  const effect = {
    operationKey: "key",
    operation: "create" as const,
    payload: {
      title: "Test",
      start: range.start,
      end: range.end,
      timeZone: "UTC",
    },
  };
  await expect(adapter.create(access, effect, signal)).rejects.toThrow(
    "MICROSOFT_CALENDAR_READ_ONLY",
  );
  await expect(adapter.update(access, effect, signal)).rejects.toThrow(
    "MICROSOFT_CALENDAR_READ_ONLY",
  );
  expect(count).toBe(2);
});
it("rejects continuation outside the calendar path and stops reads after resource ownership changes", async () => {
  const signal = new AbortController().signal;
  const fake = vi.fn<typeof fetch>(async (input) =>
    new URL(String(input)).pathname.endsWith("/primary")
      ? Response.json(resource)
      : Response.json({
          value: [],
          "@odata.nextLink": "https://else.example/path",
        }),
  );
  await expect(
    microsoftCalendarProvider(token, fake).read(access, range, signal),
  ).rejects.toThrow("MICROSOFT_CALENDAR_INVALID_PAGE");
  const changed = vi.fn(async () =>
    Response.json({ ...resource, owner: { address: "someone@example.test" } }),
  );
  await expect(
    microsoftCalendarProvider(token, changed).read(access, range, signal),
  ).rejects.toThrow("MICROSOFT_CALENDAR_ACCESS_CHANGED");
  expect(changed).toHaveBeenCalledTimes(1);
});
