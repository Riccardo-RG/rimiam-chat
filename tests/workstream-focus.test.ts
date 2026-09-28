import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { pool, transaction } from "../src/server/db";
import { auth } from "../src/server/auth";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import { attentionView } from "../src/server/attention";
import { snapshot } from "../src/server/queries";
import { history, messages, state } from "../src/server/sync";
import { processActiveWork } from "../src/server/active-work-worker";
import { processDocument } from "../src/server/media-worker";
import { analysisInputs } from "../src/server/active-work-context";
import {
  claimInterpretation,
  publishInterpretation,
  processInterpretation,
  retrieveSources,
} from "../src/server/interpretation";

afterAll(() => pool.end());
async function setup() {
  const actor = randomUUID();
  await pool.query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,\'RIMIAM contributor\',$2,true,now(),now(),true)',
    [actor, `${actor}@example.test`],
  );
  const w = (await createWorkspace(actor, "RIMIAM · Prima beta", randomUUID()))
    .id;
  const cmd = (c: unknown, key = randomUUID()) => execute(actor, w, key, c);
  const stream = await cmd({
    type: "workstream.save",
    title: "Prima beta",
    description: "Preparare le interviste iniziali",
  });
  return {
    actor,
    w,
    cmd,
    stream,
    focus: { workstreamId: stream.id, version: stream.version },
  };
}
async function finishOlder(w: string) {
  await pool.query(
    "UPDATE interpretation SET status='completed' WHERE workspace_id=$1",
    [w],
  );
}
const empty = { proposals: [], needsMore: [] };

it("atomically links one shared source with exact attributed focus and preserves retry/rollback semantics", async () => {
  const t = await setup(),
    commandId = randomUUID();
  const command = {
    type: "message.send",
    content: "Riccardo propone cinque interviste per RIMIAM",
    workstreamFocus: t.focus,
  };
  const [first, replayed] = await Promise.all([
    t.cmd(command, commandId),
    t.cmd(command, commandId),
  ]);
  expect(first).toEqual(replayed);
  const view = await attentionView(t.actor, t.w);
  expect(view.workstreams[0].sources).toEqual([
    expect.objectContaining({
      id: first.messageId,
      version: 1,
      included: true,
      origin: "human",
      actor: t.actor,
    }),
  ]);
  expect(
    (
      await pool.query(
        "SELECT * FROM message_workstream_focus WHERE workspace_id=$1",
        [t.w],
      )
    ).rows,
  ).toEqual([
    expect.objectContaining({
      message_id: first.messageId,
      workstream_version: 1,
      workstream_id: t.stream.id,
    }),
  ]);
  expect(await state(t.actor, t.w)).toMatchObject({
    goals: [],
    adherences: [],
    information: [],
    commitments: [],
  });
  await expect(
    t.cmd(
      { ...command, workstreamFocus: { ...t.focus, version: 2 } },
      commandId,
    ),
  ).rejects.toThrow("COMMAND_ID_REUSED");
  await expect(
    pool.query("DELETE FROM message_workstream_focus WHERE workspace_id=$1", [
      t.w,
    ]),
  ).rejects.toThrow();
  await t.cmd({
    type: "workstream.save",
    id: t.stream.id,
    expectedVersion: 1,
    title: "Beta mirata",
    description: "Stesso filone",
  });
  const before = (await state(t.actor, t.w)).messageSequence;
  await expect(t.cmd(command)).rejects.toThrow("STATE_STALE");
  expect((await state(t.actor, t.w)).messageSequence).toBe(before);
  expect(
    (await snapshot(t.actor, t.w)).messages.find(
      (m: { id: string }) => m.id === first.messageId,
    )?.workstream_focus,
  ).toEqual(t.focus);
});

