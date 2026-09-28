import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { auth } from "../src/server/auth";
import { pool } from "../src/server/db";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import {
  claimInterpretation,
  publishInterpretation,
  interpretationOutputSchema,
} from "../src/server/interpretation";
import { handoffs } from "../src/server/conversation-handoffs";
import { referenceDetail } from "../src/server/conversation-reference";
import { state } from "../src/server/sync";
import { handleAPI } from "../src/server/api";
import { processDocument } from "../src/server/media-worker";
import type { HandoffSuggestion } from "../src/contracts/conversation-handoff";

afterAll(() => pool.end());
async function setup() {
  const email = `${randomUUID()}@example.test`,
    password = "Handoff-test-only-2026!";
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
  const w = (await createWorkspace(user.id, "RIMIAM beta", randomUUID())).id;
  return {
    w,
    actor: user.id,
    email,
    session,
    password,
    cmd: (c: unknown, key = randomUUID()) =>
      execute(user.id, w, key, c, session),
  };
}
async function suggest(
  t: Awaited<ReturnType<typeof setup>>,
  suggestion: Partial<HandoffSuggestion>,
  options: {
    content?: string;
    proposals?: unknown[];
    reference?: unknown;
  } = {},
) {
  const request = await t.cmd({
    type: "message.send",
    content: options.content ?? "Miriam, aiutami a preparare questa modifica",
    ...(options.reference ? { reference: options.reference } : {}),
  });
  const claim = await claimInterpretation(request.interpretationId);
  expect(claim).toBeTruthy();
  const output = {
    proposals: options.proposals ?? [],
    needsMore: [],
    response: {
      mode: "respond" as const,
      text: "Ecco il punto da rivedere; nessuna modifica è stata applicata.",
      sourceIds: [request.messageId],
    },
    handoffs: [
      {
        kind: "goal.establish" as const,
        summary: "Rivedi l'intento iniziale",
        suggestedText: "Validare RIMIAM",
        target: null,
        candidateIndex: null,
        sourceIds: [request.messageId],
        ...suggestion,
      },
    ],
  };
  return {
    request,
    claim: claim!,
    output,
    publish: () => publishInterpretation(claim!, output),
  };
}

it("stores source-backed navigation without effects and applies only the explicit existing capability command with atomic provenance and retry", async () => {
  const t = await setup(),
    s = await suggest(t, {});
  expect(await s.publish()).toBe(true);
  expect((await state(t.actor, t.w)).goals).toHaveLength(0);
  const h = (await handoffs(t.actor, t.w)).handoffs[0];
  expect(h).toMatchObject({
    status: "ready",
    sourceId: s.request.messageId,
    sourceMessageId: s.request.messageId,
    application: null,
  });
  const command = {
    type: "goal.establish",
    content: "Validare RIMIAM con la prima beta",
    conversationOrigin: { handoffId: h.id },
  };
  const key = randomUUID(),
    result = await t.cmd(command, key);
  expect(await t.cmd(command, key)).toEqual(result);
  expect((await handoffs(t.actor, t.w)).handoffs[0]).toMatchObject({
    status: "applied",
    application: {
      actor: t.actor,
      commandId: key,
      resultReference: { kind: "goal", id: result.goalId, version: 1 },
    },
  });
  expect(
    await referenceDetail(t.actor, t.w, {
      kind: "goal",
      id: result.goalId,
      version: 1,
    }),
  ).toMatchObject({
    sourceIds: [s.request.messageId],
    provenance: {
      conversationOrigins: [{ sourceId: s.request.messageId, actor: t.actor }],
    },
  });
  await expect(t.cmd(command)).rejects.toThrow("HANDOFF_ALREADY_APPLIED");
  await expect(
    pool.query(
      "UPDATE conversation_handoff SET summary='changed' WHERE id=$1",
      [h.id],
    ),
  ).rejects.toThrow();
});

