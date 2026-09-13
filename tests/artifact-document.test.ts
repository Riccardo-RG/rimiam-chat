import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../src/server/db";
import { auth } from "../src/server/auth";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import { snapshot } from "../src/server/queries";
import { processActiveWork } from "../src/server/active-work-worker";
import { activeWorkView } from "../src/server/active-work-queries";
import { fixtureAnalysis } from "./support/fixture-analysis";
async function person() {
  const email = `${randomUUID()}@example.test`,
    password = "Artifact-test-only-2026!";
  const { user } = await auth.api.signUpEmail({
    body: { email, password, name: "Artifact tester" },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const login = await auth.api.signInEmail({ body: { email, password } });
  const session = (
    await pool.query("SELECT id FROM session WHERE token=$1", [login.token])
  ).rows[0].id as string;
  return { id: user.id, email, session };
}
async function setup() {
  const first = await person(),
    second = await person(),
    a = first.id,
    b = second.id,
    w = (await createWorkspace(a, "Structured artifact", randomUUID())).id;
  const cmd = (command: unknown, actor = a, key = randomUUID()) =>
    execute(
      actor,
      w,
      key,
      command,
      actor === a ? first.session : second.session,
    );
  const invitation = await cmd({
    type: "invitation.create",
    email: second.email,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(b, String(invitation.token), true);
  return { a, b, w, cmd };
}
const document = {
  type: "artifact.compose",
  title: "Piano di confronto",
  purpose: "Bozza da discutere",
  blocks: [
    { type: "heading", text: "Opzioni" },
    { type: "paragraph", text: "Ipotesi da validare insieme." },
    {
      type: "checklist",
      items: [{ text: "Visitare il locale", checked: false }],
    },
    {
      type: "table",
      columns: ["Opzione", "Costo"],
      rows: [["Milano", "Da verificare"]],
    },
  ],
  information: [],
  sourceIds: [],
  reason: "Preparazione esplicita",
  nonOperative: true,
};
afterAll(() => pool.end());
describe("Structured working artifacts", () => {
  it("creates without a Question or accepted information, versions immutable content and preserves exact governed adoption", async () => {
    const t = await setup(),
      key = randomUUID(),
      draft = await t.cmd(document, t.b, key);
    expect(await t.cmd(document, t.b, key)).toEqual(draft);
    let s = await snapshot(t.a, t.w);
    expect(s.artifactVersions[0].question_id).toBeNull();
    expect(s.artifactVersions[0].blocks).toEqual(document.blocks);
    expect(s.artifactVersions[0].outdated_reasons).toEqual([]);
    expect(s.artifacts[0].current_adoption_id).toBeNull();
    const review = await t.cmd({
      type: "artifact.review",
      artifactId: draft.artifactId,
      version: 1,
      people: [t.b],
      nonOperative: true,
    });
    const adoption = await t.cmd(
      {
        type: "artifact.approve",
        reviewId: review.reviewId,
        expectedAccessRevision: s.workspace.access_revision,
        representSelf: true,
        nonOperative: true,
      },
      t.b,
    );
    await t.cmd({
      ...document,
      artifactId: draft.artifactId,
      expectedVersion: 1,
      blocks: [
        {
          type: "paragraph",
          text: "Nuova bozza: budget massimo 100000, da discutere.",
        },
      ],
      reason: "Correzione della bozza",
    });
    s = await snapshot(t.a, t.w);
    expect(s.artifacts[0].current_adoption_id).toBe(adoption.adoptionId);
    expect(s.artifactVersions).toHaveLength(2);
    expect(s.artifactVersions[0].body).not.toContain("100000");
    expect(s.commitments).toHaveLength(0);
    expect(s.information).toHaveLength(0);
    await expect(
      t.cmd({ ...document, artifactId: draft.artifactId, expectedVersion: 1 }),
    ).rejects.toThrow("ARTIFACT_VERSION_STALE");
    await expect(
      pool.query(
        "UPDATE artifact_document SET purpose='rewrite' WHERE artifact_id=$1",
        [draft.artifactId],
      ),
    ).rejects.toThrow("immutable");
  });
  it("validates source isolation, contribution isolation, image identity and table shape without partial writes", async () => {
    const t = await setup(),
      other = await setup();
    const source = await other.cmd({
      type: "message.send",
      content: "Materiale riservato dell'altro Workspace",
    });
    for (const c of [
      { ...document, sourceIds: [source.messageId] },
      {
        ...document,
        blocks: [
          {
            type: "image",
            sourceId: source.messageId,
            alt: "Immagine",
            caption: "",
          },
        ],
      },
      { ...document, contributionId: randomUUID() },
      {
        ...document,
        blocks: [{ type: "table", columns: ["A", "B"], rows: [["Missing"]] }],
      },
    ])
      await expect(t.cmd(c)).rejects.toThrow();
    expect((await snapshot(t.a, t.w)).artifacts).toHaveLength(0);
    await t.cmd({
      type: "member.remove",
      confirmed: true,
      personId: t.b,
      expectedAccessRevision: (await snapshot(t.a, t.w)).workspace
        .access_revision,
    });
    await expect(t.cmd(document, t.b)).rejects.toThrow();
  });
  it("imports an actual persisted Contribution as a draft, retaining its source and qualification without adopting either, and blocks outdated adoption", async () => {
    const t = await setup();
    await t.cmd({
      type: "message.send",
      content: "Il locale Milano costa 3000 euro: affermazione da verificare.",
    });
    const started = await t.cmd({
        type: "work.converse",
        text: "Analizza: locali Milano",
      }),
      id = String(started.workId);
    await processActiveWork(t.w, id, fixtureAnalysis);
    const work = (await activeWorkView(t.a, t.w)).works.find(
      (x) => x.id === id,
    )!;
    expect(work.phase).toBe("completed");
    expect(work.contribution).toBeTruthy();
    const draft = await t.cmd(
      {
        type: "artifact.from_contribution",
        contributionId: work.contribution!.id,
        title: "Confronto Milano",
        purpose: "Discussione delle alternative",
        nonOperative: true,
      },
      t.b,
    );
    let s = await snapshot(t.a, t.w);
    expect(s.artifacts[0].current_adoption_id).toBeNull();
    expect(s.artifactVersions[0].contribution_id).toBe(work.contribution!.id);
    expect(s.artifactVersions[0].body).toContain(
      work.contribution!.qualification,
    );
    expect(s.artifactSources.length).toBeGreaterThan(0);
    expect(s.artifactVersions[0].outdated_reasons).toEqual([]);
    expect(s.information).toHaveLength(0);
    expect(s.commitments).toHaveLength(0);
    const r = await t.cmd({
      type: "artifact.review",
      artifactId: draft.artifactId,
      version: 1,
      people: [t.a],
      nonOperative: true,
    });
    await t.cmd({
      type: "work.converse",
      workId: id,
      expectedRevision: work.revision,
      text: "Reindirizza: consideriamo Roma e non Milano",
    });
    s = await snapshot(t.a, t.w);
    expect(s.artifactVersions[0].outdated_reasons).toContain(
      "Contribution non più corrente",
    );
    await expect(
      t.cmd({
        type: "artifact.approve",
        reviewId: r.reviewId,
        expectedAccessRevision: s.workspace.access_revision,
        representSelf: true,
        nonOperative: true,
      }),
    ).rejects.toThrow("ARTIFACT_BASIS_STALE");
    expect(
      (await activeWorkView(t.a, t.w)).works.find((x) => x.id === id)!
        .contribution!.id,
    ).toBe(work.contribution!.id);
  });
});
