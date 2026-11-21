import { emailReceiptSchema } from "../contracts/email.ts";
import { pool } from "./db.ts";
import { requireThat } from "./errors.ts";
import type { EmailEffect } from "./email-provider.ts";
import { expectedEnvelope } from "./email-mime.ts";

// A worker restart must never submit again just because a provider's reply was lost.
export async function reserveEmailDelivery(
  account: string,
  effect: EmailEffect,
  messageId: string,
  provider: "GOOGLE" | "MICROSOFT",
) {
  const reserved = await pool.query(
    `INSERT INTO google_email_delivery(credential_id,operation_key,envelope_hash,internet_message_id,expected,status)
     VALUES($1,$2,$3,$4,$5,'sending') ON CONFLICT(credential_id,operation_key) DO UPDATE SET status='sending'
     WHERE google_email_delivery.status='rejected' AND google_email_delivery.envelope_hash=EXCLUDED.envelope_hash RETURNING operation_key`,
    [
      account,
      effect.operationKey,
      effect.envelopeHash,
      messageId,
      expectedEnvelope(effect),
    ],
  );
  if (reserved.rowCount) return null;
  const old = (
    await pool.query(
      "SELECT envelope_hash,status,receipt FROM google_email_delivery WHERE credential_id=$1 AND operation_key=$2",
      [account, effect.operationKey],
    )
  ).rows[0];
  requireThat(
    old?.envelope_hash === effect.envelopeHash,
    provider + "_EMAIL_OPERATION_MISMATCH",
  );
  if (old.status === "accepted") return emailReceiptSchema.parse(old.receipt);
  throw new Error(provider + "_EMAIL_OUTCOME_UNKNOWN");
}
