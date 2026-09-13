import { randomUUID, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { pool } from "../src/server/db";
import {
  createWorkspace,
  execute,
  acceptInvitation,
} from "../src/server/commands";
import { snapshot } from "../src/server/queries";
import { readDocument } from "../src/server/sources";
import { processDocument, recoverDocuments } from "../src/server/media-worker";
import {
  configuredMediaExtractor,
  extractLocalDocument,
  inspectMedia,
  openAITranscriber,
  type MediaExtractor,
} from "../src/server/media-provider";
import { retrieveSources } from "../src/server/interpretation";

afterAll(() => pool.end());
afterEach(() => vi.unstubAllEnvs());
async function human() {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt",eligible) VALUES($1,$2,$3,true,now(),now(),true)',
    [id, "Media contributor", `${id}@example.test`],
  );
  return id;
}
async function setup() {
  const a = await human(),
    b = await human(),
    w = (await createWorkspace(a, "Media test", randomUUID())).id;
  return { a, b, w };
}
async function join(a: string, b: string, w: string) {
  const i = await execute(a, w, randomUUID(), {
    type: "invitation.create",
    email: `${b}@example.test`,
    fullHistoryDisclosed: true,
  });
  await acceptInvitation(b, i.token as string, true);
}
const pdf = readFileSync(new URL("./fixtures/lease.pdf", import.meta.url));
const docx = readFileSync(new URL("./fixtures/lease.docx", import.meta.url));
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const wav = Buffer.from("RIFF....WAVEfixture");
const upload = (
  a: string,
  w: string,
  filename = "lease.pdf",
  bytes = pdf,
  extra: Record<string, unknown> = {},
) =>
  execute(a, w, randomUUID(), {
    type: "document.upload",
    filename,
    bytesBase64: bytes.toString("base64"),
    ...extra,
  });
const result = {
  text: "Canone mensile: 3200 euro.",
  qualification: "Test extraction, unverified.",
  provider: "test-only",
};
const extractor: MediaExtractor = {
  async extract() {
    return result;
  },
};
const processing = async (id: string) =>
  (
    await pool.query("SELECT * FROM document_processing WHERE source_id=$1", [
      id,
    ])
  ).rows[0];

