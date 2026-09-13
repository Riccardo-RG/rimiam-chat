import { randomUUID } from "node:crypto";
import { pool, transaction, type Tx } from "./db.ts";
import { lockWorkspace } from "./workspace-state.ts";
import { authenticatedSession } from "./workspace-state.ts";
import { DomainError, requireThat } from "./errors.ts";
import {
  mailbox,
  mailAccess,
  sendVersion,
  validateEnvelope,
  emailHash,
  emailTransition,
  observedMessage,
  byteHash,
} from "./email-state.ts";
import {
  emailObservationSchema,
  emailReceiptSchema,
} from "../contracts/email.ts";
import {
  configuredEmailProvider,
  EmailNoEffect,
  mailboxIdentitySchema,
  type EmailProvider,
  type EmailReceipt,
  type EmailReconciliation,
} from "./email-provider.ts";
const code = (e: unknown) =>
  e instanceof DomainError || e instanceof EmailNoEffect
    ? e.code
    : "EMAIL_PROVIDER_ERROR";
const operationKey = (a: Record<string, unknown>) =>
  `miriam-email:${a.id}:${a.draft_version}`;
function providerFor(key: string, p?: EmailProvider) {
  const result = p ?? configuredEmailProvider();
  requireThat(result?.key === key, "EMAIL_PROVIDER_UNAVAILABLE", 503);
  return result;
}
async function validate(tx: Tx, w: string, id: string) {
  const ws = await lockWorkspace(tx, w),
    a = await sendVersion(tx, w, id);
  const approval = (
    await tx.query(
      "SELECT * FROM email_authorization WHERE workspace_id=$1 AND id=$2",
      [w, a.authorization_id],
    )
  ).rows[0];
  requireThat(
    approval &&
      approval.draft_version === a.draft_version &&
      approval.envelope_hash === a.envelope_hash &&
      a.envelope_hash === emailHash(a.envelope) &&
      approval.person_id === a.person_id &&
      a.current_version === a.draft_version,
    "EMAIL_AUTHORIZATION_REQUIRED",
    403,
  );
  const contents = await validateEnvelope(
      tx,
      w,
      a.person_id,
      a.envelope,
      a.connection_id,
      true,
    ),
    r = contents.connection;
  await authenticatedSession(tx, a.person_id, approval.session_id);
  requireThat(
    r.version === a.connection_version &&
      r.member_version === approval.membership_version,
    "EMAIL_ACCESS_CHANGED",
    403,
  );
  requireThat(
    ws.context_revision === approval.context_revision &&
      ws.access_revision === approval.access_revision,
    "EMAIL_APPROVAL_STALE",
  );
  return { a, r, contents };
}
async function failure(
  w: string,
  id: string,
  attempt: string,
  unknown: boolean,
  error: string,
) {
  await transaction(async (tx) => {
    await lockWorkspace(tx, w);
    const a = await sendVersion(tx, w, id);
    if (
      a.attempt_id !== attempt ||
      !["EXECUTING", "OUTCOME_UNKNOWN"].includes(a.status)
    )
      return;
    const status = unknown ? "OUTCOME_UNKNOWN" : "FAILED";
    await tx.query(
      "UPDATE email_send SET status=$2,error_code=$3,safe_to_retry=$4,lease_until=NULL WHERE id=$1",
      [id, status, error, !unknown],
    );
    await emailTransition(tx, w, id, status, null, { code: error });
  });
}
async function success(
  tx: Tx,
  w: string,
  a: Awaited<ReturnType<typeof sendVersion>>,
  raw: EmailReceipt,
) {
  const receipt = emailReceiptSchema.parse(raw);
  requireThat(
    receipt.operationKey === operationKey(a) &&
      receipt.envelopeHash === a.envelope_hash,
    "EMAIL_EFFECT_NOT_PROVEN",
  );
  await tx.query(
    "UPDATE email_send SET status='SUCCEEDED',receipt=$2,lease_until=NULL,error_code=NULL,safe_to_retry=false WHERE id=$1",
    [a.id, JSON.stringify(receipt)],
  );
  await emailTransition(tx, w, a.id, "SUCCEEDED", null, { receipt });
}
export async function processEmailSend(id: string, provider?: EmailProvider) {
  const w = (
    await pool.query("SELECT workspace_id FROM email_send WHERE id=$1", [id])
  ).rows[0]?.workspace_id;
  if (!w) return;
  const claim = await transaction(async (tx) => {
    await lockWorkspace(tx, w);
    const a = await sendVersion(tx, w, id);
    if (a.status !== "AUTHORIZED") return;
    try {
      const v = await validate(tx, w, id),
        p = providerFor(v.r.provider, provider),
        attempt = randomUUID();
      await tx.query(
        "UPDATE email_send SET status='EXECUTING',attempt_id=$2,lease_until=now()+interval '60 seconds',error_code=NULL WHERE id=$1",
        [id, attempt],
      );
      await emailTransition(tx, w, id, "EXECUTING", null, {
        phase: "preflight",
      });
      return { ...v, p, attempt };
    } catch (e) {
      await tx.query(
        "UPDATE email_send SET status='FAILED',error_code=$2,safe_to_retry=false WHERE id=$1",
        [id, code(e)],
      );
      await emailTransition(tx, w, id, "FAILED", null, {
        code: code(e),
        noEffect: true,
      });
    }
  });
  if (!claim) return;
  const { a, r, contents, p, attempt } = claim,
    access = mailAccess(r);
  try {
    const rights = mailboxIdentitySchema.parse(
      await p.checkAccess(access, AbortSignal.timeout(15000)),
    );
    requireThat(
      rights.accountRef === access.accountRef &&
        rights.sender === a.envelope.sender &&
        rights.canSendSelf &&
        rights.canRead,
      "EMAIL_SENDER_NOT_REPRESENTED",
      403,
    );
    if (contents.target) {
      const fetched = emailObservationSchema.parse(
        await p.fetch(
          access,
          "message",
          contents.target.id,
          undefined,
          AbortSignal.timeout(15000),
        ),
      );
      const target = fetched.messages.find((m) => m.id === contents.target!.id);
      requireThat(
        target && JSON.stringify(target) === JSON.stringify(contents.target),
        "EMAIL_THREAD_SOURCE_CHANGED",
      );
    }
    await transaction(async (tx) => {
      const current = await validate(tx, w, id);
      requireThat(
        current.a.status === "EXECUTING" &&
          current.a.attempt_id === attempt &&
          new Date(current.a.lease_until) > new Date(),
        "EMAIL_ATTEMPT_ENDED",
      );
      await emailTransition(tx, w, id, "EXECUTING", null, {
        phase: "commit_point",
        envelopeHash: a.envelope_hash,
        operationKey: operationKey(a),
      });
    });
  } catch (e) {
    await failure(w, id, attempt, false, code(e));
    return;
  }
  try {
    const receipt = await p.send(
      access,
      {
        operationKey: operationKey(a),
        envelopeHash: a.envelope_hash,
        envelope: contents.envelope,
        target: contents.target,
        attachments: contents.attachments,
      },
      AbortSignal.timeout(20000),
    );
    await transaction(async (tx) => {
      await lockWorkspace(tx, w);
      const current = await sendVersion(tx, w, id);
      if (
        current.attempt_id === attempt &&
        ["EXECUTING", "OUTCOME_UNKNOWN"].includes(current.status)
      )
        await success(tx, w, current, receipt);
    });
  } catch (e) {
    await failure(w, id, attempt, !(e instanceof EmailNoEffect), code(e));
  }
}
async function readBasis(tx: Tx, id: string) {
  const r = (await tx.query("SELECT * FROM email_read WHERE id=$1", [id]))
    .rows[0];
  requireThat(r, "EMAIL_READ_NOT_FOUND", 404);
  const c = await mailbox(tx, r.workspace_id, r.person_id, r.connection_id);
  await authenticatedSession(tx, r.person_id, r.session_id);
  requireThat(
    c.version === r.connection_version &&
      c.member_version === r.membership_version,
    "EMAIL_ACCESS_CHANGED",
    403,
  );
  return { r, c };
}
export async function processEmailRead(id: string, provider?: EmailProvider) {
  const w = (
    await pool.query("SELECT workspace_id FROM email_read WHERE id=$1", [id])
  ).rows[0]?.workspace_id;
  if (!w) return;
  const claim = await transaction(async (tx) => {
    await lockWorkspace(tx, w);
    if (
      (await tx.query("SELECT status FROM email_read WHERE id=$1", [id]))
        .rows[0].status !== "QUEUED"
    )
      return;
    try {
      const b = await readBasis(tx, id),
        p = providerFor(b.c.provider, provider),
        attempt = randomUUID();
      await tx.query(
        "UPDATE email_read SET status='READING',attempt_id=$2,lease_until=now()+interval '60 seconds' WHERE id=$1",
        [id, attempt],
      );
      return { ...b, p, attempt };
    } catch (e) {
      await tx.query(
        "UPDATE email_read SET status='FAILED',error_code=$2 WHERE id=$1",
        [id, code(e)],
      );
    }
  });
  if (!claim) return;
  const { r, c, p, attempt } = claim,
    request = r.request,
    access = mailAccess(c);
  try {
    const rights = mailboxIdentitySchema.parse(
      await p.checkAccess(access, AbortSignal.timeout(15000)),
    );
    requireThat(
      rights.accountRef === access.accountRef &&
        rights.sender === access.sender &&
        rights.canRead,
      "EMAIL_MAILBOX_ACCESS_DENIED",
      403,
    );
    let observation:
        ReturnType<typeof emailObservationSchema.parse> | undefined,
      attachment:
        | {
            bytes: Buffer;
            metadata: ReturnType<
              typeof emailObservationSchema.parse
            >["messages"][number]["attachments"][number];
          }
        | undefined,
      reconciliation: EmailReconciliation | undefined;
    if (request.mode === "reconcile") {
      const a = await transaction((tx) =>
        sendVersion(tx, w, request.actionId, r.person_id),
      );
      requireThat(a.status === "OUTCOME_UNKNOWN", "EMAIL_NOT_RECONCILABLE");
      reconciliation = await p.reconcile(
        access,
        operationKey(a),
        a.envelope_hash,
        AbortSignal.timeout(15000),
      );
    } else if (request.mode === "attachment") {
      const { message } = await transaction((tx) =>
        observedMessage(
          tx,
          w,
          r.person_id,
          request.observationId,
          request.messageId,
          c.id,
        ),
      );
      const metadata = message.attachments.find(
        (a) => a.id === request.attachmentId,
      );
      requireThat(metadata, "EMAIL_ATTACHMENT_NOT_FOUND", 404);
      const bytes = await p.attachment(
        access,
        message,
        metadata.id,
        AbortSignal.timeout(15000),
      );
      requireThat(
        Buffer.isBuffer(bytes) &&
          bytes.length === metadata.size &&
          bytes.length <= 1048576 &&
          byteHash(bytes) === metadata.hash,
        "EMAIL_ATTACHMENT_HASH_MISMATCH",
      );
      attachment = { bytes, metadata };
    } else {
      observation = emailObservationSchema.parse(
        await (request.mode === "search"
          ? p.search(
              access,
              request.query,
              request.cursor,
              AbortSignal.timeout(15000),
            )
          : p.fetch(
              access,
              request.mode,
              request.targetId,
              request.cursor,
              AbortSignal.timeout(15000),
            )),
      );
      if (request.mode === "message")
        requireThat(
          observation.messages.every((m) => m.id === request.targetId),
          "EMAIL_PROVIDER_OUTSIDE_REQUEST",
        );
      if (request.mode === "thread")
        requireThat(
          observation.messages.every((m) => m.threadId === request.targetId),
          "EMAIL_PROVIDER_OUTSIDE_REQUEST",
        );
    }
    await transaction(async (tx) => {
      await lockWorkspace(tx, w);
      const current = await readBasis(tx, id);
      if (current.r.status !== "READING" || current.r.attempt_id !== attempt)
        return;
      if (observation)
        await tx.query(
          "INSERT INTO email_observation(id,workspace_id,connection_id,person_id,read_id,data) VALUES($1,$2,$3,$4,$5,$6)",
          [randomUUID(), w, c.id, r.person_id, id, JSON.stringify(observation)],
        );
      if (attachment)
        await tx.query(
          "INSERT INTO email_attachment(id,workspace_id,connection_id,person_id,observation_id,message_id,external_id,filename,media_type,content_hash,bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
          [
            randomUUID(),
            w,
            c.id,
            r.person_id,
            request.observationId,
            request.messageId,
            attachment.metadata.id,
            attachment.metadata.filename,
            attachment.metadata.mediaType,
            attachment.metadata.hash,
            attachment.bytes,
          ],
        );
      if (reconciliation) {
        const a = await sendVersion(tx, w, request.actionId, r.person_id);
        if (a.status === "OUTCOME_UNKNOWN") {
          if (reconciliation.outcome === "accepted")
            await success(tx, w, a, reconciliation.receipt);
          else if (reconciliation.outcome === "not_accepted") {
            requireThat(
              typeof reconciliation.proof === "string" &&
                reconciliation.proof.length > 0 &&
                reconciliation.proof.length <= 2000,
              "EMAIL_ABSENCE_NOT_PROVEN",
            );
            await tx.query(
              "UPDATE email_send SET status='FAILED',error_code='EMAIL_CONFIRMED_NOT_ACCEPTED',safe_to_retry=true WHERE id=$1",
              [a.id],
            );
            await emailTransition(tx, w, a.id, "FAILED", r.person_id, {
              noEffect: true,
              proof: reconciliation.proof,
            });
          } else {
            requireThat(
              reconciliation.outcome === "unknown",
              "EMAIL_RECONCILIATION_INVALID",
            );
            await emailTransition(tx, w, a.id, "OUTCOME_UNKNOWN", r.person_id, {
              reconciled: false,
            });
          }
        }
      }
      await tx.query(
        "UPDATE email_read SET status='COMPLETED',lease_until=NULL WHERE id=$1",
        [id],
      );
    });
  } catch (e) {
    await transaction(async (tx) => {
      await lockWorkspace(tx, w);
      await tx.query(
        "UPDATE email_read SET status='FAILED',error_code=$3,lease_until=NULL WHERE id=$1 AND attempt_id=$2 AND status='READING'",
        [id, attempt, code(e)],
      );
    });
  }
}
export async function recoverEmail() {
  for (const a of (
    await pool.query(
      "SELECT * FROM email_send WHERE status='EXECUTING' AND lease_until<now()",
    )
  ).rows)
    await failure(
      a.workspace_id,
      a.id,
      a.attempt_id,
      true,
      "EMAIL_SEND_INTERRUPTED",
    );
  await transaction(async (tx) => {
    await tx.query(
      "UPDATE email_read SET status='QUEUED',attempt_id=NULL,lease_until=NULL WHERE status='READING' AND lease_until<now()",
    );
    for (const a of (
      await tx.query("SELECT id FROM email_send WHERE status='AUTHORIZED'")
    ).rows)
      await tx.query(
        "SELECT graphile_worker.add_job('email_send',json_build_object('id',$1::text),job_key:=$2)",
        [a.id, `email:${a.id}`],
      );
    for (const r of (
      await tx.query("SELECT id FROM email_read WHERE status='QUEUED'")
    ).rows)
      await tx.query(
        "SELECT graphile_worker.add_job('email_read',json_build_object('id',$1::text),job_key:=$2)",
        [r.id, `email-read:${r.id}`],
      );
  });
}
