import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction, type Tx } from "./db.ts";
import { changed, enqueue, member } from "./workspace-state.ts";
import { DomainError, requireThat } from "./errors.ts";
import { inspectMedia } from "./media-provider.ts";

import {
  uploadDocumentSchema,
  retryDocumentSchema,
  withdrawDocumentSchema,
  restoreDocumentSchema,
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
  processContent = true,
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
        "SELECT s.document_id,s.document_version FROM available_external_source s WHERE s.workspace_id=$1 AND s.id=$2 AND s.kind='document' AND NOT EXISTS(SELECT 1 FROM external_source newer WHERE newer.workspace_id=s.workspace_id AND newer.document_id=s.document_id AND newer.document_version>s.document_version)",
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
  if (media && processContent) {
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
  const interpretationId = processContent
    ? await scheduleSource(tx, w, sourceId)
    : undefined;
  await changed(tx, w, "document.uploaded");
  return { sourceId, documentId, version, interpretationId };
}

export async function markOrdinaryUpload(
  tx: Tx,
  w: string,
  actor: string,
  sourceId: string,
) {
  await tx.query(
    "INSERT INTO document_visibility_event(workspace_id,source_id,version,withdrawn,actor_id) VALUES($1,$2,1,false,$3)",
    [w, sourceId, actor],
  );
}

export async function changeDocumentVisibility(
  tx: Tx,
  w: string,
  actor: string,
  input:
    | z.infer<typeof withdrawDocumentSchema>
    | z.infer<typeof restoreDocumentSchema>,
) {
  await member(tx, w, actor, true, true);
  const row = (
    await tx.query(
      `SELECT s.document_version,s.contributed_by,v.version,v.withdrawn FROM document_visibility v
     JOIN external_source s ON (s.workspace_id,s.id)=(v.workspace_id,v.source_id)
     WHERE v.workspace_id=$1 AND v.source_id=$2`,
      [w, input.sourceId],
    )
  ).rows[0];
  requireThat(
    row && row.contributed_by === actor,
    "DOCUMENT_VISIBILITY_DENIED",
    403,
  );
  const withdrawn = input.type === "document.withdraw";
  requireThat(
    row.document_version === input.documentVersion &&
      row.version === input.expectedVisibilityVersion &&
      row.withdrawn !== withdrawn,
    "DOCUMENT_VISIBILITY_STALE",
    409,
  );
  const version = row.version + 1;
  await tx.query(
    "INSERT INTO document_visibility_event(workspace_id,source_id,version,withdrawn,actor_id) VALUES($1,$2,$3,$4,$5)",
    [w, input.sourceId, version, withdrawn, actor],
  );
  if (withdrawn) {
    await tx.query(
      "UPDATE document_processing SET status='failed',lease_until=NULL,attempt_id=NULL,error_code='DOCUMENT_WITHDRAWN' WHERE workspace_id=$1 AND source_id=$2 AND status IN ('queued','processing')",
      [w, input.sourceId],
    );
    await tx.query(
      "UPDATE interpretation SET status='stale',lease_until=NULL,error_code='DOCUMENT_WITHDRAWN' WHERE workspace_id=$1 AND source_id=$2 AND status IN ('queued','running','failed')",
      [w, input.sourceId],
    );
  }
  await changed(
    tx,
    w,
    withdrawn ? "document.withdrawn" : "document.restored",
    true,
  );
  return {
    sourceId: input.sourceId,
    documentVersion: row.document_version,
    visibilityVersion: version,
    withdrawn,
  };
}

// Check previously retrieved material again immediately before model disclosure
// and publication. The workspace lock orders this check against withdrawal.
export async function requireAvailableDocuments(
  tx: Tx,
  w: string,
  sourceIds: string[],
  observedVersions?: Map<string, number>,
) {
  if (!sourceIds.length) return;
  const { rows } = await tx.query<{
    source_id: string;
    version: number;
    withdrawn: boolean;
  }>(
    "SELECT source_id,version,withdrawn FROM document_visibility WHERE workspace_id=$1 AND source_id=ANY($2::uuid[])",
    [w, sourceIds],
  );
  for (const row of rows) {
    const observed = observedVersions?.get(row.source_id);
    requireThat(
      !row.withdrawn && (observed === undefined || observed === row.version),
      "DOCUMENT_WITHDRAWN",
      409,
    );
    observedVersions?.set(row.source_id, row.version);
  }
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
  await requireAvailableDocuments(tx, w, [input.sourceId]);
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
export async function sourceRecords(tx: Tx, w: string, actor: string) {
  return (
    await tx.query(
      `SELECT s.id,s.kind,s.title,CASE WHEN v.withdrawn THEN '' ELSE coalesce(e.content,s.content) END AS content,
 coalesce(v.withdrawn,false) AS withdrawn,coalesce(v.version,1) AS visibility_version,
 (v.source_id IS NOT NULL AND s.contributed_by=$2 AND EXISTS(SELECT 1 FROM membership m WHERE m.workspace_id=s.workspace_id AND m.user_id=$2 AND m.active AND m.contributes)) AS can_manage_visibility,s.contributed_by,s.qualification||coalesce(' '||e.qualification,'') AS qualification,s.content_hash,s.created_at,s.document_id,s.document_version,s.previous_source_id,s.filename,s.media_type,s.url,s.provider,s.work_id,
 ma.message_id AS shared_message_id, ma.position AS attachment_position,
 COALESCE((SELECT o.origin_workspace_id FROM library_copy_origin o
  JOIN workspace personal ON personal.id=o.workspace_id AND personal.personal_owner_id=$2
  JOIN membership m ON m.workspace_id=o.origin_workspace_id AND m.user_id=$2 AND m.active
  WHERE (o.workspace_id,o.source_id)=(s.workspace_id,s.id)), (SELECT c.workspace_id FROM private_workspace_consultation c
  JOIN membership m ON m.workspace_id=c.workspace_id AND m.user_id=$2 AND m.active
  JOIN workspace origin ON origin.id=c.workspace_id AND origin.personal_owner_id IS NULL
  WHERE c.actor_id=$2 AND (c.document_workspace_id,c.document_source_id)=(s.workspace_id,s.id))) AS origin_workspace_id,
 EXISTS(SELECT 1 FROM library_favorite f WHERE f.workspace_id=s.workspace_id AND f.source_id=s.id AND f.user_id=$2) AS favorite,
 p.status AS processing_status,p.error_code AS processing_error,e.attempt_id AS extraction_id,e.provider AS extraction_provider,e.content_hash AS extraction_hash,e.created_at AS extracted_at,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',h.id,'attempt_id',h.attempt_id,'actor_id',h.actor_id,'kind',h.kind,'error_code',h.error_code,'created_at',h.created_at) ORDER BY h.created_at,h.id) FROM document_processing_event h WHERE h.workspace_id=s.workspace_id AND h.source_id=s.id),'[]'::jsonb) AS processing_history
 FROM external_source s LEFT JOIN document_visibility v ON (v.workspace_id,v.source_id)=(s.workspace_id,s.id) LEFT JOIN message_attachment ma ON ma.workspace_id=s.workspace_id AND ma.source_id=s.id LEFT JOIN document_processing p ON p.source_id=s.id LEFT JOIN document_extraction e ON e.source_id=s.id AND e.publication='published' AND v.withdrawn IS NOT TRUE WHERE s.workspace_id=$1 ORDER BY s.created_at`,
      [w, actor],
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
        "SELECT filename,media_type,original_bytes FROM available_external_source WHERE workspace_id=$1 AND id=$2 AND kind='document'",
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