describe("rich input originals and bounded extraction", () => {
  it("extracts genuine PDF and DOCX locally with maintained parsers, keeping source qualifications", async () => {
    for (const [kind, bytes] of [
      ["pdf", pdf],
      ["docx", docx],
    ] as const) {
      const text = await extractLocalDocument(
        {
          kind,
          bytes,
          filename: `lease.${kind}`,
          mediaType: inspectMedia(`lease.${kind}`, bytes)!.mediaType,
          allowModelProcessing: false,
        },
        AbortSignal.timeout(10000),
      );
      expect(text.text).toContain("Canone mensile: 3200 euro.");
      expect(text.qualification).toContain(
        "Non costituisce informazione accettata",
      );
      expect(text.provider).toMatch(
        kind === "pdf" ? /^pypdf\// : /^python-docx\//,
      );
      if (kind === "docx") expect(text.text).toContain("Durata | 12 mesi");
    }
  });
  it("keeps exact original immediately, publishes only validated extraction and never adopts claims", async () => {
    const { a, b, w } = await setup();
    const first = await upload(a, w),
      id = first.sourceId as string;
    expect((await snapshot(a, w)).sources[0]).toMatchObject({
      id,
      content: "",
      processing_status: "queued",
    });
    expect(await retrieveSources(w, ["Canone"])).toHaveLength(0);
    expect((await readDocument(a, w, id)).original_bytes).toEqual(pdf);
    await expect(readDocument(b, w, id)).rejects.toThrow(
      "WORKSPACE_ACCESS_DENIED",
    );
    const local = vi.fn(configuredMediaExtractor().extract);
    await processDocument(id, { extract: local });
    await processDocument(id, { extract: local });
    expect(local).toHaveBeenCalledTimes(1);
    const s = await snapshot(a, w);
    expect(s.sources[0]).toMatchObject({
      processing_status: "ready",
      content_hash: createHash("sha256").update(pdf).digest("hex"),
    });
    expect(s.sources[0].content).toContain("Canone mensile");
    expect(s.sources[0].extraction_provider).toMatch(/^pypdf\//);
    expect(s.sources[0].qualification).toContain("non verificato");
    expect(s.sources[0].qualification).toContain("Estrazione testuale locale");
    expect(s.information).toHaveLength(0);
    expect(s.commitments).toHaveLength(0);
    expect((await retrieveSources(w, ["Canone"])).map((v) => v.id)).toContain(
      id,
    );
    await join(a, b, w);
    expect((await readDocument(b, w, id)).original_bytes).toEqual(pdf);
    await expect(
      pool.query(
        "UPDATE document_extraction SET content='rewritten' WHERE source_id=$1",
        [id],
      ),
    ).rejects.toThrow("immutable");
    const second = await upload(b, w, "lease.docx", docx, {
      previousSourceId: id,
    });
    expect(second.documentId).toBe(first.documentId);
    expect(second.version).toBe(2);
    await expect(
      upload(a, w, "lease.pdf", pdf, { previousSourceId: id }),
    ).rejects.toThrow("DOCUMENT_VERSION_STALE");
    expect((await readDocument(a, w, id)).original_bytes).toEqual(pdf);
  });
  it("requires explicit media disclosure, reports missing configuration honestly and preserves retry provenance", async () => {
    const { a, b, w } = await setup();
    const id = (await upload(a, w, "image.png", png)).sourceId as string;
    await processDocument(id);
    expect(await processing(id)).toMatchObject({
      status: "needs_input",
      error_code: "MEDIA_DISCLOSURE_REQUIRED",
    });
    await expect(
      execute(a, w, randomUUID(), { type: "document.retry", sourceId: id }),
    ).rejects.toThrow("MEDIA_DISCLOSURE_REQUIRED");
    await join(a, b, w);
    await execute(b, w, randomUUID(), {
      type: "document.retry",
      sourceId: id,
      allowModelProcessing: true,
    });
    vi.stubEnv("AI_MODE", "disabled");
    await processDocument(id);
    expect(await processing(id)).toMatchObject({
      status: "needs_configuration",
      error_code: "AI_CONFIGURATION_REQUIRED",
      requested_by: b,
    });
    expect((await snapshot(a, w)).sources[0].content).toBe("");
    const history = (await snapshot(a, w)).sources[0].processing_history;
    expect(history.map((e: { kind: string }) => e.kind)).toEqual([
      "started",
      "failed",
      "retry_requested",
      "started",
      "failed",
    ]);
    expect(
      history
        .filter((e: { kind: string }) => e.kind === "failed")
        .map((e: { error_code: string }) => e.error_code),
    ).toEqual(["MEDIA_DISCLOSURE_REQUIRED", "AI_CONFIGURATION_REQUIRED"]);
    await expect(
      pool.query("DELETE FROM document_processing_event WHERE source_id=$1", [
        id,
      ]),
    ).rejects.toThrow("immutable");
    expect(await retrieveSources(w, ["image"])).toHaveLength(0);
    expect(
      (
        await pool.query(
          "SELECT requested_by,allow_model_processing FROM document_extraction_attempt WHERE source_id=$1 ORDER BY created_at",
          [id],
        )
      ).rows,
    ).toEqual([
      { requested_by: a, allow_model_processing: false },
      { requested_by: b, allow_model_processing: true },
    ]);
    vi.stubEnv("TRANSCRIPTION_PROVIDER", "");
    const voice = (
      await upload(a, w, "voice.wav", wav, { allowModelProcessing: true })
    ).sourceId as string;
    await processDocument(voice);
    expect(await processing(voice)).toMatchObject({
      status: "needs_configuration",
      error_code: "TRANSCRIPTION_CONFIGURATION_REQUIRED",
    });
  });
  it("rejects invalid structured output and unavailable/parser failures without inventing text", async () => {
    const { a, w } = await setup();
    const id = (await upload(a, w)).sourceId as string;
    await processDocument(id, {
      async extract() {
        return { ...result, text: "", authority: "all" };
      },
    });
    expect(await processing(id)).toMatchObject({
      status: "failed",
      error_code: "DOCUMENT_EXTRACTION_FAILED",
    });
    expect(
      (
        await pool.query(
          "SELECT * FROM document_extraction WHERE source_id=$1",
          [id],
        )
      ).rowCount,
    ).toBe(0);
    await execute(a, w, randomUUID(), { type: "document.retry", sourceId: id });
    vi.stubEnv("DOCUMENT_PYTHON_PATH", "/nonexistent/miriam-python");
    await processDocument(id);
    expect(await processing(id)).toMatchObject({
      status: "needs_configuration",
      error_code: "DOCUMENT_PARSER_CONFIGURATION_REQUIRED",
    });
    expect(() => inspectMedia("forged.pdf", Buffer.from("not pdf"))).toThrow(
      "DOCUMENT_FORMAT_INVALID",
    );
  });
  it("fences concurrent deliveries and stale recovery results while preserving old evidence", async () => {
    const { a, w } = await setup();
    const id = (await upload(a, w)).sourceId as string;
    let release!: (x: unknown) => void;
    let began!: () => void;
    const claimed = new Promise<void>((r) => (began = r));
    const pending = processDocument(id, {
      async extract() {
        began();
        return new Promise((r) => (release = r));
      },
    });
    await claimed;
    const duplicate = vi.fn(extractor.extract);
    await processDocument(id, { extract: duplicate });
    expect(duplicate).not.toHaveBeenCalled();
    await pool.query(
      "UPDATE document_processing SET lease_until=now()-interval '1 second' WHERE source_id=$1",
      [id],
    );
    await recoverDocuments();
    await processDocument(id, {
      async extract() {
        return { ...result, text: "Current result" };
      },
    });
    release({ ...result, text: "Stale result" });
    await pending;
    expect((await snapshot(a, w)).sources[0].content).toBe("Current result");
    expect(
      (
        await pool.query(
          "SELECT publication FROM document_extraction WHERE source_id=$1 ORDER BY publication",
          [id],
        )
      ).rows.map((r) => r.publication),
    ).toEqual(["published", "superseded"]);
    expect(
      (
        await pool.query("SELECT * FROM interpretation WHERE source_id=$1", [
          id,
        ])
      ).rowCount,
    ).toBe(1);
  });
  it("cannot publish after ended eligibility, reentry or cross-Workspace retry", async () => {
    const { a, b, w } = await setup();
    await join(a, b, w);
    const id = (await upload(b, w)).sourceId as string;
    let release!: (x: unknown) => void;
    let began!: () => void;
    const claimed = new Promise<void>((r) => (began = r));
    const pending = processDocument(id, {
      async extract() {
        began();
        return new Promise((r) => (release = r));
      },
    });
    await claimed;
    await execute(b, w, randomUUID(), {
      type: "member.leave",
      confirmed: true,
    });
    await join(a, b, w);
    release(result);
    await pending;
    expect(await processing(id)).toMatchObject({
      status: "failed",
      error_code: "DOCUMENT_ACCESS_CHANGED",
    });
    expect(
      (
        await pool.query(
          "SELECT publication FROM document_extraction WHERE source_id=$1",
          [id],
        )
      ).rows[0].publication,
    ).toBe("access_ended");
    const other = (await createWorkspace(b, "Other", randomUUID())).id;
    await expect(
      execute(b, other, randomUUID(), { type: "document.retry", sourceId: id }),
    ).rejects.toThrow("DOCUMENT_NOT_RETRYABLE");
    await execute(b, w, randomUUID(), { type: "document.retry", sourceId: id });
    await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [b]);
    const attempt = vi.fn(extractor.extract);
    await processDocument(id, { extract: attempt });
    expect(attempt).not.toHaveBeenCalled();
    expect(await processing(id)).toMatchObject({
      status: "failed",
      error_code: "DOCUMENT_ACCESS_CHANGED",
    });
  });
});

