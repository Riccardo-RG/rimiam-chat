import { randomUUID } from "node:crypto";
import { afterAll, expect, it, vi } from "vitest";
import {
  createWorkspace,
  openPersonalSpace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import { emailAttachments } from "../src/server/email-state";
import type { EmailEnvelope } from "../src/contracts/email";
import { readDocument, uploadDocument } from "../src/server/sources";
import { referenceDetail } from "../src/server/conversation-reference";
import { snapshot } from "../src/server/queries";
import { pool, transaction } from "../src/server/db";
import { processDocument } from "../src/server/media-worker";
import {
  processInterpretation,
  retrieveSources,
} from "../src/server/interpretation";
import { fixtureInterpreter } from "./support/fixture-interpreter";

afterAll(() => pool.end());

async function person() {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,$1,$2,true,now(),now(),true)',
    [id, id + "@example.test"],
  );
  return id;
}
const command = (actor: string, workspace: string, input: unknown) =>
  execute(actor, workspace, randomUUID(), input);
const uploadInput = {
  type: "document.upload" as const,
  filename: "Preventivo.txt",
  bytesBase64: Buffer.from("Il locale costa €3.200 al mese.").toString(
    "base64",
  ),
};
function visibility(
  sourceId: string,
  expectedVisibilityVersion: number,
  type: "document.withdraw" | "document.restore" = "document.withdraw",
) {
  return { type, sourceId, documentVersion: 1, expectedVisibilityVersion };
}