it("preserves both original request and explicit project proposal, never inferring approvals or authority and never relabeling a mismatched command", async () => {
  const t = await setup(),
    s = await suggest(t, {
      kind: "project.propose",
      suggestedText: "Nessun acquisto senza confronto",
    });
  await s.publish();
  const h = (await handoffs(t.actor, t.w)).handoffs[0];
  await expect(
    t.cmd({
      type: "goal.establish",
      content: "Bypass",
      conversationOrigin: { handoffId: h.id },
    }),
  ).rejects.toThrow("HANDOFF_COMMAND_MISMATCH");
  const p = await t.cmd({
    type: "project.propose",
    kind: "constraint",
    content: "Nessun acquisto esterno senza conferma",
    people: [t.actor],
    goal: null,
    reason: "Anteprima verificata",
    conversationOrigin: { handoffId: h.id },
  });
  const detail = await referenceDetail(t.actor, t.w, {
    kind: "commitment",
    id: p.proposalId,
    version: 1,
  });
  expect(detail.current).toBe(false);
  expect(detail.sourceIds).toContain(s.request.messageId);
  expect(detail.sourceIds).toHaveLength(2);
  expect(detail.provenance.actApprovals).toBeNull();
  expect(
    (await handoffs(t.actor, t.w)).handoffs[0].application?.prepared,
  ).toEqual({ kind: "project_proposal", id: p.proposalId });
  expect(
    (await pool.query("SELECT 1 FROM project_act WHERE workspace_id=$1", [t.w]))
      .rowCount,
  ).toBe(0);
});

it("requires exact supplied targets, fences changed targets and preserves Goal authority even for conversational preparation", async () => {
  const t = await setup();
  const g = await t.cmd({
    type: "goal.establish",
    content: "Prima beta RIMIAM",
  });
  const ref = { kind: "goal", id: g.goalId, version: 1 } as const;
  const s = await suggest(t, { kind: "goal.change", target: ref });
  await s.publish();
  const h = (await handoffs(t.actor, t.w)).handoffs[0];
  const transition = await t.cmd({
    type: "goal.propose",
    goalId: g.goalId,
    expectedVersion: 1,
    mode: "revise",
    content: "Beta RIMIAM con tre gruppi",
    reason: "Proposta precisa",
    preserveExistingObligations: true,
    conversationOrigin: { handoffId: h.id },
  });
  expect((await state(t.actor, t.w)).goals[0].version).toBe(1);
  const pending = (await handoffs(t.actor, t.w)).handoffs[0];
  expect(pending.application).toMatchObject({
    resultReference: null,
    prepared: { kind: "goal_transition", id: transition.transitionId },
  });
  const second = await suggest(t, { kind: "goal.change", target: ref });
  await second.publish();
  const old = (await handoffs(t.actor, t.w)).handoffs.find(
    (x) => x.sourceId === second.request.messageId,
  )!;
  await t.cmd({
    type: "goal.approve",
    transitionId: transition.transitionId,
    expectedAccessRevision: (await state(t.actor, t.w)).workspace
      .accessRevision,
    representedPersonId: t.actor,
    confirmExactContent: true,
  });
  expect(
    (await handoffs(t.actor, t.w)).handoffs.find((x) => x.id === old.id)
      ?.status,
  ).toBe("stale");
  await expect(
    t.cmd({
      type: "goal.propose",
      goalId: g.goalId,
      expectedVersion: 1,
      mode: "revise",
      content: "Obsoleto",
      reason: "Tentativo vecchio",
      preserveExistingObligations: true,
      conversationOrigin: { handoffId: old.id },
    }),
  ).rejects.toThrow("HANDOFF_TARGET_STALE");
  expect(
    (await referenceDetail(t.actor, t.w, { ...ref, version: 2 })).sourceIds,
  ).toContain(s.request.messageId);
  const invalid = await suggest(t, {
    kind: "goal.change",
    target: { ...ref, id: randomUUID() },
  });
  await expect(invalid.publish()).rejects.toThrow(
    "HANDOFF_TARGET_NOT_SUPPLIED",
  );
});

