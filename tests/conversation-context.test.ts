import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { pool, transaction } from "../src/server/db";
import { auth } from "../src/server/auth";
import { createWorkspace, execute } from "../src/server/commands";
import {
  artifactContext,
  activeWorkContext,
  goalContext,
} from "../src/server/conversation-context";
import {
  processInterpretation,
  recoverExpiredInterpretations,
} from "../src/server/interpretation";
import { processActiveWork } from "../src/server/active-work-worker";
import { fixtureAnalysis } from "./support/fixture-analysis";
afterAll(() => pool.end());
async function setup() {
  const email = `${randomUUID()}@example.test`,
    password = "Context-test-only-2026!";
  const { user } = await auth.api.signUpEmail({
    body: { email, password, name: "Context tester" },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const login = await auth.api.signInEmail({ body: { email, password } }),
    session = (
      await pool.query("SELECT id FROM session WHERE token=$1", [login.token])
    ).rows[0].id;
  const w = (await createWorkspace(user.id, "Context", randomUUID())).id;
  return {
    w,
    actor: user.id,
    cmd: (c: unknown) => execute(user.id, w, randomUUID(), c, session),
  };
}
const doc = {
  type: "artifact.compose",
  title: "Confronto delle opzioni",
  purpose: "Discussione",
  blocks: [{ type: "paragraph", text: "Vecchia opzione ABELIA" }],
  information: [],
  sourceIds: [],
  reason: "Preparazione",
  nonOperative: true,
};
it("does not label a newer draft as adopted and retrieves retained Artifact versions selectively", async () => {
  const t = await setup(),
    d = await t.cmd(doc);
  const review = await t.cmd({
    type: "artifact.review",
    artifactId: d.artifactId,
    version: 1,
    people: [t.actor],
    nonOperative: true,
  });
  const revision = (
    await pool.query("SELECT access_revision FROM workspace WHERE id=$1", [t.w])
  ).rows[0].access_revision;
  await t.cmd({
    type: "artifact.approve",
    reviewId: review.reviewId,
    expectedAccessRevision: revision,
    representSelf: true,
    nonOperative: true,
  });
  await t.cmd({
    ...doc,
    artifactId: d.artifactId,
    expectedVersion: 1,
    blocks: [{ type: "paragraph", text: "Nuova ipotesi BEGONIA" }],
  });
  let rows = await transaction((tx) => artifactContext(tx, t.w));
  expect(rows.find((r) => r.version === 1)).toMatchObject({
    current_adopted_version: 1,
    is_current_adopted_version: true,
  });
  expect(rows.find((r) => r.version === 2)).toMatchObject({
    current_adopted_version: 1,
    is_current_adopted_version: false,
  });
  await t.cmd({
    ...doc,
    artifactId: d.artifactId,
    expectedVersion: 2,
    blocks: [{ type: "paragraph", text: "Terza ipotesi CAMELIA" }],
  });
  rows = await transaction((tx) => artifactContext(tx, t.w, ["BEGONIA"]));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    version: 2,
    current_draft_version: 3,
    is_current_adopted_version: false,
  });
  const other = await setup();
  expect(
    await transaction((tx) => artifactContext(tx, other.w, ["BEGONIA"])),
  ).toEqual([]);
});
it("preserves Goal roles/adherence and selectively finds older identity versions", async () => {
  const t = await setup(),
    g = await t.cmd({
      type: "goal.establish",
      content: "Aprire un bar ABELIA",
    });
  await t.cmd({ type: "goal.adhere", goalId: g.goalId, version: 1 });
  const proposed = await t.cmd({
    type: "goal.propose",
    goalId: g.goalId,
    expectedVersion: 1,
    mode: "revise",
    content: "Aprire un cocktail bar CAMELIA",
    reason: "Evoluzione",
    preserveExistingObligations: true,
  });
  const revision = (
    await pool.query("SELECT access_revision FROM workspace WHERE id=$1", [t.w])
  ).rows[0].access_revision;
  await t.cmd({
    type: "goal.approve",
    transitionId: proposed.transitionId,
    expectedAccessRevision: revision,
    representedPersonId: t.actor,
    confirmExactContent: true,
  });
  const current = await transaction((tx) => goalContext(tx, t.w));
  expect(current).toHaveLength(1);
  expect(current[0]).toMatchObject({
    version: 2,
    current_primary: true,
    current_version: true,
    explicit_adherents: [],
  });
  const history = await transaction((tx) => goalContext(tx, t.w, ["ABELIA"]));
  expect(history[0]).toMatchObject({
    version: 1,
    current_version: false,
    explicit_adherents: [t.actor],
  });
});
it("supplies qualified, unadopted actual Contribution content and exact input provenance", async () => {
  const t = await setup();
  await t.cmd({
    type: "message.send",
    content: "Il locale Milano costa 3000 euro, dato ancora da verificare.",
  });
  const start = await t.cmd({
    type: "work.converse",
    text: "Analizza: locali Milano",
  });
  await processActiveWork(t.w, String(start.workId), fixtureAnalysis);
  const rows = await transaction((tx) =>
    activeWorkContext(tx, t.w, ["Milano"]),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].contribution.body.length).toBeGreaterThan(0);
  expect(rows[0].contribution.adopted).toBe(false);
  expect(rows[0].contribution.qualification).toContain("non adottata");
  expect(rows[0].contribution.inputs.length).toBeGreaterThan(0);
});
it("does not make another model disclosure after the inference lease is fenced by recovery", async () => {
  const t = await setup(),
    m = await t.cmd({
      type: "message.send",
      content: "Che cosa sappiamo di Milano?",
    });
  let calls = 0;
  await expect(
    processInterpretation(String(m.interpretationId), {
      async interpret() {
        calls++;
        await pool.query(
          "UPDATE interpretation SET lease_until=now()-interval '1 second' WHERE id=$1",
          [m.interpretationId],
        );
        await recoverExpiredInterpretations();
        return { proposals: [], needsMore: ["Milano"] };
      },
    }),
  ).rejects.toThrow();
  expect(calls).toBe(1);
  expect(
    (
      await pool.query("SELECT status FROM interpretation WHERE id=$1", [
        m.interpretationId,
      ])
    ).rows[0].status,
  ).toBe("queued");
  expect(
    (
      await pool.query("SELECT * FROM miriam_response WHERE workspace_id=$1", [
        t.w,
      ])
    ).rowCount,
  ).toBe(0);
});

it("serializes queued conversation in source order and carries the earlier reply into a queued later turn", async () => {
  const t = await setup(),
    first = await t.cmd({
      type: "message.send",
      content: "Miriam, confrontiamo i locali Milano",
    }),
    second = await t.cmd({
      type: "message.send",
      content: "Anche il secondo locale è a Milano",
    });
  let calls = 0;
  const responder = {
    async interpret() {
      calls++;
      return {
        proposals: [],
        needsMore: [],
        response: {
          mode: "respond" as const,
          text: "Confrontiamo il primo e il secondo.",
          sourceIds: [],
        },
      };
    },
  };
  await processInterpretation(String(second.interpretationId), responder);
  expect(calls).toBe(0);
  await processInterpretation(String(first.interpretationId), responder);
  expect(calls).toBe(1);
  await processInterpretation(String(second.interpretationId), {
    async interpret(c) {
      expect(
        c.conversation?.some(
          (v) => (v as { actor_kind: string }).actor_kind === "miriam",
        ),
      ).toBe(true);
      return { proposals: [], needsMore: [] };
    },
  });
});
