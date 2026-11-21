#!/bin/sh
# Exercise the actual packaged parser without credentials, a database or network.
set -eu

image=${1:?Usage: sh scripts/check-runtime-image.sh IMAGE_TAG}
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

docker run --rm -i --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,size=16m \
  --mount "type=bind,src=$root/tests/fixtures,dst=/fixtures,readonly" \
  --entrypoint node "$image" --input-type=module - <<'JS'
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { extractLocalDocument, inspectMedia } from "/app/dist/backend/server/media-provider.js";

assert.notEqual(process.getuid(), 0, "The runtime must not run as root");
const allowed = new Set([
  ".next", "dist", "migrations", "node_modules", "public", "scripts",
  "package.json", "package-lock.json", "requirements-documents.txt", "next.config.ts",
]);
for (const name of await readdir("/app"))
  assert(allowed.has(name), `Unexpected application-root entry: ${name}`);
assert.deepEqual((await readdir("/app/scripts")).sort(), [
  "extract-document.py", "render-pdf-preview.py", "render-web.sh", "render-worker.sh",
]);

for (const kind of ["pdf", "docx"]) {
  const filename = `lease.${kind}`;
  const bytes = await readFile(`/fixtures/${filename}`);
  const media = inspectMedia(filename, bytes);
  const extracted = await extractLocalDocument({
    ...media, filename, bytes, allowModelProcessing: false,
  }, AbortSignal.timeout(15_000));
  assert(extracted.text.includes("Canone mensile: 3200 euro."));
  assert(extracted.qualification.includes("Non costituisce informazione accettata"));
  assert.match(extracted.provider, kind === "pdf" ? /^pypdf\// : /^python-docx\//);
  if (kind === "docx") assert(extracted.text.includes("Durata | 12 mesi"));
}
const { attachmentPreview } = await import("/app/dist/backend/server/attachment-preview.js");
const preview=await attachmentPreview("lease.pdf","application/pdf",await readFile("/fixtures/lease.pdf"),AbortSignal.timeout(10_000));
assert.equal(preview.preview.kind,"page");
execFileSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 10_000 });
console.log("Runtime package verified: non-root, bounded PDF/DOCX extraction, provenance qualification and FFmpeg; no network.");
JS
