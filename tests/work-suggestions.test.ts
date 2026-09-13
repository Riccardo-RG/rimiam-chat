import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { pool } from "../src/server/db";
import { auth } from "../src/server/auth";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import {
  processInterpretation,
  type Interpreter,
} from "../src/server/interpretation";
import { activeWorkView } from "../src/server/active-work-queries";
afterAll(() => pool.end());
async function person() {
  const email = `${randomUUID()}@example.test`,
    password = "Work-suggestion-test-only!";
  const { user } = await auth.api.signUpEmail({
    body: { email, password, name: "Control tester" },
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
async function setup() {
  const a = await person(),
    b = await person(),
    w = (await createWorkspace(a.id, "Control proposals", randomUUID())).id;
  const cmd = (c: unknown, actor = a, key = randomUUID()) =>
    execute(actor.id, w, key, c, actor.session);
  const invite = await cmd({
    type: "invitation.create",
    email: b.email,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(b.id, String(invite.token), true);
  const start = await cmd({
      type: "work.converse",
      text: "Analizza: locali Milano",
    }),
    id = String(start.workId);
  return { a, b, w, id, cmd, view: () => activeWorkView(a.id, w) };
}
const observer: Interpreter = {
  async interpret() {
    return { proposals: [], needsMore: [] };
  },
};
async function suggest(
  t: Awaited<ReturnType<typeof setup>>,
  operation: "pause" | "resume" | "redirect" = "pause",
) {
  const m = await t.cmd({
    type: "message.send",
    content: "Miriam, meglio fermarci un momento su questa analisi?",
  });
  await processInterpretation(String(m.interpretationId), {
    async interpret(c) {
      const work = c.activeWork![0] as { id: string; revision: number };
      return {
        proposals: [],
        needsMore: [],
        workControl: {
          workId: work.id,
          expectedRevision: work.revision,
          operation,
          text:
            operation === "redirect"
              ? "Confrontare i locali di Roma"
              : "Fermare temporaneamente l’analisi",
        },
        response: {
          mode: "respond",
          text: "Propongo questa istruzione; puoi applicarla ai controlli dell’analisi.",
          sourceIds: [c.trigger.id],
        },
      };
    },
  });
  return (await t.view()).suggestions[0];
}
it("keeps model steering as an attributed proposal until any eligible contributor explicitly applies it once", async () => {
  const t = await setup(),
    before = (await t.view()).works[0],
    s = await suggest(t);
  expect((await t.view()).works[0].revision).toBe(before.revision);
  expect((await t.view()).works[0].phase).toBe("queued");
  expect(s.status).toBe("pending");
  const key = randomUUID(),
    command = {
      type: "work.apply_suggestion",
      suggestionId: s.id,
      confirmExactInstruction: true,
    };
  const result = await t.cmd(command, t.b, key);
  expect(await t.cmd(command, t.b, key)).toEqual(result);
  const view = await t.view();
  expect(view.works[0].phase).toBe("paused");
  expect(view.suggestions[0]).toMatchObject({
    status: "applied",
    appliedBy: t.b.id,
  });
  expect(
    (
      await pool.query(
        "SELECT * FROM work_control_application WHERE workspace_id=$1",
        [t.w],
      )
    ).rowCount,
  ).toBe(1);
  expect(
    (await pool.query("SELECT * FROM project_act WHERE workspace_id=$1", [t.w]))
      .rowCount,
  ).toBe(0);
  await expect(t.cmd(command)).rejects.toThrow(
    "WORK_SUGGESTION_ALREADY_APPLIED",
  );
  await expect(
    pool.query(
      "UPDATE work_control_suggestion SET content='rewrite' WHERE id=$1",
      [s.id],
    ),
  ).rejects.toThrow("immutable");
});
it("rejects stale/foreign suggestions and cannot resume unresolved human restrictions", async () => {
  const t = await setup(),
    s = await suggest(t);
  await t.cmd(
    {
      type: "work.converse",
      workId: t.id,
      expectedRevision: s.expectedRevision,
      text: "obiezione: Non proseguire senza chiarire il costo",
    },
    t.b,
  );
  await expect(
    t.cmd({
      type: "work.apply_suggestion",
      suggestionId: s.id,
      confirmExactInstruction: true,
    }),
  ).rejects.toThrow("WORK_STATE_STALE");
  const resume = await suggest(t, "resume");
  await t.cmd({
    type: "work.apply_suggestion",
    suggestionId: resume.id,
    confirmExactInstruction: true,
  });
  // The explicit request is retained and explained in Conversation, while the
  // unresolved objection prevents execution. Applying a request is not resuming.
  const restricted = (await t.view()).works[0];
  expect(restricted.phase).toBe("needs_input");
  expect(restricted.issues).toHaveLength(1);
  const other = await setup();
  await expect(
    other.cmd({
      type: "work.apply_suggestion",
      suggestionId: resume.id,
      confirmExactInstruction: true,
    }),
  ).rejects.toThrow("WORK_SUGGESTION_NOT_FOUND");
});
it("does not allow ended membership or a revoked session to apply proposed control", async () => {
  const t = await setup(),
    s = await suggest(t);
  await t.cmd({ type: "member.leave", confirmed: true }, t.b);
  await expect(
    t.cmd(
      {
        type: "work.apply_suggestion",
        suggestionId: s.id,
        confirmExactInstruction: true,
      },
      t.b,
    ),
  ).rejects.toThrow();
  await pool.query("DELETE FROM session WHERE id=$1", [t.a.session]);
  await expect(
    t.cmd({
      type: "work.apply_suggestion",
      suggestionId: s.id,
      confirmExactInstruction: true,
    }),
  ).rejects.toThrow("AUTHENTICATION_REQUIRED");
  expect(
    (
      await pool.query(
        "SELECT * FROM work_control_application WHERE workspace_id=$1",
        [t.w],
      )
    ).rowCount,
  ).toBe(0);
});
it("rejects a model target or revision not provided in its context, and a late control suggestion", async () => {
  const t = await setup();
  for (const foreign of [true, false]) {
    const m = await t.cmd({
      type: "message.send",
      content: "Puoi modificare questa analisi?",
    });
    await expect(
      processInterpretation(String(m.interpretationId), {
        async interpret(c) {
          const work = c.activeWork![0] as { id: string; revision: number };
          return {
            proposals: [],
            needsMore: [],
            workControl: {
              workId: foreign ? randomUUID() : work.id,
              expectedRevision: foreign ? work.revision : work.revision + 1,
              operation: "pause",
              text: "Pausa",
            },
          };
        },
      }),
    ).rejects.toThrow();
  }
  const m = await t.cmd({
    type: "message.send",
    content: "Forse mettiamo in pausa",
  });
  await expect(
    processInterpretation(String(m.interpretationId), {
      async interpret(c) {
        const work = c.activeWork![0] as { id: string; revision: number };
        await t.cmd(
          {
            type: "work.converse",
            workId: t.id,
            expectedRevision: work.revision,
            text: "pausa",
          },
          t.b,
        );
        return {
          proposals: [],
          needsMore: [],
          workControl: {
            workId: work.id,
            expectedRevision: work.revision,
            operation: "resume",
            text: "Riprendi",
          },
        };
      },
    }),
  ).rejects.toThrow();
  expect((await t.view()).suggestions).toHaveLength(0);
  expect((await t.view()).works[0].phase).toBe("paused");
  // A completed unrelated interpretation stays idempotent when another turn is queued.
  await processInterpretation(String(m.interpretationId), observer);
});
