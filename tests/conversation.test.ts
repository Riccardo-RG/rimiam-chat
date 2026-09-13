import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { pool } from "../src/server/db";
import { createWorkspace, execute } from "../src/server/commands";
import { snapshot } from "../src/server/queries";
import { history, state } from "../src/server/sync";
import {
  processInterpretation,
  recoverExpiredInterpretations,
  type Interpreter,
} from "../src/server/interpretation";

async function setup() {
  const a = randomUUID();
  await pool.query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,\'Miriam\',$2,true,now(),now(),true)',
    [a, `${a}@example.test`],
  );
  const w = (await createWorkspace(a, "Conversation", randomUUID())).id;
  const m = await execute(a, w, randomUUID(), {
    type: "message.send",
    content: "Miriam, come possiamo confrontare i locali?",
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
  it("honours a newly restrictive collaboration preference at publication without erasing the source", async () => {
    const { a, w, m } = await setup();
    await processInterpretation(m.interpretationId, responder);
    await execute(a, w, randomUUID(), {
      type: "attention.preference",
      expectedVersion: 0,
      mode: "collaborative",
    });
    const next = await execute(a, w, randomUUID(), {
      type: "message.send",
      content: "I locali hanno costi diversi.",
    });
    await processInterpretation(next.interpretationId, {
      async interpret(context) {
        expect(context.collaborationMode).toBe("collaborative");
        await execute(a, w, randomUUID(), {
          type: "attention.preference",
          expectedVersion: 1,
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
        (m) => m.content === "I locali hanno costi diversi.",
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
  });
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
    expect((await snapshot(a, w)).messages).toHaveLength(1);
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
    expect(s.messages).toHaveLength(1);
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
    expect(s.messages).toHaveLength(2);
    expect(s.interpretations[0].status).toBe("completed");
  });
  it("persists AI attribution, exact sources/inputs and no adopted state", async () => {
    const { a, w, m } = await setup();
    await processInterpretation(m.interpretationId, responder);
    const s = await snapshot(a, w);
    expect(s.messages).toHaveLength(2);
    expect(s.messages[0]).toMatchObject({
      author_id: a,
      actor_kind: "human",
      author_name: "Miriam",
    });
    expect(s.messages[1]).toMatchObject({
      author_id: null,
      actor_kind: "miriam",
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
    expect(page.messages[1]).toMatchObject({
      actorKind: "miriam",
      authorId: "miriam",
      citationSourceIds: [m.messageId],
    });
    await processInterpretation(m.interpretationId, responder);
    expect((await snapshot(a, w)).messages).toHaveLength(2);
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
    expect((await snapshot(a, w)).messages).toHaveLength(1);
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
    expect((await snapshot(a, w)).messages).toHaveLength(1);
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
        expect(c.conversation).toHaveLength(3);
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
