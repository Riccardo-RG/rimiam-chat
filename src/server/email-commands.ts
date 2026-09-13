import { randomUUID } from "node:crypto";
import type { Tx } from "./db.ts";
import { member, type WorkspaceRow } from "./workspace-state.ts";
import { authenticatedSession } from "./workspace-state.ts";
import { requireThat } from "./errors.ts";
import { uploadDocument } from "./sources.ts";
import {
  mailbox,
  draftVersion,
  sendVersion,
  validateEnvelope,
  emailHash,
  emailTransition,
  observedMessage,
} from "./email-state.ts";
import type { EmailCommand } from "../contracts/email.ts";
export async function queueEmailRead(
  tx: Tx,
  w: string,
  actor: string,
  sessionId: string,
  connectionId: string,
  request: unknown,
) {
  const r = await mailbox(tx, w, actor, connectionId);
  await authenticatedSession(tx, actor, sessionId);
  const id = randomUUID();
  await tx.query(
    "INSERT INTO email_read(id,workspace_id,connection_id,person_id,session_id,membership_version,connection_version,request,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'QUEUED')",
    [
      id,
      w,
      connectionId,
      actor,
      sessionId,
      r.member_version,
      r.version,
      JSON.stringify(request),
    ],
  );
  await tx.query(
    "SELECT graphile_worker.add_job('email_read',json_build_object('id',$1::text))",
    [id],
  );
  return { readId: id };
}
export async function applyEmail(
  tx: Tx,
  ws: WorkspaceRow,
  actor: string,
  c: EmailCommand,
  sessionId?: string,
): Promise<Record<string, unknown>> {
  const w = ws.id;
  await member(tx, w, actor, true, true);
  if (c.type === "email.draft.create" || c.type === "email.draft.revise") {
    const checked = await validateEnvelope(
      tx,
      w,
      actor,
      c.envelope,
      c.connectionId,
    );
    let id: string = randomUUID(),
      version = 1;
    if (c.type === "email.draft.revise") {
      const d = await draftVersion(tx, w, c.draftId, actor);
      requireThat(d.current_version === c.expectedVersion, "EMAIL_DRAFT_STALE");
      if (c.compositionId) {
        const source = (
          await tx.query(
            "SELECT * FROM email_composition WHERE workspace_id=$1 AND id=$2 AND person_id=$3 AND draft_id=$4 AND draft_version=$5",
            [w, c.compositionId, actor, c.draftId, c.expectedVersion],
          )
        ).rows[0];
        requireThat(
          source && !source.suggestion.needsClarification,
          "EMAIL_COMPOSITION_STALE_OR_DENIED",
        );
      }
      id = c.draftId;
      version = d.current_version + 1;
      requireThat(
        !(
          await tx.query(
            "SELECT 1 FROM email_send WHERE draft_id=$1 AND status IN ('EXECUTING','OUTCOME_UNKNOWN')",
            [id],
          )
        ).rowCount,
        "EMAIL_EFFECT_UNRESOLVED",
      );
      const superseded = (
        await tx.query(
          "UPDATE email_send SET status='REJECTED',safe_to_retry=false WHERE draft_id=$1 AND status IN ('PROPOSED','AUTHORIZED','FAILED') RETURNING id",
          [id],
        )
      ).rows;
      for (const a of superseded)
        await emailTransition(tx, w, a.id, "REJECTED", actor, {
          reason: "draft_superseded",
        });
      await tx.query("UPDATE email_draft SET current_version=$2 WHERE id=$1", [
        id,
        version,
      ]);
    } else
      await tx.query(
        "INSERT INTO email_draft(id,workspace_id,person_id,current_version) VALUES($1,$2,$3,1)",
        [id, w, actor],
      );
    await tx.query(
      "INSERT INTO email_draft_version(workspace_id,draft_id,version,connection_id,connection_version,envelope,envelope_hash,reason,actor_id,composition_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        w,
        id,
        version,
        c.connectionId,
        checked.connection?.version ?? null,
        JSON.stringify(checked.envelope),
        emailHash(checked.envelope),
        c.reason,
        actor,
        c.type === "email.draft.revise" ? (c.compositionId ?? null) : null,
      ],
    );
    return { draftId: id, version };
  }
  if (c.type === "email.read") {
    await authenticatedSession(tx, actor, sessionId);
    if (c.request.mode === "attachment")
      await observedMessage(
        tx,
        w,
        actor,
        c.request.observationId,
        c.request.messageId,
        c.connectionId,
      );
    return queueEmailRead(tx, w, actor, sessionId!, c.connectionId, c.request);
  }
  if (c.type === "email.disconnect") {
    // Revoking one's own connection must not require usable read/send capabilities.
    const r = (
      await tx.query(
        "SELECT * FROM mailbox_connection WHERE workspace_id=$1 AND id=$2 AND person_id=$3 AND active",
        [w, c.connectionId, actor],
      )
    ).rows[0];
    requireThat(r, "EMAIL_MAILBOX_ACCESS_DENIED", 403);
    requireThat(r.version === c.expectedVersion, "EMAIL_CONNECTION_STALE");
    await tx.query(
      "UPDATE mailbox_connection SET active=false,version=version+1 WHERE id=$1",
      [c.connectionId],
    );
    await tx.query(
      "INSERT INTO mailbox_history(workspace_id,connection_id,version,actor_id,active,basis) VALUES($1,$2,$3,$4,false,'explicit_disconnection')",
      [w, c.connectionId, r.version + 1, actor],
    );
    return { disconnected: true };
  }
  if (c.type === "email.disclose" || c.type === "email.attachment.disclose") {
    let observationId: string,
      messageId: string,
      attachmentId: string | null = null,
      bytes: Buffer,
      filename: string;
    if (c.type === "email.disclose") {
      const { message } = await observedMessage(
        tx,
        w,
        actor,
        c.observationId,
        c.messageId,
      );
      requireThat(
        message.body.includes(c.text),
        "EMAIL_EXCERPT_NOT_IN_SOURCE",
        400,
      );
      observationId = c.observationId;
      messageId = c.messageId;
      bytes = Buffer.from(c.text);
      filename = `email-${randomUUID()}.txt`;
    } else {
      const a = (
        await tx.query(
          "SELECT * FROM email_attachment WHERE workspace_id=$1 AND id=$2 AND person_id=$3",
          [w, c.attachmentId, actor],
        )
      ).rows[0];
      requireThat(a, "EMAIL_ATTACHMENT_NOT_FOUND", 404);
      await mailbox(tx, w, actor, a.connection_id);
      observationId = a.observation_id;
      messageId = a.message_id;
      attachmentId = a.id;
      bytes = a.bytes;
      filename = a.filename;
    }
    // Existing bounded text-source ingestion preserves qualifications; no acceptance or commitment is implied.
    const result = await uploadDocument(
      tx,
      w,
      actor,
      {
        type: "document.upload",
        filename,
        bytesBase64: bytes.toString("base64"),
      },
      "Contenuto selezionato da una email privata e condiviso esplicitamente; non verificato né accettato. La persona che condivide non è automaticamente autore delle affermazioni. Provenance originale riservata; nessun altro contenuto della mailbox è condiviso.",
    );
    const id = randomUUID();
    await tx.query(
      "INSERT INTO email_disclosure(id,workspace_id,source_id,person_id,observation_id,message_id,attachment_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [id, w, result.sourceId, actor, observationId, messageId, attachmentId],
    );
    return { ...result, disclosureId: id };
  }
  if (c.type === "email.propose") {
    const d = await draftVersion(tx, w, c.draftId, actor);
    requireThat(d.current_version === c.version, "EMAIL_DRAFT_STALE");
    const v = await validateEnvelope(
      tx,
      w,
      actor,
      d.envelope,
      d.connection_id,
      true,
    );
    requireThat(
      v.connection.version === d.connection_version,
      "EMAIL_CONNECTION_STALE",
    );
    requireThat(
      !(
        await tx.query(
          "SELECT 1 FROM email_send WHERE draft_id=$1 AND draft_version=$2",
          [c.draftId, c.version],
        )
      ).rowCount,
      "EMAIL_VERSION_ALREADY_PROPOSED",
    );
    const id = randomUUID();
    await tx.query(
      "INSERT INTO email_send(id,workspace_id,draft_id,draft_version,status) VALUES($1,$2,$3,$4,'PROPOSED')",
      [id, w, c.draftId, c.version],
    );
    await emailTransition(tx, w, id, "PROPOSED", actor, {
      discloseToRecipients: true,
    });
    return { actionId: id, status: "PROPOSED" };
  }
  const a = await sendVersion(tx, w, c.actionId, actor);
  requireThat(a.draft_version === c.version, "EMAIL_ACTION_STALE");
  if (c.type === "email.reject") {
    requireThat(
      ["PROPOSED", "AUTHORIZED", "FAILED"].includes(a.status),
      "EMAIL_EFFECT_MAY_EXIST",
    );
    await tx.query(
      "UPDATE email_send SET status='REJECTED',safe_to_retry=false WHERE id=$1",
      [a.id],
    );
    await emailTransition(tx, w, a.id, "REJECTED", actor, { reason: c.reason });
    return { status: "REJECTED" };
  }
  await authenticatedSession(tx, actor, sessionId);
  const r = await mailbox(
    tx,
    w,
    actor,
    a.connection_id,
    c.type !== "email.reconcile",
  );
  requireThat(r.version === a.connection_version, "EMAIL_CONNECTION_STALE");
  if (c.type === "email.reconcile") {
    requireThat(a.status === "OUTCOME_UNKNOWN", "EMAIL_NOT_RECONCILABLE");
    return queueEmailRead(tx, w, actor, sessionId!, a.connection_id, {
      mode: "reconcile",
      actionId: a.id,
    });
  }
  requireThat(a.current_version === a.draft_version, "EMAIL_DRAFT_STALE");
  if (c.type === "email.authorize") {
    requireThat(
      ["PROPOSED", "FAILED"].includes(a.status),
      "EMAIL_NOT_AWAITING_AUTHORIZATION",
    );
    requireThat(
      c.expectedContextRevision === ws.context_revision &&
        c.expectedAccessRevision === ws.access_revision,
      "EMAIL_APPROVAL_STALE",
    );
    await validateEnvelope(tx, w, actor, a.envelope, a.connection_id, true);
    const authorizationId = randomUUID();
    await tx.query(
      "INSERT INTO email_authorization(id,workspace_id,action_id,draft_version,envelope_hash,person_id,session_id,membership_version,context_revision,access_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        authorizationId,
        w,
        a.id,
        a.draft_version,
        a.envelope_hash,
        actor,
        sessionId,
        r.member_version,
        ws.context_revision,
        ws.access_revision,
      ],
    );
    await tx.query(
      "UPDATE email_send SET status='AUTHORIZED',authorization_id=$2,safe_to_retry=false,error_code=NULL WHERE id=$1",
      [a.id, authorizationId],
    );
  } else {
    requireThat(
      c.type === "email.retry" &&
        a.status === "FAILED" &&
        a.safe_to_retry &&
        a.authorization_id,
      "EMAIL_RECONCILIATION_REQUIRED",
    );
    await tx.query(
      "UPDATE email_send SET status='AUTHORIZED',safe_to_retry=false,error_code=NULL WHERE id=$1",
      [a.id],
    );
  }
  await emailTransition(tx, w, a.id, "AUTHORIZED", actor, {
    discloseToRecipients: true,
  });
  await tx.query(
    "SELECT graphile_worker.add_job('email_send',json_build_object('id',$1::text))",
    [a.id],
  );
  return { status: "AUTHORIZED" };
}
