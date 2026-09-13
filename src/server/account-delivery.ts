import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { z } from "zod";
import { transaction, pool } from "./db.ts";
import {
  configuredVerificationMail,
  type VerificationMailTransport,
} from "./verification-mail.ts";
type Kind = "verification" | "password-reset";
function key() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("ACCOUNT_MAIL_KEY_REQUIRED");
  return Buffer.from(
    hkdfSync("sha256", secret, "miriam-account-mail-v1", "link encryption", 32),
  );
}
export function encryptAccountLink(link: string, aad: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(aad));
  const bytes = Buffer.concat([cipher.update(link, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), bytes]
    .map((b) => b.toString("base64url"))
    .join(".");
}
export function decryptAccountLink(encrypted: string, aad: string) {
  const [iv, tag, body] = encrypted
    .split(".")
    .map((s) => Buffer.from(s, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(aad));
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(body), cipher.final()]).toString("utf8");
}
const associated = (id: string, kind: Kind, recipient: string) =>
  JSON.stringify([id, kind, recipient]);
export async function enqueueAccountMail(
  kind: Kind,
  recipient: string,
  url: string,
) {
  z.email().parse(recipient);
  z.url().parse(url);
  const dedup = createHash("sha256")
    .update(JSON.stringify([kind, recipient, url]))
    .digest("hex");
  return transaction(async (tx) => {
    const id = randomUUID();
    const inserted = await tx.query(
      "INSERT INTO account_delivery(id,deduplication_key,kind,recipient,encrypted_link,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '1 hour') ON CONFLICT(deduplication_key) DO NOTHING RETURNING id",
      [
        id,
        dedup,
        kind,
        recipient,
        encryptAccountLink(url, associated(id, kind, recipient)),
      ],
    );
    if (!inserted.rowCount) return;
    await tx.query(
      "SELECT graphile_worker.add_job('account_mail',json_build_object('deliveryId',$1::text),max_attempts:=5,job_key:=$2)",
      [id, `account-mail:${id}`],
    );
  });
}
export async function processAccountMail(
  id: string,
  supplied?: VerificationMailTransport,
) {
  z.uuid().parse(id);
  const row = await transaction(async (tx) => {
    const r = (
      await tx.query("SELECT * FROM account_delivery WHERE id=$1 FOR UPDATE", [
        id,
      ])
    ).rows[0];
    if (
      !r ||
      r.status === "delivered" ||
      r.status === "expired" ||
      (r.status === "running" && r.lease_until > new Date())
    )
      return null;
    if (r.expires_at <= new Date()) {
      await tx.query(
        "UPDATE account_delivery SET status='expired',lease_until=NULL WHERE id=$1",
        [id],
      );
      return null;
    }
    await tx.query(
      "UPDATE account_delivery SET status='running',attempts=attempts+1,lease_until=now()+interval '45 seconds',error_code=NULL WHERE id=$1",
      [id],
    );
    r.attempts++;
    return r;
  });
  if (!row) return;
  let sender: VerificationMailTransport;
  try {
    sender = supplied ?? configuredVerificationMail();
  } catch {
    await pool.query(
      "UPDATE account_delivery SET status='needs_configuration',lease_until=NULL,error_code='MAIL_CONFIGURATION_REQUIRED' WHERE id=$1 AND attempts=$2 AND status='running'",
      [id, row.attempts],
    );
    return;
  }
  try {
    const url = decryptAccountLink(
      row.encrypted_link,
      associated(id, row.kind, row.recipient),
    );
    // Stable link/content-derived provider key; retry window <=1h, below the provider's deduplication window.
    const result = await (row.kind === "verification"
      ? sender.sendVerification(row.recipient, url)
      : sender.sendPasswordReset(row.recipient, url));
    await pool.query(
      "UPDATE account_delivery SET status='delivered',provider_delivery_id=$3,delivered_at=now(),lease_until=NULL WHERE id=$1 AND attempts=$2 AND status='running'",
      [id, row.attempts, result.deliveryId],
    );
  } catch {
    await pool.query(
      "UPDATE account_delivery SET status='unknown',error_code='MAIL_DELIVERY_UNCONFIRMED',lease_until=NULL WHERE id=$1 AND attempts=$2 AND status='running'",
      [id, row.attempts],
    );
    // Graphile logs only this safe code and the job ID, never URLs or token-bearing provider responses.
    throw new Error("ACCOUNT_MAIL_DELIVERY_PENDING");
  }
}
export async function recoverAccountMail() {
  const configured =
    process.env.MAIL_PROVIDER === "resend" &&
    process.env.RESEND_API_KEY &&
    process.env.MAIL_FROM;
  const rows = (
    await pool.query(
      "SELECT id FROM account_delivery WHERE expires_at<=now() AND status NOT IN ('delivered','expired') OR status='running' AND lease_until<now() OR ($1 AND status='needs_configuration' AND expires_at>now())",
      [Boolean(configured)],
    )
  ).rows;
  for (const row of rows)
    await transaction(async (tx) => {
      const current = (
        await tx.query(
          "SELECT * FROM account_delivery WHERE id=$1 FOR UPDATE",
          [row.id],
        )
      ).rows[0];
      if (["delivered", "expired"].includes(current.status)) return;
      if (current.expires_at <= new Date()) {
        await tx.query(
          "UPDATE account_delivery SET status='expired',lease_until=NULL WHERE id=$1",
          [row.id],
        );
        return;
      }
      if (current.status === "running" && current.lease_until > new Date())
        return;
      await tx.query(
        "UPDATE account_delivery SET status='queued',lease_until=NULL WHERE id=$1",
        [row.id],
      );
      await tx.query(
        "SELECT graphile_worker.add_job('account_mail',json_build_object('deliveryId',$1::text),max_attempts:=5,job_key:=$2)",
        [row.id, `account-mail:${row.id}`],
      );
    });
}
