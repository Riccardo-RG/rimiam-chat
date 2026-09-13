import { randomUUID } from "node:crypto";
import { afterAll, describe, it, expect } from "vitest";
import { auth } from "../src/server/auth";
import { pool } from "../src/server/db";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import { establishCalendarConnection } from "../src/server/calendar-state";
import {
  processCalendarAction,
  processCalendarRead,
  recoverCalendar,
} from "../src/server/calendar-worker";
import { calendarView, calendarHistory } from "../src/server/calendar-queries";
import { handleAPI } from "../src/server/api";
import {
  calendarViewSchema,
  type CalendarCommand,
} from "../src/contracts/calendar";
import { FixtureCalendar } from "./support/fixture-calendar";
import {
  processInterpretation,
  claimInterpretation,
} from "../src/server/interpretation";
import { fixtureInterpreter } from "./support/fixture-interpreter";
const password = "Calendar-test-only-2026!";
const payload = {
  title: "Sopralluogo personale",
  start: "2026-10-10T10:00:00Z",
  end: "2026-10-10T11:00:00Z",
  timeZone: "Europe/Rome",
};
const window = { start: "2026-10-01T00:00:00Z", end: "2026-10-31T00:00:00Z" };
async function person() {
  const email = `${randomUUID()}@example.test`;
  const { user } = await auth.api.signUpEmail({
    body: { email, password, name: "Calendar tester" },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const login = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const session = (
    await pool.query("SELECT id FROM session WHERE token=$1", [
      login.response.token,
    ])
  ).rows[0].id as string;
  return {
    id: user.id,
    email,
    session,
    cookie: login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
async function setup() {
  const a = await person(),
    w = (await createWorkspace(a.id, "Calendar test", randomUUID())).id,
    p = new FixtureCalendar();
  const c = await establishCalendarConnection(
    a.id,
    w,
    a.session,
    p,
    a.id,
    "Connessione personale",
  );
  const cmd = (command: CalendarCommand, id = randomUUID()) =>
    execute(a.id, w, id, command, a.session);
  const view = () => calendarView(a.id, w, window.start, window.end);
  const propose = () =>
    cmd({
      type: "calendar.propose",
      connectionId: c.connectionId,
      resourceId: c.resourceIds[0],
      operation: "create",
      payload,
      reason: "Visita personale",
      shareWithWorkspace: true,
    });
  const authorize = async (id: string, version = 1) => {
    const v = await view();
    return cmd({
      type: "calendar.authorize",
      actionId: id,
      version,
      expectedContextRevision: v.contextRevision,
      expectedAccessRevision: v.accessRevision,
      representSelf: true,
    });
  };
  return { a, w, p, c, cmd, view, propose, authorize };
}
afterAll(() => pool.end());
describe("Calendar domain and common contract", () => {
  it("attaches timing to the existing self-adopted commitment identity and supplies canonical temporal context", async () => {
    const t = await setup();
    const message = await execute(t.a.id, t.w, randomUUID(), {
      type: "message.send",
      content: "We commit: I personally visit the venue",
    });
    await processInterpretation(message.interpretationId, fixtureInterpreter);
    const candidate = (
      await pool.query("SELECT id FROM candidate WHERE source_id=$1", [
        message.messageId,
      ])
    ).rows[0];
    const proposal = await execute(t.a.id, t.w, randomUUID(), {
      type: "commitment.propose",
      candidateId: candidate.id,
      people: [t.a.id],
    });
    const before = await t.view();
    await execute(t.a.id, t.w, randomUUID(), {
      type: "commitment.approve",
      proposalId: proposal.proposalId,
      expectedContextRevision: before.contextRevision,
      expectedAccessRevision: before.accessRevision,
      representSelf: true,
    });
    const current = await t.view();
    expect(current.ownCommitments).toEqual([
      expect.objectContaining({ id: proposal.proposalId, version: 0 }),
    ]);
    await t.cmd({
      type: "commitment.time.set",
      commitmentId: proposal.proposalId,
      expectedVersion: 0,
      time: {
        start: payload.start,
        end: payload.end,
        timeZone: payload.timeZone,
      },
      reason: "Intervallo concordato per il mio impegno",
      representSelf: true,
      expectedContextRevision: current.contextRevision,
    });
    const view = await t.view();
    expect(view.temporal[0].id).toBe(proposal.proposalId);
    expect(view.temporal[0].kind).toBe("commitment");
    expect(view.ownCommitments[0].version).toBe(1);
    const otherPerson = await person();
    const invitation = await execute(t.a.id, t.w, randomUUID(), {
      type: "invitation.create",
      email: otherPerson.email,
      fullHistoryDisclosed: true,
    });
    await acceptInvitation(otherPerson.id, invitation.token as string, true);
    expect(
      (await calendarView(otherPerson.id, t.w, window.start, window.end))
        .ownCommitments,
    ).toEqual([]);
    expect(
      (
        await pool.query(
          "SELECT id FROM scheduled_event WHERE workspace_id=$1",
          [t.w],
        )
      ).rowCount,
    ).toBe(0);
    const next = await execute(t.a.id, t.w, randomUUID(), {
      type: "message.send",
      content: "Quando è il mio impegno?",
    });
    const claim = await claimInterpretation(next.interpretationId);
    expect(claim?.context.temporal).toHaveLength(1);
    expect(claim?.context.temporal[0].id).toBe(proposal.proposalId);
  });
  it("same command receipt replays exactly and rejects changed payload under that identity", async () => {
    const t = await setup(),
      id = randomUUID(),
      c: CalendarCommand = {
        type: "temporal.create",
        payload,
        reason: "Explicit self intent",
        representSelf: true,
        expectedContextRevision: 0,
      };
    const original = await t.cmd(c, id);
    expect(await t.cmd(c, id)).toEqual(original);
    await expect(
      t.cmd({ ...c, payload: { ...payload, title: "Changed" } }, id),
    ).rejects.toThrow("COMMAND_ID_REUSED");
    expect((await t.view()).temporal).toHaveLength(1);
  });
  it("connection revocation in preflight stops the write and revoked reads retain no disclosed observation", async () => {
    const t = await setup(),
      a = await t.propose();
    await t.authorize(a.actionId);
    t.p.beforeCheck = async () => {
      await t.cmd({
        type: "calendar.disconnect",
        connectionId: t.c.connectionId,
        expectedVersion: 1,
      });
    };
    await processCalendarAction(a.actionId, t.p);
    expect(t.p.writes).toBe(0);
    expect((await t.view()).actions[0].status).toBe("FAILED");
    const s = await setup();
    const read = await s.cmd({
      type: "calendar.read",
      connectionId: s.c.connectionId,
      resourceId: s.c.resourceIds[0],
      mode: "availability",
      ...window,
    });
    s.p.beforeCheck = async () => {
      await s.cmd({
        type: "calendar.disconnect",
        connectionId: s.c.connectionId,
        expectedVersion: 1,
      });
    };
    await processCalendarRead(read.readId, s.p);
    expect((await s.view()).observations).toHaveLength(0);
  });
  it("observing personal content never shares it with another admitted member or the Context Engine", async () => {
    const t = await setup(),
      b = await person(),
      access = {
        connectionId: t.c.connectionId,
        accountRef: t.a.id,
        resourceId: "personal",
      };
    t.p.events.set(t.p.keyFor(access, "private"), {
      id: "private",
      revision: "1",
      payload: { ...payload, title: "Private external detail" },
      selfOnly: true,
      deleted: false,
    });
    const read = await t.cmd({
      type: "calendar.read",
      connectionId: t.c.connectionId,
      resourceId: t.c.resourceIds[0],
      mode: "events",
      ...window,
    });
    await processCalendarRead(read.readId, t.p);
    expect(JSON.stringify(await t.view())).toContain("Private external detail");
    const invite = await execute(t.a.id, t.w, randomUUID(), {
      type: "invitation.create",
      email: b.email,
      fullHistoryDisclosed: true,
    });
    await acceptInvitation(b.id, invite.token, true);
    expect(
      JSON.stringify(await calendarView(b.id, t.w, window.start, window.end)),
    ).not.toContain("Private external detail");
    const next = await execute(t.a.id, t.w, randomUUID(), {
      type: "message.send",
      content: "Controlliamo il calendario",
    });
    const claim = await claimInterpretation(next.interpretationId);
    expect(JSON.stringify(claim)).not.toContain("Private external detail");
  });
  it("successful conditional update keeps one publication identity and preserves both receipts", async () => {
    const t = await setup(),
      a = await t.propose();
    await t.authorize(a.actionId);
    await processCalendarAction(a.actionId, t.p);
    const p = (await t.view()).publications[0],
      update = await t.cmd({
        type: "calendar.propose",
        connectionId: t.c.connectionId,
        resourceId: t.c.resourceIds[0],
        operation: "update",
        publicationId: p.id,
        payload: { ...payload, title: "Nuovo titolo autorizzato" },
        reason: "Update self",
        shareWithWorkspace: true,
      });
    await t.authorize(update.actionId);
    await processCalendarAction(update.actionId, t.p);
    await processCalendarAction(update.actionId, t.p);
    expect(t.p.writes).toBe(2);
    expect((await t.view()).publications.map((x) => x.id)).toEqual([p.id]);
    expect(
      (
        await pool.query(
          "SELECT id FROM calendar_publication_history WHERE publication_id=$1",
          [p.id],
        )
      ).rowCount,
    ).toBe(2);
  });
  it("two proposals cannot create two linked representations while the first outcome is unresolved", async () => {
    const t = await setup(),
      event = await t.cmd({
        type: "temporal.create",
        payload,
        reason: "Personal",
        representSelf: true,
        expectedContextRevision: 0,
      });
    const proposal: CalendarCommand = {
      type: "calendar.propose",
      connectionId: t.c.connectionId,
      resourceId: t.c.resourceIds[0],
      operation: "create",
      temporal: { kind: "scheduled_event", id: event.eventId, version: 1 },
      payload,
      reason: "Publish",
      shareWithWorkspace: true,
    };
    const a = await t.cmd(proposal),
      b = await t.cmd(proposal);
    await t.authorize(a.actionId);
    await t.authorize(b.actionId);
    t.p.loseResponse = true;
    await processCalendarAction(a.actionId, t.p);
    await processCalendarAction(b.actionId, t.p);
    expect(t.p.writes).toBe(1);
    expect(
      (await t.view()).actions.find((x) => x.id === b.actionId)?.error,
    ).toBe("CALENDAR_OTHER_EFFECT_UNRESOLVED");
  });
  it("creates temporal versions without a provider, preserves source and history, and never creates external effects", async () => {
    const t = await setup(),
      message = await execute(t.a.id, t.w, randomUUID(), {
        type: "message.send",
        content: "Vado personalmente al sopralluogo",
      });
    const created = await t.cmd({
      type: "temporal.create",
      payload,
      reason: "Intento personale",
      sourceMessageId: message.messageId,
      representSelf: true,
      expectedContextRevision: 0,
    });
    await t.cmd({
      type: "temporal.revise",
      eventId: created.eventId,
      expectedVersion: 1,
      payload: { ...payload, title: "Sopralluogo personale aggiornato" },
      reason: "Cambio titolo",
      representSelf: true,
      expectedContextRevision: 1,
    });
    const view = await t.view();
    expect(view.temporal).toHaveLength(1);
    expect(view.temporal[0].version).toBe(2);
    expect(t.p.writes).toBe(0);
    expect(
      (await calendarHistory(t.a.id, t.w, created.eventId, "scheduled_event"))
        .versions,
    ).toHaveLength(2);
    await expect(
      pool.query("DELETE FROM scheduled_event_version WHERE event_id=$1", [
        created.eventId,
      ]),
    ).rejects.toThrow("immutable");
  });
  it("proposal is not authority; exact authorization and command replay cause one external write", async () => {
    const t = await setup(),
      a = await t.propose();
    await processCalendarAction(a.actionId, t.p);
    expect(t.p.writes).toBe(0);
    await t.authorize(a.actionId);
    await Promise.all([
      processCalendarAction(a.actionId, t.p),
      processCalendarAction(a.actionId, t.p),
    ]);
    expect(t.p.writes).toBe(1);
    expect((await t.view()).actions[0].status).toBe("SUCCEEDED");
    await processCalendarAction(a.actionId, t.p);
    expect(t.p.writes).toBe(1);
    const history = await calendarHistory(t.a.id, t.w, a.actionId, "action");
    expect(history.approvals).toHaveLength(1);
    expect(JSON.stringify(history)).toContain("commit_point");
    expect(JSON.stringify(history)).not.toContain(t.a.session);
  });
  it("revising a proposal invalidates the old authorization and rejects old-version approval", async () => {
    const t = await setup(),
      a = await t.propose();
    await t.authorize(a.actionId);
    await t.cmd({
      type: "calendar.revise",
      actionId: a.actionId,
      expectedVersion: 1,
      connectionId: t.c.connectionId,
      resourceId: t.c.resourceIds[0],
      operation: "create",
      payload: { ...payload, title: "Nuova proposta" },
      reason: "Nuovo contenuto",
      shareWithWorkspace: true,
    });
    await processCalendarAction(a.actionId, t.p);
    expect(t.p.writes).toBe(0);
    await expect(t.authorize(a.actionId)).rejects.toThrow(
      "CALENDAR_ACTION_VERSION_STALE",
    );
    await t.authorize(a.actionId, 2);
    await processCalendarAction(a.actionId, t.p);
    expect(t.p.writes).toBe(1);
  });
  it("denies another account, Workspace and merely writable shared resource", async () => {
    const t = await setup(),
      b = await person(),
      a = await t.propose();
    const invite = await execute(t.a.id, t.w, randomUUID(), {
      type: "invitation.create",
      email: b.email,
      fullHistoryDisclosed: true,
    });
    await acceptInvitation(b.id, invite.token, true);
    const v = await t.view();
    await expect(
      execute(
        b.id,
        t.w,
        randomUUID(),
        {
          type: "calendar.authorize",
          actionId: a.actionId,
          version: 1,
          expectedContextRevision: v.contextRevision,
          expectedAccessRevision: v.accessRevision,
          representSelf: true,
        },
        b.session,
      ),
    ).rejects.toThrow("CALENDAR_SELF_AUTHORITY_REQUIRED");
    await expect(
      execute(
        b.id,
        t.w,
        randomUUID(),
        {
          type: "calendar.read",
          connectionId: t.c.connectionId,
          resourceId: t.c.resourceIds[0],
          mode: "events",
          ...window,
        },
        b.session,
      ),
    ).rejects.toThrow("CALENDAR_RESOURCE_ACCESS_DENIED");
    await expect(
      t.cmd({
        type: "calendar.propose",
        connectionId: t.c.connectionId,
        resourceId: t.c.resourceIds[1],
        operation: "create",
        payload,
        reason: "Shared resource",
        shareWithWorkspace: true,
      }),
    ).rejects.toThrow("CALENDAR_RESOURCE_ACCESS_DENIED");
    const foreign = (await createWorkspace(b.id, "Foreign", randomUUID())).id;
    await expect(
      calendarView(t.a.id, foreign, window.start, window.end),
    ).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
    expect(
      (await calendarView(b.id, t.w, window.start, window.end)).connections,
    ).toEqual([]);
  });
  it("revalidates revoked session at the last Commit Point after network preflight", async () => {
    const t = await setup(),
      a = await t.propose();
    await t.authorize(a.actionId);
    t.p.beforeCheck = async () => {
      await pool.query("DELETE FROM session WHERE id=$1", [t.a.session]);
    };
    await processCalendarAction(a.actionId, t.p);
    expect(t.p.writes).toBe(0);
    expect((await t.view()).actions[0].status).toBe("FAILED");
  });
  it("revoked membership/account and changed context prevent queued effects", async () => {
    for (const kind of ["membership", "account", "context"]) {
      const t = await setup(),
        a = await t.propose();
      await t.authorize(a.actionId);
      if (kind === "membership")
        await execute(t.a.id, t.w, randomUUID(), {
          type: "member.leave",
          confirmed: true,
        });
      if (kind === "account")
        await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [
          t.a.id,
        ]);
      if (kind === "context")
        await execute(t.a.id, t.w, randomUUID(), {
          type: "goal.establish",
          content: "Nuovo contesto",
        });
      await processCalendarAction(a.actionId, t.p);
      expect(t.p.writes).toBe(0);
    }
  });
  it("response loss after success remains unknown, prohibits edits/retry, and reconciles without duplication", async () => {
    const t = await setup(),
      a = await t.propose();
    await t.authorize(a.actionId);
    t.p.loseResponse = true;
    await processCalendarAction(a.actionId, t.p);
    expect((await t.view()).actions[0].status).toBe("OUTCOME_UNKNOWN");
    await expect(
      t.cmd({ type: "calendar.retry", actionId: a.actionId, version: 1 }),
    ).rejects.toThrow("CALENDAR_RECONCILIATION_REQUIRED");
    await expect(
      t.cmd({
        type: "calendar.reject",
        actionId: a.actionId,
        version: 1,
        reason: "Non più necessario",
      }),
    ).rejects.toThrow("CALENDAR_EFFECT_MAY_ALREADY_EXIST");
    await expect(t.authorize(a.actionId)).rejects.toThrow(
      "CALENDAR_NOT_AWAITING_AUTHORIZATION",
    );
    const r = await t.cmd({
      type: "calendar.reconcile",
      actionId: a.actionId,
      version: 1,
    });
    await processCalendarRead(r.readId, t.p);
    expect((await t.view()).actions[0].status).toBe("SUCCEEDED");
    expect(t.p.writes).toBe(1);
  });
  it("recovers interrupted execution from the database; absence of evidence stays unknown", async () => {
    const t = await setup(),
      a = await t.propose();
    await t.authorize(a.actionId);
    await pool.query(
      "UPDATE calendar_action SET status='EXECUTING',attempt_id=$2,lease_until=now()-interval '1 minute' WHERE id=$1",
      [a.actionId, randomUUID()],
    );
    await recoverCalendar();
    expect((await t.view()).actions[0].status).toBe("OUTCOME_UNKNOWN");
    let r = await t.cmd({
      type: "calendar.reconcile",
      actionId: a.actionId,
      version: 1,
    });
    await processCalendarRead(r.readId, new FixtureCalendar());
    expect((await t.view()).actions[0].status).toBe("OUTCOME_UNKNOWN");
    t.p.proveAbsence = true;
    r = await t.cmd({
      type: "calendar.reconcile",
      actionId: a.actionId,
      version: 1,
    });
    await processCalendarRead(r.readId, t.p);
    expect((await t.view()).actions[0].canRetry).toBe(true);
    await t.cmd({ type: "calendar.retry", actionId: a.actionId, version: 1 });
    await processCalendarAction(a.actionId, t.p);
    expect(t.p.writes).toBe(1);
  });
  it("records a completed effect even when access is revoked during the provider call; receipt access remains denied", async () => {
    const t = await setup(),
      a = await t.propose();
    await t.authorize(a.actionId);
    t.p.afterWrite = async () => {
      await execute(t.a.id, t.w, randomUUID(), {
        type: "member.leave",
        confirmed: true,
      });
    };
    await processCalendarAction(a.actionId, t.p);
    expect(
      (
        await pool.query("SELECT status FROM calendar_action WHERE id=$1", [
          a.actionId,
        ])
      ).rows[0].status,
    ).toBe("SUCCEEDED");
    await expect(t.view()).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
  });
  it("observations remain private evidence, overlap is not identity, and linked divergence never changes internal state", async () => {
    const t = await setup();
    const event = await t.cmd({
      type: "temporal.create",
      payload,
      reason: "Personal",
      representSelf: true,
      expectedContextRevision: 0,
    });
    await t.cmd({
      type: "temporal.create",
      payload,
      reason: "Distinct event",
      representSelf: true,
      expectedContextRevision: 1,
    });
    const a = await t.cmd({
      type: "calendar.propose",
      connectionId: t.c.connectionId,
      resourceId: t.c.resourceIds[0],
      operation: "create",
      temporal: { kind: "scheduled_event", id: event.eventId, version: 1 },
      payload,
      reason: "Publish exact event",
      shareWithWorkspace: true,
    });
    await t.authorize(a.actionId);
    await processCalendarAction(a.actionId, t.p);
    const ext = [...t.p.events.entries()][0];
    t.p.events.set(ext[0], {
      ...ext[1],
      revision: "2",
      payload: { ...payload, title: "Modificato fuori da Miriam" },
    });
    const read = await t.cmd({
      type: "calendar.read",
      connectionId: t.c.connectionId,
      resourceId: t.c.resourceIds[0],
      mode: "events",
      ...window,
    });
    await processCalendarRead(read.readId, t.p);
    const v = await t.view();
    expect(v.alerts.filter((x) => x.kind === "overlap")).toHaveLength(1);
    expect(v.alerts.some((x) => x.kind === "external_divergence")).toBe(true);
    expect(v.temporal[0].payload.title).toBe(payload.title);
    expect(
      (
        await pool.query(
          "SELECT id FROM accepted_information WHERE workspace_id=$1",
          [t.w],
        )
      ).rows,
    ).toEqual([]);
    await t.cmd({
      type: "temporal.revise",
      eventId: event.eventId,
      expectedVersion: 1,
      payload: { ...payload, title: "Nuova versione interna" },
      reason: "Intento cambiato",
      representSelf: true,
      expectedContextRevision: 2,
    });
    expect(
      (await t.view()).alerts.some((x) => x.kind === "internal_divergence"),
    ).toBe(true);
    expect(t.p.writes).toBe(1);
    const correction = {
      type: "temporal.revise" as const,
      eventId: event.eventId,
      expectedVersion: 2,
      payload: v.observations[0].data.events[0].payload,
      sourceObservationId: v.observations[0].id,
      reason: "Adotto esplicitamente questo orario e contenuto per me",
      representSelf: true as const,
      expectedContextRevision: 3,
    };
    await expect(t.cmd(correction)).rejects.toThrow(
      "CALENDAR_EXPLICIT_SHARING_REQUIRED",
    );
    await expect(
      t.cmd({
        ...correction,
        sourceObservationId: randomUUID(),
        shareObservedContent: true,
      }),
    ).rejects.toThrow("CALENDAR_OBSERVATION_NOT_FOUND");
    await t.cmd({ ...correction, shareObservedContent: true });
    const history = await calendarHistory(
      t.a.id,
      t.w,
      event.eventId,
      "scheduled_event",
    );
    expect(history.versions.map((v) => v.title)).toEqual([
      payload.title,
      "Nuova versione interna",
      "Modificato fuori da Miriam",
    ]);
    expect(history.versions[2].source_observation_id).toBe(
      v.observations[0].id,
    );
    expect(t.p.writes).toBe(1); // Authorized internal correction still cannot write externally.
    const update = await t.cmd({
      type: "calendar.propose",
      connectionId: t.c.connectionId,
      resourceId: t.c.resourceIds[0],
      operation: "update",
      publicationId: v.publications[0].id,
      temporal: { kind: "scheduled_event", id: event.eventId, version: 3 },
      payload: correction.payload,
      reason: "Proposta separata",
      shareWithWorkspace: true,
    });
    const actionHistory = await calendarHistory(
      t.a.id,
      t.w,
      update.actionId,
      "action",
    );
    expect(actionHistory.versions[0].precondition_observation_id).toBe(
      v.observations[0].id,
    );
    expect(
      (await t.view()).actions.find((a) => a.id === update.actionId)?.status,
    ).toBe("PROPOSED");
  });
  it("conditional update requires new proposal/approval; no silent overwrite after an external race", async () => {
    const t = await setup(),
      a = await t.propose();
    await t.authorize(a.actionId);
    await processCalendarAction(a.actionId, t.p);
    const pub = (await t.view()).publications[0];
    const update = await t.cmd({
      type: "calendar.propose",
      connectionId: t.c.connectionId,
      resourceId: t.c.resourceIds[0],
      operation: "update",
      publicationId: pub.id,
      payload: { ...payload, title: "Updated" },
      reason: "Change",
      shareWithWorkspace: true,
    });
    await t.authorize(update.actionId);
    const ext = [...t.p.events.entries()][0];
    t.p.events.set(ext[0], { ...ext[1], revision: "another" });
    await processCalendarAction(update.actionId, t.p);
    expect(t.p.writes).toBe(1);
    expect(
      (await t.view()).actions.find((x) => x.id === update.actionId)?.error,
    ).toBe("CALENDAR_EXTERNAL_PRECONDITION_CHANGED");
  });
  it("unconfigured provider reports failure without fabricated results; API contract retains web CSRF", async () => {
    const t = await setup(),
      a = await t.propose();
    await t.authorize(a.actionId);
    await processCalendarAction(a.actionId);
    expect((await t.view()).actions[0].error).toBe(
      "CALENDAR_PROVIDER_UNAVAILABLE",
    );
    const base = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000",
      url = `${base}/api/v1/workspaces/${t.w}/calendar?start=${window.start}&end=${window.end}`;
    const response = await handleAPI(
      new Request(url, { headers: { Cookie: t.a.cookie } }),
    );
    expect(response.status).toBe(200);
    calendarViewSchema.parse(await response.json());
    expect(
      (
        await handleAPI(
          new Request(`${base}/api/v1/workspaces/${t.w}/commands`, {
            method: "POST",
            headers: {
              Cookie: t.a.cookie,
              Origin: "https://wrong.example",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              commandId: randomUUID(),
              command: {
                type: "calendar.reject",
                actionId: a.actionId,
                version: 1,
                reason: "Test",
              },
            }),
          }),
        )
      ).status,
    ).toBe(403);
  });
});
