import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const fixture = vi.hoisted(() => {
  const clientId = "identity-only-client.apps.googleusercontent.com";
  const clientSecret = "identity-only-test-secret";
  process.env.GOOGLE_AUTH_CLIENT_ID = clientId;
  process.env.GOOGLE_AUTH_CLIENT_SECRET = clientSecret;
  process.env.GOOGLE_OAUTH_CLIENT_ID = "separate-calendar-mail-client";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "separate-calendar-mail-secret";
  return { clientId, clientSecret };
});

import { auth, googleSignInAvailable, nativeAuth } from "../src/server/auth";
import { pool } from "../src/server/db";
import { createWorkspace } from "../src/server/commands";

const base = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
const password = "Google-auth-test-password-2026!";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  alg: "RS256",
  kid: "test-google",
};
type Profile = {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
};
const pending = new Map<string, { profile: Profile; challenge: string }>();
let exchanges = 0;

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}

function profile(email = `${randomUUID()}@example.test`): Profile {
  return {
    sub: randomUUID(),
    email,
    email_verified: true,
    name: "Google test person",
  };
}

async function post(
  path: string,
  body: unknown,
  cookie = "",
  attempt = 0,
): Promise<Response> {
  const response = await auth.handler(
    new Request(`${base}/api/auth/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: base,
        Cookie: cookie,
      },
      body: JSON.stringify(body),
    }),
  );
  if (response.status === 429 && attempt < 3) {
    const seconds = Number(response.headers.get("x-retry-after") ?? 10);
    // Keep the real login limiter enabled and respect its retry window.
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
    return post(path, body, cookie, attempt + 1);
  }
  return response;
}

async function start(returnTo = "/", extra: Record<string, unknown> = {}) {
  const response = await post("sign-in/social", {
    provider: "google",
    callbackURL: returnTo,
    errorCallbackURL: "/?authError=1",
    disableRedirect: true,
    ...extra,
  });
  expect(response.status).toBe(200);
  return {
    url: new URL((await response.json()).url),
    cookie: cookies(response),
  };
}

async function complete(person: Profile, returnTo = "/") {
  const flow = await start(returnTo);
  const code = randomUUID();
  pending.set(code, {
    profile: person,
    challenge: flow.url.searchParams.get("code_challenge")!,
  });
  const callback = new URL(`${base}/api/auth/callback/google`);
  callback.searchParams.set("state", flow.url.searchParams.get("state")!);
  callback.searchParams.set("code", code);
  return auth.handler(
    new Request(callback, { headers: { Cookie: flow.cookie } }),
  );
}

async function session(response: Response) {
  return auth.api.getSession({
    headers: new Headers({ Cookie: cookies(response) }),
  });
}

async function passwordAccount(verified: boolean) {
  const email = `${randomUUID()}@example.test`;
  const created = await auth.api.signUpEmail({
    body: { email, password, name: "Original local name" },
  });
  if (verified)
    await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
      created.user.id,
    ]);
  return { id: created.user.id, email };
}

async function providerAccount(id: string) {
  return (
    await pool.query(
      'SELECT * FROM account WHERE "userId"=$1 AND "providerId"=\'google\'',
      [id],
    )
  ).rows;
}

beforeEach(() => {
  pending.clear();
  exchanges = 0;
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === "https://www.googleapis.com/oauth2/v3/certs")
        return Response.json({ keys: [jwk] });
      if (url !== "https://oauth2.googleapis.com/token")
        throw new Error("Unexpected external request in Google auth test");
      const form = new URLSearchParams(String(init?.body));
      const grant = pending.get(form.get("code") ?? "");
      expect(grant).toBeDefined();
      expect(form.get("client_id")).toBe(fixture.clientId);
      expect(form.get("client_secret")).toBe(fixture.clientSecret);
      expect(form.get("redirect_uri")).toBe(`${base}/api/auth/callback/google`);
      expect(
        createHash("sha256")
          .update(form.get("code_verifier")!)
          .digest("base64url"),
      ).toBe(grant!.challenge);
      pending.delete(form.get("code")!);
      exchanges++;
      const head = Buffer.from(
        JSON.stringify({ alg: "RS256", kid: jwk.kid }),
      ).toString("base64url");
      const claims = Buffer.from(
        JSON.stringify({
          ...grant!.profile,
          aud: fixture.clientId,
          iss: "https://accounts.google.com",
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString("base64url");
      const signature = sign(
        "RSA-SHA256",
        Buffer.from(`${head}.${claims}`),
        privateKey,
      ).toString("base64url");
      return Response.json({
        access_token: "test-access-token",
        refresh_token: "unexpected-refresh-token-must-not-persist",
        id_token: `${head}.${claims}.${signature}`,
        expires_in: 3600,
        token_type: "Bearer",
        scope: "openid email profile",
      });
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => pool.end());

describe.sequential(
  "Google identity authentication with deterministic provider endpoints",
  { timeout: 60000 },
  () => {
    it("uses dedicated credentials, identity scopes, online PKCE and bound return URLs", async () => {
      expect(googleSignInAvailable).toBe(true);
      expect(nativeAuth.options.socialProviders).toEqual({});
      const flow = await start(`/?invite=${"a".repeat(43)}`);
      expect(flow.url.origin).toBe("https://accounts.google.com");
      expect(flow.url.searchParams.get("client_id")).toBe(fixture.clientId);
      expect(flow.url.searchParams.get("scope")!.split(" ").sort()).toEqual([
        "email",
        "openid",
        "profile",
      ]);
      expect(flow.url.searchParams.get("access_type")).toBe("online");
      expect(flow.url.searchParams.get("include_granted_scopes")).not.toBe(
        "true",
      );
      expect(flow.url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(flow.url.searchParams.get("state")).toBeTruthy();
      const redirect = await post("sign-in/social", {
        provider: "google",
        callbackURL: "https://foreign.invalid",
      });
      expect(redirect.status).toBe(403);
      for (const extra of [
        { scopes: ["https://www.googleapis.com/auth/gmail.readonly"] },
        { additionalParams: { include_granted_scopes: "true" } },
        { additionalParams: { access_type: "offline" } },
      ]) {
        const response = await post("sign-in/social", {
          provider: "google",
          callbackURL: "/",
          ...extra,
        });
        expect(response.status).toBe(400);
        expect((await response.json()).code).toBe("GOOGLE_AUTH_SCOPE_REJECTED");
      }
      const direct = await post("sign-in/social", {
        provider: "google",
        idToken: { token: "not-an-auth-code" },
      });
      expect(direct.status).toBe(404);
      expect(exchanges).toBe(0);
    });

    it("registers a verified Google identity without password, verification email, membership or stored Google tokens", async () => {
      const person = profile(),
        returnTo = `/?invite=${"b".repeat(43)}`;
      const response = await complete(person, returnTo);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(returnTo);
      const signedIn = await session(response);
      expect(signedIn?.user).toMatchObject({
        email: person.email,
        emailVerified: true,
        eligible: true,
      });
      const id = signedIn!.user.id;
      expect((await providerAccount(id))[0]).toMatchObject({
        accountId: person.sub,
        providerId: "google",
        accessToken: null,
        refreshToken: null,
        idToken: null,
        password: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
      });
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM membership WHERE user_id=$1",
            [id],
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM local_mail WHERE recipient=$1",
            [person.email],
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        response.headers
          .getSetCookie()
          .some((value) => value.includes("account_data")),
      ).toBe(false);
      const again = await complete(person);
      expect((await session(again))?.user.id).toBe(id);
      expect(await providerAccount(id)).toHaveLength(1);
      expect((await providerAccount(id))[0].idToken).toBeNull();
    });

    it("links only verified matching local accounts while preserving password, identity and Workspace state", async () => {
      const local = await passwordAccount(true);
      const workspace = (
        await createWorkspace(local.id, "Google login isolation", randomUUID())
      ).id;
      const before = (
        await pool.query("SELECT * FROM workspace WHERE id=$1", [workspace])
      ).rows;
      const oldPassword = (
        await pool.query(
          'SELECT password FROM account WHERE "userId"=$1 AND "providerId"=\'credential\'',
          [local.id],
        )
      ).rows[0].password;
      const response = await complete(profile(local.email));
      expect(response.status).toBe(302);
      expect((await session(response))?.user).toMatchObject({
        id: local.id,
        name: "Original local name",
      });
      expect((await providerAccount(local.id))[0].refreshToken).toBeNull();
      expect(
        (
          await pool.query(
            'SELECT password FROM account WHERE "userId"=$1 AND "providerId"=\'credential\'',
            [local.id],
          )
        ).rows[0].password,
      ).toBe(oldPassword);
      expect(
        (await pool.query("SELECT * FROM workspace WHERE id=$1", [workspace]))
          .rows,
      ).toEqual(before);
      expect(
        (await post("sign-in/email", { email: local.email, password })).status,
      ).toBe(200);
    });

    it("does not link Google into an unverified password preregistration or bypass password verification", async () => {
      const local = await passwordAccount(false);
      const response = await complete(profile(local.email));
      expect(
        new URL(response.headers.get("location")!, base).searchParams.get(
          "error",
        ),
      ).toBe("account_not_linked");
      expect(await session(response)).toBeNull();
      expect(await providerAccount(local.id)).toHaveLength(0);
      expect(
        (
          await pool.query('SELECT "emailVerified" FROM "user" WHERE id=$1', [
            local.id,
          ])
        ).rows[0].emailVerified,
      ).toBe(false);
      expect(
        (await post("sign-in/email", { email: local.email, password })).status,
      ).toBe(403);
    });

    it("rejects unverified provider emails and does not restore an ineligible account", async () => {
      const unverified = { ...profile(), email_verified: false };
      const rejected = await complete(unverified);
      expect(
        new URL(rejected.headers.get("location")!, base).searchParams.get(
          "error",
        ),
      ).toBe("google_email_unverified");
      expect(await session(rejected)).toBeNull();
      expect(
        (
          await pool.query('SELECT id FROM "user" WHERE email=$1', [
            unverified.email,
          ])
        ).rowCount,
      ).toBe(0);
      const person = profile();
      const initial = await complete(person);
      const id = (await session(initial))!.user.id;
      await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [id]);
      const denied = await complete(person);
      expect(
        new URL(denied.headers.get("location")!, base).searchParams.get(
          "error",
        ),
      ).toBe("account_ineligible");
      expect(await session(denied)).toBeNull();
      expect(
        (await pool.query('SELECT eligible FROM "user" WHERE id=$1', [id]))
          .rows[0].eligible,
      ).toBe(false);
    });

    it("rejects absent state cookies, replay and provider cancellation without accidental sessions", async () => {
      const flow = await start();
      const callback = new URL(`${base}/api/auth/callback/google`);
      callback.searchParams.set("state", flow.url.searchParams.get("state")!);
      callback.searchParams.set("code", "unused-code");
      const rejected = await auth.handler(new Request(callback));
      expect(rejected.status).toBe(302);
      expect(await session(rejected)).toBeNull();
      expect(exchanges).toBe(0);
      const cancel = await start();
      callback.searchParams.set("state", cancel.url.searchParams.get("state")!);
      callback.searchParams.delete("code");
      callback.searchParams.set("error", "access_denied");
      const cancellation = await auth.handler(
        new Request(callback, { headers: { Cookie: cancel.cookie } }),
      );
      expect(
        new URL(cancellation.headers.get("location")!, base).searchParams.get(
          "error",
        ),
      ).toBe("access_denied");
      expect(await session(cancellation)).toBeNull();
      const replay = await auth.handler(
        new Request(callback, { headers: { Cookie: cancel.cookie } }),
      );
      expect(
        new URL(replay.headers.get("location")!, base).searchParams.get(
          "error",
        ),
      ).not.toBe("access_denied");
      expect(exchanges).toBe(0);
    });
  },
);
