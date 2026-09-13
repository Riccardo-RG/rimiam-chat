import { z } from "zod";
import { pool, transaction, type Tx } from "./db.ts";
import { encryptAccountLink, decryptAccountLink } from "./account-delivery.ts";
import {
  configuredInvitationMail,
  invitationPayloadSchema,
  type InvitationMailTransport,
} from "./invitation-mail.ts";
import { changed, lockWorkspace } from "./workspace-state.ts";

const associated = (id: string, field: string) =>
  JSON.stringify(["invitation", id, field]);
async function queue(tx: Tx, id: string) {
  await tx.query(
    "SELECT graphile_worker.add_job('invitation_mail',json_build_object('invitationId',$1::text),max_attempts:=5,job_key:=$2)",
    [id, `invitation-mail:${id}`],
  );
}
async function event(tx: Tx, w: string, id: string) {
  await tx.query(
    "INSERT INTO invitation_delivery_event(invitation_id,attempt,status,error_code) SELECT invitation_id,attempts,status,error_code FROM invitation_delivery WHERE invitation_id=$1",
    [id],
  );
  await changed(tx, w, "invitation.delivery");
}
export async function enqueueInvitationMail(
  tx: Tx,
  w: string,
  id: string,
  url: string,
) {
  await tx.query(
    "INSERT INTO invitation_delivery(invitation_id,encrypted_link) VALUES($1,$2)",
    [id, encryptAccountLink(url, associated(id, "link"))],
  );
  await event(tx, w, id);
  await queue(tx, id);
}

export async function processInvitationMail(
  id: string,
  supplied?: InvitationMailTransport,
) {
  z.uuid().parse(id);
  const lookup = (
    await pool.query("SELECT workspace_id FROM invitation WHERE id=$1", [id])
  ).rows[0];
  if (!lookup) return;
  const w = lookup.workspace_id as string;
  let sender: InvitationMailTransport | undefined;
  try {
    sender = supplied ?? configuredInvitationMail();
  } catch {
    /* Retain pending delivery until configured; never fake success. */
  }
  const claim = await transaction(async (tx) => {
    await lockWorkspace(tx, w);
    const r = (
      await tx.query(
        "SELECT d.*,i.recipient_email,i.issuer_id,i.relationship_id,i.expires_at,i.revoked_at,i.accepted_at FROM invitation_delivery d JOIN invitation i ON i.id=d.invitation_id WHERE d.invitation_id=$1 FOR UPDATE OF d",
        [id],
      )
    ).rows[0];
    if (
      !r ||
      ["submitted", "cancelled", "expired"].includes(r.status) ||
      (r.status === "running" && r.lease_until > new Date())
    )
      return;
    // A retry reuses the frozen payload/key only within one hour of the first dispatch (Resend retains keys for 24h).
    // Never repeat an uncertain external effect after that window, including after long downtime.
    if (r.committed_at && Date.now() - r.committed_at.getTime() >= 3600000) {
      if (
        r.status !== "unknown" ||
        r.error_code !== "MAIL_RECONCILIATION_REQUIRED"
      ) {
        await tx.query(
          "UPDATE invitation_delivery SET status='unknown',lease_until=NULL,error_code='MAIL_RECONCILIATION_REQUIRED' WHERE invitation_id=$1",
          [id],
        );
        await event(tx, w, id);
      }
      return;
    }
    const valid = (
      await tx.query(
        'SELECT 1 FROM access_relationship a JOIN membership m ON m.workspace_id=a.workspace_id AND m.user_id=a.holder_id JOIN "user" u ON u.id=m.user_id WHERE a.workspace_id=$1 AND a.id=$2 AND a.holder_id=$3 AND a.active AND a.invitations AND m.active AND u.eligible AND u."emailVerified" FOR SHARE OF u',
        [w, r.relationship_id, r.issuer_id],
      )
    ).rowCount;
    if (r.revoked_at || r.accepted_at || !valid || r.expires_at <= new Date()) {
      await tx.query(
        "UPDATE invitation_delivery SET status=$2,lease_until=NULL,error_code=$3 WHERE invitation_id=$1",
        [
          id,
          r.committed_at
            ? "unknown"
            : r.expires_at <= new Date()
              ? "expired"
              : "cancelled",
          r.committed_at
            ? "MAIL_RECONCILIATION_REQUIRED"
            : "INVITATION_NO_LONGER_VALID",
        ],
      );
      await event(tx, w, id);
      return;
    }
    let payload;
    try {
      if (!sender) throw new Error();
      payload = r.encrypted_payload
        ? invitationPayloadSchema.parse(
            JSON.parse(
              decryptAccountLink(
                r.encrypted_payload,
                associated(id, "payload"),
              ),
            ),
          )
        : sender.prepare(
            r.recipient_email,
            decryptAccountLink(r.encrypted_link, associated(id, "link")),
          );
    } catch {
      if (r.status !== "needs_configuration") {
        await tx.query(
          "UPDATE invitation_delivery SET status='needs_configuration',lease_until=NULL,error_code='MAIL_CONFIGURATION_REQUIRED' WHERE invitation_id=$1",
          [id],
        );
        await event(tx, w, id);
      }
      return;
    }
    await tx.query(
      "UPDATE invitation_delivery SET status='running',attempts=attempts+1,lease_until=now()+interval '45 seconds',error_code=NULL,committed_at=coalesce(committed_at,now()),encrypted_payload=coalesce(encrypted_payload,$2) WHERE invitation_id=$1",
      [
        id,
        encryptAccountLink(JSON.stringify(payload), associated(id, "payload")),
      ],
    );
    await event(tx, w, id);
    // This short, validated transaction is the dispatch Commit Point; later revocation invalidates admission, not an email already sent.
    return { payload, attempt: r.attempts + 1 };
  });
  if (!claim || !sender) return;
  let deliveryId: string | undefined;
  try {
    deliveryId = z
      .string()
      .min(1)
      .max(200)
      .parse((await sender.send(claim.payload, `invitation/${id}`)).deliveryId);
  } catch {
    /* Unknown, not failed/delivered. */
  }
  await transaction(async (tx) => {
    await lockWorkspace(tx, w);
    const updated = await tx.query(
      "UPDATE invitation_delivery SET status=$3,provider_delivery_id=$4,submitted_at=CASE WHEN $4::text IS NOT NULL THEN now() ELSE NULL END,lease_until=NULL,error_code=$5 WHERE invitation_id=$1 AND attempts=$2 AND status='running' RETURNING invitation_id",
      [
        id,
        claim.attempt,
        deliveryId ? "submitted" : "unknown",
        deliveryId ?? null,
        deliveryId ? null : "MAIL_DELIVERY_UNCONFIRMED",
      ],
    );
    if (updated.rowCount) await event(tx, w, id);
  });
  if (!deliveryId) throw new Error("INVITATION_MAIL_DELIVERY_PENDING");
}

export async function recoverInvitationMail() {
  let configured = false;
  try {
    configuredInvitationMail();
    configured = true;
  } catch {
    /* No synthetic mail transport. */
  }
  const rows = (
    await pool.query(
      "SELECT invitation_id FROM invitation_delivery WHERE status='queued' OR ($1 AND status='needs_configuration') OR status='running' AND lease_until<now() OR status='unknown' AND error_code IS DISTINCT FROM 'MAIL_RECONCILIATION_REQUIRED' AND (lease_until IS NULL OR lease_until<now())",
      [configured],
    )
  ).rows;
  for (const row of rows)
    await transaction(async (tx) => {
      await queue(tx, row.invitation_id);
    });
}
