import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { spawn } from "node:child_process";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { pool, transaction, type Tx } from "./db.ts";
import { member, lockWorkspace } from "./workspace-state.ts";
import { requireThat, DomainError } from "./errors.ts";
import {
  configuredMediaExtractor,
  extractionSchema,
  type MediaExtractor,
} from "./media-provider.ts";
import { callEvent } from "./calls.ts";
import { uploadDocument } from "./sources.ts";
import { createActiveWork } from "./active-work-commands.ts";

function store() {
  requireThat(
    process.env.CALL_STORAGE_BUCKET &&
      process.env.CALL_STORAGE_ACCESS_KEY &&
      process.env.CALL_STORAGE_SECRET_KEY &&
      process.env.CALL_STORAGE_REGION,
    "CALL_STORAGE_CONFIGURATION_REQUIRED",
    503,
  );
  return new S3Client({
    region: process.env.CALL_STORAGE_REGION,
    endpoint: process.env.CALL_STORAGE_ENDPOINT || undefined,
    forcePathStyle: process.env.CALL_STORAGE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.CALL_STORAGE_ACCESS_KEY,
      secretAccessKey: process.env.CALL_STORAGE_SECRET_KEY,
    },
  });
}
async function object(key: string, range?: string, version?: string) {
  return store().send(
    new GetObjectCommand({
      Bucket: process.env.CALL_STORAGE_BUCKET!,
      Key: key,
      Range: range,
      VersionId: version,
    }),
    { abortSignal: AbortSignal.timeout(60000) },
  );
}
export async function callAudio(
  actor: string,
  w: string,
  id: string,
  range?: string | null,
) {
  requireThat(!range || /^bytes=\d*-\d*$/.test(range), "INVALID_RANGE", 416);
  const row = await transaction(async (tx) => {
    await member(tx, w, actor);
    const r = (
      await tx.query(
        "SELECT r.object_key,s.object_version FROM call_recording r JOIN call_recording_source s ON s.recording_id=r.id WHERE r.workspace_id=$1 AND r.id=$2 AND r.state='complete'",
        [w, id],
      )
    ).rows[0];
    requireThat(r, "CALL_AUDIO_NOT_AVAILABLE", 404);
    return r;
  });
  const result = await object(
    row.object_key,
    range ?? undefined,
    row.object_version,
  );
  requireThat(result.Body, "CALL_AUDIO_NOT_AVAILABLE", 404);
  return new Response(result.Body.transformToWebStream(), {
    status: result.ContentRange ? 206 : 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, no-store",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "X-Miriam-API-Version": "1",
      ...(result.ContentLength !== undefined
        ? { "Content-Length": String(result.ContentLength) }
        : {}),
      ...(result.ContentRange ? { "Content-Range": result.ContentRange } : {}),
    },
  });
}
async function audioChunks(key: string, directory: string) {
  const known = (
    await pool.query(
      "SELECT s.* FROM call_recording_source s JOIN call_recording r ON r.id=s.recording_id WHERE r.object_key=$1",
      [key],
    )
  ).rows[0];
  const response = await object(key, undefined, known?.object_version);
  requireThat(
    response.VersionId && response.VersionId !== "null",
    "CALL_STORAGE_VERSIONING_REQUIRED",
    503,
  );
  requireThat(response.Body, "CALL_AUDIO_NOT_AVAILABLE", 404);
  const maximum = Number(process.env.CALL_RECORDING_MAX_BYTES ?? 536870912);
  requireThat(
    Number.isSafeInteger(maximum) && maximum > 0,
    "CALL_STORAGE_CONFIGURATION_REQUIRED",
    503,
  );
  let size = 0;
  const hash = createHash("sha256");
  const limiter = new Transform({
    transform(chunk, _, cb) {
      size += chunk.length;
      hash.update(chunk);
      cb(
        size > maximum
          ? new DomainError("CALL_RECORDING_TOO_LARGE", 413)
          : null,
        chunk,
      );
    },
  });
  await pipeline(
    Readable.fromWeb(
      response.Body.transformToWebStream() as import("node:stream/web").ReadableStream,
    ),
    limiter,
    createWriteStream(join(directory, "original.mp3")),
    { signal: AbortSignal.timeout(300000) },
  );
  const digest = hash.digest("hex");
  if (known)
    requireThat(
      known.sha256 === digest && Number(known.byte_length) === size,
      "CALL_RECORDING_INTEGRITY_FAILED",
      409,
    );
  else
    await pool.query(
      "INSERT INTO call_recording_source(recording_id,object_version,byte_length,sha256) SELECT id,$2,$3,$4 FROM call_recording WHERE object_key=$1 ON CONFLICT DO NOTHING",
      [key, response.VersionId, size, digest],
    );
  await new Promise<void>((resolve, reject) => {
    const p = spawn(
      process.env.FFMPEG_PATH ?? "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-i",
        join(directory, "original.mp3"),
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "32k",
        "-f",
        "segment",
        "-segment_time",
        "300",
        join(directory, "part-%06d.mp3"),
      ],
      { stdio: "ignore", signal: AbortSignal.timeout(300000) },
    );
    p.once("error", () =>
      reject(
        new DomainError("CALL_AUDIO_PROCESSOR_CONFIGURATION_REQUIRED", 503),
      ),
    );
    p.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new DomainError("CALL_AUDIO_PROCESSING_FAILED", 502)),
    );
  });
  return (await readdir(directory)).filter((f) => f.startsWith("part-")).sort();
}
export async function transcribeCallRecording(
  id: string,
  extractor: MediaExtractor = configuredMediaExtractor(),
  prepare = audioChunks,
) {
  const claim = await transaction(async (tx) => {
    const r = (
      await tx.query(
        "SELECT r.*,t.status FROM call_recording r JOIN call_transcription t ON t.recording_id=r.id WHERE r.id=$1",
        [id],
      )
    ).rows[0];
    if (!r || r.status !== "queued") return null;
    await lockWorkspace(tx, r.workspace_id);
    const attempt = randomUUID();
    const updated = await tx.query(
      "UPDATE call_transcription SET status='processing',attempt_id=$2,lease_until=now()+interval '10 minutes',error_code=NULL WHERE recording_id=$1 AND status='queued' RETURNING recording_id",
      [id, attempt],
    );
    return updated.rowCount ? { ...r, attempt } : null;
  });
  if (!claim) return;
  const directory = await mkdtemp(join(tmpdir(), "miriam-call-"));
  try {
    const files = await prepare(claim.object_key, directory);
    requireThat(files.length, "CALL_AUDIO_EMPTY", 422);
    for (const [ordinal, file] of files.entries()) {
      const bytes = await readFile(join(directory, file)),
        hash = createHash("sha256").update(bytes).digest("hex");
      const previous = (
        await pool.query(
          "SELECT audio_hash FROM call_transcript_segment WHERE recording_id=$1 AND ordinal=$2",
          [id, ordinal],
        )
      ).rows[0];
      if (previous) {
        requireThat(previous.audio_hash === hash, "CALL_AUDIO_CHANGED", 409);
        continue;
      }
      const result = extractionSchema.parse(
        await extractor.extract(
          {
            kind: "audio",
            filename: file,
            mediaType: "audio/mpeg",
            bytes,
            allowModelProcessing: true,
          },
          AbortSignal.timeout(60000),
        ),
      );
      await transaction(async (tx) => {
        await lockWorkspace(tx, claim.workspace_id);
        const fenced = await tx.query(
          "UPDATE call_transcription SET lease_until=now()+interval '10 minutes' WHERE recording_id=$1 AND attempt_id=$2 AND status='processing' RETURNING recording_id",
          [id, claim.attempt],
        );
        requireThat(fenced.rowCount, "CALL_TRANSCRIPTION_SUPERSEDED", 409);
        await tx.query(
          "INSERT INTO call_transcript_segment(id,workspace_id,recording_id,ordinal,content,provider,qualification,audio_hash,start_seconds) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            randomUUID(),
            claim.workspace_id,
            id,
            ordinal,
            result.text,
            result.provider,
            `Trascrizione automatica fallibile della traccia del partecipante ${claim.participant_id}; verificare l'audio originale. ${result.qualification}`,
            hash,
            ordinal * 300,
          ],
        );
      });
    }
    await transaction(async (tx) => {
      await lockWorkspace(tx, claim.workspace_id);
      const r = await tx.query(
        "UPDATE call_transcription SET status='ready',lease_until=NULL WHERE recording_id=$1 AND attempt_id=$2 AND status='processing' RETURNING recording_id",
        [id, claim.attempt],
      );
      if (r.rowCount)
        await callEvent(
          tx,
          claim.workspace_id,
          claim.call_id,
          "call.transcribed",
        );
    });
  } catch (e) {
    const code =
      e instanceof DomainError ? e.code : "CALL_TRANSCRIPTION_FAILED";
    await transaction(async (tx) => {
      await lockWorkspace(tx, claim.workspace_id);
      const r = await tx.query(
        "UPDATE call_transcription SET status=$3,error_code=$4,lease_until=NULL WHERE recording_id=$1 AND attempt_id=$2 AND status='processing' RETURNING recording_id",
        [
          id,
          claim.attempt,
          code.includes("CONFIGURATION") ? "needs_configuration" : "failed",
          code,
        ],
      );
      if (r.rowCount)
        await callEvent(
          tx,
          claim.workspace_id,
          claim.call_id,
          "call.transcription_failed",
        );
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function analyzeCall(
  tx: Tx,
  w: string,
  actor: string,
  id: string,
) {
  await member(tx, w, actor, true, true);
  requireThat(
    (
      await tx.query(
        "SELECT 1 FROM audio_call WHERE workspace_id=$1 AND id=$2 AND state='ended'",
        [w, id],
      )
    ).rowCount,
    "CALL_NOT_ENDED",
    409,
  );
  const pending = (
    await tx.query(
      "SELECT 1 FROM call_recording r LEFT JOIN call_transcription t ON t.recording_id=r.id WHERE r.call_id=$1 AND (r.state NOT IN ('complete','failed') OR (r.state='complete' AND t.status IS DISTINCT FROM 'ready'))",
      [id],
    )
  ).rowCount;
  requireThat(!pending, "CALL_TRANSCRIPTION_NOT_READY", 409);
  const segments = (
    await tx.query(
      `SELECT s.*,r.participant_id,p.user_id,u.name,r.created_at AS recording_started
    FROM call_transcript_segment s JOIN call_recording r ON r.id=s.recording_id JOIN call_participant p ON p.id=r.participant_id JOIN "user" u ON u.id=p.user_id
    WHERE r.workspace_id=$1 AND r.call_id=$2 ORDER BY r.created_at,s.ordinal`,
      [w, id],
    )
  ).rows;
  requireThat(segments.length, "CALL_TRANSCRIPT_UNAVAILABLE", 409);
  const request = randomUUID(),
    sourceIds: string[] = [];
  const newMappings: { segment: string; source: string }[] = [];
  for (const segment of segments) {
    const prior = (
      await tx.query(
        "SELECT source_id FROM call_analysis_source WHERE segment_id=$1",
        [segment.id],
      )
    ).rows[0];
    if (prior) {
      sourceIds.push(prior.source_id);
      continue;
    }
    const text = `Chiamata ${id}. Traccia ${segment.recording_id}, partecipante ${segment.name} (${segment.user_id}), intervallo da ${segment.start_seconds}s della traccia iniziata ${new Date(segment.recording_started).toISOString()}.\n${segment.content}`;
    const source = await uploadDocument(
      tx,
      w,
      actor,
      {
        type: "document.upload",
        filename: `chiamata-${id}-${segment.ordinal}.txt`,
        bytesBase64: Buffer.from(text).toString("base64"),
      },
      `${segment.qualification} Fonte derivata dalla registrazione ${segment.recording_id}, segmento ${segment.id}, su richiesta di analisi ${request}. Nessuna accettazione, decisione o autorità implicita.`,
      false,
    );
    sourceIds.push(source.sourceId);
    newMappings.push({ segment: segment.id, source: source.sourceId });
  }
  await tx.query(
    "INSERT INTO call_analysis_request(id,workspace_id,call_id,actor_id,source_ids) VALUES($1,$2,$3,$4,$5)",
    [request, w, id, actor, sourceIds],
  );
  for (const mapping of newMappings)
    await tx.query(
      "INSERT INTO call_analysis_source(segment_id,source_id,request_id) VALUES($1,$2,$3)",
      [mapping.segment, mapping.source, request],
    );
  const work = await createActiveWork(
    tx,
    w,
    `Analizza la chiamata ${id}: recap, divergenze, informazioni utili, domande aperte e possibili task. Nessuna adozione o azione autorizzata.`,
    sourceIds[0],
    actor,
  );
  await callEvent(tx, w, id, "call.analysis_requested", actor);
  return { ...work, sourceIds, requestId: request };
}
