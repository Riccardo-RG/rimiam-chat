import { createHash, randomBytes } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { z } from "zod";
import {
  nativeSocialState,
  nativeSocialChallenge,
  nativeSocialExchange,
  nativeLinkedMethods,
} from "../contracts/native-social.ts";
import {
  auth,
  nativeAuth,
  googleSignInAvailable,
  microsoftSignInAvailable,
} from "./auth.ts";
import { transaction } from "./db.ts";
import { body } from "./http.ts";
import { eligible } from "./workspace-state.ts";
import { DomainError, requireThat } from "./errors.ts";
import { loginResultSchema } from "../contracts/v1.ts";
import { assertNativeRequest, nativeSession } from "./native-session.ts";

const providerSchema = z.enum(["google", "microsoft"]);
const callback = "com.rimiam.chat:/oauth/complete";
const digest = (s: string) => createHash("sha256").update(s);
const webOrigin = () =>
  new URL(process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000").origin;
export const nativeSocialProviders = () => ({
  google: googleSignInAvailable,
  microsoft: microsoftSignInAvailable,
});

function redirectToDevice(response: Response, params: URLSearchParams) {
  const headers = new Headers(response.headers);
  headers.set("location", callback + "?" + params);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(null, { status: 303, headers });
}

// Called only with the actual response produced by Better Auth on the fixed provider callback.
// The browser cannot exchange its cookie for an app session at a separately callable endpoint.
export async function nativeSocialRedirect(
  request: Request,
  response: Response,
) {
  const match = new URL(request.url).pathname.match(
    /^\/api\/auth\/callback\/(google|microsoft)$/,
  );
  const location = response.headers.get("location");
  if (!match || !location || response.status < 300 || response.status >= 400)
    return response;
  const target = new URL(location, webOrigin());
  if (
    target.origin !== webOrigin() ||
    target.username ||
    target.password ||
    target.hash ||
    target.pathname !== "/account/native/return"
  )
    return response;
  const provider = providerSchema.parse(match[1]);
  const state = nativeSocialState.safeParse(target.searchParams.get("state"));
  const challenge = nativeSocialChallenge.safeParse(
    target.searchParams.get("challenge"),
  );
  // Malformed or failed callbacks may return to the installed app but can never create a grant.
  if (
    !state.success ||
    target.searchParams.getAll("state").length !== 1 ||
    !challenge.success ||
    target.searchParams.getAll("challenge").length !== 1 ||
    target.searchParams.getAll("provider").length !== 1 ||
    target.searchParams.get("provider") !== provider ||
    target.searchParams.has("error")
  )
    return redirectToDevice(
      response,
      new URLSearchParams({
        state: state.success ? state.data : "",
        error: "access_failed",
      }),
    );
  const { authCookies } = await auth.$context;
  const cookieName = authCookies.sessionToken.name;
  const issuedCookie = response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .find(
      (c) => c.startsWith(cookieName + "=") && c.length > cookieName.length + 1,
    );
  const session = issuedCookie
    ? await auth.api.getSession({
        headers: new Headers({ cookie: issuedCookie }),
      })
    : null;
  if (!session)
    return redirectToDevice(
      response,
      new URLSearchParams({ state: state.data, error: "access_failed" }),
    );
  const code = randomBytes(32).toString("base64url");
  try {
    await transaction(async (tx) => {
      await eligible(tx, session.user.id, true);
      await tx.query(
        "DELETE FROM native_social_handoff WHERE expires_at<=now()",
      );
      await tx.query(
        "INSERT INTO native_social_handoff(code_hash,challenge,client_state,browser_session_id,provider,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '90 seconds')",
        [
          digest(code).digest("hex"),
          challenge.data,
          state.data,
          session.session.id,
          provider,
        ],
      );
    });
  } catch (error) {
    if (error instanceof DomainError && error.code === "ACCOUNT_INELIGIBLE") {
      return redirectToDevice(
        response,
        new URLSearchParams({ state: state.data, error: "access_failed" }),
      );
    }
    throw error;
  }
  return redirectToDevice(
    response,
    new URLSearchParams({ code, state: state.data }),
  );
}

export async function exchangeNativeSocial(request: Request) {
  assertNativeRequest(request);
  requireThat(!request.headers.has("authorization"), "INVALID_REQUEST", 400);
  requireThat(
    request.headers.get("content-type")?.includes("application/json"),
    "JSON_REQUIRED",
    415,
  );
  const input = nativeSocialExchange.parse(await body(request, 2048));
  const actor = await transaction(async (tx) => {
    const row = (
      await tx.query<{ id: string }>(
        `
      SELECT s."userId" AS id FROM native_social_handoff g JOIN session s ON s.id=g.browser_session_id
      WHERE g.code_hash=$1 AND g.challenge=$2 AND g.client_state=$3
        AND g.expires_at>now() AND s."expiresAt">now() FOR UPDATE OF g FOR SHARE OF s`,
        [
          digest(input.code).digest("hex"),
          digest(input.verifier).digest("base64url"),
          input.state,
        ],
      )
    ).rows[0];
    requireThat(row, "NATIVE_SOCIAL_HANDOFF_INVALID", 401);
    await eligible(tx, row.id, true);
    await tx.query("DELETE FROM native_social_handoff WHERE code_hash=$1", [
      digest(input.code).digest("hex"),
    ]);
    return row.id;
  });
  // A lost exchange response requires fresh provider sign-in. Never return a previous bearer
  // or let signing out the installed app revoke the independent browser session.
  const ctx = await nativeAuth.$context;
  const session = await ctx.internalAdapter.createSession(actor);
  try {
    const token = encodeURIComponent(
      session.token + "." + (await makeSignature(session.token, ctx.secret)),
    );
    const user = await transaction(async (tx) => {
      await eligible(tx, actor, true);
      return (
        await tx.query<{ id: string; email: string; name: string }>(
          'SELECT id,email,name FROM "user" WHERE id=$1',
          [actor],
        )
      ).rows[0];
    });
    return loginResultSchema.parse({
      token,
      user,
      expiresAt: session.expiresAt.toISOString(),
    });
  } catch (e) {
    await ctx.internalAdapter.deleteSession(session.token);
    throw e;
  }
}

export async function linkedNativeIdentities(request: Request) {
  const identity = await nativeSession(request);
  const ids = await transaction(async (tx) => {
    await eligible(tx, identity.user.id, true);
    return (
      await tx.query<{ providerId: string }>(
        `SELECT "providerId" FROM account WHERE "userId"=$1 AND "providerId" IN ('google','microsoft')`,
        [identity.user.id],
      )
    ).rows.map((row) => row.providerId);
  });
  return nativeLinkedMethods.parse({
    google: {
      available: googleSignInAvailable,
      linked: ids.includes("google"),
    },
    microsoft: {
      available: microsoftSignInAvailable,
      linked: ids.includes("microsoft"),
    },
  });
}