it("preserves the author's exact reversible withdrawal, provenance and previously accepted state", async () => {
  const owner = await person(),
    author = await person(),
    w = (await createWorkspace(owner, "Preventivi", randomUUID())).id;
  const i = await command(owner, w, {
    type: "invitation.create",
    email: author + "@example.test",
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(author, i.token as string, true);
  const original = await command(author, w, {
    ...uploadInput,
    conversationShare: {},
  });
  const sourceId = String(original.sourceId),
    ref = { kind: "source" as const, id: sourceId, version: 1 };
  expect((await snapshot(owner, w)).sources[0].can_manage_visibility).toBe(
    false,
  );
  expect((await snapshot(author, w)).sources[0].can_manage_visibility).toBe(
    true,
  );
  await processInterpretation(
    original.interpretationId as string,
    fixtureInterpreter,
  );
  const candidate = (await snapshot(owner, w)).candidates[0];
  await command(owner, w, {
    type: "information.accept",
    candidateId: candidate.id,
    descriptiveOnly: true,
  });
  await expect(command(owner, w, visibility(sourceId, 1))).rejects.toThrow(
    "DOCUMENT_VISIBILITY_DENIED",
  );
  const other = (await createWorkspace(author, "Altro spazio", randomUUID()))
    .id;
  await expect(command(author, other, visibility(sourceId, 1))).rejects.toThrow(
    "DOCUMENT_VISIBILITY_DENIED",
  );
  await expect(
    command(author, w, { ...visibility(sourceId, 1), documentVersion: 2 }),
  ).rejects.toThrow("DOCUMENT_VISIBILITY_STALE");
  const receipt = randomUUID(),
    action = visibility(sourceId, 1);
  const [first, replay] = await Promise.all([
    execute(author, w, receipt, action),
    execute(author, w, receipt, action),
  ]);
  expect(replay).toEqual(first);
  expect(first).toMatchObject({ visibilityVersion: 2, withdrawn: true });
  await expect(command(author, w, action)).rejects.toThrow(
    "DOCUMENT_VISIBILITY_STALE",
  );
  const visible = await snapshot(owner, w);
  expect(visible.sources[0]).toMatchObject({
    id: sourceId,
    shared_message_id: original.messageId,
    withdrawn: true,
    visibility_version: 2,
    content: "",
  });
  expect(visible.candidates[0]).toMatchObject({
    id: candidate.id,
    source_ids: [sourceId],
    source_content: "",
  });
  expect(visible.information[0].content).toContain("3.200");
  const derived = await command(owner, w, {
    type: "artifact.compose",
    title: "Preventivo",
    purpose: "Consultazione",
    blocks: [
      { type: "paragraph", text: "Riepilogo del riferimento accettato." },
    ],
    information: [
      {
        id: visible.information[0].id,
        version: visible.information[0].current_version,
      },
    ],
    sourceIds: [],
    reason: "Riferimento redazionale",
    nonOperative: true,
  });
  expect(derived.artifactId).toBeTruthy();
  await expect(readDocument(author, w, sourceId)).rejects.toThrow(
    "SOURCE_NOT_FOUND",
  );
  expect(await retrieveSources(w, [sourceId])).toHaveLength(0);
  const evidence = await referenceDetail(owner, w, {
    ...ref,
    eventId: "source:" + sourceId + ":1",
  });
  expect(evidence).toMatchObject({
    content: "",
    current: false,
    provenance: { withdrawn: true },
    sourceIds: [sourceId],
  });
  await expect(
    command(author, w, { ...uploadInput, previousSourceId: sourceId }),
  ).rejects.toThrow("DOCUMENT_VERSION_STALE");
  await expect(
    command(owner, w, {
      type: "interpretation.retry",
      interpretationId: original.interpretationId,
    }),
  ).rejects.toThrow("DOCUMENT_WITHDRAWN");
  const restored = await command(
    author,
    w,
    visibility(sourceId, 2, "document.restore"),
  );
  expect(restored).toMatchObject({ withdrawn: false, visibilityVersion: 3 });
  expect(
    (await readDocument(owner, w, sourceId)).original_bytes.toString("base64"),
  ).toBe(uploadInput.bytesBase64);
  expect((await referenceDetail(owner, w, ref)).content).toContain("3.200");
  const events = (
    await pool.query(
      "SELECT version,withdrawn,actor_id FROM document_visibility_event WHERE source_id=$1 ORDER BY version",
      [sourceId],
    )
  ).rows;
  expect(events.map((e) => [e.version, e.withdrawn, e.actor_id])).toEqual([
    [1, false, author],
    [2, true, author],
    [3, false, author],
  ]);
  const ended = await command(author, w, {
    type: "member.leave",
    confirmed: true,
  });
  expect(ended).toBeDefined();
  await expect(execute(author, w, receipt, action)).rejects.toThrow(
    "WORKSPACE_ACCESS_DENIED",
  );
});

it("fences processing and discards a late extraction even after restoration", async () => {
  const author = await person(),
    w = (await createWorkspace(author, "Allegati", randomUUID())).id;
  await command(author, w, {
    type: "message.send",
    content: "Ecco le immagini",
    attachments: [
      {
        filename: "presentazione.png",
        bytesBase64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString(
          "base64",
        ),
        allowModelProcessing: true,
      },
    ],
  });
  const source = (await snapshot(author, w)).sources[0],
    id = source.id;
  expect(source.can_manage_visibility).toBe(true);
  let began!: () => void, release!: (v: unknown) => void;
  const started = new Promise<void>((r) => {
    began = r;
  });
  const running = processDocument(id, {
    async extract() {
      began();
      return new Promise((r) => {
        release = r;
      });
    },
  });
  await started;
  await command(author, w, visibility(id, 1));
  await expect(
    command(author, w, {
      type: "document.retry",
      sourceId: id,
      allowModelProcessing: true,
    }),
  ).rejects.toThrow("DOCUMENT_WITHDRAWN");
  const extractor = {
    extract: vi.fn(async () => ({
      text: "Descrizione aggiornata",
      provider: "test",
      qualification: "Descrizione di prova.",
    })),
  };
  await processDocument(id, extractor);
  expect(extractor.extract).not.toHaveBeenCalled();
  await command(author, w, visibility(id, 2, "document.restore"));
  release({
    text: "Risultato ritirato",
    provider: "test",
    qualification: "Descrizione di prova.",
  });
  await running;
  expect(
    (
      await pool.query("SELECT * FROM document_extraction WHERE source_id=$1", [
        id,
      ])
    ).rows,
  ).toHaveLength(0);
  await command(author, w, {
    type: "document.retry",
    sourceId: id,
    allowModelProcessing: true,
  });
  await processDocument(id, extractor);
  expect((await snapshot(author, w)).sources[0].content).toBe(
    "Descrizione aggiornata",
  );
});

it("never grants upload authority to a managed source just because its contributor matches", async () => {
  const a = await person(),
    w = (await createWorkspace(a, "Fonti", randomUUID())).id;
  const original = await transaction((tx) =>
    uploadDocument(
      tx,
      w,
      a,
      uploadInput,
      "Materiale da un altro flusso governato.",
      false,
    ),
  );
  expect((await snapshot(a, w)).sources[0].can_manage_visibility).toBe(false);
  await expect(command(a, w, visibility(original.sourceId, 1))).rejects.toThrow(
    "DOCUMENT_VISIBILITY_DENIED",
  );
});

it("blocks new copies, document composition and email attachments while preserving an earlier independent copy and a private restore", async () => {
  const a = await person(),
    session = randomUUID(),
    w = (await createWorkspace(a, "Disegni", randomUUID())).id;
  await pool.query(
    'INSERT INTO session(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES($1,$2,$3,now()+interval \'1 day\',now(),now())',
    [session, randomUUID(), a],
  );
  const personal = (await openPersonalSpace(a, session)).id;
  const exec = (space: string, input: unknown) =>
    execute(a, space, randomUUID(), input, session);
  const original = await exec(w, uploadInput),
    id = String(original.sourceId);
  const { sources } = await snapshot(a, w);
  const source = sources.find((s) => s.id === id)!;
  const e: EmailEnvelope = {
    kind: "new",
    sender: "author@example.test",
    to: ["peer@example.test"],
    cc: [],
    bcc: [],
    subject: "File",
    body: "Documento",
    target: null,
    attachments: [
      {
        kind: "workspace_source",
        id,
        filename: uploadInput.filename,
        hash: source.content_hash,
        version: 1,
      },
    ],
  };
  const readMail = () => transaction((tx) => emailAttachments(tx, w, a, e));
  expect((await readMail())[0].bytes.toString("base64")).toBe(
    uploadInput.bytesBase64,
  );
  const copy = { type: "library.copy", destinationId: personal, sourceId: id };
  const independent = await exec(w, copy);
  await exec(w, visibility(id, 1));
  await expect(exec(w, copy)).rejects.toThrow("SOURCE_NOT_FOUND");
  await expect(readMail()).rejects.toThrow("EMAIL_ATTACHMENT_STALE_OR_DENIED");
  await expect(
    exec(w, {
      type: "artifact.compose",
      title: "Riepilogo",
      purpose: "Consultazione",
      blocks: [{ type: "paragraph", text: "Bozza." }],
      sourceIds: [id],
      information: [],
      reason: "Confronto",
      nonOperative: true,
    }),
  ).rejects.toThrow("SOURCE_NOT_FOUND");
  expect(
    (
      await readDocument(a, personal, String(independent.sourceId))
    ).original_bytes.toString("base64"),
  ).toBe(uploadInput.bytesBase64);
  const peer = await person();
  const invitation = await command(a, w, {
    type: "invitation.create",
    email: peer + "@example.test",
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(peer, String(invitation.token), true);
  const published = await exec(personal, {
    type: "library.copy",
    sourceId: independent.sourceId,
    destinationId: w,
  });
  const publishedId = String(published.sourceId);
  const copyView = async (actor: string) =>
    (await snapshot(actor, w)).sources.find((s) => s.id === publishedId);
  expect((await copyView(a))?.can_manage_visibility).toBe(true);
  expect((await copyView(peer))?.can_manage_visibility).toBe(false);
  await expect(command(peer, w, visibility(publishedId, 1))).rejects.toThrow(
    "DOCUMENT_VISIBILITY_DENIED",
  );
  await exec(w, visibility(publishedId, 1));
  await expect(readDocument(peer, w, publishedId)).rejects.toThrow(
    "SOURCE_NOT_FOUND",
  );
  expect(
    (
      await readDocument(a, personal, String(independent.sourceId))
    ).original_bytes.toString("base64"),
  ).toBe(uploadInput.bytesBase64);
  await exec(w, visibility(publishedId, 2, "document.restore"));
  expect(
    (await readDocument(peer, w, publishedId)).original_bytes.toString(
      "base64",
    ),
  ).toBe(uploadInput.bytesBase64);
  await expect(readDocument(a, w, id)).rejects.toThrow("SOURCE_NOT_FOUND");
  const privateFile = await exec(personal, uploadInput),
    privateId = String(privateFile.sourceId);
  await exec(personal, visibility(privateId, 1));
  await expect(readDocument(a, personal, privateId)).rejects.toThrow(
    "SOURCE_NOT_FOUND",
  );
  await exec(personal, visibility(privateId, 2, "document.restore"));
  expect(
    (await readDocument(a, personal, privateId)).original_bytes.toString(
      "base64",
    ),
  ).toBe(uploadInput.bytesBase64);
});

it("discards late model results for a withdrawn input even when its bytes have already been restored", async () => {
  const a = await person(),
    w = (await createWorkspace(a, "Analisi", randomUUID())).id;
  const upload = await command(a, w, uploadInput),
    id = String(upload.sourceId);
  let start!: () => void, finish!: () => void;
  const began = new Promise<void>((r) => {
    start = r;
  });
  const gate = new Promise<void>((r) => {
    finish = r;
  });
  const running = processInterpretation(String(upload.interpretationId), {
    async interpret(context, scope) {
      start();
      await gate;
      return fixtureInterpreter.interpret(context, scope);
    },
  });
  await began;
  await command(a, w, visibility(id, 1));
  await command(a, w, visibility(id, 2, "document.restore"));
  finish();
  await expect(running).rejects.toThrow("DOCUMENT_WITHDRAWN");
  expect(
    (
      await pool.query(
        "SELECT 1 FROM interpretation_result WHERE interpretation_id=$1",
        [upload.interpretationId],
      )
    ).rowCount,
  ).toBe(0);
  expect((await snapshot(a, w)).candidates).toHaveLength(0);
});