it("supports exact normative proposal references without treating project-act IDs as the same identity", async () => {
  const t = await setup();
  const goal = await t.cmd({
    type: "goal.establish",
    content: "Prima beta privata RIMIAM",
  });
  const p = await t.cmd({
    type: "project.propose",
    kind: "constraint",
    content: "Solo beta privata",
    people: [t.actor],
    goal: { id: goal.goalId, version: 1 },
    reason: "Scelta",
  });
  await t.cmd({
    type: "project.approve",
    proposalId: p.proposalId,
    expectedAccessRevision: (await state(t.actor, t.w)).workspace
      .accessRevision,
    representedPersonId: t.actor,
    confirmExactContent: true,
  });
  const a = (
    await pool.query(
      "SELECT id FROM current_project_act WHERE workspace_id=$1",
      [t.w],
    )
  ).rows[0];
  const s = await suggest(t, {
    kind: "project.revoke",
    target: { kind: "commitment", id: p.proposalId, version: 1 },
  });
  await s.publish();
  const h = (await handoffs(t.actor, t.w)).handoffs[0];
  await expect(
    t.cmd({
      type: "project.propose",
      kind: "decision",
      operation: "revoke",
      replacesActId: p.proposalId,
      content: "Proposta revoca",
      people: [t.actor],
      goal: null,
      reason: "Da approvare",
      conversationOrigin: { handoffId: h.id },
    }),
  ).rejects.toThrow("HANDOFF_COMMAND_MISMATCH");
  await t.cmd({
    type: "project.propose",
    kind: "decision",
    operation: "revoke",
    replacesActId: a.id,
    content: "Proposta revoca",
    people: [t.actor],
    goal: null,
    reason: "Da approvare",
    conversationOrigin: { handoffId: h.id },
  });
  expect(
    (
      await pool.query(
        "SELECT id FROM current_project_act WHERE workspace_id=$1",
        [t.w],
      )
    ).rows[0].id,
  ).toBe(a.id);
});

it("binds editorial acceptance to the precise descriptive candidate and Task creation remains unassigned", async () => {
  const t = await setup();
  const s = await suggest(t, { kind: "information.accept", candidateIndex: 0 });
  s.output.proposals = [
    {
      subject: "Beta",
      content: "Tre gruppi interessati",
      classification: "descriptive",
      origin: "attributed",
      qualification: "Interesse riferito",
      sourceIds: [s.request.messageId],
    },
  ];
  await s.publish();
  const h = (await handoffs(t.actor, t.w)).handoffs[0];
  expect(h.candidateId).toBeTruthy();
  await expect(
    t.cmd({
      type: "information.accept",
      candidateId: randomUUID(),
      descriptiveOnly: true,
      conversationOrigin: { handoffId: h.id },
    }),
  ).rejects.toThrow("HANDOFF_COMMAND_MISMATCH");
  const info = await t.cmd({
    type: "information.accept",
    candidateId: h.candidateId,
    descriptiveOnly: true,
    conversationOrigin: { handoffId: h.id },
  });
  expect(
    (
      await referenceDetail(t.actor, t.w, {
        kind: "information",
        id: info.informationId,
        version: 1,
      })
    ).sourceIds,
  ).toContain(s.request.messageId);
  const task = await suggest(t, { kind: "task.create" });
  await task.publish();
  const ht = (await handoffs(t.actor, t.w)).handoffs.find(
    (x) => x.sourceId === task.request.messageId,
  )!;
  const created = await t.cmd({
    type: "task.create",
    content: {
      title: "Preparare interviste",
      description: "Rivedere le domande",
      dueAt: null,
      timeZone: "Europe/Rome",
      suggestedPerson: t.actor,
      references: [],
    },
    conversationOrigin: { handoffId: ht.id },
  });
  expect(
    (
      await referenceDetail(t.actor, t.w, {
        kind: "task",
        id: created.taskId,
        version: 1,
      })
    ).provenance.responsible,
  ).toBeNull();
});