it("validates Workspace, contribution, current lifecycle and preserves shared history for later members", async () => {
  const t = await setup(),
    other = await setup();
  await expect(
    t.cmd({
      type: "message.send",
      content: "Messaggio",
      workstreamFocus: other.focus,
    }),
  ).rejects.toThrow("WORKSTREAM_NOT_FOUND");
  const sent = await t.cmd({
    type: "message.send",
    content: "Fonte condivisa",
    workstreamFocus: t.focus,
  });
  await t.cmd({
    type: "workstream.transition",
    workstreamId: t.stream.id,
    expectedVersion: 1,
    action: "resolve",
  });
  await expect(
    t.cmd({
      type: "message.send",
      content: "Non riaprire implicitamente",
      workstreamFocus: { ...t.focus, version: 2 },
    }),
  ).rejects.toThrow("WORKSTREAM_NOT_ACTIVE");
  await t.cmd({
    type: "workstream.transition",
    workstreamId: t.stream.id,
    expectedVersion: 2,
    action: "archive",
  });
  await expect(
    t.cmd({
      type: "message.send",
      content: "Non riaprire implicitamente",
      workstreamFocus: { ...t.focus, version: 3 },
    }),
  ).rejects.toThrow("WORKSTREAM_NOT_ACTIVE");
  const invite = await t.cmd({
    type: "invitation.create",
    email: `${other.actor}@example.test`,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(other.actor, invite.token, true);
  const head = (await state(other.actor, t.w)).messageSequence;
  expect(
    (
      await history(other.actor, t.w, head + 1, head, 10, t.stream.id)
    ).messages.map((m) => m.id),
  ).toEqual([sent.messageId]);
  await expect(
    history(other.actor, other.w, head + 1, head, 10, t.stream.id),
  ).rejects.toThrow("WORKSTREAM_NOT_FOUND");
  await t.cmd({
    type: "workstream.transition",
    workstreamId: t.stream.id,
    expectedVersion: 3,
    action: "reopen",
  });
  await pool.query(
    "UPDATE membership SET contributes=false WHERE workspace_id=$1 AND user_id=$2",
    [t.w, other.actor],
  );
  await expect(
    execute(other.actor, t.w, randomUUID(), {
      type: "message.send",
      content: "Non posso contribuire",
      workstreamFocus: { ...t.focus, version: 4 },
    }),
  ).rejects.toThrow();
  await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [
    other.actor,
  ]);
  await expect(
    messages(other.actor, t.w, 0, head, 10, t.stream.id),
  ).rejects.toThrow();
});

it("focused pagination keeps source/reply identities and independent semantic memberships without moving history", async () => {
  const t = await setup();
  const outside = await t.cmd({
    type: "message.send",
    content: "Argomento generale",
  });
  const source = await t.cmd({
    type: "message.send",
    content: "Miriam, chi intervistiamo?",
    workstreamFocus: t.focus,
  });
  await finishOlder(t.w);
  await pool.query("UPDATE interpretation SET status='queued' WHERE id=$1", [
    source.interpretationId,
  ]);
  await processInterpretation(source.interpretationId, {
    async interpret() {
      return {
        ...empty,
        response: {
          mode: "respond",
          text: "Possiamo preparare le domande per le interviste.",
          sourceIds: [source.messageId],
        },
      };
    },
  });
  const head = (await state(t.actor, t.w)).messageSequence;
  const first = await messages(t.actor, t.w, 0, head, 1, t.stream.id);
  const second = await messages(
    t.actor,
    t.w,
    first.nextAfter,
    head,
    1,
    t.stream.id,
  );
  expect(first.hasMore).toBe(true);
  expect(second.hasMore).toBe(false);
  expect(first.messages[0]).toMatchObject({
    id: source.messageId,
    workstreamFocus: t.focus,
  });
  expect(second.messages[0]).toMatchObject({
    actorKind: "miriam",
    replyToSourceId: source.messageId,
    workstreamFocus: t.focus,
  });
  const historyPage = await history(
    t.actor,
    t.w,
    head + 1,
    head,
    10,
    t.stream.id,
  );
  expect(historyPage.messages.map((m) => m.id)).toEqual(
    [...first.messages, ...second.messages].map((m) => m.id),
  );
  const secondStream = await t.cmd({
    type: "workstream.save",
    title: "Ricerca utenti",
    description: "Altra organizzazione dello stesso materiale",
  });
  await t.cmd({
    type: "workstream.link",
    workstreamId: secondStream.id,
    sourceId: source.messageId,
    expectedVersion: 0,
    included: true,
  });
  expect(
    (await messages(t.actor, t.w, 0, head, 10, secondStream.id)).messages,
  ).toEqual(historyPage.messages);
  await t.cmd({
    type: "workstream.link",
    workstreamId: t.stream.id,
    sourceId: source.messageId,
    expectedVersion: 1,
    included: false,
  });
  expect(
    (await messages(t.actor, t.w, 0, head, 10, t.stream.id)).messages,
  ).toEqual([]);
  expect(
    (await messages(t.actor, t.w, 0, head, 10)).messages.map((m) => m.id),
  ).toContain(outside.messageId);
  expect(
    (await messages(t.actor, t.w, 0, head, 10)).messages.find(
      (m) => m.id === source.messageId,
    )?.workstreamFocus,
  ).toEqual(t.focus);
});

it("selects linked history outside the recent window and expands to relevant shared history outside focus", async () => {
  const t = await setup(),
    foreign = await setup();
  const old = await t.cmd({
    type: "message.send",
    content: "Le interviste sono con Giulia il venerdì",
    workstreamFocus: t.focus,
  });
  const outside = await t.cmd({
    type: "message.send",
    content: "Regola ATLAS: le interviste non autorizzano registrazioni.",
  });
  await foreign.cmd({
    type: "message.send",
    content: "ATLAS: materiale di altro Workspace",
  });
  for (let i = 0; i < 18; i++)
    await t.cmd({
      type: "message.send",
      content: `Conversazione generale ${i}`,
    });
  await finishOlder(t.w);
  const trigger = await t.cmd({
    type: "message.send",
    content: "Miriam, ricordi il giorno? Cerca anche la regola ATLAS.",
    workstreamFocus: t.focus,
  });
  let rounds = 0;
  await processInterpretation(trigger.interpretationId, {
    async interpret(ctx) {
      rounds++;
      expect(ctx.workstreamFocus).toMatchObject({
        ...t.focus,
        currentVersion: 1,
        currentState: "active",
      });
      expect(ctx.sources.map((s) => s.id)).toContain(old.messageId);
      expect(
        ctx.sources.every((s) => !s.content.includes("altro Workspace")),
      ).toBe(true);
      if (rounds === 1) {
        expect(ctx.sources.map((s) => s.id)).not.toContain(outside.messageId);
        return { proposals: [], needsMore: ["ATLAS"] };
      }
      expect(ctx.sources.map((s) => s.id)).toContain(outside.messageId);
      return {
        ...empty,
        response: {
          mode: "respond",
          text: "Venerdì, senza presumere consenso alla registrazione.",
          sourceIds: [old.messageId, outside.messageId],
        },
      };
    },
  });
  expect(rounds).toBe(2);
  const inputs = await transaction((tx) =>
    analysisInputs(tx, t.w, "Analizza il materiale", [], [], trigger.messageId),
  );
  expect(inputs).toContainEqual(
    expect.objectContaining({ kind: "source", id: old.messageId }),
  );
  expect(inputs).toContainEqual(
    expect.objectContaining({
      kind: "workstream_focus",
      id: t.stream.id,
      version: 1,
      provenance: expect.objectContaining({
        historicalSelection: true,
        current: false,
      }),
    }),
  );
});

it("fences late results on actual focus dependencies without depending on unrelated Workspace revision", async () => {
  const t = await setup();
  const first = await t.cmd({
    type: "message.send",
    content: "Miriam, fammi un riepilogo",
    workstreamFocus: t.focus,
  });
  const claim = await claimInterpretation(first.interpretationId);
  expect(claim).not.toBeNull();
  await t.cmd({
    type: "workstream.save",
    title: "Altro filone",
    description: "Nessuna modifica al focus",
  });
  const general = await t.cmd({
    type: "message.send",
    content: "Nota estranea alla selezione iniziale",
  });
  await t.cmd({
    type: "workstream.link",
    workstreamId: t.stream.id,
    sourceId: general.messageId,
    expectedVersion: 0,
    included: true,
  });
  await pool.query("UPDATE interpretation SET status='completed' WHERE id=$1", [
    general.interpretationId,
  ]);
  expect(
    await publishInterpretation(claim!, {
      ...empty,
      response: {
        mode: "respond",
        text: "Il filone riguarda le interviste.",
        sourceIds: [first.messageId],
      },
    }),
  ).toBe(true);
  const late = await t.cmd({
    type: "message.send",
    content: "Miriam, aggiungi un dettaglio",
    workstreamFocus: t.focus,
  });
  const lateClaim = await claimInterpretation(late.interpretationId);
  await t.cmd({
    type: "workstream.transition",
    workstreamId: t.stream.id,
    expectedVersion: 1,
    action: "resolve",
  });
  expect(
    await publishInterpretation(lateClaim!, {
      ...empty,
      response: {
        mode: "respond",
        text: "Risposta tardiva",
        sourceIds: [late.messageId],
      },
    }),
  ).toBe(false);
  expect(
    (
      await pool.query(
        "SELECT * FROM miriam_response WHERE interpretation_id=$1",
        [late.interpretationId],
      )
    ).rowCount,
  ).toBe(0);
  await t.cmd({
    type: "workstream.transition",
    workstreamId: t.stream.id,
    expectedVersion: 2,
    action: "reopen",
  });
  const linked = await t.cmd({
    type: "message.send",
    content: "Miriam, questa fonte serve",
    workstreamFocus: { ...t.focus, version: 3 },
  });
  const linkedClaim = await claimInterpretation(linked.interpretationId);
  await t.cmd({
    type: "workstream.link",
    workstreamId: t.stream.id,
    sourceId: first.messageId,
    expectedVersion: 1,
    included: false,
  });
  expect(await publishInterpretation(linkedClaim!, empty)).toBe(false);
});

it("expands retained linked history by exact identity without a fixed sample becoming a correctness cap", async () => {
  const t = await setup();
  const old = await t.cmd({
    type: "message.send",
    content: "Dettaglio remoto ABELIA",
    workstreamFocus: t.focus,
  });
  for (let i = 0; i < 14; i++)
    await t.cmd({
      type: "message.send",
      content: `Nota recente ${i}`,
      workstreamFocus: t.focus,
    });
  const initial = await transaction((tx) =>
    analysisInputs(tx, t.w, "materiale", [], [], old.messageId),
  );
  expect(initial.filter((i) => i.kind === "source")).toHaveLength(12);
  const expanded = await transaction((tx) =>
    analysisInputs(tx, t.w, "materiale", [], [t.stream.id], old.messageId),
  );
  expect(expanded.filter((i) => i.kind === "source")).toHaveLength(15);
  expect(
    (await retrieveSources(t.w, [t.stream.id])).map((s) => s.id),
  ).toContain(old.messageId);
  expect(
    (await retrieveSources(t.w, [old.messageId])).map((s) => s.id),
  ).toEqual([old.messageId]);
  const other = await setup();
  expect(await retrieveSources(other.w, [t.stream.id, old.messageId])).toEqual(
    [],
  );
});

it("keeps voice focus on the immutable message and actual transcription source through delayed processing", async () => {
  const t = await setup();
  const input = {
    type: "voice.send",
    filename: "voice.wav",
    bytesBase64: Buffer.from("RIFF....WAVEtest").toString("base64"),
    mode: "miriam",
    allowModelProcessing: true,
    workstreamFocus: t.focus,
  };
  const key = randomUUID();
  const sent = await t.cmd(input, key);
  expect(await t.cmd(input, key)).toEqual(sent);
  const head = (await state(t.actor, t.w)).messageSequence;
  expect(
    (await messages(t.actor, t.w, 0, head, 10, t.stream.id)).messages,
  ).toEqual([
    expect.objectContaining({ id: sent.messageId, workstreamFocus: t.focus }),
  ]);
  await t.cmd({
    type: "workstream.transition",
    workstreamId: t.stream.id,
    expectedVersion: 1,
    action: "resolve",
  });
  await processDocument(sent.sourceId, {
    async extract() {
      return {
        text: "Miriam, ricapitoliamo le interviste RIMIAM",
        qualification: "Trascrizione fallibile",
        provider: "test-only",
      };
    },
  });
  const stream = (await attentionView(t.actor, t.w)).workstreams[0];
  expect(stream.state).toBe("resolved");
  expect(stream.sources).toEqual([
    expect.objectContaining({
      id: sent.sourceId,
      included: true,
      actor: t.actor,
    }),
  ]);
  const interpretation = (
    await pool.query(
      "SELECT id FROM interpretation WHERE workspace_id=$1 AND source_id=$2",
      [t.w, sent.sourceId],
    )
  ).rows[0];
  const claim = await claimInterpretation(interpretation.id);
  expect(claim?.context.workstreamFocus).toMatchObject({
    ...t.focus,
    currentVersion: 2,
    currentState: "resolved",
  });
  expect(claim?.context.trigger.id).toBe(sent.sourceId);
  await publishInterpretation(claim!, {
    ...empty,
    response: {
      mode: "respond",
      text: "Ricapitoliamo il materiale già condiviso.",
      sourceIds: [sent.sourceId],
    },
  });
  const after = (await state(t.actor, t.w)).messageSequence;
  const page = await messages(t.actor, t.w, 0, after, 10, t.stream.id);
  expect(page.messages).toHaveLength(2);
  expect(page.messages[1]).toMatchObject({
    actorKind: "miriam",
    replyToSourceId: sent.sourceId,
    workstreamFocus: t.focus,
  });
  expect(await state(t.actor, t.w)).toMatchObject({
    goals: [],
    adherences: [],
    information: [],
    commitments: [],
  });
  await expect(
    t.cmd({ ...input, workstreamFocus: { ...t.focus, version: 2 } }),
  ).rejects.toThrow("WORKSTREAM_NOT_ACTIVE");
});

it("carries the initial focused request into durable Specialist inputs without adopting its output", async () => {
  const t = await setup();
  const email = `${randomUUID()}@example.test`,
    password = "Focus-worker-test-only-2026!";
  const account = await auth.api.signUpEmail({
    body: { email, password, name: "Second contributor" },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    account.user.id,
  ]);
  const login = await auth.api.signInEmail({ body: { email, password } });
  const session = (
    await pool.query("SELECT id FROM session WHERE token=$1", [login.token])
  ).rows[0].id;
  const invitation = await t.cmd({
    type: "invitation.create",
    email,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(account.user.id, invitation.token, true);
  const source = await t.cmd({
    type: "message.send",
    content: "Nadia è disponibile venerdì",
    workstreamFocus: t.focus,
  });
  const request = await execute(
    account.user.id,
    t.w,
    randomUUID(),
    {
      type: "message.send",
      content: "Analizza questo filone",
      workstreamFocus: t.focus,
    },
    session,
  );
  let calls = 0;
  const specialist = {
    name: "test-focus-analysis",
    async analyze(input: {
      inputs: { kind: string; id: string; key: string }[];
    }) {
      calls++;
      const selected = input.inputs.find(
        (i) => i.kind === "source" && i.id === source.messageId,
      );
      expect(selected).toBeDefined();
      expect(input.inputs).toContainEqual(
        expect.objectContaining({ kind: "workstream_focus", id: t.stream.id }),
      );
      return {
        body: "Disponibilità dichiarata da verificare.",
        citations: [selected!.key],
        needsMore: [],
        needsInput: "",
      };
    },
  };
  await processActiveWork(t.w, request.workId, specialist);
  await processActiveWork(t.w, request.workId, specialist);
  expect(calls).toBe(1);
  expect(
    (
      await pool.query(
        "SELECT phase FROM active_work WHERE workspace_id=$1 AND id=$2",
        [t.w, request.workId],
      )
    ).rows[0].phase,
  ).toBe("completed");
  expect(
    (
      await pool.query(
        "SELECT * FROM active_work_input WHERE workspace_id=$1 AND work_id=$2 AND kind='workstream_focus'",
        [t.w, request.workId],
      )
    ).rows,
  ).toEqual([
    expect.objectContaining({
      reference_id: t.stream.id,
      reference_version: 1,
      provenance: expect.objectContaining({
        sourceId: request.messageId,
        historicalSelection: true,
      }),
    }),
  ]);
  expect(
    (
      await pool.query(
        "SELECT * FROM active_work_contribution WHERE workspace_id=$1 AND work_id=$2",
        [t.w, request.workId],
      )
    ).rowCount,
  ).toBe(1);
  expect(await state(t.actor, t.w)).toMatchObject({
    goals: [],
    adherences: [],
    information: [],
    commitments: [],
  });
});
