import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { auth } from "../src/server/auth";
import { pool } from "../src/server/db";
import {
  createWorkspace,
  acceptInvitation,
  openPersonalSpace,
  execute,
} from "../src/server/commands";
import { agendaDestination, agendaView } from "../src/server/agenda";
import { messages } from "../src/server/sync";
import { workspaceSchedule } from "../src/server/agenda";
import { tasksView } from "../src/server/tasks-queries";
import { processFollowup } from "../src/server/tasks-worker";
import { establishCalendarConnection } from "../src/server/calendar-state";
import { snapshot } from "../src/server/queries";
import { FixtureCalendar } from "./support/fixture-calendar";
const iso = (n: number) => new Date(n).toISOString();
async function account() {
  const email = randomUUID() + "@example.test",
    password = "Agenda-test-2026!!";
  const { user } = await auth.api.signUpEmail({
    body: { email, password, name: "Agenda tester" },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const login = await auth.api.signInEmail({ body: { email, password } });
  const session = (
    await pool.query("SELECT id FROM session WHERE token=$1", [login.token])
  ).rows[0].id;
  return { id: user.id, email, session };
}
type Person = Awaited<ReturnType<typeof account>>;
const send = (p: Person, w: string, c: unknown) =>
  execute(p.id, w, randomUUID(), c, p.session);
async function join(p: Person, w: string, b: Person) {
  const invitation = await send(p, w, {
    type: "invitation.create",
    email: b.email,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(b.id, String(invitation.token), true);
}
const day = new Date().toISOString().slice(0, 10);
const list = (p: Person, d = day) => agendaView(p.id, p.session, d, "UTC");
const future = "2033-01-11",
  at = future + "T10:00:00.000Z",
  end = future + "T10:30:00.000Z";
async function event(p: Person, w: string, title: string, audience?: unknown) {
  const revision = (await agendaDestination(p.id, p.session, w))
    .contextRevision;
  return send(p, w, {
    type: "temporal.create",
    reason: "Prova",
    representSelf: true,
    expectedContextRevision: revision,
    payload: { title, start: at, end, timeZone: "UTC" },
    audience,
  });
}
const schedule = (
  p: Person,
  w: string,
  content: string,
  date = at,
  recurring = false,
) =>
  send(p, w, {
    type: "followup.create",
    kind: "remember",
    content,
    remindAt: date,
    timeZone: "UTC",
    reference: null,
    ...(recurring ? { recurrence: { weekdays: [1, 2, 3, 4, 5, 6, 7] } } : {}),
  });
afterAll(() => pool.end());
describe("personal and shared agenda", () => {
  it("reports only this person's active calendar connection in the selected scope", async () => {
    const a = await account();
    const b = await account();
    const w = (await createWorkspace(a.id, "Calendari", randomUUID())).id;
    await join(a, w, b);
    await establishCalendarConnection(
      a.id,
      w,
      a.session,
      new FixtureCalendar(),
      a.id,
      "Calendar",
    );
    expect((await snapshot(a.id, w)).workspace.has_linked_calendar).toBe(true);
    expect((await snapshot(b.id, w)).workspace.has_linked_calendar).toBe(false);
    expect((await list(a)).hasLinkedCalendar).toBe(false);
    const archive = (await openPersonalSpace(a.id, a.session)).id;
    const linked = await establishCalendarConnection(
      a.id,
      archive,
      a.session,
      new FixtureCalendar(),
      a.id,
      "Calendar",
    );
    expect((await list(a)).hasLinkedCalendar).toBe(true);
    expect((await list(b)).hasLinkedCalendar).toBe(false);
    await send(a, archive, {
      type: "calendar.disconnect",
      connectionId: linked.connectionId,
      expectedVersion: 1,
    });
    expect((await list(a)).hasLinkedCalendar).toBe(false);
  });
  it("protects the named audience, checks the version on RSVP, leaves declined items in the Workspace calendar", async () => {
    const a = await account(),
      b = await account(),
      outsider = await account(),
      w = (await createWorkspace(a.id, "Inviti", randomUUID())).id;
    await join(a, w, b);
    const privateW = (await openPersonalSpace(a.id, a.session)).id;
    await event(a, privateW, "Solo A");
    await event(a, w, "Calendario");
    const named = await event(a, w, "Per B", {
      kind: "people",
      people: [b.id],
    });
    await event(a, w, "Gruppo", { kind: "all" });
    expect((await list(a, future)).items.map((i) => i.title).sort()).toEqual([
      "Gruppo",
      "Solo A",
    ]);
    expect((await list(b, future)).items.map((i) => i.title).sort()).toEqual([
      "Gruppo",
      "Per B",
    ]);
    expect((await list(outsider, future)).items).toEqual([]);
    const respond = {
      type: "temporal.respond",
      eventId: named.eventId,
      expectedVersion: 1,
      response: "declined",
    };
    await expect(send(a, w, respond)).rejects.toThrow("CALENDAR_NOT_INVITED");
    await expect(send(outsider, w, respond)).rejects.toThrow(
      "WORKSPACE_ACCESS_DENIED",
    );
    await expect(
      send(b, w, { ...respond, expectedVersion: 2 }),
    ).rejects.toThrow("CALENDAR_EVENT_STALE");
    await send(b, w, respond);
    expect((await list(b, future)).items.map((i) => i.title)).toEqual([
      "Gruppo",
    ]);
    expect(
      (
        await pool.query(
          "SELECT current_version FROM scheduled_event WHERE workspace_id=$1 AND id=$2",
          [w, named.eventId],
        )
      ).rowCount,
    ).toBe(1);
    const group = (await list(b, future)).items[0];
    await send(b, w, { ...respond, eventId: group.id, response: "accepted" });
    expect((await list(b, future)).items[0].rsvp).toBe("accepted");
  });
  it("local dismissal, closure and a series split preserve other people, dates and historical delivery", async () => {
    const a = await account(),
      b = await account(),
      w = (await createWorkspace(a.id, "Agenda", randomUUID())).id;
    await join(a, w, b);
    const id = String(
      (await schedule(a, w, "Ricorrenza", at, true)).followupId,
    );
    const one = {
      type: "followup.occurrence",
      followupId: id,
      expectedVersion: 1,
      scheduledAt: at,
    };
    await send(b, w, { ...one, action: "hide" });
    expect((await list(b, future)).items).toEqual([]);
    expect((await list(a, future)).items[0].title).toBe("Ricorrenza");
    await expect(send(b, w, { ...one, action: "close" })).rejects.toThrow(
      "FOLLOWUP_NOT_OWNER",
    );
    await send(a, w, { ...one, action: "close" });
    expect((await list(a, future)).items).toEqual([]);
    expect(
      (await workspaceSchedule(a.id, w, false, 20)).entries.find(
        (e) => e.id === id,
      )?.at,
    ).toBe("2033-01-12T10:00:00.000Z");
    expect(
      (await tasksView(b.id, w, undefined, id)).followups[0].nextRemindAt,
    ).toBe("2033-01-12T10:00:00.000Z");
    const next = "2033-01-12",
      third = "2033-01-13";
    expect((await list(b, next)).items).toHaveLength(1);
    await send(a, w, {
      ...one,
      scheduledAt: third + "T10:00:00Z",
      action: "replace_following",
      replacement: {
        content: "Nuova serie",
        remindAt: third + "T11:00:00Z",
        timeZone: "UTC",
      },
    });
    expect((await list(a, next)).items.map((i) => i.title)).toEqual([
      "Ricorrenza",
    ]);
    expect((await list(b, third)).items.map((i) => i.title)).toEqual([
      "Nuova serie",
    ]);
    await send(a, w, {
      ...one,
      action: "close",
      scheduledAt: next + "T10:00:00Z",
    });
    expect(
      (await workspaceSchedule(a.id, w, false, 20)).entries.find(
        (e) => e.id === id,
      ),
    ).toBeUndefined();
    expect(
      (await tasksView(a.id, w, undefined, id)).followups[0].nextRemindAt,
    ).toBeNull();
    expect(
      (
        await pool.query(
          "SELECT next_remind_at FROM workspace_followup WHERE workspace_id=$1 AND id=$2",
          [w, id],
        )
      ).rows[0].next_remind_at.toISOString(),
    ).toBe(at);
  });
  it("archives only earlier private deliveries and leaves today's occurrence available to its owner", async () => {
    const a = await account(),
      w = (await openPersonalSpace(a.id, a.session)).id,
      yesterday = iso(Date.now() - 86400_000 - 60000);
    const id = String(
      (await schedule(a, w, "Controllo", yesterday)).followupId,
    );
    await processFollowup(w, id, 1);
    const open = await list(a);
    expect(open.previous.map((p) => p.id)).toContain(id);
    const todayId = (await schedule(a, w, "Oggi", day + "T12:00:00Z"))
      .followupId;
    await send(a, w, {
      type: "followup.previous",
      followupId: id,
      before: open.before,
      timeZone: "UTC",
      action: "archive",
    });
    const now = await list(a);
    expect(now.previous).toHaveLength(0);
    expect(now.items.map((i) => i.id)).toContain(todayId);
  });
  it("keeps a requested personal reminder and its follow-up private while retaining the authored shared message", async () => {
    const a = await account(),
      b = await account(),
      w = (await createWorkspace(a.id, "Richieste", randomUUID())).id;
    await join(a, w, b);
    const origin = await send(a, w, {
      type: "message.send",
      content: "@Emme ricordami domani alle 10 di telefonare allo studio",
      clientTimeZone: "Europe/Rome",
    });
    const own = (await messages(a.id, w, 0, 100, 100)).messages.find(
      (m) => m.id === origin.messageId,
    )!;
    const other = (await messages(b.id, w, 0, 100, 100)).messages.find(
      (m) => m.id === origin.messageId,
    )!;
    expect(own.reminder?.audience).toBe("personal");
    expect(own.reminder?.id).toBeTruthy();
    expect(own.reminder?.content).toBe("telefonare allo studio");
    expect(other.reminder).toBeNull();
    expect(other.content).toBe(own.content);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM workspace_followup WHERE workspace_id=$1",
          [w],
        )
      ).rows[0].n,
    ).toBe(0);
    const ask = await send(a, w, {
      type: "message.send",
      content: "@Emme ricordaci domani di inviare il preventivo",
      clientTimeZone: "Europe/Rome",
    });
    const missing = (await messages(a.id, w, 0, 100, 100)).messages.find(
      (m) => m.id === ask.messageId,
    )!.reminder!;
    expect(missing.at).toBeNull();
    expect(missing.day).toBeTruthy();
    const cmd = {
      type: "reminder.set_time",
      messageId: ask.messageId,
      remindAt: iso(Date.now() + 86400000),
    };
    await expect(send(b, w, cmd)).rejects.toThrow("REMINDER_REQUEST_NOT_FOUND");
    await send(a, w, cmd);
    await expect(send(a, w, cmd)).rejects.toThrow("REMINDER_ALREADY_SCHEDULED");
    expect(
      (await messages(a.id, w, 0, 100, 100)).messages.find(
        (m) => m.id === ask.messageId,
      )!.reminder?.destination,
    ).toBe(w);
  });
  it("one stable Task offer changes status on acceptance, no assignment merely from suggestion", async () => {
    const a = await account(),
      b = await account(),
      w = (await createWorkspace(a.id, "Attività", randomUUID())).id;
    await join(a, w, b);
    const offered = await send(a, w, {
      type: "task.create",
      content: {
        title: "Revisione",
        description: "Rileggere il preventivo",
        dueAt: at,
        timeZone: "UTC",
        suggestedPerson: b.id,
        references: [],
      },
    });
    const line = (await messages(b.id, w, 0, 100, 100)).messages.find(
      (m) => m.taskOffer,
    )!;
    expect(line.taskOffer?.status).toBe("pending");
    expect((await list(b)).offers.map((o) => o.id)).toContain(offered.taskId);
    expect((await workspaceSchedule(b.id, w, true, 20)).entries).toHaveLength(
      0,
    );
    await send(b, w, {
      type: "task.accept",
      taskId: offered.taskId,
      expectedVersion: 1,
      reason: "Me ne occupo",
      representSelf: true,
    });
    const after = (await messages(b.id, w, 0, 100, 100)).messages.filter(
      (m) => m.taskOffer,
    );
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(line.id);
    expect(after[0].taskOffer?.status).toBe("accepted");
    expect((await list(b)).offers).toHaveLength(0);
    expect(
      (await workspaceSchedule(b.id, w, true, 20)).entries.map((i) => i.id),
    ).toContain(offered.taskId);
    const other = await send(a, w, {
      type: "task.create",
      content: {
        title: "Prova",
        description: "Rifiutabile",
        dueAt: at,
        timeZone: "UTC",
        suggestedPerson: b.id,
        references: [],
      },
    });
    await send(b, w, {
      type: "task.decline",
      taskId: other.taskId,
      expectedVersion: 1,
      reason: "Non disponibile",
    });
    expect((await list(b)).offers).toHaveLength(0);
  });
});
