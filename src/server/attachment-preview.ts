import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import type { AttachmentPreview } from "../contracts/attachment-preview.ts";
import { isSharedPhoto } from "../shared/photo-media-type.ts";
import { extractLocalDocument } from "./media-provider.ts";

const textLimit = 16000;
const inputLimit = 8 * 1024 * 1024;
let parsing = false;
function asText(value: string): AttachmentPreview["preview"] {
  return {
    kind: "text",
    text: value.slice(0, textLimit),
    truncated: value.length > textLimit,
  };
}
async function renderFirstPage(bytes: Buffer, signal: AbortSignal) {
  return new Promise<Buffer>((done, fail) => {
    const devFonts = "/opt/homebrew/etc/fonts/fonts.conf";
    const child = spawn(
      process.env.DOCUMENT_PYTHON_PATH ?? "python3",
      [resolve(process.cwd(), "scripts/render-pdf-preview.py")],
      {
        signal,
        killSignal: "SIGKILL",
        stdio: ["pipe", "pipe", "ignore"],
        env: {
          PATH: process.env.PATH,
          NODE_ENV: process.env.NODE_ENV,
          LANG: "C.UTF-8",
          PYTHONDONTWRITEBYTECODE: "1",
          ...(process.platform === "darwin" && existsSync(devFonts)
            ? { FONTCONFIG_FILE: devFonts, XDG_CACHE_HOME: tmpdir() }
            : {}),
        },
      },
    );
    const pieces: Buffer[] = [];
    let length = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > 1024 * 1024) {
        child.kill("SIGKILL");
        return;
      }
      pieces.push(chunk);
    });
    child.stdin.on("error", () => {});
    // close follows a spawn error or abort. Keep the process slot until all pipes close.
    child.on("error", () => {});
    child.on("close", (code) => {
      const image = Buffer.concat(pieces);
      if (
        !signal.aborted &&
        length <= 1024 * 1024 &&
        code === 0 &&
        image[0] === 0xff &&
        image[1] === 0xd8 &&
        image[2] === 0xff
      )
        done(image);
      else fail(new Error("PDF preview unavailable"));
    });
    child.stdin.end(bytes);
  });
}
/** Call only after the ordinary file reader authorizes this actor and exact container. */
export async function attachmentPreview(
  filename: string,
  mediaType: string,
  bytes: Buffer,
  signal: AbortSignal,
): Promise<AttachmentPreview> {
  const info = { filename, mediaType, bytes: bytes.length };
  const type = mediaType.split(";")[0].trim().toLowerCase();
  const unavailable = (
    reason: "format" | "unreadable" | "busy",
  ): AttachmentPreview => ({
    ...info,
    preview: { kind: "unavailable", reason },
  });
  if (bytes.length > inputLimit) return unavailable("unreadable");
  if (isSharedPhoto(type)) return { ...info, preview: { kind: "image" } };
  const extension = audioTypes.get(type);
  if (extension) return { ...info, preview: { kind: "audio", extension } };
  if (["text/plain", "text/markdown", "text/csv"].includes(type)) {
    // No markup, active links, HTML or embedded objects are interpreted by either client.
    return {
      ...info,
      preview: asText(bytes.subarray(0, textLimit * 4 + 4).toString("utf8")),
    };
  }
  const pdf = type === "application/pdf";
  if (
    !pdf &&
    type !==
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return unavailable("format");
  if (parsing || signal.aborted) return unavailable("busy");
  parsing = true;
  try {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(6500)]);
    if (pdf) {
      try {
        return {
          ...info,
          preview: {
            kind: "page",
            jpeg: (await renderFirstPage(bytes, bounded)).toString("base64"),
          },
        };
      } catch {
        if (bounded.aborted) return unavailable("unreadable");
      }
    }
    const extracted = await extractLocalDocument(
      {
        kind: pdf ? "pdf" : "docx",
        filename,
        mediaType,
        bytes,
        allowModelProcessing: false,
      },
      bounded,
      "preview",
    );
    return { ...info, preview: asText(extracted.text) };
  } catch {
    return unavailable("unreadable");
  } finally {
    parsing = false;
  }
}

const audioTypes = new Map<string, "mp3" | "m4a" | "wav" | "webm" | "ogg">([
  ["audio/mpeg", "mp3"],
  ["audio/mp4", "m4a"],
  ["audio/wav", "wav"],
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
]);

/** Call after the ordinary file read, including for every seek by an audio player. */
export async function attachmentResponse(
  request: Request,
  filename: string,
  mediaType: string,
  bytes: Buffer,
  headers: Record<string, string>,
) {
  const view = new URL(request.url).searchParams.get("view");
  if (view === "preview")
    return Response.json(
      await attachmentPreview(filename, mediaType, bytes, request.signal),
      { headers },
    );
  if (view !== "audio")
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...headers,
        "Content-Type": mediaType,
        "Content-Disposition":
          "attachment; filename*=UTF-8''" + encodeURIComponent(filename),
      },
    });

  const type = mediaType.split(";")[0].trim().toLowerCase();
  if (!audioTypes.has(type) || bytes.length > inputLimit)
    return new Response(null, { status: 415, headers });
  const playbackHeaders = {
    ...headers,
    "Accept-Ranges": "bytes",
    "Content-Type": type,
    "Content-Disposition": "inline",
  };
  const range = request.headers.get("range");
  if (range === null)
    return new Response(new Uint8Array(bytes), {
      headers: { ...playbackHeaders, "Content-Length": String(bytes.length) },
    });

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  const start = match?.[1]
    ? Number(match[1])
    : Math.max(0, bytes.length - Number(match?.[2]));
  const end =
    match?.[1] && match[2]
      ? Math.min(Number(match[2]), bytes.length - 1)
      : bytes.length - 1;
  if (
    !match ||
    (!match[1] && !match[2]) ||
    start > end ||
    start >= bytes.length
  )
    return new Response(null, {
      status: 416,
      headers: {
        ...playbackHeaders,
        "Content-Range": "bytes */" + bytes.length,
      },
    });
  return new Response(new Uint8Array(bytes.subarray(start, end + 1)), {
    status: 206,
    headers: {
      ...playbackHeaders,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
    },
  });
}
