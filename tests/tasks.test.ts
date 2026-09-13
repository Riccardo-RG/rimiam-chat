import { randomUUID } from "node:crypto";
import { afterAll, describe, it, expect } from "vitest";
import { auth } from "../src/server/auth";
import { pool, transaction } from "../src/server/db";
import { workContext } from "../src/server/tasks-context";
import { processInterpretation } from "../src/server/interpretation";
import { fixtureInterpreter } from "./support/fixture-interpreter";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import { tasksView, tasksHistory } from "../src/server/tasks-queries";
import { processFollowup, recoverFollowups } from "../src/server/tasks-worker";
import { handleAPI } from "../src/server/api";
const content = {
  title: "Raccogliere preventivi",
  description: "Confrontare tre proposte, senza acquisti",
  dueAt: null,
  timeZone: "Europe/Rome",
  suggestedPerson: null,
  references: [],
};
async function person() {
  const email = `${randomUUID()}@example.test`,
    password = "Tasks-test-only-2026!";
  const { user } = await auth.api.signUpEmail({
    body: { email, password, name: "Tasks tester" },
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
  ).rows[0].id;
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
    b = await person(),
    w = (await createWorkspace(a.id, "Tasks", randomUUID())).id;
  const cmd = (c: unknown, as = a, key = randomUUID()) =>
    execute(as.id, w, key, c, as.session);
  const inv = await cmd({
    type: "invitation.create",
    email: b.email,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(b.id, inv.token as string, true);
  const task = await cmd({ type: "task.create", content });
  const id = String(task.taskId);
  const accept = () =>
    cmd(
      {
        type: "task.accept",
        taskId: id,
        expectedVersion: 1,
        reason: "Me ne occupo",
        representSelf: true,
      },
      b,
    );
  const reminder = (reference: unknown = null) =>
    cmd({
      type: "followup.create",
      content: "Controllare i preventivi",
      kind: "check",
      remindAt: new Date(Date.now() - 1000).toISOString(),
      timeZone: "Europe/Rome",
      reference,
    });
  return { a, b, w, cmd, id, accept, reminder };
}
afterAll(() => pool.end());
describe("Tasks and follow-up boundaries", () => {
  it("completion and relinquishment preserve an actual linked adopted commitment", async () => {
    const t = await setup();
    await t.cmd({
      type: "message.send",
      content: "Ci impegniamo a raccogliere tre preventivi",
    });
    const i = (
      await pool.query("SELECT id FROM interpretation WHERE workspace_id=$1", [
        t.w,
      ])
    ).rows[0];
    await processInterpretation(i.id, fixtureInterpreter);
    const c = (await tasksView(t.a.id, t.w)).suggestions[0];
    const p = await t.cmd({
      type: "commitment.propose",
      candidateId: c.id,
      people: [t.a.id],
    });
    const ws = (await pool.query("SELECT * FROM workspace WHERE id=$1", [t.w]))
      .rows[0];
    await t.cmd({
      type: "commitment.approve",
      proposalId: p.proposalId,
      expectedContextRevision: ws.context_revision,
      expectedAccessRevision: ws.access_revision,
      representSelf: true,
    });
    const before = (
      await pool.query("SELECT * FROM project_act WHERE workspace_id=$1", [t.w])
    ).rows;
    await t.cmd({
      type: "task.revise",
      taskId: t.id,
      expectedVersion: 1,
      reason: "Collegamento senza duplicazione",
      content: {
        ...content,
        references: [{ kind: "commitment", id: before[0].id, version: 1 }],
      },
    });
    await t.cmd({
      type: "task.accept",
      taskId: t.id,
      expectedVersion: 2,
      reason: "Me ne occupo",
      representSelf: true,
    });
    await t.cmd({
      type: "task.status",
      taskId: t.id,
      expectedVersion: 3,
      reason: "Lavoro svolto, obbligo distinto",
      status: "completed",
      noNormativeEffect: true,
    });
    await t.cmd({
      type: "task.relinquish",
      taskId: t.id,
      expectedVersion: 4,
      reason: "Rinuncia operativa",
      representSelf: true,
    });
    expect(
      (
        await pool.query("SELECT * FROM project_act WHERE workspace_id=$1", [
          t.w,
        ])
      ).rows,
    ).toEqual(before);
    expect((await tasksView(t.a.id, t.w)).tasks[0].references).toEqual([
      { kind: "commitment", id: before[0].id, version: 1 },
    ]);
  });
  it("keeps AI output non-authoritative and records explicit adoption provenance", async () => {
    const t = await setup();
    await t.cmd({
      type: "message.send",
      content: "Possiamo raccogliere preventivi?",
    });
    const i = (
      await pool.query("SELECT id FROM interpretation WHERE workspace_id=$1", [
        t.w,
      ])
    ).rows[0];
    await processInterpretation(i.id, fixtureInterpreter);
    expect((await tasksView(t.a.id, t.w)).tasks).toHaveLength(1);
    const suggestion = (await tasksView(t.a.id, t.w)).suggestions[0];
    const r = await t.cmd({
      type: "task.create",
      content,
      candidateId: suggestion.id,
    });
    const v = (await tasksView(t.a.id, t.w)).tasks.find(
      (v) => v.id === r.taskId,
    )!;
    expect(v.responsible).toBeNull();
    expect(v.candidateId).toBe(suggestion.id);
  });
  it("retrieves selected current/historical work and preserves other-workspace isolation", async () => {
    const t = await setup();
    await t.cmd({
      type: "task.revise",
      taskId: t.id,
      expectedVersion: 1,
      reason: "Correzione",
      content: { ...content, title: "Parolaunica aggiornata" },
    });
    const relevant = await transaction((tx) =>
      workContext(tx, t.w, ["Parolaunica"], true),
    );
    expect(relevant).toHaveLength(1);
    expect(relevant[0].version).toBe(2);
    const old = await transaction((tx) => workContext(tx, t.w, ["preventivi"]));
    expect(old.some((v) => v.version === 1 && !v.current)).toBe(true);
    expect(
      await transaction((tx) => workContext(tx, randomUUID(), ["preventivi"])),
    ).toEqual([]);
  });
  it("records work without responsibility or a commitment; nominations do not assign", async () => {
    const t = await setup();
    await t.cmd({
      type: "task.revise",
      taskId: t.id,
      expectedVersion: 1,
      reason: "Possibile referente",
      content: { ...content, suggestedPerson: t.b.id },
    });
    const v = await tasksView(t.a.id, t.w);
    expect(v.tasks[0].responsible).toBeNull();
    expect(v.tasks[0].suggestedPerson).toBe(t.b.id);
    expect(
      (
        await pool.query("SELECT 1 FROM project_act WHERE workspace_id=$1", [
          t.w,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it("requires own explicit acceptance and rejects injected assignment fields", async () => {
    const t = await setup();
    await expect(
      t.cmd({
        type: "task.accept",
        taskId: t.id,
        expectedVersion: 1,
        reason: "For B",
        representSelf: true,
        personId: t.b.id,
      }),
    ).rejects.toThrow();
    await t.accept();
    const v = (await tasksView(t.a.id, t.w)).tasks[0];
    expect(v.responsible).toBe(t.b.id);
    expect(v.acceptedVersion).toBe(1);
    await expect(
      t.cmd({
        type: "task.status",
        taskId: t.id,
        expectedVersion: 2,
        reason: "Creator override",
        status: "cancelled",
        noNormativeEffect: true,
      }),
    ).rejects.toThrow("TASK_NOT_RESPONSIBLE");
  });
  it("keeps accepted scope until exact proposal is reaccepted", async () => {
    const t = await setup();
    await t.accept();
    const next = {
      ...content,
      title: "Confrontare cinque preventivi",
      dueAt: "2026-10-02T10:00:00Z",
    };
    await expect(
      t.cmd(
        {
          type: "task.revise",
          taskId: t.id,
          expectedVersion: 2,
          reason: "Override",
          content: next,
        },
        t.b,
      ),
    ).rejects.toThrow("TASK_NEW_ACCEPTANCE_REQUIRED");
    const p = await t.cmd({
      type: "task.propose_revision",
      taskId: t.id,
      expectedVersion: 2,
      reason: "Più alternative",
      content: next,
    });
    expect((await tasksView(t.b.id, t.w)).tasks[0].title).toBe(content.title);
    await expect(
      t.cmd({
        type: "task.adopt_revision",
        taskId: t.id,
        expectedVersion: 2,
        reason: "For B",
        proposalId: p.proposalId,
        acceptResponsibility: true,
      }),
    ).rejects.toThrow("TASK_NOT_RESPONSIBLE");
    await t.cmd(
      {
        type: "task.adopt_revision",
        taskId: t.id,
        expectedVersion: 2,
        reason: "Accetto nuovo perimetro",
        proposalId: p.proposalId,
        acceptResponsibility: true,
      },
      t.b,
    );
    const v = (await tasksView(t.b.id, t.w)).tasks[0];
    expect(v.title).toBe(next.title);
    expect(v.acceptedVersion).toBe(3);
    expect(
      (await tasksHistory(t.a.id, t.w, t.id, "task")).acceptances,
    ).toHaveLength(2);
  });
  it("rejects stale and concurrent acceptance and version rewrites", async () => {
    const t = await setup();
    const results = await Promise.allSettled([
      t.accept(),
      t.cmd({
        type: "task.accept",
        taskId: t.id,
        expectedVersion: 1,
        reason: "Anche io",
        representSelf: true,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(
      pool.query("UPDATE task_version SET title=$1 WHERE task_id=$2", [
        "Rewrite",
        t.id,
      ]),
    ).rejects.toThrow("immutable");
    expect(
      (await tasksHistory(t.a.id, t.w, t.id, "task")).versions,
    ).toHaveLength(2);
  });
  it("returns relinquished work to unassigned without deleting accepted history", async () => {
    const t = await setup();
    await t.accept();
    await t.cmd(
      {
        type: "task.relinquish",
        taskId: t.id,
        expectedVersion: 2,
        reason: "Non posso più seguirlo",
        representSelf: true,
      },
      t.b,
    );
    expect((await tasksView(t.a.id, t.w)).tasks[0].responsible).toBeNull();
    expect(
      (await tasksHistory(t.a.id, t.w, t.id, "task")).acceptances,
    ).toHaveLength(1);
  });
  it("does not mutate Goal or create normative effects on completion/cancellation", async () => {
    const t = await setup();
    const g = await t.cmd({
      type: "goal.establish",
      content: "Aprire il locale",
    });
    await t.cmd({
      type: "task.revise",
      taskId: t.id,
      expectedVersion: 1,
      reason: "Collegamento",
      content: {
        ...content,
        references: [{ kind: "goal", id: g.goalId, version: 1 }],
      },
    });
    await t.cmd({
      type: "task.status",
      taskId: t.id,
      expectedVersion: 2,
      reason: "Completato",
      status: "completed",
      noNormativeEffect: true,
    });
    expect(
      (
        await pool.query(
          "SELECT current_version,current_primary FROM goal WHERE id=$1",
          [g.goalId],
        )
      ).rows[0],
    ).toEqual({ current_version: 1, current_primary: true });
    expect(
      (
        await pool.query("SELECT 1 FROM project_act WHERE workspace_id=$1", [
          t.w,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it("enforces workspace, session and reference isolation", async () => {
    const t = await setup(),
      outsider = await person();
    await expect(tasksView(outsider.id, t.w)).rejects.toThrow(
      "WORKSPACE_ACCESS_DENIED",
    );
    await expect(
      execute(
        t.a.id,
        t.w,
        randomUUID(),
        { type: "task.create", content },
        outsider.session,
      ),
    ).rejects.toThrow("AUTHENTICATION_REQUIRED");
    await expect(
      t.cmd({
        type: "task.create",
        content: {
          ...content,
          references: [{ kind: "task", id: randomUUID(), version: 1 }],
        },
      }),
    ).rejects.toThrow("WORK_REFERENCE_NOT_FOUND");
  });
  it("does not let a removed/rejoined holder revive operational authority", async () => {
    const t = await setup();
    await t.accept();
    await pool.query(
      "UPDATE membership SET active=false,version=version+1 WHERE workspace_id=$1 AND user_id=$2",
      [t.w, t.b.id],
    );
    expect((await tasksView(t.a.id, t.w)).tasks[0].responsibleAvailable).toBe(
      false,
    );
    await expect(
      t.cmd(
        {
          type: "task.status",
          taskId: t.id,
          expectedVersion: 2,
          status: "completed",
          reason: "Old authority",
          noNormativeEffect: true,
        },
        t.b,
      ),
    ).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
    await pool.query(
      "UPDATE membership SET active=true,version=version+1 WHERE workspace_id=$1 AND user_id=$2",
      [t.w, t.b.id],
    );
    await expect(
      t.cmd(
        {
          type: "task.status",
          taskId: t.id,
          expectedVersion: 2,
          status: "completed",
          reason: "Old authority",
          noNormativeEffect: true,
        },
        t.b,
      ),
    ).rejects.toThrow("TASK_NOT_RESPONSIBLE");
  });
  it("emits exactly one durable in-app reminder under retries/concurrency", async () => {
    const t = await setup(),
      r = await t.reminder();
    await Promise.all([
      processFollowup(t.w, String(r.followupId), 1),
      processFollowup(t.w, String(r.followupId), 1),
    ]);
    expect(
      (
        await pool.query(
          "SELECT * FROM followup_delivery WHERE followup_id=$1",
          [r.followupId],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (await tasksView(t.a.id, t.w)).followups[0].deliveredAt,
    ).not.toBeNull();
    expect((await tasksView(t.a.id, t.w)).tasks[0].responsible).toBeNull();
  });
  it("suppresses stale target reminders and preserves old receipts after explicit rescheduling", async () => {
    const t = await setup(),
      r = await t.reminder({ kind: "task", id: t.id, version: 1 });
    await t.accept();
    expect(await processFollowup(t.w, String(r.followupId), 1)).toBe(
      "suppressed",
    );
    expect((await tasksView(t.a.id, t.w)).followups[0].needsReview).toBe(true);
    await t.cmd({
      type: "followup.revise",
      followupId: r.followupId,
      expectedVersion: 1,
      reason: "Verificata versione",
      content: "Controlla",
      kind: "check",
      remindAt: new Date(0).toISOString(),
      timeZone: "Europe/Rome",
      reference: { kind: "task", id: t.id, version: 2 },
    });
    expect(await processFollowup(t.w, String(r.followupId), 1)).toBe(
      "obsolete",
    );
    expect(await processFollowup(t.w, String(r.followupId), 2)).toBe(
      "delivered",
    );
    expect(
      (await tasksHistory(t.a.id, t.w, String(r.followupId), "followup"))
        .proposals,
    ).toHaveLength(2);
  });
  it("suppresses after membership or account security changes", async () => {
    const t = await setup(),
      r = await t.reminder();
    await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [t.a.id]);
    expect(await processFollowup(t.w, String(r.followupId), 1)).toBe(
      "suppressed",
    );
    await pool.query('UPDATE "user" SET eligible=true WHERE id=$1', [t.a.id]);
  });
  it("cancels reminders without acting and rejects others managing personal follow-up", async () => {
    const t = await setup(),
      r = await t.reminder();
    const c = {
      type: "followup.close",
      followupId: r.followupId,
      expectedVersion: 1,
      reason: "Non serve",
      status: "cancelled",
    };
    await expect(t.cmd(c, t.b)).rejects.toThrow("FOLLOWUP_NOT_OWNER");
    await t.cmd(c);
    expect(await processFollowup(t.w, String(r.followupId), 1)).toBe(
      "obsolete",
    );
  });
  it("recovers scheduling from persistence and reuses exact command receipts", async () => {
    const t = await setup(),
      key = randomUUID(),
      c = {
        type: "followup.create",
        content: "Verifica",
        kind: "review",
        remindAt: new Date(0).toISOString(),
        timeZone: "UTC",
        reference: null,
      };
    const r = await t.cmd(c, t.a, key);
    expect(await t.cmd(c, t.a, key)).toEqual(r);
    await recoverFollowups();
    expect(
      (
        await pool.query("SELECT 1 FROM graphile_worker.jobs WHERE key=$1", [
          `followup:${r.followupId}:1`,
        ])
      ).rowCount,
    ).toBe(1);
    expect(await processFollowup(t.w, String(r.followupId), 1)).toBe(
      "delivered",
    );
  });
  it("exposes common validated API with access-checked history", async () => {
    const t = await setup();
    const r = await handleAPI(
      new Request(`http://localhost/api/v1/workspaces/${t.w}/tasks`, {
        headers: { cookie: t.a.cookie },
      }),
    );
    expect(r.status).toBe(200);
    expect((await r.json()).tasks[0].id).toBe(t.id);
    expect(
      (
        await handleAPI(
          new Request(
            `http://localhost/api/v1/workspaces/${t.w}/tasks-history?id=${t.id}&kind=task`,
            { headers: { cookie: t.b.cookie } },
          ),
        )
      ).status,
    ).toBe(200);
  });
});
