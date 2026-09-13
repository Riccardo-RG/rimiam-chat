import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { pool, transaction, type Tx } from "./db.ts";
import { member, lockWorkspace, changed } from "./workspace-state.ts";
import { DomainError, requireThat } from "./errors.ts";
import {
  configuredMediaExtractor,
  extractionSchema,
  type MediaExtractor,
  type MediaInput,
} from "./media-provider.ts";
import {
  queueDocument,
  scheduleSource,
  documentProcessingEvent,
} from "./sources.ts";

async function eligible(
  tx: Tx,
  row: {
    workspace_id: string;
    requested_by: string;
    membership_version: number;
  },
) {
  await member(tx, row.workspace_id, row.requested_by, true, true);
  requireThat(
    (
      await tx.query(
        "SELECT 1 FROM membership WHERE workspace_id=$1 AND user_id=$2 AND version=$3",
        [row.workspace_id, row.requested_by, row.membership_version],
      )
    ).rowCount,
    "DOCUMENT_ACCESS_CHANGED",
    403,
  );
}
export async function processDocument(
  sourceId: string,
  extractor: MediaExtractor = configuredMediaExtractor(),
) {
  z.uuid().parse(sourceId);
  const claim = await transaction(async (tx) => {
    const p = (
      await tx.query("SELECT * FROM document_processing WHERE source_id=$1", [
        sourceId,
      ])
    ).rows[0];
    if (!p) return null;
    await lockWorkspace(tx, p.workspace_id);
    const row = (
      await tx.query(
        "SELECT p.*,s.original_bytes,s.filename,s.media_type FROM document_processing p JOIN external_source s ON s.id=p.source_id WHERE p.source_id=$1 FOR UPDATE OF p",
        [sourceId],
      )
    ).rows[0];
    if (row.status !== "queued") return null;
    try {
      await eligible(tx, row);
    } catch {
      await tx.query(
        "UPDATE document_processing SET status='failed',error_code='DOCUMENT_ACCESS_CHANGED' WHERE source_id=$1",
        [sourceId],
      );
      await changed(tx, row.workspace_id, "document.processing_failed");
      await documentProcessingEvent(
        tx,
        row.workspace_id,
        sourceId,
        null,
        row.requested_by,
        "access_ended",
        "DOCUMENT_ACCESS_CHANGED",
      );
      return null;
    }
    const attempt = randomUUID();
    await tx.query(
      "INSERT INTO document_extraction_attempt(id,workspace_id,source_id,requested_by,membership_version,allow_model_processing) VALUES($1,$2,$3,$4,$5,$6)",
      [
        attempt,
        row.workspace_id,
        sourceId,
        row.requested_by,
        row.membership_version,
        row.allow_model_processing,
      ],
    );
    await tx.query(
      "UPDATE document_processing SET status='processing',attempt_id=$2,lease_until=now()+interval '120 seconds',error_code=NULL WHERE source_id=$1",
      [sourceId, attempt],
    );
    await changed(tx, row.workspace_id, "document.processing");
    await documentProcessingEvent(
      tx,
      row.workspace_id,
      sourceId,
      attempt,
      row.requested_by,
      "started",
    );
    return { ...row, attempt };
  });
  if (!claim) return;
  try {
    const input: MediaInput = {
      kind: claim.kind,
      filename: claim.filename,
      mediaType: claim.media_type,
      bytes: claim.original_bytes,
      allowModelProcessing: claim.allow_model_processing,
    };
    const result = extractionSchema.parse(
      await extractor.extract(input, AbortSignal.timeout(60000)),
    );
    await transaction(async (tx) => {
      await lockWorkspace(tx, claim.workspace_id);
      const current = (
        await tx.query("SELECT * FROM document_processing WHERE source_id=$1", [
          sourceId,
        ])
      ).rows[0];
      let publication = "published";
      if (
        current.status !== "processing" ||
        current.attempt_id !== claim.attempt
      )
        publication = "superseded";
      else
        try {
          await eligible(tx, claim);
        } catch {
          publication = "access_ended";
        }
      await tx.query(
        "INSERT INTO document_extraction(attempt_id,workspace_id,source_id,content,qualification,provider,content_hash,publication) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          claim.attempt,
          claim.workspace_id,
          sourceId,
          result.text,
          result.qualification,
          result.provider,
          createHash("sha256").update(result.text).digest("hex"),
          publication,
        ],
      );
      await documentProcessingEvent(
        tx,
        claim.workspace_id,
        sourceId,
        claim.attempt,
        claim.requested_by,
        publication,
        publication === "access_ended" ? "DOCUMENT_ACCESS_CHANGED" : null,
      );
      if (publication === "superseded") return;
      await tx.query(
        "UPDATE document_processing SET status=$2,lease_until=NULL,error_code=$3 WHERE source_id=$1",
        [
          sourceId,
          publication === "published" ? "ready" : "failed",
          publication === "published" ? null : "DOCUMENT_ACCESS_CHANGED",
        ],
      );
      if (publication === "published")
        await scheduleSource(tx, claim.workspace_id, sourceId);
      await changed(
        tx,
        claim.workspace_id,
        publication === "published"
          ? "document.extracted"
          : "document.processing_failed",
      );
    });
  } catch (error) {
    const code =
      error instanceof DomainError ? error.code : "DOCUMENT_EXTRACTION_FAILED";
    const status = code.includes("CONFIGURATION")
      ? "needs_configuration"
      : [
            "MEDIA_DISCLOSURE_REQUIRED",
            "PDF_TEXT_UNAVAILABLE",
            "PDF_PASSWORD_REQUIRED",
            "IMAGE_NEEDS_INPUT",
            "DOCUMENT_TEXT_UNAVAILABLE",
          ].includes(code)
        ? "needs_input"
        : "failed";
    await transaction(async (tx) => {
      await lockWorkspace(tx, claim.workspace_id);
      const updated = await tx.query(
        "UPDATE document_processing SET status=$3,error_code=$4,lease_until=NULL WHERE source_id=$1 AND attempt_id=$2 AND status='processing' RETURNING source_id",
        [sourceId, claim.attempt, status, code],
      );
      await documentProcessingEvent(
        tx,
        claim.workspace_id,
        sourceId,
        claim.attempt,
        claim.requested_by,
        updated.rowCount ? "failed" : "superseded",
        code,
      );
      if (updated.rowCount)
        await changed(tx, claim.workspace_id, "document.processing_failed");
    });
  }
}
export async function recoverDocuments() {
  const rows = (
    await pool.query(
      "SELECT source_id,workspace_id FROM document_processing WHERE status='queued' OR (status='processing' AND lease_until<now()) LIMIT 100",
    )
  ).rows;
  for (const row of rows)
    await transaction(async (tx) => {
      await lockWorkspace(tx, row.workspace_id);
      const p = (
        await tx.query(
          "SELECT * FROM document_processing WHERE source_id=$1 FOR UPDATE",
          [row.source_id],
        )
      ).rows[0];
      if (p.status === "processing" && new Date(p.lease_until) < new Date()) {
        await tx.query(
          "UPDATE document_processing SET status='queued',attempt_id=NULL,lease_until=NULL,error_code='DOCUMENT_INTERRUPTED' WHERE source_id=$1",
          [row.source_id],
        );
        await changed(tx, row.workspace_id, "document.recovered");
        await documentProcessingEvent(
          tx,
          row.workspace_id,
          row.source_id,
          p.attempt_id,
          null,
          "recovered",
          "DOCUMENT_INTERRUPTED",
        );
      }
      if (p.status === "queued" || p.status === "processing")
        await queueDocument(tx, row.source_id);
    });
}