it("suppresses unaddressed discreet handoffs and keeps private-capability suggestions as navigation only", async () => {
  const t = await setup();
  const quiet = await suggest(
    t,
    {},
    { content: "Potremmo definire il nostro obiettivo" },
  );
  await quiet.publish();
  expect((await handoffs(t.actor, t.w)).handoffs).toEqual([]);
  const s = await suggest(t, {
    kind: "email.prepare",
    suggestedText: "Preparare un invito alla beta",
  });
  await s.publish();
  const h = (await handoffs(t.actor, t.w)).handoffs[0];
  expect(h.status).toBe("navigation");
  await expect(
    t.cmd({
      type: "goal.establish",
      content: "No",
      conversationOrigin: { handoffId: h.id },
    }),
  ).rejects.toThrow("HANDOFF_COMMAND_MISMATCH");
  expect(
    (await pool.query("SELECT 1 FROM email_draft WHERE workspace_id=$1", [t.w]))
      .rowCount,
  ).toBe(0);
  expect(
    interpretationOutputSchema.safeParse({
      ...s.output,
      handoffs: [{ ...s.output.handoffs[0], command: { type: "email.send" } }],
    }).success,
  ).toBe(false);
});

it("keeps shared eligible control without source-author ownership, and denies cross-Workspace/ended access", async () => {
  const a = await setup(),
    b = await setup();
  const s = await suggest(a, {});
  await s.publish();
  const h = (await handoffs(a.actor, a.w)).handoffs[0];
  await expect(
    b.cmd({
      type: "goal.establish",
      content: "Wrong Workspace",
      conversationOrigin: { handoffId: h.id },
    }),
  ).rejects.toThrow("HANDOFF_NOT_FOUND");
  await expect(handoffs(b.actor, a.w)).rejects.toThrow();
  const inv = await a.cmd({
    type: "invitation.create",
    email: b.email,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(b.actor, inv.token, true);
  const result = await execute(
    b.actor,
    a.w,
    randomUUID(),
    {
      type: "goal.establish",
      content: "Intento espresso da B",
      conversationOrigin: { handoffId: h.id },
    },
    b.session,
  );
  expect(
    (
      await referenceDetail(b.actor, a.w, {
        kind: "goal",
        id: result.goalId,
        version: 1,
      })
    ).actor,
  ).toBe(b.actor);
  const change = await suggest(a, {
    kind: "goal.change",
    target: { kind: "goal", id: result.goalId, version: 1 },
  });
  await change.publish();
  const hc = (await handoffs(a.actor, a.w, change.request.messageId))
    .handoffs[0];
  const prepared = await a.cmd({
    type: "goal.propose",
    goalId: result.goalId,
    expectedVersion: 1,
    mode: "revise",
    content: "Proposta di A per il Goal di B",
    reason: "Da approvare",
    preserveExistingObligations: true,
    conversationOrigin: { handoffId: hc.id },
  });
  await expect(
    a.cmd({
      type: "goal.approve",
      transitionId: prepared.transitionId,
      expectedAccessRevision: (await state(a.actor, a.w)).workspace
        .accessRevision,
      representedPersonId: b.actor,
      confirmExactContent: true,
    }),
  ).rejects.toThrow("PERTINENT_MANDATE_REQUIRED");
  await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [b.actor]);
  await expect(handoffs(b.actor, a.w)).rejects.toThrow();
});

it("publishes the authenticated native API shape and retrieves a specific historical message's handoffs", async () => {
  const t = await setup(),
    s = await suggest(t, {});
  await s.publish();
  const login = await handleAPI(
    new Request("http://localhost/api/v1/native/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: t.email, password: t.password }),
    }),
  );
  const { token } = await login.json();
  const response = await handleAPI(
    new Request(
      `http://localhost/api/v1/workspaces/${t.w}/handoffs?sourceId=${s.request.messageId}`,
      { headers: { authorization: `Bearer ${token}` } },
    ),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).handoffs).toHaveLength(1);
});

