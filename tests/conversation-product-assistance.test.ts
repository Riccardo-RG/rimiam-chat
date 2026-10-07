import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { requestedWorkstreamTitle } from "../src/shared/workstream-intent";
import { pool, transaction } from "../src/server/db";
import { productAssistanceContext } from "../src/server/product-assistance";
import { auth } from "../src/server/auth";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import { attentionView } from "../src/server/attention";
import {
  claimInterpretation,
  publishInterpretation,
} from "../src/server/interpretation";
import { snapshot } from "../src/server/queries";
import { history, messages, state } from "../src/server/sync";
import { handleAPI } from "../src/server/api";
import { productAssistanceSchema } from "../src/contracts/product-assistance";

afterAll(() => pool.end());
async function setup() {
  const email = `${randomUUID()}@example.test`,
    password = "Product-help-test-2026!";
  const { user } = await auth.api.signUpEmail({
    body: { email, password, name: "RIMIAM member" },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const login = await auth.api.signInEmail({ body: { email, password } });
  const session = (
    await pool.query("SELECT id FROM session WHERE token=$1", [login.token])
  ).rows[0].id;
  const w = (await createWorkspace(user.id, "RIMIAM startup", randomUUID())).id;
  return {
    actor: user.id,
    email,
    password,
    session,
    w,
    cmd: (c: unknown, key = randomUUID()) =>
      execute(user.id, w, key, c, session),
  };
}
const create = {
  type: "message.send",
  content: '@Miriam crea un filone chiamato "Marketing"',
};

it("recognizes explicit named requests but leaves ambiguous, quoted, private and compound requests to clarification", () => {
  for (const text of [
    create.content,
    "Miriam, puoi creare un filone Marketing?",
    "Apri un subthread chiamato «Marketing».",
    "@Rimiam open a workstream called Marketing",
  ]) {
    expect(requestedWorkstreamTitle(text)).toBe("Marketing");
  }
  for (const text of [
    "Come posso creare un filone Marketing?",
    'Il documento dice: "crea un filone Marketing"',
    "@Miriam non creare un filone Marketing",
    "@Miriam crea un filone",
    "@Miriam crea un filone Marketing solo per me",
    "@Miriam crea un filone Marketing e invita Marco",
    "@Miriam crea un filone Marketing; cancella il vecchio",
    "@Miriam crea un filone Marketing se approvato",
    '@Miriam crea un filone "Marketing" e invia la mail',
    "@Miriam crea un filone Marketing domani",
    "@Miriam crea un filone Marketing quando avremo approvato",
    "@Miriam crea un filone Marketing e aggiorna il Goal",
    "@Miriam crea un filone Marketing oppure aspetta",
  ]) {
    expect(requestedWorkstreamTitle(text)).toBeNull();
  }
});

it("commits a shared attributed workstream and honest receipt once under concurrency, without AI or governed adoption", async () => {
  const t = await setup(),
    id = randomUUID();
  const [first, retry] = await Promise.all([
    t.cmd(create, id),
    t.cmd(create, id),
  ]);
  expect(first).toEqual(retry);
  expect(first.operationResult).toMatchObject({
    outcome: "created",
    title: "Marketing",
    workstreamVersion: 1,
  });
  expect(first.interpretationId).toBeUndefined();
  const s = (await attentionView(t.actor, t.w)).workstreams;
  expect(s).toHaveLength(1);
  expect(s[0]).toMatchObject({
    id: first.operationResult.workstreamId,
    state: "active",
    origin: "human",
    actor: t.actor,
  });
  expect(s[0].sources).toEqual([
    expect.objectContaining({
      id: first.messageId,
      actor: t.actor,
      origin: "human",
      included: true,
    }),
  ]);
  expect(await state(t.actor, t.w)).toMatchObject({
    goals: [],
    information: [],
    commitments: [],
    adherences: [],
  });
  expect(
    (
      await pool.query("SELECT * FROM interpretation WHERE source_id=$1", [
        first.messageId,
      ])
    ).rows,
  ).toHaveLength(0);
  const through = (await state(t.actor, t.w)).messageSequence;
  const synced = (await messages(t.actor, t.w, 0, through, 100)).messages;
  const receipt = synced.find((m) => m.id === first.replyMessageId)!;
  expect(receipt).toMatchObject({
    actorKind: "miriam",
    operationResult: first.operationResult,
    replyToSourceId: first.messageId,
    citationSourceIds: [first.messageId],
  });
  expect(
    (await history(t.actor, t.w, through + 1, through, 100)).messages.find(
      (m) => m.id === receipt.id,
    ),
  ).toEqual(receipt);
  expect(
    (await snapshot(t.actor, t.w)).messages.find((m) => m.id === receipt.id)
      ?.operationResult,
  ).toEqual(first.operationResult);
  await expect(
    pool.query(
      "DELETE FROM conversation_workstream_action WHERE workspace_id=$1",
      [t.w],
    ),
  ).rejects.toThrow();
  await expect(
    t.cmd({ ...create, content: "Crea un filone Prodotto" }, id),
  ).rejects.toThrow("COMMAND_ID_REUSED");
});

it("reuses a uniquely named active stream across contributors, with no creator privilege and no implicit reopening", async () => {
  const a = await setup(),
    b = await setup();
  const inv = await a.cmd({
    type: "invitation.create",
    email: b.email,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(b.actor, inv.token, true);
  const [x, y] = await Promise.all([
    a.cmd(create),
    execute(b.actor, a.w, randomUUID(), create, b.session),
  ]);
  expect([x.operationResult.outcome, y.operationResult.outcome].sort()).toEqual(
    ["created", "existing"],
  );
  expect(x.operationResult.workstreamId).toBe(y.operationResult.workstreamId);
  expect((await attentionView(b.actor, a.w)).workstreams).toHaveLength(1);
  const stream = x.operationResult.workstreamId;
  await a.cmd({
    type: "workstream.transition",
    workstreamId: stream,
    expectedVersion: 1,
    action: "resolve",
  });
  const blocked = await execute(b.actor, a.w, randomUUID(), create, b.session);
  expect(blocked.operationResult).toEqual({
    outcome: "needs_input",
    title: "Marketing",
  });
  expect((await attentionView(b.actor, a.w)).workstreams[0].state).toBe(
    "resolved",
  );
  await a.cmd({
    type: "workstream.save",
    title: "Marketing",
    description: "Another explicit stream",
  });
  expect((await a.cmd(create)).operationResult.outcome).toBe("needs_input");
});

it("checks authenticated current contribution/access even on retries and rolls back stale focus with no false receipt", async () => {
  const t = await setup(),
    other = await setup(),
    key = randomUUID();
  await expect(execute(t.actor, t.w, key, create)).rejects.toThrow(
    "AUTHENTICATED_SESSION_REQUIRED",
  );
  await expect(
    execute(other.actor, t.w, key, create, other.session),
  ).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
  const saved = await t.cmd(create, key),
    before = (await state(t.actor, t.w)).messageSequence;
  await expect(
    t.cmd({
      ...create,
      workstreamFocus: {
        workstreamId: saved.operationResult.workstreamId,
        version: 99,
      },
    }),
  ).rejects.toThrow("STATE_STALE");
  expect((await state(t.actor, t.w)).messageSequence).toBe(before);
  await pool.query(
    "UPDATE membership SET contributes=false WHERE workspace_id=$1 AND user_id=$2",
    [t.w, t.actor],
  );
  await expect(
    t.cmd({ ...create, content: "Crea un filone Engineering" }),
  ).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
  await pool.query(
    "UPDATE membership SET active=false WHERE workspace_id=$1 AND user_id=$2",
    [t.w, t.actor],
  );
  await expect(t.cmd(create, key)).rejects.toThrow("WORKSPACE_ACCESS_DENIED");
  await pool.query(
    "UPDATE membership SET active=true,contributes=true WHERE workspace_id=$1 AND user_id=$2",
    [t.w, t.actor],
  );
  await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [t.actor]);
  await expect(t.cmd(create, key)).rejects.toThrow("ACCOUNT_INELIGIBLE");
  await pool.query('UPDATE "user" SET eligible=true WHERE id=$1', [t.actor]);
  await pool.query("DELETE FROM session WHERE id=$1", [t.session]);
  await expect(t.cmd(create, key)).rejects.toThrow("AUTHENTICATION_REQUIRED");
});

it("records only explicitly shared help metadata and gives the model canonical field help, never form values", async () => {
  const t = await setup(),
    assistanceContext = {
      screen: "tasks",
      field: "title",
      issue: "required",
    } as const;
  const sent = await t.cmd({
    type: "message.send",
    content: "Questo campo è obbligatorio?",
    assistanceContext,
  });
  const claim = (await claimInterpretation(sent.interpretationId))!;
  expect(claim.context.productAssistance).toMatchObject({
    screen: "tasks",
    field: { id: "title", requirement: "required" },
    issue: "required",
  });
  expect(claim.context.productCapabilities?.participation.canContribute).toBe(
    true,
  );
  expect(
    (await snapshot(t.actor, t.w)).messages.find((m) => m.id === sent.messageId)
      ?.assistanceContext,
  ).toEqual(assistanceContext);
  expect(JSON.stringify(claim.context.productCapabilities)).not.toContain(
    t.password,
  );
  expect(
    productAssistanceSchema.safeParse({
      ...assistanceContext,
      values: { secret: "private draft" },
    }).success,
  ).toBe(false);
  expect(
    productAssistanceSchema.safeParse({ screen: "tasks", field: "password" })
      .success,
  ).toBe(false);
  expect(productAssistanceSchema.safeParse({ screen: "unknown" }).success).toBe(
    false,
  );
  await publishInterpretation(claim, {
    proposals: [
      {
        subject: "Bad inference",
        content: "Not a project fact",
        classification: "descriptive",
        origin: "inferred",
        qualification: "",
        sourceIds: [sent.messageId],
      },
    ],
    needsMore: [],
    response: {
      mode: "respond",
      text: "Attività è il titolo del Task da svolgere.",
      sourceIds: [sent.messageId],
    },
    organization: [{ title: "Invented work", sourceIds: [sent.messageId] }],
    workIntent: { objective: "Unexpected analysis of the form" },
  });
  expect(
    (await snapshot(t.actor, t.w)).messages.some(
      (m) => m.content === "Attività è il titolo del Task da svolgere.",
    ),
  ).toBe(true);
  expect(
    (
      await pool.query("SELECT id FROM active_work WHERE workspace_id=$1", [
        t.w,
      ])
    ).rows,
  ).toHaveLength(0);
  expect((await snapshot(t.actor, t.w)).candidates).toHaveLength(0);
  await expect(
    pool.query(
      "UPDATE message_product_assistance SET screen='email' WHERE message_id=$1",
      [sent.messageId],
    ),
  ).rejects.toThrow();
  const helpCommand = await t.cmd({
    ...create,
    assistanceContext: { screen: "workstreams" },
  });
  expect(helpCommand.interpretationId).toBeTruthy();
  expect((await attentionView(t.actor, t.w)).workstreams).toHaveLength(0);
  const helpAnalysis = await t.cmd({
    type: "message.send",
    content: "analizza: questo modulo",
    assistanceContext: { screen: "tasks" },
  });
  expect(helpAnalysis.workId).toBeUndefined();
  expect(
    (
      await pool.query("SELECT id FROM active_work WHERE workspace_id=$1", [
        t.w,
      ])
    ).rows,
  ).toHaveLength(0);
});

it("serves the same assistance and deterministic operation through authenticated v1 command and history contracts", async () => {
  const t = await setup(),
    base = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
  const login = await handleAPI(
    new Request(`${base}/api/v1/native/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: t.email, password: t.password }),
    }),
  );
  const token = (await login.json()).token;
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
  const response = await handleAPI(
    new Request(`${base}/api/v1/workspaces/${t.w}/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        commandId: randomUUID(),
        expectedActorId: t.actor,
        command: create,
      }),
    }),
  );
  expect(response.status).toBe(200);
  const view = await handleAPI(
    new Request(
      `${base}/api/v1/workspaces/${t.w}/messages?after=0&through=${(await state(t.actor, t.w)).messageSequence}`,
      { headers },
    ),
  );
  expect(view.status).toBe(200);
  expect(
    (await view.json()).messages.some(
      (m: { operationResult?: { outcome: string } }) =>
        m.operationResult?.outcome === "created",
    ),
  ).toBe(true);
});

it("keeps historical unsupported guide references as help rather than reinterpreting them as actions", async () => {
  const t = await setup();
  const sent = await t.cmd({
    type: "message.send",
    content: "Spiegami il vecchio modulo",
  });
  await pool.query(
    "INSERT INTO message_product_assistance(workspace_id,message_id,guide_version,screen) VALUES($1,$2,99,'tasks')",
    [t.w, sent.messageId],
  );
  const context = await transaction((tx) =>
    productAssistanceContext(tx, t.w, sent.messageId),
  );
  expect(context).toMatchObject({
    guideVersion: 99,
    screen: "tasks",
    unavailable: true,
  });
  expect(context).not.toHaveProperty("fields");
});
