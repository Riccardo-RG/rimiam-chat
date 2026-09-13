import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { z } from "zod";
import { pool } from "./db.ts";
import { DomainError, requireThat } from "./errors.ts";
import {
  googleJSON,
  GoogleHTTPError,
  type GoogleAuthorization,
} from "./google-http.ts";

export type GoogleCapability = "calendar" | "email";
const scopeBase = "https://www.googleapis.com/auth/";
export const googleScopes = {
  calendar: [
    "openid",
    `${scopeBase}userinfo.email`,
    `${scopeBase}calendar.calendarlist.readonly`,
    `${scopeBase}calendar.events.owned`,
  ],
  email: [
    "openid",
    `${scopeBase}userinfo.email`,
    `${scopeBase}gmail.readonly`,
    `${scopeBase}gmail.send`,
  ],
} satisfies Record<GoogleCapability, string[]>;
export function googleConfiguration() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim(),
    clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (
    !clientId ||
    !clientSecret ||
    (process.env.BETTER_AUTH_SECRET?.length ?? 0) < 32
  )
    return undefined;
  const base = new URL(process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000");
  const redirect = new URL(
    process.env.GOOGLE_OAUTH_REDIRECT_URI ??
      "/api/v1/integrations/google/callback",
    base,
  );
  if (
    redirect.pathname !== "/api/v1/integrations/google/callback" ||
    redirect.search ||
    redirect.hash ||
    redirect.username ||
    redirect.password ||
    !(
      redirect.protocol === "https:" ||
      (redirect.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(redirect.hostname))
    )
  )
    return undefined;
  return {
    clientId,
    clientSecret,
    redirectUri: redirect.href,
    launchOrigin: redirect.origin,
    appOrigin: base.origin,
  };
}
function key() {
  requireThat(
    process.env.BETTER_AUTH_SECRET &&
      process.env.BETTER_AUTH_SECRET.length >= 32,
    "GOOGLE_CONFIGURATION_REQUIRED",
    503,
  );
  return createHash("sha256")
    .update(`miriam/google-credentials/v1\0${process.env.BETTER_AUTH_SECRET}`)
    .digest();
}
export function encryptGoogleSecret(value: string, purpose: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const content = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    content.toString("base64url"),
  ].join(".");
}
export function decryptGoogleSecret(value: string, purpose: string) {
  try {
    const [version, iv, tag, bytes] = value.split(".");
    requireThat(
      version === "v1" && iv && tag && bytes,
      "GOOGLE_RECONNECT_REQUIRED",
      503,
    );
    const cipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      Buffer.from(iv, "base64url"),
    );
    cipher.setAAD(Buffer.from(purpose));
    cipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      cipher.update(Buffer.from(bytes, "base64url")),
      cipher.final(),
    ]).toString("utf8");
  } catch {
    throw new DomainError("GOOGLE_RECONNECT_REQUIRED", 503);
  }
}
export const googleTokenSchema = z.object({
  access_token: z.string().min(1).max(10000),
  expires_in: z.number().int().positive().max(86400),
  token_type: z.literal("Bearer"),
  refresh_token: z.string().min(1).max(10000).optional(),
  scope: z.string().max(20000).optional(),
});

async function current(id: string, capability: GoogleCapability) {
  z.uuid().parse(id);
  const row = (
    await pool.query(
      `SELECT g.* FROM google_credential g
    JOIN membership m ON m.workspace_id=g.workspace_id AND m.user_id=g.person_id
    JOIN "user" u ON u.id=g.person_id
    LEFT JOIN calendar_connection c ON c.id=g.calendar_connection_id
    LEFT JOIN mailbox_connection e ON e.id=g.mailbox_connection_id
    WHERE g.id=$1 AND g.capability=$2 AND g.status='active' AND m.active AND m.contributes AND u.eligible AND u."emailVerified"
      AND m.version=g.membership_version
      AND ((g.capability='calendar' AND c.active AND c.person_id=g.person_id AND c.membership_version=m.version)
        OR (g.capability='email' AND e.active AND e.person_id=g.person_id AND e.membership_version=m.version))`,
      [id, capability],
    )
  ).rows[0];
  requireThat(row, "GOOGLE_CONNECTION_UNAVAILABLE", 403);
  return row;
}
export async function googleCredentialToken(
  id: string,
  capability: GoogleCapability,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<GoogleAuthorization> {
  let row = await current(id, capability);
  if (new Date(row.expires_at).getTime() <= Date.now() + 30000) {
    const config = googleConfiguration();
    requireThat(config && row.refresh_cipher, "GOOGLE_RECONNECT_REQUIRED", 503);
    const attempt = randomUUID();
    const claimed = await pool.query(
      "UPDATE google_credential SET refresh_attempt=$2,refresh_until=now()+interval '45 seconds' WHERE id=$1 AND status='active' AND version=$3 AND (refresh_until IS NULL OR refresh_until<now()) RETURNING id",
      [id, attempt, row.version],
    );
    requireThat(claimed.rowCount, "GOOGLE_REFRESH_IN_PROGRESS", 503);
    try {
      const tokens = googleTokenSchema.parse(
        await googleJSON(
          "https://oauth2.googleapis.com/token",
          {
            method: "POST",
            signal,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: config.clientId,
              client_secret: config.clientSecret,
              grant_type: "refresh_token",
              refresh_token: decryptGoogleSecret(
                row.refresh_cipher,
                `${id}:refresh`,
              ),
            }),
          },
          fetcher,
          32000,
        ),
      );
      const scopes = tokens.scope
        ? tokens.scope.split(" ")
        : (row.scopes as string[]);
      requireThat(
        googleScopes[capability].every((s) => scopes.includes(s)),
        "GOOGLE_SCOPE_REQUIRED",
        403,
      );
      await current(id, capability);
      const changed = await pool.query(
        "UPDATE google_credential SET access_cipher=$3,refresh_cipher=$4,expires_at=$5,scopes=$6,version=version+1,refresh_attempt=NULL,refresh_until=NULL WHERE id=$1 AND refresh_attempt=$2 AND status='active' RETURNING id",
        [
          id,
          attempt,
          encryptGoogleSecret(tokens.access_token, `${id}:access`),
          tokens.refresh_token
            ? encryptGoogleSecret(tokens.refresh_token, `${id}:refresh`)
            : row.refresh_cipher,
          new Date(Date.now() + tokens.expires_in * 1000),
          scopes,
        ],
      );
      requireThat(changed.rowCount, "GOOGLE_CONNECTION_UNAVAILABLE", 403);
    } catch (error) {
      const permanent =
        error instanceof GoogleHTTPError &&
        [400, 401].includes(error.httpStatus);
      await pool.query(
        "UPDATE google_credential SET status=CASE WHEN $3 THEN 'reconnect_required' ELSE status END,access_cipher=CASE WHEN $3 THEN NULL ELSE access_cipher END,refresh_cipher=CASE WHEN $3 THEN NULL ELSE refresh_cipher END,refresh_attempt=NULL,refresh_until=NULL,error_code=$4 WHERE id=$1 AND refresh_attempt=$2",
        [
          id,
          attempt,
          permanent,
          permanent ? "GOOGLE_RECONNECT_REQUIRED" : "GOOGLE_REFRESH_FAILED",
        ],
      );
      throw error;
    }
    row = await current(id, capability);
  }
  requireThat(row.access_cipher, "GOOGLE_RECONNECT_REQUIRED", 503);
  return {
    accessToken: decryptGoogleSecret(row.access_cipher, `${id}:access`),
    email: row.email,
    scopes: row.scopes,
  };
}