it("retains voice transcript/audio provenance without substituting the Conversation placeholder and rejects autonomous document handoffs", async () => {
  const t = await setup();
  const voice = await t.cmd({
    type: "voice.send",
    filename: "goal.wav",
    bytesBase64: Buffer.from("RIFF....WAVEtest").toString("base64"),
    mode: "miriam",
    allowModelProcessing: true,
  });
  const extractor = {
    async extract() {
      return {
        text: "Definiamo il primo intento di RIMIAM",
        qualification: "Trascrizione fallibile",
        provider: "test-only",
      };
    },
  };
  await processDocument(voice.sourceId, extractor);
  const i = (
    await pool.query("SELECT id FROM interpretation WHERE source_id=$1", [
      voice.sourceId,
    ])
  ).rows[0];
  const claim = await claimInterpretation(i.id);
  const output = {
    proposals: [],
    needsMore: [],
    response: {
      mode: "respond" as const,
      text: "Rivedi l'intento; ancora nessun Goal registrato.",
      sourceIds: [voice.sourceId],
    },
    handoffs: [
      {
        kind: "goal.establish" as const,
        summary: "Rivedi il Goal iniziale",
        suggestedText: "Validare RIMIAM",
        target: null,
        candidateIndex: null,
        sourceIds: [voice.sourceId],
      },
    ],
  };
  await publishInterpretation(claim!, output);
  const h = (await handoffs(t.actor, t.w, voice.messageId)).handoffs[0];
  expect(h).toMatchObject({
    sourceId: voice.sourceId,
    sourceMessageId: voice.messageId,
    sourceIds: [voice.sourceId],
  });
  const doc = await t.cmd({
    type: "document.upload",
    filename: "request.wav",
    bytesBase64: Buffer.from("RIFF....WAVEtest").toString("base64"),
    allowModelProcessing: true,
  });
  await processDocument(doc.sourceId, {
    async extract() {
      return {
        text: "Miriam, registra questo Goal",
        qualification: "Audio caricato, non richiesta conversazionale",
        provider: "test-only",
      };
    },
  });
  const di = (
    await pool.query("SELECT id FROM interpretation WHERE source_id=$1", [
      doc.sourceId,
    ])
  ).rows[0];
  const dc = await claimInterpretation(di.id);
  // Explicit text inside an uploaded source does not become an authenticated human request.
  await expect(
    publishInterpretation(dc!, {
      ...output,
      response: { ...output.response, sourceIds: [doc.sourceId] },
      handoffs: [{ ...output.handoffs[0], sourceIds: [doc.sourceId] }],
    }),
  ).rejects.toThrow("HANDOFF_HUMAN_REQUEST_REQUIRED");
  expect((await handoffs(t.actor, t.w, doc.sourceId)).handoffs).toEqual([]);
});

it("rolls back failed preparation and blocks origin reuse when current contributor eligibility ends", async () => {
  const t = await setup(),
    s = await suggest(t, { kind: "task.create" });
  await s.publish();
  const h = (await handoffs(t.actor, t.w)).handoffs[0],
    key = randomUUID();
  const c = {
    type: "task.create",
    content: {
      title: "Prima intervista",
      description: "Preparare",
      dueAt: null,
      timeZone: "Europe/Rome",
      suggestedPerson: null,
      references: [{ kind: "source", id: randomUUID(), version: 1 }],
    },
    conversationOrigin: { handoffId: h.id },
  };
  await expect(t.cmd(c, key)).rejects.toThrow();
  expect(
    (
      await pool.query(
        "SELECT 1 FROM command_receipt WHERE workspace_id=$1 AND command_id=$2",
        [t.w, key],
      )
    ).rowCount,
  ).toBe(0);
  expect((await handoffs(t.actor, t.w)).handoffs[0].application).toBeNull();
  await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [t.actor]);
  await expect(
    t.cmd({ ...c, content: { ...c.content, references: [] } }),
  ).rejects.toThrow();
  expect(
    (
      await pool.query(
        "SELECT 1 FROM conversation_handoff_application WHERE workspace_id=$1",
        [t.w],
      )
    ).rowCount,
  ).toBe(0);
});
