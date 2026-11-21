import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { pool } from "../src/server/db";
import { createWorkspace, execute } from "../src/server/commands";
import { snapshot } from "../src/server/queries";
import { referenceDetail } from "../src/server/conversation-reference";
import { processInterpretation } from "../src/server/interpretation";
import { fixtureInterpreter } from "./support/fixture-interpreter";

afterAll(() => pool.end());

async function setup() {
  const actor = randomUUID();
  await pool.query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,$1,$2,true,now(),now(),true)',
    [actor, `${actor}@example.test`],
  );
  const w = (
    await createWorkspace(actor, "Shared source references", randomUUID())
  ).id;
  const cmd = (command: unknown) => execute(actor, w, randomUUID(), command);
  const welcome = (await snapshot(actor, w)).messages.find(
    (m) => m.actor_kind === "miriam",
  )!;
  return { actor, w, cmd, welcome };
}

it("compiles a question based on Emme's actual welcome with explicit AI provenance, without adopting it or widening normal evidence retrieval", async () => {
  const t = await setup();
  const q = await t.cmd({
    type: "question.open",
    sourceId: t.welcome.id,
    content: "Come prepariamo una beta utile?",
  });
  const human = await t.cmd({
    type: "message.send",
    content: "Il locale costa €3.000 al mese.",
  });
  await processInterpretation(
    human.interpretationId as string,
    fixtureInterpreter,
  );
  const candidate = (await snapshot(t.actor, t.w)).candidates[0];
  const accepted = await t.cmd({
    type: "information.accept",
    candidateId: candidate.id,
    descriptiveOnly: true,
  });
  const draft = await t.cmd({
    type: "artifact.draft",
    questionId: q.questionId,
    questionVersion: 1,
    information: [{ id: accepted.informationId, version: 1 }],
    sourceIds: [t.welcome.id],
    title: "Preparazione beta",
    notes: "Valutazione da discutere.",
  });
  const state = await snapshot(t.actor, t.w);
  expect(state.artifactVersions[0].body).toContain("Emme AI");
  expect(state.artifactVersions[0].body).toContain(
    "Contenuto generato da Emme",
  );
  expect(state.artifactSources).toContainEqual(
    expect.objectContaining({
      artifact_id: draft.artifactId,
      source_id: t.welcome.id,
    }),
  );
  expect(state.artifacts[0].current_adoption_id).toBeNull();
  expect(state.information).toHaveLength(1);
  expect(state.information[0].candidate_id).toBe(candidate.id);
  expect(state.commitments).toHaveLength(0);
  const detail = await referenceDetail(t.actor, t.w, {
    kind: "source",
    id: t.welcome.id,
    version: 1,
  });
  expect(detail.content).toBe(t.welcome.content);
  expect(detail.actor).toBeNull();
  expect(detail.provenance).toMatchObject({
    actorKind: "miriam",
    authorName: "Emme AI",
  });
  expect(detail.sourceIds).toEqual([t.welcome.id]);
  const artifact = await referenceDetail(t.actor, t.w, {
    kind: "artifact",
    id: draft.artifactId as string,
    version: 1,
  });
  expect(artifact.sourceIds).toContain(t.welcome.id);
  expect(
    (
      await pool.query(
        "SELECT 1 FROM workspace_source WHERE workspace_id=$1 AND id=$2",
        [t.w, t.welcome.id],
      )
    ).rowCount,
  ).toBe(0);
});

it("supports an explicit AI citation in a rich document but never admits a foreign Workspace source", async () => {
  const t = await setup(),
    other = await setup();
  const command = {
    type: "artifact.compose",
    title: "Bozza condivisa",
    purpose: "Discussione",
    blocks: [
      { type: "paragraph", text: "Un punto da verificare con il gruppo." },
    ],
    information: [],
    sourceIds: [t.welcome.id],
    reason: "Riferimento esplicito alla conversazione",
    nonOperative: true,
  };
  await t.cmd(command);
  await expect(
    t.cmd({ ...command, sourceIds: [other.welcome.id] }),
  ).rejects.toThrow("SOURCE_NOT_FOUND");
  await expect(
    referenceDetail(t.actor, t.w, {
      kind: "source",
      id: other.welcome.id,
      version: 1,
    }),
  ).rejects.toThrow("REFERENCE_NOT_FOUND");
  await expect(
    referenceDetail(other.actor, t.w, {
      kind: "source",
      id: t.welcome.id,
      version: 1,
    }),
  ).rejects.toThrow();
  const state = await snapshot(t.actor, t.w);
  expect(state.artifacts).toHaveLength(1);
  expect(state.artifacts[0].current_adoption_id).toBeNull();
});
