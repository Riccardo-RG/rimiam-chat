import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { apiVersion, errorSchema } from "../contracts/v1.ts";
import { auth } from "./auth.ts";
import { nativeSession } from "./native-session.ts";
import { assertOrigin, body } from "./http.ts";
import { pool, transaction, type Tx } from "./db.ts";
import { member } from "./workspace-state.ts";
import { requireThat, DomainError } from "./errors.ts";
import { establishCalendarConnection } from "./calendar-state.ts";
import { establishMailbox } from "./email-state.ts";
import { googleCalendarProvider } from "./google-calendar.ts";
import { googleEmailProvider } from "./google-email.ts";
import {
  googleConfiguration,
  googleScopes,
  googleTokenSchema,
  encryptGoogleSecret,
  decryptGoogleSecret,
  type GoogleCapability,
} from "./google-credentials.ts";
import { googleHash, googleJSON, type GoogleToken } from "./google-http.ts";

const headers = {
  "X-Miriam-API-Version": apiVersion,
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
};
const random = () => randomBytes(32).toString("base64url");
async function session(request: Request) {
  if (request.headers.has("authorization")) return nativeSession(request);
  if (request.method !== "GET") assertOrigin(request);
  const s = await auth.api.getSession({ headers: request.headers });
  requireThat(s, "AUTHENTICATION_REQUIRED", 401);
  return s;
}
async function validate(
  tx: Tx,
  row: {
    person_id: string;
    workspace_id: string;
    session_id: string;
    membership_version: number;
  },
) {
  await member(tx, row.workspace_id, row.person_id, true, true);
  requireThat(
    (
      await tx.query(
        'SELECT 1 FROM session WHERE id=$1 AND "userId"=$2 AND "expiresAt">now()',
        [row.session_id, row.person_id],
      )
    ).rowCount,
    "AUTHENTICATION_REQUIRED",
    401,
  );
  requireThat(
    (
      await tx.query(
        "SELECT 1 FROM membership WHERE workspace_id=$1 AND user_id=$2 AND version=$3 AND active AND contributes",
        [row.workspace_id, row.person_id, row.membership_version],
      )
    ).rowCount,
    "GOOGLE_ACCESS_CHANGED",
    403,
  );
}
function callbackPage(
  ok: boolean,
  appOrigin: string,
  workspace?: string,
  errorCode?: string,
) {
  const link = new URL("/", appOrigin);
  if (workspace) link.searchParams.set("workspace", workspace);
  return new Response(
    `<!doctype html><html lang="it"><meta name="viewport" content="width=device-width"><title>MIRIAM · Google</title><body><h1>${ok ? "Connessione Google pronta" : "Connessione non completata"}</h1><p>${ok ? "Puoi tornare a MIRIAM e aggiornare Calendar o Email. Nessun contenuto è stato condiviso e nessuna azione è stata eseguita." : errorCode === "GOOGLE_ACCOUNT_MISMATCH" ? "Usa un account Google con lo stesso indirizzo email verificato del tuo account MIRIAM." : "Ritorna a MIRIAM e riprova il collegamento. Nessuna autorizzazione di progetto è stata creata."}</p><a href="${link.href.replaceAll("&", "&amp;")}">Torna a MIRIAM</a></body></html>`,
    {
      status: ok ? 200 : 400,
      headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

// Same transport for web and native. System-browser handoff never contains an app session token.
export async function handleGoogleIntegration(
  request: Request,
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  const url = new URL(request.url),
    match = url.pathname.match(
      /^\/api\/v1\/workspaces\/([^/]+)\/google-connect$/,
    );
  const root = "/api/v1/integrations/google/";
  if (!match && !url.pathname.startsWith(root)) return null;
  try {
    if (url.pathname === `${root}status` && request.method === "GET") {
      await session(request);
      return Response.json(
        {
          configured: !!googleConfiguration(),
          capabilities: ["calendar", "email"],
        },
        { headers },
      );
    }
    const config = googleConfiguration();
    requireThat(config, "GOOGLE_CONFIGURATION_REQUIRED", 503);
    if (match && request.method === "POST") {
      const s = await session(request),
        w = z.uuid().parse(match[1]);
      const input = z
        .object({ capability: z.enum(["calendar", "email"]) })
        .strict()
        .parse(await body(request));
      const id = randomUUID(),
        state = random(),
        ticket = random(),
        verifier = random(),
        expires = new Date(Date.now() + 10 * 60 * 1000);
      await transaction(async (tx) => {
        await member(tx, w, s.user.id, true, true);
        await tx.query(
          "UPDATE google_oauth_request SET status='failed',verifier_cipher='',error_code='GOOGLE_OAUTH_EXPIRED' WHERE expires_at<now() AND status IN ('pending','launched','exchanging')",
        );
        await tx.query(
          "UPDATE google_credential SET status='revoked',access_cipher=NULL,refresh_cipher=NULL,error_code='GOOGLE_OAUTH_EXPIRED' WHERE status='connecting' AND created_at<now()-interval '10 minutes'",
        );
        const m = (
          await tx.query(
            "SELECT version FROM membership WHERE workspace_id=$1 AND user_id=$2",
            [w, s.user.id],
          )
        ).rows[0];
        const recent = (
          await tx.query(
            "SELECT count(*)::int AS count FROM google_oauth_request WHERE person_id=$1 AND created_at>now()-interval '10 minutes'",
            [s.user.id],
          )
        ).rows[0];
        requireThat(recent.count < 10, "GOOGLE_CONNECTION_RATE_LIMITED", 429);
        await tx.query(
          "INSERT INTO google_oauth_request(id,workspace_id,person_id,session_id,membership_version,capability,state_hash,ticket_hash,verifier_cipher,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10)",
          [
            id,
            w,
            s.user.id,
            s.session.id,
            m.version,
            input.capability,
            googleHash(state),
            googleHash(ticket),
            encryptGoogleSecret(
              JSON.stringify({ state, verifier }),
              `${id}:oauth`,
            ),
            expires,
          ],
        );
      });
      const launch = new URL(`${root}launch`, config.launchOrigin);
      launch.searchParams.set("ticket", ticket);
      return Response.json(
        { authorizationUrl: launch.href, expiresAt: expires.toISOString() },
        { headers },
      );
    }
    if (url.pathname === `${root}launch` && request.method === "GET") {
      const ticket = z
          .string()
          .regex(/^[A-Za-z0-9_-]{43}$/)
          .parse(url.searchParams.get("ticket")),
        binding = random();
      const row = await transaction(async (tx) => {
        const row = (
          await tx.query(
            "SELECT * FROM google_oauth_request WHERE ticket_hash=$1 AND status='pending' AND expires_at>now() FOR UPDATE",
            [googleHash(ticket)],
          )
        ).rows[0];
        requireThat(row, "GOOGLE_OAUTH_EXPIRED", 400);
        await validate(tx, row);
        await tx.query(
          "UPDATE google_oauth_request SET status='launched',browser_hash=$2 WHERE id=$1",
          [row.id, googleHash(binding)],
        );
        return row;
      });
      const secret = z
        .object({ state: z.string(), verifier: z.string() })
        .parse(
          JSON.parse(
            decryptGoogleSecret(row.verifier_cipher, `${row.id}:oauth`),
          ),
        );
      const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      const params = {
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: googleScopes[row.capability as GoogleCapability].join(" "),
        access_type: "offline",
        prompt: "consent select_account",
        state: secret.state,
        code_challenge: Buffer.from(
          googleHash(secret.verifier),
          "hex",
        ).toString("base64url"),
        code_challenge_method: "S256",
      };
      for (const [k, v] of Object.entries(params))
        authorize.searchParams.set(k, v);
      const cookie = `miriam_google_${row.id}=${binding}; Path=${root}; HttpOnly; SameSite=Lax; Max-Age=600${new URL(config.redirectUri).protocol === "https:" ? "; Secure" : ""}`;
      return new Response(null, {
        status: 303,
        headers: { ...headers, Location: authorize.href, "Set-Cookie": cookie },
      });
    }
    if (url.pathname === `${root}callback` && request.method === "GET") {
      const state = z
        .string()
        .regex(/^[A-Za-z0-9_-]{43}$/)
        .parse(url.searchParams.get("state"));
      const row = await transaction(async (tx) => {
        const row = (
          await tx.query(
            "SELECT * FROM google_oauth_request WHERE state_hash=$1 AND status='launched' AND expires_at>now() FOR UPDATE",
            [googleHash(state)],
          )
        ).rows[0];
        requireThat(row, "GOOGLE_OAUTH_EXPIRED", 400);
        const cookie = request.headers
          .get("cookie")
          ?.split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith(`miriam_google_${row.id}=`))
          ?.split("=")[1];
        requireThat(
          cookie && googleHash(cookie) === row.browser_hash,
          "GOOGLE_OAUTH_BROWSER_MISMATCH",
          403,
        );
        await validate(tx, row);
        await tx.query(
          "UPDATE google_oauth_request SET status='exchanging' WHERE id=$1",
          [row.id],
        );
        return row;
      });
      const credentialId = randomUUID();
      try {
        requireThat(
          !url.searchParams.has("error"),
          "GOOGLE_CONSENT_DECLINED",
          400,
        );
        const code = z
          .string()
          .min(1)
          .max(10000)
          .parse(url.searchParams.get("code"));
        const secret = z
          .object({ state: z.string(), verifier: z.string() })
          .parse(
            JSON.parse(
              decryptGoogleSecret(row.verifier_cipher, `${row.id}:oauth`),
            ),
          );
        const signal = AbortSignal.timeout(25000);
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
                code,
                code_verifier: secret.verifier,
                redirect_uri: config.redirectUri,
                grant_type: "authorization_code",
              }),
            },
            fetcher,
            32000,
          ),
        );
        const capability = row.capability as GoogleCapability,
          scopes = tokens.scope?.split(" ") ?? [];
        requireThat(
          tokens.refresh_token &&
            googleScopes[capability].every((s) => scopes.includes(s)),
          "GOOGLE_SCOPE_REQUIRED",
          403,
        );
        const identity = z
          .object({
            sub: z.string().min(1).max(500),
            email: z.email().toLowerCase(),
            email_verified: z.literal(true),
          })
          .parse(
            await googleJSON(
              "https://openidconnect.googleapis.com/v1/userinfo",
              {
                signal,
                headers: { Authorization: `Bearer ${tokens.access_token}` },
              },
              fetcher,
              32000,
            ),
          );
        // A transferable native launch URL must not attach another person's Google account
        // to its initiator. Additional owned addresses need a stronger account-link ceremony.
        const owner = (
          await pool.query(
            'SELECT email FROM "user" WHERE id=$1 AND "emailVerified" AND eligible',
            [row.person_id],
          )
        ).rows[0];
        requireThat(
          owner && owner.email.toLowerCase() === identity.email,
          "GOOGLE_ACCOUNT_MISMATCH",
          403,
        );
        await transaction(async (tx) => {
          await validate(tx, row);
          await tx.query(
            "INSERT INTO google_credential(id,workspace_id,person_id,membership_version,capability,google_subject,email,scopes,access_cipher,refresh_cipher,expires_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'connecting')",
            [
              credentialId,
              row.workspace_id,
              row.person_id,
              row.membership_version,
              capability,
              identity.sub,
              identity.email,
              scopes,
              encryptGoogleSecret(
                tokens.access_token,
                `${credentialId}:access`,
              ),
              encryptGoogleSecret(
                tokens.refresh_token!,
                `${credentialId}:refresh`,
              ),
              new Date(Date.now() + tokens.expires_in * 1000),
            ],
          );
        });
        const temporary: GoogleToken = async (id) => {
          requireThat(
            id === credentialId,
            "GOOGLE_CONNECTION_UNAVAILABLE",
            403,
          );
          await transaction((tx) => validate(tx, row));
          return {
            accessToken: tokens.access_token,
            email: identity.email,
            scopes,
          };
        };
        const finalize = async (tx: Tx, connectionId: string) => {
          await validate(tx, row);
          const column =
            capability === "calendar"
              ? "calendar_connection_id"
              : "mailbox_connection_id";
          const updated = await tx.query(
            `UPDATE google_credential SET ${column}=$2,status='active' WHERE id=$1 AND status='connecting' RETURNING id`,
            [credentialId, connectionId],
          );
          requireThat(updated.rowCount, "GOOGLE_OAUTH_EXPIRED", 409);
          await tx.query(
            "UPDATE google_oauth_request SET status='completed',verifier_cipher='' WHERE id=$1",
            [row.id],
          );
        };
        if (capability === "calendar")
          await establishCalendarConnection(
            row.person_id,
            row.workspace_id,
            row.session_id,
            googleCalendarProvider(temporary, fetcher),
            credentialId,
            `Google · ${identity.email}`,
            finalize,
          );
        else
          await establishMailbox(
            row.person_id,
            row.workspace_id,
            row.session_id,
            googleEmailProvider(temporary, fetcher),
            credentialId,
            `Gmail · ${identity.email}`,
            finalize,
          );
        return callbackPage(true, config.appOrigin, row.workspace_id);
      } catch (error) {
        await transaction(async (tx) => {
          await tx.query(
            "UPDATE google_credential SET status='revoked',access_cipher=NULL,refresh_cipher=NULL WHERE id=$1",
            [credentialId],
          );
          await tx.query(
            "UPDATE google_oauth_request SET status='failed',verifier_cipher='',error_code=$2 WHERE id=$1",
            [
              row.id,
              error instanceof DomainError
                ? error.code
                : "GOOGLE_CONNECTION_FAILED",
            ],
          );
        });
        return callbackPage(
          false,
          config.appOrigin,
          undefined,
          error instanceof DomainError ? error.code : undefined,
        );
      }
    }
    throw new DomainError("METHOD_NOT_ALLOWED", 405);
  } catch (error) {
    const code =
      error instanceof DomainError
        ? error.code
        : error instanceof z.ZodError
          ? "INVALID_REQUEST"
          : "GOOGLE_CONNECTION_FAILED";
    const status =
      error instanceof DomainError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : 500;
    const requestId = randomUUID();
    return Response.json(
      errorSchema.parse({
        error: {
          code,
          requestId,
          recovery:
            status === 401
              ? "authenticate"
              : status === 409
                ? "refresh"
                : "none",
        },
      }),
      { status, headers: { ...headers, "X-Request-ID": requestId } },
    );
  }
}
