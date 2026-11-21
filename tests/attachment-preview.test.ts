import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  attachmentPreview,
  attachmentResponse,
} from "../src/server/attachment-preview";
import { attachmentPreviewSchema } from "../src/contracts/attachment-preview";

it("preserves the exact text without interpreting markup, caps long extracts and reports original size", async () => {
  const body = "<script>text only</script>🍋";
  const bytes = Buffer.from(body.repeat(1800));
  const result = attachmentPreviewSchema.parse(
    await attachmentPreview(
      "test.txt",
      "text/plain; charset=utf-8",
      bytes,
      AbortSignal.timeout(2000),
    ),
  );
  expect(result.bytes).toBe(bytes.length);
  expect(result.preview).toMatchObject({
    kind: "text",
    truncated: true,
    text: body.repeat(1800).slice(0, 16000),
  });
});
it("does not preview active image formats or arbitrary archived attachments", async () => {
  for (const type of [
    "image/svg+xml",
    "text/html",
    "application/zip",
    "audio/svg+xml",
  ]) {
    const result = await attachmentPreview(
      "x",
      type,
      Buffer.from("body"),
      AbortSignal.timeout(500),
    );
    expect(result.preview).toEqual({ kind: "unavailable", reason: "format" });
  }
});
it("serves only supported audio types inline and handles a player's byte-range requests", async () => {
  const bytes = Buffer.from("ID3abcdef");
  const headers = { "Cache-Control": "private, no-store" };
  const response = (range: string, type = "audio/mpeg") =>
    attachmentResponse(
      new Request("http://localhost/file?view=audio", {
        headers: { Range: range },
      }),
      "sound",
      type,
      bytes,
      headers,
    );
  for (const [mime, extension] of [
    ["audio/mpeg", "mp3"],
    ["audio/mp4", "m4a"],
    ["audio/wav", "wav"],
    ["audio/webm", "webm"],
    ["audio/ogg", "ogg"],
  ]) {
    const metadata = await attachmentPreview(
      "sound",
      mime,
      bytes,
      AbortSignal.timeout(1000),
    );
    expect(attachmentPreviewSchema.parse(metadata).preview).toEqual({
      kind: "audio",
      extension,
    });
  }
  for (const [range, content] of [
    ["bytes=0-1", "ID"],
    ["bytes=3-", "abcdef"],
    ["bytes=-3", "def"],
    ["bytes=8-100", "f"],
  ]) {
    const result = await response(range);
    expect(result.status).toBe(206);
    expect(result.headers.get("Content-Disposition")).toBe("inline");
    expect(result.headers.get("Cache-Control")).toBe(headers["Cache-Control"]);
    expect(await result.text()).toBe(content);
  }
  for (const range of [
    "bytes=9-",
    "bytes=4-2",
    "bytes=-0",
    "bytes=-",
    "bytes=0-1,5-",
  ]) {
    const result = await response(range);
    expect(result.status).toBe(416);
    expect(result.headers.get("Content-Range")).toBe("bytes */9");
  }
  expect((await response("bytes=0-1", "text/html")).status).toBe(415);
});
it("renders an inert first PDF page locally and reports an unreadable PDF without a download", async () => {
  const bytes = await readFile("tests/fixtures/lease.pdf");
  const result = attachmentPreviewSchema.parse(
    await attachmentPreview(
      "lease.pdf",
      "application/pdf",
      bytes,
      AbortSignal.timeout(12000),
    ),
  );
  expect(result.preview.kind).toBe("page");
  if (result.preview.kind === "page")
    expect(Buffer.from(result.preview.jpeg, "base64").subarray(0, 3)).toEqual(
      Buffer.from([255, 216, 255]),
    );
  const invalid = await attachmentPreview(
    "broken.pdf",
    "application/pdf",
    Buffer.from("%PDF-invalid"),
    AbortSignal.timeout(10000),
  );
  expect(invalid.preview.kind).toBe("unavailable");
});
it("previews DOCX text with the bounded local extractor", async () => {
  const result = await attachmentPreview(
    "lease.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    await readFile("tests/fixtures/lease.docx"),
    AbortSignal.timeout(10000),
  );
  expect(result.preview).toMatchObject({
    kind: "text",
    text: expect.stringContaining("Canone mensile"),
  });
});

it("releases the single renderer slot after an aborted request", async () => {
  const bytes = await readFile("tests/fixtures/lease.pdf");
  const open = (signal: AbortSignal) =>
    attachmentPreview("lease.pdf", "application/pdf", bytes, signal);
  const c = new AbortController();
  const inProgress = open(c.signal);
  expect((await open(AbortSignal.timeout(1000))).preview).toMatchObject({
    kind: "unavailable",
    reason: "busy",
  });
  c.abort();
  expect((await inProgress).preview.kind).toBe("unavailable");
  expect((await open(AbortSignal.timeout(10000))).preview.kind).toBe("page");
});
