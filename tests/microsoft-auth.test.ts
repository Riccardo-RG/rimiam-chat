import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const config = vi.hoisted(() => {
  process.env.MICROSOFT_AUTH_CLIENT_ID = "microsoft-test-client";
  process.env.MICROSOFT_AUTH_CLIENT_SECRET = "microsoft-test-secret";
  return { clientId: process.env.MICROSOFT_AUTH_CLIENT_ID };
});

import { auth, nativeAuth, microsoftSignInAvailable } from "../src/server/auth";
import { handleAPI } from "../src/server/api";
import { nativeSocialRedirect } from "../src/server/native-social";
import { pool } from "../src/server/db";

const base = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
const authority = "https://login.microsoftonline.com";
const consumer = "9188040d-6c67-4c5b-b112-36a304b66dad";
const password = "Fixture-Microsoft-Signin-2026!";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "microsoft-test",
  alg: "RS256",
  use: "sig",
};

function profile(
  email = `${randomUUID()}@example.test`,
  tid: string = consumer,
) {
  return {
    sub: randomUUID(),
    oid: randomUUID(),
    tid,
    email,
    preferred_username: email,
    email_verified: true,
    name: "Test Microsoft",
  };
}
type Claims = Partial<ReturnType<typeof profile>> & Record<string, unknown>;
const grants = new Map<string, { claims: Claims; challenge: string }>();
const cookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
const session = (r: Response) =>
  auth.api.getSession({ headers: new Headers({ Cookie: cookie(r) }) });
const error = (r: Response) =>
  new URL(r.headers.get("location")!, base).searchParams.get("error");

