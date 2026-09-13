import { z } from "zod";
import { transaction } from "./db.ts";
import { member } from "./workspace-state.ts";
import { requireThat } from "./errors.ts";
import { emailViewSchema } from "../contracts/email.ts";
import { mailbox, draftVersion } from "./email-state.ts";
import { configuredEmailProvider } from "./email-provider.ts";
export async function emailView(
  actor: string,
  w: string,
  before?: string,
  observationId?: string,
) {
  if (before) z.uuid().parse(before);
  if (observationId) z.uuid().parse(observationId);
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await member(tx, w, actor);
    const ws = (await tx.query("SELECT * FROM workspace WHERE id=$1", [w]))
      .rows[0];
    const connections = (
      await tx.query(
        `SELECT c.* FROM mailbox_connection c JOIN membership m ON m.workspace_id=c.workspace_id AND m.user_id=c.person_id WHERE c.workspace_id=$1 AND c.person_id=$2 AND c.membership_version=m.version`,
        [w, actor],
      )
    ).rows;
    const active = connections
      .filter((c) => c.active && c.can_read)
      .map((c) => c.id);
    const drafts = (
      await tx.query(
        `SELECT d.id,d.current_version,v.* FROM email_draft d JOIN email_draft_version v ON v.workspace_id=d.workspace_id AND v.draft_id=d.id AND v.version=d.current_version JOIN email_draft_version initial ON initial.draft_id=d.id AND initial.version=1 WHERE d.workspace_id=$1 AND d.person_id=$2 AND ($3::uuid IS NULL OR (initial.created_at,d.id)<(SELECT original.created_at,original.draft_id FROM email_draft_version original JOIN email_draft cursor ON cursor.id=original.draft_id WHERE original.workspace_id=$1 AND original.draft_id=$3 AND original.version=1 AND cursor.person_id=$2)) ORDER BY initial.created_at DESC,d.id DESC LIMIT 51`,
        [w, actor, before ?? null],
      )
    ).rows;
    const more = drafts.length > 50;
    if (more) drafts.pop();
    const actions = (
      await tx.query(
        `SELECT a.*,v.envelope,v.envelope_hash,v.connection_id FROM email_send a JOIN email_draft_version v ON v.workspace_id=a.workspace_id AND v.draft_id=a.draft_id AND v.version=a.draft_version WHERE a.workspace_id=$1 AND a.draft_id=ANY($2::uuid[]) ORDER BY a.id DESC`,
        [w, drafts.map((d) => d.id)],
      )
    ).rows;
    const observations = (
      await tx.query(
        "SELECT o.*,r.request FROM email_observation o JOIN email_read r ON r.id=o.read_id WHERE o.workspace_id=$1 AND o.person_id=$2 AND o.connection_id=ANY($3::uuid[]) AND ($4::uuid IS NULL OR o.id=$4) ORDER BY o.observed_at DESC,o.id DESC LIMIT 50",
        [w, actor, active, observationId ?? null],
      )
    ).rows;
    const attachments = (
      await tx.query(
        "SELECT id,version,content_hash,filename,observation_id,message_id FROM email_attachment WHERE workspace_id=$1 AND person_id=$2 AND connection_id=ANY($3::uuid[]) ORDER BY id",
        [w, actor, active],
      )
    ).rows;
    const sources = (
      await tx.query(
        `SELECT s.id,s.document_version AS version,s.content_hash,s.filename FROM external_source s WHERE s.workspace_id=$1 AND s.kind='document' AND NOT EXISTS(SELECT 1 FROM external_source n WHERE n.workspace_id=s.workspace_id AND n.document_id=s.document_id AND n.document_version>s.document_version)`,
        [w],
      )
    ).rows;
    const disclosures = (
      await tx.query(
        "SELECT id,source_id,person_id,created_at FROM email_disclosure WHERE workspace_id=$1 ORDER BY created_at",
        [w],
      )
    ).rows;
    const reads = (
      await tx.query(
        "SELECT id,status,error_code FROM email_read WHERE workspace_id=$1 AND person_id=$2 ORDER BY created_at DESC LIMIT 20",
        [w, actor],
      )
    ).rows;
    const attachmentRef = (s: Record<string, unknown>, kind: string) => ({
      kind,
      id: s.id,
      version: s.version,
      hash: s.content_hash,
      filename: s.filename,
    });
    return emailViewSchema.parse({
      workspaceId: w,
      revision: ws.revision,
      contextRevision: ws.context_revision,
      accessRevision: ws.access_revision,
      providerConfigured: !!configuredEmailProvider(),
      connections: connections.map((c) => ({
        id: c.id,
        version: c.version,
        sender: c.sender,
        label: c.label,
        active: c.active,
        canRead: c.can_read,
        canSend: c.can_send,
      })),
      drafts: drafts.map((d) => ({
        id: d.id,
        version: d.version,
        connectionId: d.connection_id,
        envelope: d.envelope,
        reason: d.reason,
      })),
      actions: actions.map((a) => ({
        id: a.id,
        draftId: a.draft_id,
        version: a.draft_version,
        status: a.status,
        envelope: a.envelope,
        hash: a.envelope_hash,
        error: a.error_code,
        receipt: a.receipt,
        canAuthorize:
          active.includes(a.connection_id) &&
          ["PROPOSED", "FAILED"].includes(a.status),
        canReject: ["PROPOSED", "AUTHORIZED", "FAILED"].includes(a.status),
        canRetry:
          active.includes(a.connection_id) &&
          a.status === "FAILED" &&
          a.safe_to_retry,
        canReconcile:
          active.includes(a.connection_id) && a.status === "OUTCOME_UNKNOWN",
      })),
      observations: observations.map((o) => ({
        id: o.id,
        connectionId: o.connection_id,
        observedAt: new Date(o.observed_at).toISOString(),
        data: o.data,
        request: o.request,
      })),
      attachments: attachments.map((a) => ({
        ...attachmentRef(a, "mailbox_attachment"),
        observationId: a.observation_id,
        messageId: a.message_id,
      })),
      workspaceAttachments: sources.map((s) =>
        attachmentRef(s, "workspace_source"),
      ),
      disclosures: disclosures.map((d) => ({
        id: d.id,
        sourceId: d.source_id,
        personId: d.person_id,
        createdAt: new Date(d.created_at).toISOString(),
      })),
      reads: reads.map((r) => ({
        id: r.id,
        status: r.status,
        error: r.error_code,
      })),
      nextDrafts: more ? drafts.at(-1)!.id : null,
    });
  });
}
export async function emailHistory(actor: string, w: string, id: string) {
  z.uuid().parse(id);
  return transaction(async (tx) => {
    await member(tx, w, actor);
    await draftVersion(tx, w, id, actor);
    const versions = (
      await tx.query(
        "SELECT version,envelope,envelope_hash,reason,created_at,composition_id FROM email_draft_version WHERE workspace_id=$1 AND draft_id=$2 ORDER BY version",
        [w, id],
      )
    ).rows;
    const transitions = (
      await tx.query(
        "SELECT t.action_id,t.status,t.actor_id,t.detail,t.created_at FROM email_transition t JOIN email_send a ON a.id=t.action_id WHERE t.workspace_id=$1 AND a.draft_id=$2 ORDER BY t.created_at,t.id",
        [w, id],
      )
    ).rows;
    const compositions = (
      await tx.query(
        "SELECT id,draft_version,instruction,suggestion,created_at FROM email_composition WHERE workspace_id=$1 AND draft_id=$2 AND person_id=$3 ORDER BY created_at",
        [w, id, actor],
      )
    ).rows;
    return { versions, transitions, compositions };
  });
}
export async function emailAttachment(actor: string, w: string, id: string) {
  z.uuid().parse(id);
  return transaction(async (tx) => {
    await member(tx, w, actor);
    const a = (
      await tx.query(
        "SELECT * FROM email_attachment WHERE workspace_id=$1 AND id=$2 AND person_id=$3",
        [w, id, actor],
      )
    ).rows[0];
    requireThat(a, "EMAIL_ATTACHMENT_NOT_FOUND", 404);
    await mailbox(tx, w, actor, a.connection_id);
    return { bytes: a.bytes as Buffer, filename: a.filename as string };
  });
}
