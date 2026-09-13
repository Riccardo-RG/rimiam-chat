import { createHash, randomUUID } from "node:crypto";
import { transaction, type Tx } from "./db.ts";
import { member, lockWorkspace, eligible } from "./workspace-state.ts";
import { authenticatedSession } from "./workspace-state.ts";
import { requireThat } from "./errors.ts";
import {
  emailEnvelopeSchema,
  emailMessageSchema,
  type EmailEnvelope,
} from "../contracts/email.ts";
import {
  mailboxIdentitySchema,
  type EmailProvider,
  type EmailEffect,
  type EmailAccess,
} from "./email-provider.ts";
export const emailHash = (value: EmailEnvelope) =>
  createHash("sha256")
    .update(JSON.stringify(emailEnvelopeSchema.parse(value)))
    .digest("hex");
export const byteHash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export async function mailbox(
  tx: Tx,
  w: string,
  actor: string,
  id: string,
  write = false,
) {
  await member(tx, w, actor, true, true);
  const r = (
    await tx.query(
      `SELECT c.*,m.version AS member_version FROM mailbox_connection c JOIN membership m ON m.workspace_id=c.workspace_id AND m.user_id=c.person_id WHERE c.workspace_id=$1 AND c.id=$2 AND c.person_id=$3 FOR SHARE OF c`,
      [w, id, actor],
    )
  ).rows[0];
  requireThat(
    r &&
      r.active &&
      r.membership_version === r.member_version &&
      r.can_read &&
      (!write || r.can_send),
    "EMAIL_MAILBOX_ACCESS_DENIED",
    403,
  );
  return r;
}
export const mailAccess = (r: Record<string, unknown>): EmailAccess => ({
  connectionId: r.id as string,
  accountRef: r.account_ref as string,
  sender: r.sender as string,
});
// Trusted server seam only: WIRE caller must first verify the external account, never a public ownership claim.
export async function establishMailbox(
  actor: string,
  w: string,
  sessionId: string,
  p: EmailProvider,
  verifiedAccountRef: string,
  label: string,
  finalize?: (tx: Tx, connectionId: string) => Promise<void>,
) {
  await transaction(async (tx) => {
    await member(tx, w, actor, true);
    await authenticatedSession(tx, actor, sessionId);
  });
  const identity = mailboxIdentitySchema.parse(
    await p.discover(verifiedAccountRef, AbortSignal.timeout(15000)),
  );
  requireThat(
    identity.accountRef === verifiedAccountRef,
    "EMAIL_MAILBOX_IDENTITY_MISMATCH",
    403,
  );
  requireThat(
    label.trim().length > 0 && label.length <= 200,
    "INVALID_REQUEST",
    400,
  );
  return transaction(async (tx) => {
    await lockWorkspace(tx, w);
    await member(tx, w, actor, true, true);
    await authenticatedSession(tx, actor, sessionId);
    const m = (
      await tx.query(
        "SELECT version FROM membership WHERE workspace_id=$1 AND user_id=$2",
        [w, actor],
      )
    ).rows[0];
    const id = randomUUID();
    await tx.query(
      "INSERT INTO mailbox_connection(id,workspace_id,person_id,provider,account_ref,sender,label,membership_version,can_read,can_send) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        id,
        w,
        actor,
        p.key,
        identity.accountRef,
        identity.sender,
        label,
        m.version,
        identity.canRead,
        identity.canSendSelf,
      ],
    );
    await tx.query(
      "INSERT INTO mailbox_history(workspace_id,connection_id,version,actor_id,active,basis) VALUES($1,$2,1,$3,true,'verified_external_mailbox')",
      [w, id, actor],
    );
    // Trusted integration finalization is atomic with connection/history creation.
    await finalize?.(tx, id);
    return { connectionId: id, sender: identity.sender };
  });
}
export async function observedMessage(
  tx: Tx,
  w: string,
  actor: string,
  observationId: string,
  messageId: string,
  connectionId?: string,
) {
  const o = (
    await tx.query(
      "SELECT * FROM email_observation WHERE workspace_id=$1 AND id=$2 AND person_id=$3",
      [w, observationId, actor],
    )
  ).rows[0];
  requireThat(
    o && (!connectionId || o.connection_id === connectionId),
    "EMAIL_OBSERVATION_NOT_FOUND",
    404,
  );
  await mailbox(tx, w, actor, o.connection_id);
  const m = o.data.messages.find((m: { id: string }) => m.id === messageId);
  requireThat(m, "EMAIL_MESSAGE_NOT_FOUND", 404);
  return { observation: o, message: emailMessageSchema.parse(m) };
}
export async function draftVersion(
  tx: Tx,
  w: string,
  id: string,
  actor?: string,
) {
  const d = (
    await tx.query(
      `SELECT d.*,v.* FROM email_draft d JOIN email_draft_version v ON v.workspace_id=d.workspace_id AND v.draft_id=d.id AND v.version=d.current_version WHERE d.workspace_id=$1 AND d.id=$2`,
      [w, id],
    )
  ).rows[0];
  requireThat(
    d && (!actor || d.person_id === actor),
    "EMAIL_DRAFT_NOT_FOUND",
    404,
  );
  return d;
}
export async function sendVersion(
  tx: Tx,
  w: string,
  id: string,
  actor?: string,
) {
  const a = (
    await tx.query(
      `SELECT a.*,d.person_id,d.current_version,v.connection_id,v.connection_version,v.envelope,v.envelope_hash FROM email_send a JOIN email_draft d ON d.id=a.draft_id JOIN email_draft_version v ON v.workspace_id=a.workspace_id AND v.draft_id=a.draft_id AND v.version=a.draft_version WHERE a.workspace_id=$1 AND a.id=$2`,
      [w, id],
    )
  ).rows[0];
  requireThat(
    a && (!actor || a.person_id === actor),
    "EMAIL_ACTION_NOT_FOUND",
    404,
  );
  return a;
}
export async function emailAttachments(
  tx: Tx,
  w: string,
  actor: string,
  e: EmailEnvelope,
) {
  const result: EmailEffect["attachments"] = [];
  for (const a of e.attachments) {
    let bytes: Buffer, mediaType: string;
    if (a.kind === "workspace_source") {
      const s = (
        await tx.query(
          `SELECT * FROM external_source s WHERE s.workspace_id=$1 AND s.id=$2 AND s.kind='document' AND NOT EXISTS(SELECT 1 FROM external_source n WHERE n.workspace_id=s.workspace_id AND n.document_id=s.document_id AND n.document_version>s.document_version)`,
          [w, a.id],
        )
      ).rows[0];
      requireThat(
        s &&
          s.document_version === a.version &&
          s.content_hash === a.hash &&
          s.filename === a.filename,
        "EMAIL_ATTACHMENT_STALE_OR_DENIED",
      );
      bytes = s.original_bytes;
      mediaType = s.media_type;
    } else {
      const s = (
        await tx.query(
          "SELECT * FROM email_attachment WHERE workspace_id=$1 AND id=$2 AND person_id=$3",
          [w, a.id, actor],
        )
      ).rows[0];
      requireThat(
        s &&
          s.version === a.version &&
          s.content_hash === a.hash &&
          s.filename === a.filename,
        "EMAIL_ATTACHMENT_STALE_OR_DENIED",
        403,
      );
      await mailbox(tx, w, actor, s.connection_id);
      bytes = s.bytes;
      mediaType = s.media_type;
    }
    requireThat(byteHash(bytes) === a.hash, "EMAIL_ATTACHMENT_HASH_MISMATCH");
    result.push({ filename: a.filename, mediaType, hash: a.hash, bytes });
  }
  requireThat(
    result.reduce((n, a) => n + a.bytes.length, 0) <= 5 * 1048576,
    "EMAIL_ATTACHMENTS_TOO_LARGE",
    413,
  );
  return result;
}
export async function validateEnvelope(
  tx: Tx,
  w: string,
  actor: string,
  raw: EmailEnvelope,
  connectionId: string | null,
  sending = false,
) {
  const e = emailEnvelopeSchema.parse(raw),
    r = connectionId
      ? await mailbox(tx, w, actor, connectionId, sending)
      : null;
  if (r)
    requireThat(r.sender === e.sender, "EMAIL_SENDER_NOT_REPRESENTED", 403);
  else {
    const u = await eligible(tx, actor);
    requireThat(
      !sending && e.sender === u.email.toLowerCase(),
      "EMAIL_VERIFIED_MAILBOX_REQUIRED",
      403,
    );
  }
  const recipients = [...e.to, ...e.cc, ...e.bcc];
  requireThat(
    recipients.length <= 20 &&
      new Set(recipients).size === recipients.length &&
      (!sending || recipients.length > 0),
    "EMAIL_RECIPIENTS_INVALID",
    400,
  );
  requireThat(
    (e.kind === "new") === (e.target === null),
    "EMAIL_TARGET_REQUIRED",
    400,
  );
  const target = e.target
    ? (
        await observedMessage(
          tx,
          w,
          actor,
          e.target.observationId,
          e.target.messageId,
          connectionId ?? undefined,
        )
      ).message
    : null;
  requireThat(!target || r, "EMAIL_VERIFIED_MAILBOX_REQUIRED", 403);
  const attachments = await emailAttachments(tx, w, actor, e);
  return { envelope: e, target, attachments, connection: r };
}
export async function emailTransition(
  tx: Tx,
  w: string,
  id: string,
  status: string,
  actor: string | null,
  detail: Record<string, unknown> = {},
) {
  await tx.query(
    `INSERT INTO email_transition(id,workspace_id,action_id,status,actor_id,authorization_id,attempt_id,detail) SELECT $1,workspace_id,id,$4,$5,authorization_id,attempt_id,$6 FROM email_send WHERE workspace_id=$2 AND id=$3`,
    [randomUUID(), w, id, status, actor, JSON.stringify(detail)],
  );
  // No shared revision hint for a private mailbox operation.
}
