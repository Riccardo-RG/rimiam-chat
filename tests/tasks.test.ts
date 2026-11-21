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
import {
  tasksView,
  tasksHistory,
  taskComments,
} from "../src/server/tasks-queries";
import { tasksHistorySchema, taskCommentsSchema } from "../src/contracts/tasks";
import { workspaceSchedule } from "../src/server/agenda";
import { validWorkReference } from "../src/server/tasks-state";
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
  it("attributes comments without invalidating an offer or accepted responsibility, and treats standby as reversible operational state", async () => {
    const t = await setup();
    await t.cmd({
      type: "task.revise",
      taskId: t.id,
      expectedVersion: 1,
      reason: "Chiedi a B",
      content: { ...content, suggestedPerson: t.b.id },
    });
    const comment = {
      type: "task.comment",
      taskId: t.id,
      expectedVersion: 2,
      body: "Primo aggiornamento",
    };
    const key = randomUUID();
    const [first, replay] = await Promise.all([
      t.cmd(comment, t.a, key),
      t.cmd(comment, t.a, key),
    ]);
    expect(first).toEqual(replay);
    await expect(
      t.cmd({ ...comment, body: "Altro" }, t.a, key),
    ).rejects.toThrow("COMMAND_ID_REUSED");
    expect((await taskComments(t.b.id, t.w, t.id)).comments).toMatchObject([
      {
        id: first.commentId,
        actor: t.a.id,
        body: comment.body,
        taskVersion: 2,
      },
    ]);
    const accept = {
      type: "task.accept",
      taskId: t.id,
      expectedVersion: 2,
      reason: "Me ne occupo",
      representSelf: true,
    };
    await expect(t.cmd(accept, t.a)).rejects.toThrow("TASK_NOT_OFFERED");
    await t.cmd(accept, t.b);
    await expect(t.cmd({ ...comment, body: "Vecchia copia" })).rejects.toThrow(
      "TASK_VERSION_STALE",
    );
    await t.cmd(
      { ...comment, expectedVersion: 3, body: "Sto aspettando il preventivo" },
      t.a,
    );
    const standby = {
      type: "task.status",
      taskId: t.id,
      expectedVersion: 3,
      status: "standby",
      reason: "In attesa di conferma",
      noNormativeEffect: true,
    };
    await expect(t.cmd(standby, t.a)).rejects.toThrow("TASK_NOT_RESPONSIBLE");
    await t.cmd(standby, t.b);
    expect((await tasksView(t.b.id, t.w)).tasks[0]).toMatchObject({
      status: "standby",
      version: 4,
      acceptedVersion: 2,
      responsible: t.b.id,
    });
    expect(
      (await workspaceSchedule(t.b.id, t.w, true, 20)).entries.map((x) => x.id),
    ).toContain(t.id);
    expect(
      await transaction((tx) =>
        validWorkReference(
          tx,
          t.w,
          { kind: "task", id: t.id, version: 4 },
          true,
        ),
      ),
    ).toBe(true);
    await t.cmd({ ...standby, status: "in_progress", expectedVersion: 4 }, t.b);
    await t.cmd(
      {
        type: "task.relinquish",
        taskId: t.id,
        expectedVersion: 5,
        reason: "Non posso",
        representSelf: true,
      },
      t.b,
    );
    expect((await tasksView(t.a.id, t.w)).tasks[0]).toMatchObject({
      status: "open",
      responsible: null,
      suggestedPerson: null,
    });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM workspace_change WHERE workspace_id=$1 AND kind='task.comment'",
          [t.w],
        )
      ).rows[0].n,
    ).toBe(2);
  });
  it("rejects closed offers and protects comments from outsiders, former members and read-only members", async () => {
    const t = await setup();
    const other = (await createWorkspace(t.a.id, "Altro", randomUUID())).id;
    const offer = await t.cmd({
      type: "task.create",
      content: { ...content, suggestedPerson: t.b.id },
    });
    const task = {
      taskId: offer.taskId,
      expectedVersion: 1,
      reason: "Risposta",
    };
    await t.cmd({ type: "task.decline", ...task }, t.b);
    await expect(
      t.cmd({ type: "task.accept", ...task, representSelf: true }, t.b),
    ).rejects.toThrow("TASK_NOT_OFFERED");
    const comment = {
      type: "task.comment",
      taskId: t.id,
      expectedVersion: 1,
      body: "Nel gruppo",
    };
    await expect(
      execute(t.a.id, other, randomUUID(), comment, t.a.session),
    ).rejects.toThrow("TASK_NOT_FOUND");
    await expect(taskComments(t.a.id, other, t.id)).rejects.toThrow(
      "TASK_NOT_FOUND",
    );
    await expect(taskComments(t.b.id, other, t.id)).rejects.toThrow(
      "WORKSPACE_ACCESS_DENIED",
    );
    await pool.query(
      "UPDATE membership SET contributes=false,version=version+1 WHERE workspace_id=$1 AND user_id=$2",
      [t.w, t.b.id],
    );
    await expect(t.cmd(comment, t.b)).rejects.toThrow(
      "WORKSPACE_ACCESS_DENIED",
    );
    await expect(
      t.cmd({
        type: "task.create",
        content: { ...content, suggestedPerson: t.b.id },
      }),
    ).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
    expect(await taskComments(t.b.id, t.w, t.id)).toEqual({
      comments: [],
      next: null,
    });
    await pool.query(
      "UPDATE membership SET active=false,version=version+1 WHERE workspace_id=$1 AND user_id=$2",
      [t.w, t.b.id],
    );
    await expect(taskComments(t.b.id, t.w, t.id)).rejects.toThrow(
      "WORKSPACE_ACCESS_DENIED",
    );
    await expect(t.cmd(comment, t.b)).rejects.toThrow(
      "WORKSPACE_ACCESS_DENIED",
    );
  });
  it("pages immutable task comments in stable order when another member contributes between reads", async () => {
    const t = await setup();
    const add = (n: number) =>
      t.cmd(
        {
          type: "task.comment",
          taskId: t.id,
          expectedVersion: 1,
          body: `Nota ${n}`,
        },
        n % 2 ? t.a : t.b,
      );
    for (let i = 1; i <= 31; i++) await add(i);
    const url = new URL(
      `http://localhost/api/v1/workspaces/${t.w}/task-comments?id=${t.id}`,
    );
    const get = async () =>
      handleAPI(new Request(url, { headers: { cookie: t.b.cookie } }));
    const initial = await get();
    expect(initial.status).toBe(200);
    const first = taskCommentsSchema.parse(await initial.json());
    expect(first.comments).toHaveLength(30);
    expect(first.comments[0]).toMatchObject({
      body: "Nota 31",
      actor: t.a.id,
      taskVersion: 1,
    });
    expect(first.comments.at(-1)?.body).toBe("Nota 2");
    await add(32);
    url.searchParams.set("before", first.next!);
    const last = taskCommentsSchema.parse(await (await get()).json());
    expect(last.comments.map((c) => c.body)).toEqual(["Nota 1"]);
    expect(last.next).toBeNull();
    url.searchParams.set("before", "invalid");
    expect((await get()).status).toBe(400);
    await expect(
      pool.query("UPDATE task_comment SET body='rewritten' WHERE id=$1", [
        first.comments[0].id,
      ]),
    ).rejects.toThrow("immutable");
  });
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
  it("keeps the rule's wall-clock time through both Europe/Rome clock changes", async () => {
    const next = async (
      anchor: string,
      after: string | null,
      until: string | null = null,
    ) => {
      const r = await pool.query(
        "SELECT followup_next_occurrence($1, 'Europe/Rome', ARRAY[1,2,3,4,5,6,7]::smallint[], $2, $3) AS at",
        [anchor, until, after],
      );
      return r.rows[0].at?.toISOString() ?? null;
    };
    const spring = "2026-03-28T01:30:00.000Z";
    // The nonexistent 02:30 on Sunday moves into the gap's next hour. Monday is 02:30 again.
    expect(await next(spring, spring)).toBe("2026-03-29T01:30:00.000Z");
    expect(await next(spring, "2026-03-29T01:30:00.000Z")).toBe(
      "2026-03-30T00:30:00.000Z",
    );
    expect(
      await next(spring, "2026-03-29T01:30:00.000Z", "2026-03-29"),
    ).toBeNull();
    const autumn = "2026-10-24T00:30:00.000Z";
    expect(await next(autumn, autumn)).toBe("2026-10-25T01:30:00.000Z");
    // When the initial date itself is ambiguous, preserve the precise instant the client supplied.
    expect(await next("2026-10-25T00:30:00.000Z", null)).toBe(
      "2026-10-25T00:30:00.000Z",
    );
  });
  it("expires a finite recurring reminder after downtime without notifying or requesting authority", async () => {
    const t = await setup();
    const anchor = "2020-01-01T10:00:00.000Z";
    const created = await t.cmd({
      type: "followup.create",
      content: "Rivedere le note",
      kind: "review",
      remindAt: anchor,
      timeZone: "UTC",
      reference: null,
      recurrence: { weekdays: [1, 2, 3, 4, 5, 6, 7], until: "2020-01-02" },
    });
    const id = String(created.followupId);
    await processFollowup(t.w, id, 1, anchor);
    expect(
      (
        await pool.query(
          "SELECT outcome FROM followup_delivery WHERE followup_id=$1",
          [id],
        )
      ).rows,
    ).toEqual([{ outcome: "expired" }]);
    expect((await tasksView(t.a.id, t.w)).followups[0]).toMatchObject({
      deliveredAt: null,
      nextRemindAt: null,
      needsReview: false,
    });
  });
  it("schedules the selected local weekdays, including the final date, and preserves the rule in older-client revisions", async () => {
    const t = await setup();
    // 2030-03-29 is Friday. At the first selected Monday Rome is already on summer time.
    const anchor = "2030-03-29T08:00:00.000Z";
    const rule = { weekdays: [1, 4], until: "2030-04-01" };
    const fields = {
      content: "Controllare i preventivi",
      kind: "check",
      remindAt: anchor,
      timeZone: "Europe/Rome",
      reference: null,
    };
    const created = await t.cmd({
      type: "followup.create",
      ...fields,
      recurrence: rule,
    });
    const id = String(created.followupId);
    const read = async () =>
      (await tasksView(t.a.id, t.w)).followups.find((f) => f.id === id)!;
    expect(await read()).toMatchObject({
      remindAt: anchor,
      nextRemindAt: "2030-04-01T07:00:00.000Z",
      recurrence: rule,
    });
    const revision = {
      type: "followup.revise",
      followupId: id,
      reason: "Rendere più preciso il testo",
      ...fields,
      content: "Rileggere i preventivi",
    };
    await t.cmd({ ...revision, expectedVersion: 1 });
    expect(await read()).toMatchObject({ version: 2, recurrence: rule });
    await expect(
      t.cmd({ ...revision, expectedVersion: 2, recurrence: null }, t.b),
    ).rejects.toThrow("FOLLOWUP_NOT_OWNER");
    await t.cmd({ ...revision, expectedVersion: 2, recurrence: null });
    expect(await read()).toMatchObject({
      version: 3,
      nextRemindAt: anchor,
      recurrence: null,
    });
    await expect(
      t.cmd({
        type: "followup.create",
        ...fields,
        recurrence: { weekdays: [1], until: "2030-03-31" },
      }),
    ).rejects.toThrow();
    expect((await tasksView(t.a.id, t.w)).followups).toHaveLength(1);
  });
  it("coalesces missed recurring wake-ups, journals one delivery, and fences late jobs after stop", async () => {
    const t = await setup();
    const anchor = new Date(Date.now() - 8 * 86400000).toISOString();
    const c = {
      type: "followup.create",
      content: "Verifica giornaliera",
      kind: "check",
      timeZone: "UTC",
      remindAt: anchor,
      reference: null,
      recurrence: { weekdays: [1, 2, 3, 4, 5, 6, 7] },
    };
    const key = randomUUID();
    const created = await t.cmd(c, t.a, key);
    expect(await t.cmd(c, t.a, key)).toEqual(created);
    const id = String(created.followupId);
    await recoverFollowups();
    await Promise.all([
      processFollowup(t.w, id, 1, anchor),
      processFollowup(t.w, id, 1, anchor),
    ]);
    const current = (await tasksView(t.a.id, t.w)).followups[0];
    expect(current.version).toBe(1);
    expect(current.deliveredAt).toBeTruthy();
    expect(Date.parse(current.nextRemindAt!)).toBeGreaterThan(Date.now());
    expect(Date.parse(current.nextRemindAt!) - Date.now()).toBeLessThanOrEqual(
      86400000,
    );
    expect(
      (
        await pool.query(
          "SELECT outcome FROM followup_delivery WHERE followup_id=$1",
          [id],
        )
      ).rows,
    ).toEqual([{ outcome: "delivered" }]);
    await recoverFollowups();
    await t.cmd({
      ...c,
      type: "followup.revise",
      followupId: id,
      expectedVersion: 1,
      reason: "Dettaglio",
      content: "Verifica giornaliera aggiornata",
    });
    expect((await tasksView(t.a.id, t.w)).followups[0].nextRemindAt).toBe(
      current.nextRemindAt,
    );
    await t.cmd({
      type: "followup.close",
      followupId: id,
      expectedVersion: 2,
      reason: "Fine della verifica",
      status: "cancelled",
    });
    expect(await processFollowup(t.w, id, 1, current.nextRemindAt!)).toBe(
      "obsolete",
    );
    expect((await tasksView(t.a.id, t.w)).followups[0]).toMatchObject({
      status: "cancelled",
      nextRemindAt: null,
    });
  });
  it("halts a recurring reminder if its referenced task changes", async () => {
    const t = await setup();
    const anchor = new Date(Date.now() - 30000).toISOString();
    const { followupId } = await t.cmd({
      type: "followup.create",
      content: "Controllo",
      kind: "check",
      timeZone: "UTC",
      remindAt: anchor,
      reference: { kind: "task", id: t.id, version: 1 },
      recurrence: { weekdays: [1, 2, 3, 4, 5, 6, 7] },
    });
    await t.accept();
    expect(await processFollowup(t.w, String(followupId), 1, anchor)).toBe(
      "suppressed",
    );
    expect((await tasksView(t.a.id, t.w)).followups[0]).toMatchObject({
      needsReview: true,
      nextRemindAt: null,
      deliveredAt: null,
    });
  });
  it("pages all recurring delivery receipts across versions without overlaps or omissions", async () => {
    const t = await setup();
    const fields = {
      content: "Ricorda la verifica",
      kind: "check",
      reference: null,
      timeZone: "UTC",
      remindAt: "2020-01-01T10:00:00.123456Z",
      recurrence: { weekdays: [1, 2, 3, 4, 5, 6, 7] },
    };
    const { followupId } = await t.cmd({ type: "followup.create", ...fields });
    const id = String(followupId);
    await t.cmd({
      type: "followup.revise",
      followupId: id,
      expectedVersion: 1,
      ...fields,
      content: "Ricorda la seconda verifica",
      reason: "Test della cronologia",
    });
    // Seed retained receipts directly: workers and their delivery effects are covered separately.
    // Identical schedules in two immutable versions exercise both components of the cursor.
    await pool.query(
      `INSERT INTO followup_delivery(workspace_id, followup_id, version, scheduled_at, outcome, reason)
       SELECT $1, $2, v, $3::timestamptz + n * interval '1 day', 'delivered', format('%s/%s', v, n)
       FROM generate_series(1, 2) v CROSS JOIN generate_series(0, 50) n`,
      [t.w, id, fields.remindAt],
    );
    async function page(
      after?: { version: number; scheduledAt: string } | null,
    ) {
      const url = new URL(
        `http://localhost/api/v1/workspaces/${t.w}/tasks-history`,
      );
      url.searchParams.set("id", id);
      url.searchParams.set("kind", "followup");
      if (after) {
        url.searchParams.set("beforeDeliveryVersion", String(after.version));
        url.searchParams.set("beforeDeliveryAt", after.scheduledAt);
      }
      const result = await handleAPI(
        new Request(url, { headers: { cookie: t.b.cookie } }),
      );
      expect(result.status).toBe(200);
      return tasksHistorySchema.parse(await result.json());
    }
    const first = await page();
    expect(first.proposals).toHaveLength(50);
    expect(first.nextDelivery).toEqual({
      version: 2,
      scheduledAt: "2020-01-02T10:00:00.123456Z",
    });
    const second = await page(first.nextDelivery);
    expect(second.proposals).toHaveLength(50);
    expect(second.nextDelivery).toEqual({
      version: 1,
      scheduledAt: "2020-01-03T10:00:00.123456Z",
    });
    const third = await page(second.nextDelivery);
    expect(third.proposals).toHaveLength(2);
    expect(third.nextDelivery).toBeNull();
    expect(
      [first, second, third].flatMap((part) =>
        part.proposals.map((r) => r.reason),
      ),
    ).toEqual(
      [2, 1].flatMap((version) =>
        Array.from({ length: 51 }, (_, index) => `${version}/${50 - index}`),
      ),
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
