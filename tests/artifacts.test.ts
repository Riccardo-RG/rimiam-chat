import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../src/server/db";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import { snapshot } from "../src/server/queries";
import { processInterpretation } from "../src/server/interpretation";
import { fixtureInterpreter } from "./support/fixture-interpreter";
async function user() {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,$1,$2,true,now(),now(),true)',
    [id, `${id}@example.test`],
  );
  return id;
}
async function join(a: string, b: string, w: string) {
  const i = await execute(a, w, randomUUID(), {
    type: "invitation.create",
    email: `${b}@example.test`,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(b, i.token as string, true);
}
async function setup() {
  const a = await user(),
    b = await user(),
    c = await user(),
    w = (await createWorkspace(a, "Artifact tests", randomUUID())).id;
  await join(a, b, w);
  await join(a, c, w);
  const sent = await execute(a, w, randomUUID(), {
    type: "message.send",
    content: "Il locale costa €3.000 al mese.",
  });
  await processInterpretation(
    sent.interpretationId as string,
    fixtureInterpreter,
  );
  let state = await snapshot(a, w);
  const accepted = await execute(a, w, randomUUID(), {
    type: "information.accept",
    candidateId: state.candidates[0].id,
    descriptiveOnly: true,
  });
  const q = await execute(b, w, randomUUID(), {
    type: "question.open",
    sourceId: sent.messageId,
    content: "Quali costi dobbiamo confrontare?",
  });
  const draft = {
    type: "artifact.draft",
    questionId: q.questionId,
    questionVersion: 1,
    information: [{ id: accepted.informationId, version: 1 }],
    sourceIds: [sent.messageId],
    title: "Confronto dei costi",
    notes: "Ipotesi: valutare un locale diverso.",
  };
  state = await snapshot(a, w);
  return {
    a,
    b,
    c,
    w,
    draft,
    info: state.information[0],
    source: sent.messageId as string,
  };
}
const run = (actor: string, w: string, command: unknown) =>
  execute(actor, w, randomUUID(), command);
async function approve(actor: string, w: string, reviewId: unknown) {
  const s = await snapshot(actor, w);
  return run(actor, w, {
    type: "artifact.approve",
    reviewId,
    expectedAccessRevision: s.workspace.access_revision,
    representSelf: true,
    nonOperative: true,
  });
}
afterAll(() => pool.end());
describe("Governed research Artifact", () => {
  it("compiles real selected references, retains exact versions/provenance and immutable history, never accepts evidence or changes normative state", async () => {
    const { a, b, w, draft, info, source } = await setup();
    const key = randomUUID();
    const result = await execute(b, w, key, draft);
    expect(await execute(b, w, key, draft)).toEqual(result);
    let s = await snapshot(a, w);
    expect(s.artifacts).toHaveLength(1);
    expect(s.artifacts[0].current_adoption_id).toBeNull();
    const v = s.artifactVersions[0];
    expect(v.body).toContain("€3.000");
    expect(v.body).toContain(info.qualification);
    expect(v.provider).toBeNull();
    expect(v.generator).toBe("reference_brief_v1");
    expect(v.authored_by).toBe(b);
    expect(s.artifactInformation[0].information_version).toBe(1);
    expect(s.artifactSources.map((r) => r.source_id)).toContain(source);
    expect(s.information).toHaveLength(1);
    expect(s.commitments).toHaveLength(0);
    await expect(
      pool.query(
        "UPDATE artifact_version SET body='rewritten' WHERE artifact_id=$1",
        [result.artifactId],
      ),
    ).rejects.toThrow("immutable");
    await expect(
      run(a, w, {
        ...draft,
        type: "artifact.draft",
        effects: [{ type: "commitment.revoke" }],
      }),
    ).rejects.toThrow();
    await run(a, w, {
      ...draft,
      type: "artifact.revise",
      artifactId: result.artifactId,
      expectedVersion: 1,
      notes: "Bozza: spenderemo €100.000. Questa ipotesi non è un impegno.",
      reason: "Aggiunta di una ipotesi da valutare.",
    });
    s = await snapshot(a, w);
    expect(s.artifactVersions).toHaveLength(2);
    expect(s.artifactVersions[0].body).not.toContain("100.000");
    expect(s.commitments).toHaveLength(0);
  });
  it("requires exactly the named personal acts, not creator/access membership or universal-member agreement; adoption affects only the artifact", async () => {
    const { a, b, c, w, draft } = await setup();
    const doc = await run(b, w, draft);
    const review = await run(b, w, {
      type: "artifact.review",
      artifactId: doc.artifactId,
      version: 1,
      people: [b, c],
      nonOperative: true,
    });
    await expect(approve(a, w, review.reviewId)).rejects.toThrow(
      "NOT_A_NAMED_APPROVER",
    );
    expect((await approve(b, w, review.reviewId)).adopted).toBe(false);
    const adopted = await approve(c, w, review.reviewId);
    expect(adopted.adopted).toBe(true);
    let s = await snapshot(a, w);
    expect(s.artifacts[0].current_adoption_id).toBe(adopted.adoptionId);
    expect(s.commitments).toHaveLength(0);
    expect(s.information).toHaveLength(1);
    expect(s.artifactVersions[0].outdated_reasons).toEqual([]);
    await run(a, w, {
      ...draft,
      type: "artifact.revise",
      artifactId: doc.artifactId,
      expectedVersion: 1,
      reason: "Proposta di revisione",
      notes: "Testo diverso",
    });
    s = await snapshot(a, w);
    expect(s.artifacts[0].current_adoption_id).toBe(adopted.adoptionId);
    await expect(
      run(a, w, {
        type: "artifact.review",
        artifactId: doc.artifactId,
        version: 2,
        people: [a],
        nonOperative: true,
      }),
    ).rejects.toThrow("ARTIFACT_SCOPE_CHANGE_UNSUPPORTED");
    const next = await run(a, w, {
      type: "artifact.review",
      artifactId: doc.artifactId,
      version: 2,
      people: [b, c],
      nonOperative: true,
    });
    expect((await approve(b, w, next.reviewId)).adopted).toBe(false);
    expect((await approve(c, w, next.reviewId)).adopted).toBe(true);
    expect((await snapshot(a, w)).artifactAdoptions).toHaveLength(2);
  });
  it("fences concurrent revisions and reviews; an unrelated question does not invalidate anchored inputs", async () => {
    const { a, b, w, draft, source } = await setup();
    const doc = await run(a, w, draft);
    const review = await run(a, w, {
      type: "artifact.review",
      artifactId: doc.artifactId,
      version: 1,
      people: [a],
      nonOperative: true,
    });
    await run(a, w, {
      type: "question.open",
      sourceId: source,
      content: "Altra domanda indipendente?",
    });
    expect((await approve(a, w, review.reviewId)).adopted).toBe(true);
    const revise = {
      ...draft,
      type: "artifact.revise",
      artifactId: doc.artifactId,
      expectedVersion: 1,
      reason: "Cambio note",
    };
    const results = await Promise.allSettled([
      run(a, w, { ...revise, notes: "A" }),
      run(b, w, { ...revise, notes: "B" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await snapshot(a, w)).artifactVersions).toHaveLength(2);
    await expect(approve(a, w, review.reviewId)).rejects.toThrow(
      "ARTIFACT_VERSION_STALE",
    );
  });
  it("blocks stale information, selected documents and Goal changes without changing the old artifact", async () => {
    const { a, w, draft, info } = await setup();
    const doc = await run(a, w, draft);
    const sent = await run(a, w, {
      type: "message.send",
      content: "Il locale costa €3.500 al mese.",
    });
    await processInterpretation(
      sent.interpretationId as string,
      fixtureInterpreter,
    );
    const s = await snapshot(a, w);
    await run(a, w, {
      type: "information.correct",
      informationId: info.id,
      expectedVersion: 1,
      candidateId: s.candidates.find((c) => c.source_id === sent.messageId)!.id,
      reason: "Informazione corretta",
      descriptiveOnly: true,
    });
    await expect(
      run(a, w, {
        type: "artifact.review",
        artifactId: doc.artifactId,
        version: 1,
        people: [a],
        nonOperative: true,
      }),
    ).rejects.toThrow("ARTIFACT_BASIS_STALE");
    expect((await snapshot(a, w)).artifactVersions[0].body).toContain("€3.000");
    const upload = await run(a, w, {
      type: "document.upload",
      filename: "fonte.txt",
      bytesBase64: Buffer.from("Fonte originale").toString("base64"),
    });
    const selection = {
      ...draft,
      information: [{ id: info.id, version: 2 }],
      sourceIds: [upload.sourceId],
    };
    const doc2 = await run(a, w, selection);
    await run(a, w, {
      type: "document.upload",
      filename: "fonte.txt",
      previousSourceId: upload.sourceId,
      bytesBase64: Buffer.from("Fonte corretta").toString("base64"),
    });
    await expect(run(a, w, selection)).rejects.toThrow("ARTIFACT_SOURCE_STALE");
    expect(
      (await snapshot(a, w)).artifactVersions.find(
        (v) => v.artifact_id === doc2.artifactId,
      )!.outdated_reasons,
    ).toContain("Documento selezionato aggiornato");
    await run(a, w, { type: "goal.establish", content: "Nuovo intento" });
    expect(
      (await snapshot(a, w)).artifactVersions[0].outdated_reasons,
    ).toContain("Goal cambiato");
  });
  it("invalidates prior approvals across departure/re-entry; never silently shrinks the named set", async () => {
    const { a, b, w, draft } = await setup();
    const doc = await run(a, w, draft);
    const review = await run(a, w, {
      type: "artifact.review",
      artifactId: doc.artifactId,
      version: 1,
      people: [a, b],
      nonOperative: true,
    });
    await approve(b, w, review.reviewId);
    await run(b, w, { type: "member.leave", confirmed: true });
    await expect(approve(a, w, review.reviewId)).rejects.toThrow(
      "WORKSPACE_ACCESS_DENIED",
    );
    await join(a, b, w);
    expect((await approve(a, w, review.reviewId)).adopted).toBe(false);
    expect((await approve(b, w, review.reviewId)).adopted).toBe(true);
  });
  it("preserves effective commitments even when a brief suggests contradictory actions, and revalidates normative premises", async () => {
    const { a, w, draft } = await setup();
    const old = await run(a, w, draft);
    const message = await run(a, w, {
      type: "message.send",
      content: "Ci impegniamo a non superare il budget concordato.",
    });
    await processInterpretation(
      message.interpretationId as string,
      fixtureInterpreter,
    );
    let state = await snapshot(a, w);
    const proposal = await run(a, w, {
      type: "commitment.propose",
      candidateId: state.candidates.find(
        (c) => c.source_id === message.messageId,
      )!.id,
      people: [a],
    });
    state = await snapshot(a, w);
    await run(a, w, {
      type: "commitment.approve",
      proposalId: proposal.proposalId,
      expectedContextRevision: state.workspace.context_revision,
      expectedAccessRevision: state.workspace.access_revision,
      representSelf: true,
    });
    await expect(
      run(a, w, {
        type: "artifact.review",
        artifactId: old.artifactId,
        version: 1,
        people: [a],
        nonOperative: true,
      }),
    ).rejects.toThrow("ARTIFACT_BASIS_STALE");
    const baseline = (await snapshot(a, w)).commitments;
    const revised = await run(a, w, {
      ...draft,
      type: "artifact.revise",
      artifactId: old.artifactId,
      expectedVersion: 1,
      reason: "Scenario alternativo, soggetto a separata decisione.",
      notes:
        "Ipotesi: aumentare la spesa. Non autorizza la modifica del limite vigente.",
    });
    const review = await run(a, w, {
      type: "artifact.review",
      artifactId: revised.artifactId,
      version: 2,
      people: [a],
      nonOperative: true,
    });
    await approve(a, w, review.reviewId);
    expect((await snapshot(a, w)).commitments).toEqual(baseline);
  });
  it("enforces tenant boundaries and appends approval receipts idempotently", async () => {
    const { a, b, w, draft, source } = await setup();
    const doc = await run(a, w, draft);
    const other = (await createWorkspace(b, "Other artifact", randomUUID())).id;
    await expect(run(b, other, draft)).rejects.toThrow(
      "QUESTION_VERSION_STALE",
    );
    const foreign = await run(b, other, {
      type: "message.send",
      content: "External source",
    });
    await expect(
      run(a, w, { ...draft, sourceIds: [foreign.messageId] }),
    ).rejects.toThrow("SOURCE_NOT_FOUND");
    await expect(
      pool.query("INSERT INTO artifact_source VALUES($1,$2,1,$3,true)", [
        w,
        doc.artifactId,
        foreign.messageId,
      ]),
    ).rejects.toThrow("foreign key");
    const review = await run(a, w, {
      type: "artifact.review",
      artifactId: doc.artifactId,
      version: 1,
      people: [a],
      nonOperative: true,
    });
    const state = await snapshot(a, w);
    const cmd = {
      type: "artifact.approve",
      reviewId: review.reviewId,
      expectedAccessRevision: state.workspace.access_revision,
      representSelf: true,
      nonOperative: true,
    };
    const key = randomUUID();
    const first = await execute(a, w, key, cmd);
    expect(await execute(a, w, key, cmd)).toEqual(first);
    expect((await snapshot(a, w)).artifactApprovals).toHaveLength(1);
    expect(source).toBeTruthy();
  });
});
