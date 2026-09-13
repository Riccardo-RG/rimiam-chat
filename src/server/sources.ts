import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction, type Tx } from "./db.ts";
import { changed, enqueue, member } from "./workspace-state.ts";
import { DomainError, requireThat } from "./errors.ts";
import { inspectMedia } from "./media-provider.ts";

import {
  uploadDocumentSchema,
  retryDocumentSchema,
} from "../contracts/commands.ts";
export { uploadDocumentSchema } from "../contracts/commands.ts";
export async function scheduleSource(tx: Tx, w: string, sourceId: string) {
  const interpretationId = randomUUID();
  await tx.query(
    "INSERT INTO interpretation(id,workspace_id,source_id,status) VALUES($1,$2,$3,'queued')",
    [interpretationId, w, sourceId],
  );
  await enqueue(tx, interpretationId);
  return interpretationId;
}

export function decodeDocument(input: z.infer<typeof uploadDocumentSchema>) {
  requireThat(
    !/[\\/\x00-\x1f\x7f]/.test(input.filename) &&
      /\.(txt|md|csv)$/i.test(input.filename),
    "DOCUMENT_FORMAT_UNSUPPORTED",
    400,
  );
  const bytes = Buffer.from(input.bytesBase64, "base64");
  requireThat(
    bytes.length > 0 && bytes.length <= 1048576,
    "DOCUMENT_TOO_LARGE",
    413,
  );
  requireThat(
    bytes.toString("base64") === input.bytesBase64,
    "INVALID_DOCUMENT_ENCODING",
    400,
  );
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DomainError("INVALID_DOCUMENT_ENCODING", 400);
  }
  requireThat(
    !content.includes("\0") &&
      content.trim().length > 0 &&
      content.length <= 200000,
    "INVALID_DOCUMENT_TEXT",
    400,
  );
  return { bytes, content };
}

export async function uploadDocument(
  tx: Tx,
  w: string,
  actor: string,
  input: z.infer<typeof uploadDocumentSchema>,
  sourceQualification?: string,
  interpret = true,
) {
  await member(tx, w, actor, true, true);
  requireThat(
    !/[\\/\x00-\x1f\x7f]/.test(input.filename),
    "DOCUMENT_FORMAT_UNSUPPORTED",
    400,
  );
  const original = Buffer.from(input.bytesBase64, "base64");
  requireThat(
    original.length > 0 && original.length <= 8388608,
    "DOCUMENT_TOO_LARGE",
    413,
  );
  requireThat(
    original.toString("base64") === input.bytesBase64,
    "INVALID_DOCUMENT_ENCODING",
    400,
  );
  const media = inspectMedia(input.filename, original);
  const { bytes, content } = media
    ? { bytes: original, content: "" }
    : decodeDocument(input);
  let documentId = randomUUID(),
    version = 1;
  if (input.previousSourceId) {
    const prior = (
      await tx.query(
        "SELECT s.document_id,s.document_version FROM external_source s WHERE s.workspace_id=$1 AND s.id=$2 AND s.kind='document' AND NOT EXISTS(SELECT 1 FROM external_source newer WHERE newer.workspace_id=s.workspace_id AND newer.document_id=s.document_id AND newer.document_version>s.document_version)",
        [w, input.previousSourceId],
      )
    ).rows[0];
    requireThat(prior, "DOCUMENT_VERSION_STALE");
    documentId = prior.document_id;
    version = prior.document_version + 1;
  }
  const sourceId = randomUUID();
  await tx.query(
    "INSERT INTO source_identity(id,workspace_id,kind) VALUES($1,$2,'document')",
    [sourceId, w],
  );
  await tx.query(
    "INSERT INTO external_source(id,workspace_id,kind,title,content,contributed_by,qualification,content_hash,document_id,document_version,previous_source_id,filename,media_type,original_bytes) VALUES($1,$2,'document',$3,$4,$5,$6,$7,$8,$9,$10,$3,$11,$12)",
    [
      sourceId,
      w,
      input.filename,
      content,
      actor,
      sourceQualification ??
        "Contenuto del documento caricato; non verificato né accettato come riferimento. Un possibile obbligo riportato dal documento non è un nuovo impegno assunto nel Workspace.",
      createHash("sha256").update(bytes).digest("hex"),
      documentId,
      version,
      input.previousSourceId ?? null,
      media?.mediaType ??
        (input.filename.toLowerCase().endsWith(".csv")
          ? "text/csv"
          : "text/plain"),
      bytes,
    ],
  );
  if (media) {
    const membership = (
      await tx.query(
        "SELECT version FROM membership WHERE workspace_id=$1 AND user_id=$2",
        [w, actor],
      )
    ).rows[0];
    await tx.query(
      "INSERT INTO document_processing(source_id,workspace_id,kind,status,requested_by,membership_version,allow_model_processing) VALUES($1,$2,$3,'queued',$4,$5,$6)",
      [
        sourceId,
        w,
        media.kind,
        actor,
        membership.version,
        input.allowModelProcessing === true,
      ],
    );
    await queueDocument(tx, sourceId);
    await changed(tx, w, "document.uploaded");
    return { sourceId, documentId, version, processingStatus: "queued" };
  }
  const interpretationId = interpret
    ? await scheduleSource(tx, w, sourceId)
    : undefined;
  await changed(tx, w, "document.uploaded");
  return { sourceId, documentId, version, interpretationId };
}