async function post(
  path: string,
  body: unknown,
  sessionCookie = "",
  attempt = 0,
): Promise<Response> {
  const response = await auth.handler(
    new Request(`${base}/api/auth/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: base,
        Cookie: sessionCookie,
      },
      body: JSON.stringify(body),
    }),
  );
  if (response.status === 429 && attempt < 3) {
    const retry = Number(response.headers.get("x-retry-after") ?? 10);
    await new Promise((resolve) => setTimeout(resolve, (retry + 1) * 1000));
    return post(path, body, sessionCookie, attempt + 1);
  }
  return response;
}
async function begin(sessionCookie = "", returnTo = "/") {
  const r = await post(
    sessionCookie ? "link-social" : "sign-in/social",
    {
      provider: "microsoft",
      callbackURL: returnTo,
      errorCallbackURL: "/?oauthError=1",
      disableRedirect: true,
    },
    sessionCookie,
  );
  expect(r.status).toBe(200);
  return {
    url: new URL((await r.json()).url),
    cookie: [sessionCookie, cookie(r)].filter(Boolean).join("; "),
  };
}
async function finish(flow: Awaited<ReturnType<typeof begin>>, claims: Claims) {
  const code = randomUUID();
  grants.set(code, {
    claims,
    challenge: flow.url.searchParams.get("code_challenge")!,
  });
  const callback = new URL(`${base}/api/auth/callback/microsoft`);
  callback.searchParams.set("state", flow.url.searchParams.get("state")!);
  callback.searchParams.set("code", code);
  const request = new Request(callback, { headers: { Cookie: flow.cookie } });
  return nativeSocialRedirect(request, await auth.handler(request));
}
async function localUser() {
  const email = `${randomUUID()}@example.test`;
  const created = await auth.api.signUpEmail({
    body: { name: "Local person", email, password },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    created.user.id,
  ]);
  const login = await post("sign-in/email", { email, password });
  expect(login.status).toBe(200);
  return { id: created.user.id, email, cookie: cookie(login) };
}
const providerRows = async (user: string) =>
  (
    await pool.query(
      `SELECT * FROM account WHERE "providerId"='microsoft' AND "userId"=$1`,
      [user],
    )
  ).rows;

beforeEach(() => {
  grants.clear();
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === authority + "/common/discovery/v2.0/keys")
        return Response.json({ keys: [jwk] });
      if (url !== authority + "/common/oauth2/v2.0/token")
        throw new Error("Unexpected network request in Microsoft sign-in test");
      const form = new URLSearchParams(String(init?.body));
      const grant = grants.get(form.get("code")!);
      expect(grant).toBeDefined();
      grants.delete(form.get("code")!);
      expect(form.get("redirect_uri")).toBe(
        base + "/api/auth/callback/microsoft",
      );
      expect(form.get("client_id")).toBe(config.clientId);
      expect(form.get("client_secret")).toBe("microsoft-test-secret");
      expect(
        createHash("sha256")
          .update(form.get("code_verifier")!)
          .digest("base64url"),
      ).toBe(grant!.challenge);
      const now = Math.floor(Date.now() / 1000);
      const encode = (value: unknown) =>
        Buffer.from(JSON.stringify(value)).toString("base64url");
      const content =
        encode({ alg: "RS256", kid: jwk.kid }) +
        "." +
        encode({
          aud: config.clientId,
          iss: `${authority}/${grant!.claims.tid}/v2.0`,
          iat: now,
          exp: now + 3600,
          ...grant!.claims,
        });
      const id_token =
        content +
        "." +
        sign("RSA-SHA256", Buffer.from(content), privateKey).toString(
          "base64url",
        );
      return Response.json({
        access_token: "fixture",
        refresh_token: "discard",
        id_token,
        expires_in: 3600,
        token_type: "Bearer",
        scope: "openid profile email",
      });
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => pool.end());

describe.sequential(
  "Microsoft web sign-in through signed fixture responses and the local database",
  { timeout: 90000 },
  () => {
    it("opens native Microsoft sign-in with the verified personal identity and a narrow device exchange", async () => {
      const verifier = randomBytes(32).toString("hex"),
        state = randomBytes(32).toString("hex");
      const challenge = createHash("sha256")
        .update(verifier)
        .digest("base64url");
      const claims = profile();
      const signed = await finish(
        await begin(
          "",
          "/account/native/return?" +
            new URLSearchParams({ provider: "microsoft", state, challenge }),
        ),
        claims,
      );
      const result = new URL(signed.headers.get("location")!);
      expect(result.protocol + result.pathname).toBe(
        "com.rimiam.chat:/oauth/complete",
      );
      const r = await handleAPI(
        new Request(base + "/api/v1/native/social/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: result.searchParams.get("code"),
            state,
            verifier,
          }),
        }),
      );
      expect(r.status).toBe(200);
      expect((await r.json()).user.email).toBe(claims.email);
    });
    it("limits browser authorization to identity, PKCE and local returns", async () => {
      expect(microsoftSignInAvailable).toBe(true);
      expect(nativeAuth.options.socialProviders).toEqual({});
      const { url } = await begin();
      expect(url.origin + url.pathname).toBe(
        authority + "/common/oauth2/v2.0/authorize",
      );
      expect(url.searchParams.get("scope")!.split(" ").sort()).toEqual([
        "email",
        "openid",
        "profile",
      ]);
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("prompt")).toBe("select_account");
      expect(
        (
          await post("sign-in/social", {
            provider: "microsoft",
            callbackURL: "https://other.invalid/",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await post("sign-in/social", {
            provider: "microsoft",
            scopes: ["Mail.Send"],
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await post("sign-in/social", {
            provider: "microsoft",
            idToken: { token: "fixture" },
          })
        ).status,
      ).toBe(404);
    });

    it("creates a verified personal identity without memberships or saved tokens, then uses the binding until eligibility ends", async () => {
      const person = profile(),
        invite = "/?invite=" + "e".repeat(43);
      const initial = await finish(await begin("", invite), person);
      expect(initial.headers.get("location")).toBe(invite);
      const signedIn = (await session(initial))!.user;
      expect(signedIn).toMatchObject({
        email: person.email,
        emailVerified: true,
      });
      expect(await providerRows(signedIn.id)).toMatchObject([
        {
          accountId: person.oid,
          accessToken: null,
          refreshToken: null,
          idToken: null,
        },
      ]);
      expect(
        (
          await pool.query("SELECT 1 FROM membership WHERE user_id=$1", [
            signedIn.id,
          ])
        ).rowCount,
      ).toBe(0);
      const again = await finish(await begin(), {
        ...person,
        email: "changed@example.test",
        email_verified: false,
      });
      expect((await session(again))?.user).toMatchObject({
        id: signedIn.id,
        email: person.email,
      });
      await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [
        signedIn.id,
      ]);
      const denied = await finish(await begin(), person);
      expect(error(denied)).toBe("account_ineligible");
      expect(await session(denied)).toBeNull();
    });

    it("requires a verified local account and explicit link for organizational accounts and prevents implicit email matches", async () => {
      const local = await localUser();
      const colleague = profile(local.email, randomUUID());
      const other = profile(undefined, randomUUID());
      for (const person of [
        colleague,
        { ...other, xms_edov: true },
        profile(local.email),
      ]) {
        const response = await finish(await begin(), person);
        expect(["account_not_linked", "microsoft_link_required"]).toContain(
          error(response),
        );
        expect(await session(response)).toBeNull();
      }
      expect(await providerRows(local.id)).toHaveLength(0);
      expect(
        (await pool.query('SELECT 1 FROM "user" WHERE email=$1', [other.email]))
          .rowCount,
      ).toBe(0);
      const wrong = await finish(await begin(local.cookie), other);
      expect(error(wrong)).toBe("microsoft_link_required");
      expect(await providerRows(local.id)).toHaveLength(0);
      const linked = await finish(await begin(local.cookie), {
        ...colleague,
        email_verified: false,
      });
      expect(error(linked)).toBeNull();
      expect(await providerRows(local.id)).toMatchObject([
        {
          accountId: colleague.oid,
          accessToken: null,
          refreshToken: null,
          idToken: null,
        },
      ]);
      const again = await finish(await begin(), {
        ...colleague,
        email: undefined,
        preferred_username: "changed@example.test",
      });
      expect((await session(again))?.user).toMatchObject({
        id: local.id,
        email: local.email,
        name: "Local person",
      });
    });

    it("rejects an unverified consumer address or invalid token audience before persistence", async () => {
      const person = profile();
      for (const claims of [
        { ...person, email_verified: false, xms_edov: true },
        { ...person, aud: "another-app" },
      ]) {
        const denied = await finish(await begin(), claims);
        expect(error(denied)).toBeTruthy();
        expect(await session(denied)).toBeNull();
      }
      expect(
        (
          await pool.query('SELECT 1 FROM "user" WHERE email=$1', [
            person.email,
          ])
        ).rowCount,
      ).toBe(0);
    });
  },
);