describe("real transcription adapter with deterministic HTTP only", () => {
  it("sends only the explicitly disclosed original, preserves uncertainty and rejects unsupported output", async () => {
    const input = {
      kind: "audio" as const,
      filename: "voice.wav",
      mediaType: "audio/wav",
      bytes: wav,
      allowModelProcessing: true,
    };
    const http = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe(
        "https://api.openai.com/v1/audio/transcriptions",
      );
      expect(init?.redirect).toBe("error");
      const form = init?.body as FormData;
      expect([...form.keys()].sort()).toEqual([
        "file",
        "model",
        "response_format",
      ]);
      expect(form.get("model")).toBe("explicit-model");
      expect(
        Buffer.from(await (form.get("file") as File).arrayBuffer()),
      ).toEqual(wav);
      return Response.json({
        text: "Riccardo dice che il budget è ottantamila euro.",
      });
    });
    const adapter = openAITranscriber("test-only", "explicit-model", http),
      value = (await adapter.extract(
        input,
        AbortSignal.timeout(2000),
      )) as typeof result;
    expect(value.qualification).toContain("non è necessariamente chi parla");
    expect(value.provider).toBe("openai-transcription/explicit-model");
    await expect(
      adapter.extract(
        { ...input, allowModelProcessing: false },
        AbortSignal.timeout(2000),
      ),
    ).rejects.toThrow("MEDIA_DISCLOSURE_REQUIRED");
    expect(http).toHaveBeenCalledTimes(1);
    await expect(
      openAITranscriber("test", "model", async () =>
        Response.json({ text: "" }),
      ).extract(input, AbortSignal.timeout(2000)),
    ).rejects.toThrow();
    await expect(
      openAITranscriber("test", "model", async () =>
        Response.json({}, { status: 429 }),
      ).extract(input, AbortSignal.timeout(2000)),
    ).rejects.toThrow("TRANSCRIPTION_RATE_LIMITED");
  });
});
