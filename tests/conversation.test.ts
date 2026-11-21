import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { pool } from "../src/server/db";
import {
  acceptInvitation,
  createWorkspace,
  execute,
} from "../src/server/commands";
import {
  addressMiriam,
  askAboutMessage,
  directlyAddressesMiriam,
} from "../src/shared/miriam-address";
import { saveAssistantSettings } from "../src/server/assistant-settings";
import { assistantConnectionRevision } from "../src/server/assistant-connections";
import { snapshot } from "../src/server/queries";
import { history, state } from "../src/server/sync";
import {
  processInterpretation,
  recoverExpiredInterpretations,
  type Interpreter,
} from "../src/server/interpretation";

async function setup(content = "Miriam, come possiamo confrontare i locali?") {
  const a = randomUUID();
  await pool.query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,\'Miriam\',$2,true,now(),now(),true)',
    [a, `${a}@example.test`],
  );
  const w = (await createWorkspace(a, "Conversation", randomUUID())).id;
  const m = await execute(a, w, randomUUID(), {
    type: "message.send",
    content,
  });
  return { a, w, m };
}
const responder: Interpreter = {
  async interpret(c) {
    return {
      proposals: [],
      needsMore: [],
      response: {
        mode: "respond",
        text: "Possiamo confrontare costi, posizione e vincoli. Quali locali state valutando?",
        sourceIds: [c.trigger.id],
      },
    };
  },
};
afterAll(() => pool.end());
afterEach(() => vi.unstubAllEnvs());
describe("durable conversational Miriam", () => {
  it("retains the explicit CTA and previous addresses, independently of natural questions", () => {
    expect(addressMiriam("Cosa facciamo?")).toBe("@Emme Cosa facciamo?");
    for (const text of [
      "@Emme ciao",
      "Emme, ci sei?",
      "Ciao Emme",
      "Ciao, @Emme!",
      "@Miriam ciao",
      "@Rimiam ciao",
    ]) {
      expect(directlyAddressesMiriam(text)).toBe(true);
      expect(addressMiriam(text)).toBe(
        /^@(?:miriam|rimiam)\b/i.test(text) ? `@Emme ${text}` : text,
      );
    }
    expect(directlyAddressesMiriam("Emmental e pane?")).toBe(false);
    expect(addressMiriam("Miriam, ti va?")).toBe("@Emme Miriam, ti va?");
    expect(addressMiriam("Ciao Miriam")).toBe("@Emme Ciao Miriam");
    expect(directlyAddressesMiriam("Analizza: i costi")).toBe(false);
    expect(addressMiriam("Analizza: i costi")).toBe("@Emme Analizza: i costi");
  });
  it("keeps a human Miriam distinct from Emme for commands and replies, including queued turns after departure", async () => {
    const { a, w, m } = await setup("@Miriam ciao");
    await processInterpretation(m.interpretationId, responder);
    const recipient = randomUUID();
    const email = `${recipient}@example.test`;
    await pool.query(
      `INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible)
       VALUES($1,'Miriam Rossi',$2,true,now(),now(),true)`,
      [recipient, email],
    );
    const invite = await execute(a, w, randomUUID(), {
      type: "invitation.create",
      email,
      fullHistoryDisclosed: true,
    });
    await acceptInvitation(recipient, invite.token, true);
    const toEmme = await execute(a, w, randomUUID(), {
      type: "message.send",
      content: "@Emme, come va?",
    });
    await processInterpretation(toEmme.interpretationId, responder);
    await execute(a, w, randomUUID(), {
      type: "attention.preference",
      expectedVersion: 0,
      mode: "collaborative",
    });
    const toPerson = [];
    for (const content of [
      "@Miriam, apri un filone chiamato Milano",
      "Miriam, analizza: il locale",
      "Ciao Miriam",
    ]) {
      const message = await execute(a, w, randomUUID(), {
        type: "message.send",
        content,
      });
      expect(message).toHaveProperty("interpretationId");
      expect(message).not.toHaveProperty("workId");
      expect(message).not.toHaveProperty("operationResult");
      toPerson.push(message);
    }
    await execute(recipient, w, randomUUID(), {
      type: "member.leave",
      confirmed: true,
    });
    for (const message of toPerson) {
      await processInterpretation(message.interpretationId, {
        async interpret(c) {
          expect(c.addressee).toBe("other_member");
          return {
            ...(await responder.interpret(c)),
            workIntent: { objective: "Analisi non richiesta a Emme" },
          };
        },
      });
    }
    const timeline = (await snapshot(a, w)).messages;
    expect(
      timeline
        .filter((row) => row.reply_to_source_id)
        .map((row) => row.reply_to_source_id),
    ).toEqual([m.messageId, toEmme.messageId]);
    expect(
      (
        await pool.query("SELECT id FROM active_work WHERE workspace_id=$1", [
          w,
        ])
      ).rowCount,
    ).toBe(0);
  });
  it("keeps a customized chat name attributable and a human namesake in control of addressed messages", async () => {
    const { a, w, m } = await setup("@Emme ciao");
    await processInterpretation(m.interpretationId, responder);
    const session = randomUUID();
    await pool.query(
      `INSERT INTO session(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,now()+interval '1 day',now(),now())`,
      [session, randomUUID(), a],
    );
    vi.stubEnv(
      "RIMIAM_ASSISTANT_CONNECTIONS",
      JSON.stringify([
        {
          id: "local",
          kind: "model",
          provider: "ollama",
          model: "synthetic",
          label: "Local",
        },
      ]),
    );
    const settings = {
      workspaceId: w,
      expectedActorId: a,
      connectionId: "local",
      connectionRevision: assistantConnectionRevision("local")!,
      displayName: "Ada",
      instructions: "",
      expectedRevision: 0,
    };
    await saveAssistantSettings(a, session, settings);
    const question = await execute(
      a,
      w,
      randomUUID(),
      { type: "message.send", content: "@Ada, ci sei?" },
      session,
    );
    await processInterpretation(question.interpretationId, responder);
    const other = randomUUID(),
      email = other + "@example.test";
    await pool.query(
      `INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,'Ada Rossi',$2,true,now(),now(),true)`,
      [other, email],
    );
    const invitation = await execute(
      a,
      w,
      randomUUID(),
      { type: "invitation.create", email, fullHistoryDisclosed: true },
      session,
    );
    await acceptInvitation(other, invitation.token, true);
    const human = await execute(
      a,
      w,
      randomUUID(),
      { type: "message.send", content: "@Ada apri un argomento su Milano" },
      session,
    );
    expect(human).not.toHaveProperty("operationResult");
    await processInterpretation(human.interpretationId, {
      async interpret(context) {
        expect(context.addressee).toBe("other_member");
        return responder.interpret(context);
      },
    });
    const fallback = await execute(
      a,
      w,
      randomUUID(),
      { type: "message.send", content: "@Emme, rispondi tu" },
      session,
    );
    await processInterpretation(fallback.interpretationId, responder);
    await saveAssistantSettings(a, session, {
      ...settings,
      displayName: "Nova",
      expectedRevision: 1,
    });
    const messages = (await snapshot(a, w)).messages;
    expect(
      messages
        .filter((item) => item.reply_to_source_id)
        .map((item) => [item.reply_to_source_id, item.author_name]),
    ).toEqual([
      [m.messageId, "Emme"],
      [question.messageId, "Ada"],
      [fallback.messageId, "Ada"],
    ]);
    const cursor = (await state(a, w)).messageSequence;
    expect(
      (await history(a, w, cursor + 1, cursor, 50)).messages
        .filter((x) => x.replyToSourceId)
        .map((x) => x.authorName),
    ).toEqual(["Emme", "Ada", "Ada"]);
  });
  it.each([
    "Ciao",
    "Quanto spendiamo per il sito?",
    "Analizza il preventivo",
    "Crea un filone chiamato Milano",
  ])(
    "keeps ordinary group message %s quiet even if the model tries to intervene",
    async (content) => {
      const { a, w, m } = await setup(content);
      expect(m.interpretationId).toBeTruthy();
      expect(m.workId).toBeUndefined();
      expect(m.operationResult).toBeUndefined();
      await processInterpretation(m.interpretationId, {
        async interpret(c) {
          expect(c.collaborationMode).toBe("discreet");
          return {
            proposals: [],
            needsMore: [],
            response: {
              mode: "respond",
              text: "Non richiesta.",
              sourceIds: [c.trigger.id],
            },
            handoffs: [
              {
                kind: "goal.establish",
                summary: "Un altro intervento",
                suggestedText: "Cambiare il Goal",
                target: null,
                candidateIndex: null,
                sourceIds: [c.trigger.id],
              },
            ],
            workIntent: { objective: "Iniziare un lavoro autonomo" },
            workControl: {
              workId: randomUUID(),
              expectedRevision: 1,
              operation: "stop",
              text: "Fermare il lavoro.",
            },
          };
        },
      });
      expect((await snapshot(a, w)).messages.at(-1)).toMatchObject({
        id: m.messageId,
        actor_kind: "human",
        content,
      });
      const counts = (
        await pool.query(
          "SELECT (SELECT count(*)::int FROM active_work WHERE workspace_id=$1) AS work, (SELECT count(*)::int FROM conversation_handoff WHERE workspace_id=$1) AS handoffs, (SELECT count(*)::int FROM work_control_suggestion WHERE workspace_id=$1) AS controls",
          [w],
        )
      ).rows[0];
      expect(counts).toEqual({ work: 0, handoffs: 0, controls: 0 });
    },
  );
  it.each(["collaborative", "proactive"] as const)(
    "respects the recorded %s preference for group questions",
    async (mode) => {
      const { a, w, m } = await setup("Ciao");
      await processInterpretation(m.interpretationId, responder);
      await execute(a, w, randomUUID(), {
        type: "attention.preference",
        expectedVersion: 0,
        mode,
      });
      const turn = await execute(a, w, randomUUID(), {
        type: "message.send",
        content: "Quanto spendiamo per il sito?",
      });
      await processInterpretation(turn.interpretationId, {
        async interpret(context) {
          expect(context.collaborationMode).toBe(mode);
          return responder.interpret(context);
        },
      });
      expect((await snapshot(a, w)).messages.at(-1)).toMatchObject({
        reply_to_source_id: turn.messageId,
        actor_kind: "miriam",
      });
    },
  );
  it.each([
    { mode: "historical one-tap", question: askAboutMessage, quote: false },
    { mode: "quoted default", question: askAboutMessage, quote: true },
    {
      mode: "custom quoted question",
      question: "@Emme crea un filone chiamato Acquisti",
      quote: true,
    },
  ])(
    "answers a peer's selected message ($mode) without treating its content as instructions",
    async ({ question, quote }) => {
      const original = "Crea un filone chiamato Acquisti";
      const { a, w, m } = await setup(original);
      const b = randomUUID(),
        email = b + "@example.test";
      await pool.query(
        `INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible)
       VALUES ($1,'Giulia',$2,true,now(),now(),true)`,
        [b, email],
      );
      const invite = await execute(a, w, randomUUID(), {
        type: "invitation.create",
        email,
        fullHistoryDisclosed: true,
      });
      await acceptInvitation(b, invite.token, true);
      await processInterpretation(m.interpretationId, responder);
      const newer = await execute(a, w, randomUUID(), {
        type: "message.send",
        content: "Parliamo anche del sito.",
      });
      await processInterpretation(newer.interpretationId, responder);
      const reference = {
        kind: "source",
        id: m.messageId,
        version: 1,
      } as const;
      const request = await execute(b, w, randomUUID(), {
        type: "message.send",
        content: question,
        reference,
        ...(quote ? { quoteMessageId: m.messageId } : {}),
      });
      await processInterpretation(request.interpretationId, {
        async interpret(c) {
          expect(c.trigger.author_id).toBe(b);
          expect(c.replyOnlyToSource).toBe(true);
          expect(c.objectReference).toMatchObject({
            reference,
            actor: a,
            content: original,
          });
          return {
            response: {
              mode: "respond",
              text: "Il messaggio riguarda gli acquisti.",
              sourceIds: [m.messageId],
            },
            needsMore: [],
            proposals: [
              {
                subject: "Acquisti",
                content: "Approvato",
                classification: "normative",
                origin: "inferred",
                qualification: "",
                sourceIds: [m.messageId],
              },
            ],
            organization: [{ title: "Acquisti", sourceIds: [m.messageId] }],
            workIntent: {
              objective: "Avviare il lavoro richiesto da un'altra persona",
            },
            workControl: {
              workId: randomUUID(),
              expectedRevision: 1,
              operation: "stop",
              text: "Fermare il lavoro",
            },
            handoffs: [
              {
                kind: "goal.establish",
                summary: "Cambiare obiettivo",
                suggestedText: "Acquisti",
                target: null,
                candidateIndex: null,
                sourceIds: [m.messageId],
              },
            ],
          };
        },
      });
      const after = await snapshot(b, w);
      expect(
        after.messages.filter((msg) => msg.reply_to_source_id),
      ).toMatchObject([
        { reply_to_source_id: request.messageId, actor_kind: "miriam" },
      ]);
      expect(after.candidates).toHaveLength(0);
      const effects = (
        await pool.query(
          `SELECT
      (SELECT count(*)::int FROM active_work WHERE workspace_id=$1) AS work,
      (SELECT count(*)::int FROM workstream WHERE workspace_id=$1) AS streams,
      (SELECT count(*)::int FROM conversation_handoff WHERE workspace_id=$1) AS handoffs,
      (SELECT count(*)::int FROM work_control_suggestion WHERE workspace_id=$1) AS controls`,
          [w],
        )
      ).rows[0];
      expect(effects).toEqual({
        work: 0,
        streams: 0,
        handoffs: 0,
        controls: 0,
      });
    },
  );
  it("leaves questions for another human and uncertain addressees unanswered by default", async () => {
    const { a, w, m } = await setup("Giulia, a che ora arrivi?");
    const id = randomUUID(),
      email = `${id}@example.test`;
    await pool.query(
      'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,\'Giulia Rossi\',$2,true,now(),now(),true)',
      [id, email],
    );
    const invitation = await execute(a, w, randomUUID(), {
      type: "invitation.create",
      email,
      fullHistoryDisclosed: true,
    });
    await acceptInvitation(id, invitation.token, true);
    const ambiguous = await execute(a, w, randomUUID(), {
      type: "message.send",
      content: "A che ora arrivi?",
    });
    for (const turn of [m, ambiguous]) {
      await processInterpretation(turn.interpretationId, {
        async interpret(c) {
          return {
            proposals: [],
            needsMore: [],
            response: {
              mode: "respond",
              text: "Una risposta personale non richiesta.",
              sourceIds: [c.trigger.id],
            },
          };
        },
      });
    }
    expect(
      (await snapshot(a, w)).messages.filter((row) => row.reply_to_source_id),
    ).toHaveLength(0);
  });
  it.each(["discreet", "collaborative"])(
    "honours switching from %s to explicit discreet mode while a question is in flight",
    async (initialMode) => {
      const { a, w, m } = await setup();
      await processInterpretation(m.interpretationId, responder);
      if (initialMode === "collaborative")
        await execute(a, w, randomUUID(), {
          type: "attention.preference",
          expectedVersion: 0,
          mode: "collaborative",
        });
      const next = await execute(a, w, randomUUID(), {
        type: "message.send",
        content: "Quanto costa ciascun locale?",
      });
      await processInterpretation(next.interpretationId, {
        async interpret(context) {
          expect(context.collaborationMode).toBe(initialMode);
          await execute(a, w, randomUUID(), {
            type: "attention.preference",
            expectedVersion: initialMode === "collaborative" ? 1 : 0,
            mode: "discreet",
          });
          return {
            proposals: [],
            needsMore: [],
            response: {
              mode: "respond",
              text: "Intervento non richiesto",
              sourceIds: [context.trigger.id],
            },
            workIntent: { objective: "Confrontare i costi dei locali" },
          };
        },
      });
      const current = await snapshot(a, w);
      expect(
        current.messages.some(
          (m) => m.content === "Quanto costa ciascun locale?",
        ),
      ).toBe(true);
      expect(
        current.messages.some((m) => m.content === "Intervento non richiesto"),
      ).toBe(false);
      expect(
        (
          await pool.query("SELECT id FROM active_work WHERE workspace_id=$1", [
            w,
          ])
        ).rows,
      ).toHaveLength(0);
    },
  );
  it("records incomplete provider configuration as a failed turn, never a stuck queued turn", async () => {
    const { a, w, m } = await setup();
    vi.stubEnv("AI_MODE", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expect(processInterpretation(m.interpretationId)).rejects.toThrow(
      "AI_CONFIGURATION_REQUIRED",
    );
    const row = (
      await pool.query(
        "SELECT status,error_code,lease_until FROM interpretation WHERE id=$1",
        [m.interpretationId],
      )
    ).rows[0];
    expect(row).toMatchObject({
      status: "failed",
      error_code: "AI_CONFIGURATION_REQUIRED",
      lease_until: null,
    });
    expect((await snapshot(a, w)).messages).toHaveLength(2);
  });
  it("records malformed output without publishing a reply or losing the original source", async () => {
    const { a, w, m } = await setup();
    const invalid = {
      async interpret() {
        return { response: "invalid private model output" };
      },
    } as unknown as Interpreter;
    await expect(
      processInterpretation(m.interpretationId, invalid),
    ).rejects.toThrow("AI_OUTPUT_PARSE_ERROR");
    expect(
      (
        await pool.query(
          "SELECT status,error_code FROM interpretation WHERE id=$1",
          [m.interpretationId],
        )
      ).rows[0],
    ).toMatchObject({ status: "failed", error_code: "AI_OUTPUT_PARSE_ERROR" });
    const s = await snapshot(a, w);
    expect(s.messages).toHaveLength(2);
    expect(s.candidates).toHaveLength(0);
  });
  it("does not publish a failure event for a newer recovered and completed generation", async () => {
    const { a, w, m } = await setup();
    let completedRevision = 0;
    await expect(
      processInterpretation(m.interpretationId, {
        async interpret() {
          await pool.query(
            "UPDATE interpretation SET lease_until=now()-interval '1 second' WHERE id=$1",
            [m.interpretationId],
          );
          await recoverExpiredInterpretations();
          await processInterpretation(m.interpretationId, responder);
          completedRevision = (await snapshot(a, w)).workspace.revision;
          throw new Error("late provider error containing private data");
        },
      }),
    ).rejects.toThrow("INTERPRETATION_FAILED");
    const s = await snapshot(a, w);
    expect(s.workspace.revision).toBe(completedRevision);
    expect(s.messages).toHaveLength(3);
    expect(s.interpretations[0].status).toBe("completed");
  });
  it("persists AI attribution, exact sources/inputs and no adopted state", async () => {
    const { a, w, m } = await setup();
    await processInterpretation(m.interpretationId, responder);
    const s = await snapshot(a, w);
    expect(s.messages).toHaveLength(3);
    expect(s.messages[1]).toMatchObject({
      author_id: a,
      actor_kind: "human",
      author_name: "Miriam",
      content: "Miriam, come possiamo confrontare i locali?",
    });
    expect(s.messages[2]).toMatchObject({
      author_id: null,
      actor_kind: "miriam",
      author_name: "Emme",
      reply_to_source_id: m.messageId,
      citation_source_ids: [m.messageId],
    });
    expect(s.information).toHaveLength(0);
    expect(s.commitments).toHaveLength(0);
    const input = (
      await pool.query(
        "SELECT context FROM interpretation_input WHERE workspace_id=$1",
        [w],
      )
    ).rows;
    expect(input).toHaveLength(1);
    expect(input[0].context.trigger.id).toBe(m.messageId);
    expect(
      (
        await pool.query(
          "SELECT * FROM interpretation_result WHERE workspace_id=$1",
          [w],
        )
      ).rowCount,
    ).toBe(1);
    const current = await state(a, w);
    const page = await history(
      a,
      w,
      current.messageSequence + 1,
      current.messageSequence,
      50,
    );
    expect(page.messages[2]).toMatchObject({
      actorKind: "miriam",
      authorId: "miriam",
      authorName: "Emme",
      citationSourceIds: [m.messageId],
    });
    await processInterpretation(m.interpretationId, responder);
    expect((await snapshot(a, w)).messages).toHaveLength(3);
  });
  it("observes without manufacturing a reply", async () => {
    const { a, w, m } = await setup();
    await processInterpretation(m.interpretationId, {
      async interpret() {
        return {
          proposals: [],
          needsMore: [],
          response: { mode: "observe", text: "", sourceIds: [] },
        };
      },
    });
    expect((await snapshot(a, w)).messages).toHaveLength(2);
  });
  it("rejects invented citations and preserves the source", async () => {
    const { a, w, m } = await setup();
    await expect(
      processInterpretation(m.interpretationId, {
        async interpret() {
          return {
            proposals: [],
            needsMore: [],
            response: {
              mode: "respond",
              text: "Una conclusione",
              sourceIds: [randomUUID()],
            },
          };
        },
      }),
    ).rejects.toThrow();
    expect(
      (
        await pool.query("SELECT error_code FROM interpretation WHERE id=$1", [
          m.interpretationId,
        ])
      ).rows[0].error_code,
    ).toBe("INVALID_SOURCE_REFERENCE");
    expect((await snapshot(a, w)).messages).toHaveLength(2);
  });
  it("fences late results after access changes", async () => {
    const { a, w, m } = await setup();
    await processInterpretation(m.interpretationId, {
      async interpret(c) {
        await execute(a, w, randomUUID(), {
          type: "member.leave",
          confirmed: true,
        });
        return responder.interpret(c);
      },
    });
    expect(
      (
        await pool.query(
          "SELECT * FROM miriam_response WHERE workspace_id=$1",
          [w],
        )
      ).rowCount,
    ).toBe(0);
  });
  it("does not extract AI replies recursively as evidence", async () => {
    const { w, m } = await setup();
    await processInterpretation(m.interpretationId, responder);
    expect(
      (
        await pool.query("SELECT * FROM interpretation WHERE workspace_id=$1", [
          w,
        ])
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT * FROM workspace_source WHERE workspace_id=$1",
          [w],
        )
      ).rowCount,
    ).toBe(1);
  });
  it("includes conversational neighbours and expandable sources", async () => {
    const { a, w, m } = await setup();
    await processInterpretation(m.interpretationId, responder);
    const n = await execute(a, w, randomUUID(), {
      type: "message.send",
      content: "Il secondo costa meno, ma è più piccolo.",
    });
    await processInterpretation(n.interpretationId, {
      async interpret(c) {
        expect(c.conversation).toHaveLength(4);
        expect(c.sources.some((s) => s.id === m.messageId)).toBe(true);
        return {
          proposals: [],
          needsMore: [],
          response: { mode: "observe", text: "", sourceIds: [] },
        };
      },
    });
  });
});