export async function queueDocument(tx: Tx, sourceId: string) {
  await tx.query(
    "SELECT graphile_worker.add_job('document_extract',json_build_object('sourceId',$1::text),max_attempts:=1,job_key:=$2)",
    [sourceId, `document:${sourceId}`],
  );
}
export async function retryDocument(
  tx: Tx,
  w: string,
  actor: string,
  input: z.infer<typeof retryDocumentSchema>,
) {
  await member(tx, w, actor, true, true);
  const p = (
    await tx.query(
      "SELECT * FROM document_processing WHERE workspace_id=$1 AND source_id=$2 FOR UPDATE",
      [w, input.sourceId],
    )
  ).rows[0];
  requireThat(
    p && ["failed", "needs_input", "needs_configuration"].includes(p.status),
    "DOCUMENT_NOT_RETRYABLE",
    409,
  );
  requireThat(
    !["image", "audio"].includes(p.kind) || input.allowModelProcessing === true,
    "MEDIA_DISCLOSURE_REQUIRED",
    403,
  );
  const membership = (
    await tx.query(
      "SELECT version FROM membership WHERE workspace_id=$1 AND user_id=$2",
      [w, actor],
    )
  ).rows[0];
  await tx.query(
    "UPDATE document_processing SET status='queued',requested_by=$3,membership_version=$4,allow_model_processing=$5,attempt_id=NULL,lease_until=NULL,error_code=NULL WHERE workspace_id=$1 AND source_id=$2",
    [
      w,
      input.sourceId,
      actor,
      membership.version,
      input.allowModelProcessing === true,
    ],
  );
  await queueDocument(tx, input.sourceId);
  await documentProcessingEvent(
    tx,
    w,
    input.sourceId,
    p.attempt_id,
    actor,
    "retry_requested",
  );
  await changed(tx, w, "document.processing_requested");
  return { sourceId: input.sourceId };
}
export async function documentProcessingEvent(
  tx: Tx,
  w: string,
  sourceId: string,
  attemptId: string | null,
  actor: string | null,
  kind: string,
  errorCode: string | null = null,
) {
  await tx.query(
    "INSERT INTO document_processing_event(id,workspace_id,source_id,attempt_id,actor_id,kind,error_code) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [randomUUID(), w, sourceId, attemptId, actor, kind, errorCode],
  );
}
export async function sourceRecords(tx: Tx, w: string) {
  return (
    await tx.query(
      `SELECT s.id,s.kind,s.title,coalesce(e.content,s.content) AS content,s.contributed_by,s.qualification||coalesce(' '||e.qualification,'') AS qualification,s.content_hash,s.created_at,s.document_id,s.document_version,s.previous_source_id,s.filename,s.media_type,s.url,s.provider,s.work_id,
 p.status AS processing_status,p.error_code AS processing_error,e.attempt_id AS extraction_id,e.provider AS extraction_provider,e.content_hash AS extraction_hash,e.created_at AS extracted_at,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',h.id,'attempt_id',h.attempt_id,'actor_id',h.actor_id,'kind',h.kind,'error_code',h.error_code,'created_at',h.created_at) ORDER BY h.created_at,h.id) FROM document_processing_event h WHERE h.workspace_id=s.workspace_id AND h.source_id=s.id),'[]'::jsonb) AS processing_history
 FROM external_source s LEFT JOIN document_processing p ON p.source_id=s.id LEFT JOIN document_extraction e ON e.source_id=s.id AND e.publication='published' WHERE s.workspace_id=$1 ORDER BY s.created_at`,
      [w],
    )
  ).rows;
}

export async function readDocument(actor: string, w: string, sourceId: string) {
  z.uuid().parse(w);
  z.uuid().parse(sourceId);
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await member(tx, w, actor);
    const row = (
      await tx.query(
        "SELECT filename,media_type,original_bytes FROM external_source WHERE workspace_id=$1 AND id=$2 AND kind='document'",
        [w, sourceId],
      )
    ).rows[0];
    requireThat(row, "SOURCE_NOT_FOUND", 404);
    return row as {
      filename: string;
      media_type: string;
      original_bytes: Buffer;
    };
  });
}
