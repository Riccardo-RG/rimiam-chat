import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth } from "../src/server/auth";
import { pool } from "../src/server/db";
import { handleAPI } from "../src/server/api";
import { acceptBetaRules } from "../src/server/beta-rules";
import { createWorkspace } from "../src/server/commands";
import { betaRules } from "../src/shared/beta-rules";
import { betaRulesViewSchema } from "../src/contracts/beta-rules";
import { loginResultSchema } from "../src/contracts/v1";

const base = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
const password = "Beta-rules-test-password-2026!";
const contentDigest = createHash("sha256").update(betaRules.text).digest("hex");
type Account = { id: string; cookie: string; token: string; sessionId: string };
let first: Account, second: Account, workspace: string;

async function account(): Promise<Account> {
  const email = `${randomUUID()}@example.test`;
  const created = await auth.api.signUpEmail({
    body: { email, password, name: "Beta acknowledgement test" },
  });
  const id = created.user.id;
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [id]);
  const login = await handleAPI(
    new Request(`${base}/api/v1/native/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }),
  );
  expect(login.status).toBe(200);
  const token = loginResultSchema.parse(await login.json()).token;
  const web = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = web.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const session = await auth.api.getSession({
    headers: new Headers({ cookie }),
  });
  expect(session).not.toBeNull();
  return { id, token, cookie, sessionId: session!.session.id };
}

function input(person = first) {
  return {
    expectedActorId: person.id,
    version: betaRules.version,
    contentDigest,
  };
}

function call(
  person: Account,
  transport: "web" | "native",
  data?: unknown,
  extra: Record<string, string> = {},
) {
  return handleAPI(
    new Request(`${base}/api/v1/beta-rules`, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(transport === "web"
          ? { Cookie: person.cookie, Origin: base }
          : { Authorization: `Bearer ${person.token}` }),
        ...extra,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    }),
  );
}

async function acceptanceCount(person: Account) {
  return Number(
    (
      await pool.query(
        "SELECT count(*) FROM beta_rules_acceptance WHERE user_id=$1",
        [person.id],
      )
    ).rows[0].count,
  );
}

beforeAll(async () => {
  first = await account();
  second = await account();
  workspace = (
    await createWorkspace(first.id, "Acknowledgement isolation", randomUUID())
  ).id;
});
afterAll(() => pool.end());

describe.sequential(
  "Versioned beta acknowledgement through real web/native auth",
  () => {
    it("reads only the authenticated account and retains auth/origin protections", async () => {
      const anonymous = await handleAPI(
        new Request(`${base}/api/v1/beta-rules`),
      );
      expect(anonymous.status).toBe(401);
      for (const transport of ["web", "native"] as const) {
        const response = await call(first, transport);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        expect(betaRulesViewSchema.parse(await response.json())).toEqual({
          actorId: first.id,
          ...betaRules,
          contentDigest,
          acceptedAt: null,
        });
      }
      expect(
        (
          await call(first, "web", input(), {
            Origin: "https://foreign.invalid",
          })
        ).status,
      ).toBe(403);
      expect(
        (await call(first, "native", input(), { Cookie: first.cookie })).status,
      ).toBe(403);
      expect(
        (
          await call(first, "native", input(), {
            Authorization: "Bearer invalid",
          })
        ).status,
      ).toBe(401);
      expect(await acceptanceCount(first)).toBe(0);
      const contract = await handleAPI(
        new Request(`${base}/api/v1/openapi.json`),
      );
      expect(
        (await contract.json()).paths["/beta-rules"].post.requestBody,
      ).toBeDefined();
    });

    it("rejects stale account, text and version without recording acceptance", async () => {
      for (const [payload, expected] of [
        [{ ...input(), expectedActorId: second.id }, "AUTH_CONTEXT_CHANGED"],
        [{ ...input(), version: "2026-09-28-v0" }, "BETA_RULES_VERSION_STALE"],
        [
          { ...input(), contentDigest: "0".repeat(64) },
          "BETA_RULES_VERSION_STALE",
        ],
      ] as const) {
        const response = await call(first, "web", payload);
        expect(response.status).toBe(409);
        expect((await response.json()).error.code).toBe(expected);
      }
      const forged = await call(first, "native", {
        ...input(),
        actorId: second.id,
      });
      expect(forged.status).toBe(400);
      expect(await acceptanceCount(first)).toBe(0);
      expect(await acceptanceCount(second)).toBe(0);
    });

    it("persists exact attributed text once across concurrent web/native retries with no Workspace effects", async () => {
      const before = (
        await pool.query("SELECT * FROM workspace WHERE id=$1", [workspace])
      ).rows;
      const responses = await Promise.all([
        call(first, "web", input()),
        call(first, "native", input()),
      ]);
      const views = await Promise.all(
        responses.map(async (response) => {
          expect(response.status).toBe(200);
          return betaRulesViewSchema.parse(await response.json());
        }),
      );
      expect(views[0]).toEqual(views[1]);
      expect(views[0].acceptedAt).not.toBeNull();
      expect(await acceptanceCount(first)).toBe(1);
      expect(
        (
          await pool.query(
            "SELECT user_id,version,content_digest,content,accepted_at FROM beta_rules_acceptance WHERE user_id=$1",
            [first.id],
          )
        ).rows[0],
      ).toEqual({
        user_id: first.id,
        version: betaRules.version,
        content_digest: contentDigest,
        content: betaRules.text,
        accepted_at: new Date(views[0].acceptedAt!),
      });
      expect(
        betaRulesViewSchema.parse(
          await (await call(first, "web", input())).json(),
        ),
      ).toEqual(views[0]);
      expect(
        betaRulesViewSchema.parse(await (await call(first, "native")).json()),
      ).toEqual(views[0]);
      expect(
        betaRulesViewSchema.parse(await (await call(second, "native")).json())
          .acceptedAt,
      ).toBeNull();
      expect(
        (await pool.query("SELECT * FROM workspace WHERE id=$1", [workspace]))
          .rows,
      ).toEqual(before);
    });

    it("does not carry a historical version forward or rewrite its evidence", async () => {
      const historical = "Earlier beta rules for this test";
      await pool.query(
        "INSERT INTO beta_rules_acceptance(user_id,version,content_digest,content) VALUES($1,$2,$3,$4)",
        [
          second.id,
          "earlier-v0",
          createHash("sha256").update(historical).digest("hex"),
          historical,
        ],
      );
      expect(
        betaRulesViewSchema.parse(await (await call(second, "web")).json())
          .acceptedAt,
      ).toBeNull();
      const accepted = await call(second, "native", input(second));
      expect(accepted.status).toBe(200);
      expect(await acceptanceCount(second)).toBe(2);
      expect(
        (
          await pool.query(
            "SELECT content FROM beta_rules_acceptance WHERE user_id=$1 AND version='earlier-v0'",
            [second.id],
          )
        ).rows[0].content,
      ).toBe(historical);
    });

    it("rejects late work after account ineligibility or session revocation", async () => {
      await pool.query('UPDATE "user" SET eligible=false WHERE id=$1', [
        first.id,
      ]);
      try {
        for (const transport of ["web", "native"] as const) {
          expect((await call(first, transport)).status).toBe(403);
          expect((await call(first, transport, input())).status).toBe(403);
        }
      } finally {
        await pool.query('UPDATE "user" SET eligible=true WHERE id=$1', [
          first.id,
        ]);
      }
      await pool.query("DELETE FROM session WHERE id=$1", [first.sessionId]);
      expect((await call(first, "web", input())).status).toBe(401);
      await expect(
        acceptBetaRules(first.id, first.sessionId, input()),
      ).rejects.toThrow("AUTHENTICATION_REQUIRED");
      expect(await acceptanceCount(first)).toBe(1);
    });
  },
);
