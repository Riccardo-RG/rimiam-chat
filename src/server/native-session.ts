import { z } from "zod";
import { nativeAuth } from "./auth.ts";
import { requireThat, DomainError } from "./errors.ts";
import { eligible } from "./workspace-state.ts";
import { transaction } from "./db.ts";
import {
  loginSchema,
  loginResultSchema,
  sessionSchema,
  nativeAccountSchema,
} from "../contracts/v1.ts";
import { body } from "./http.ts";

export function assertNativeRequest(request: Request) {
  // This is a separate, cookie-less transport. A header claiming to be native is never authority.
  requireThat(
    !request.headers.has("cookie") &&
      !request.headers.has("origin") &&
      !request.headers.has("sec-fetch-site"),
    "NATIVE_TRANSPORT_REQUIRED",
    403,
  );
}
function headersFor(request: Request) {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const key of [
    "authorization",
    "user-agent",
    "x-forwarded-for",
    "x-real-ip",
  ])
    if (request.headers.has(key)) headers.set(key, request.headers.get(key)!);
  return headers;
}
// Closed, unauthenticated account actions reuse the normal auth limiter/delivery.
// No arbitrary route, callback, redirect or authenticated response is forwarded.
export async function nativeAccount(request: Request) {
  assertNativeRequest(request);
  requireThat(!request.headers.has("authorization"), "INVALID_REQUEST", 400);
  requireThat(
    request.headers.get("content-type")?.includes("application/json"),
    "JSON_REQUIRED",
    415,
  );
  const input = nativeAccountSchema.parse(await body(request));
  const base = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
  const headers = headersFor(request);
  headers.set("origin", new URL(base).origin);
  const routes = {
    register: "sign-up/email",
    "request-password-reset": "request-password-reset",
    "send-verification": "send-verification-email",
  };
  const payload =
    input.action === "register"
      ? {
          email: input.email,
          name: input.name,
          password: input.password,
          callbackURL: new URL("/", base).href,
        }
      : input.action === "request-password-reset"
        ? {
            email: input.email,
            redirectTo: new URL("/account/recovery", base).href,
          }
        : { email: input.email, callbackURL: new URL("/", base).href };
  const response = await nativeAuth.handler(
    new Request(`${base}/api/auth/${routes[input.action]}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }),
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    // Never reveal account existence from a verification/recovery request.
    if (response.status === 429)
      throw new DomainError("TOO_MANY_REQUESTS", 429);
    if (
      input.action === "register" &&
      ![
        "USER_ALREADY_EXISTS",
        "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
      ].includes(error.code)
    ) {
      const code = z
        .string()
        .regex(/^[A-Z_]+$/)
        .safeParse(error.code);
      throw new DomainError(
        code.success ? code.data : "ACCOUNT_REQUEST_FAILED",
        response.status,
      );
    }
    if (response.status >= 500)
      throw new DomainError("ACCOUNT_REQUEST_FAILED", 503);
  }
  return { requested: true as const };
}
export async function nativeSession(request: Request, checkEligibility = true) {
  assertNativeRequest(request);
  requireThat(
    /^Bearer \S+$/i.test(request.headers.get("authorization") ?? ""),
    "AUTHENTICATION_REQUIRED",
    401,
  );
  const session = await nativeAuth.api.getSession({
    headers: headersFor(request),
  });
  requireThat(session, "AUTHENTICATION_REQUIRED", 401);
  if (checkEligibility)
    await transaction((tx) => eligible(tx, session.user.id));
  return session;
}
export function sessionView(
  session: Awaited<ReturnType<typeof nativeSession>>,
) {
  return sessionSchema.parse({
    user: session.user,
    expiresAt: session.session.expiresAt.toISOString(),
  });
}
export async function login(request: Request) {
  assertNativeRequest(request);
  requireThat(!request.headers.has("authorization"), "INVALID_REQUEST", 400);
  requireThat(
    request.headers.get("content-type")?.includes("application/json"),
    "JSON_REQUIRED",
    415,
  );
  const input = loginSchema.parse(await body(request));
  const base = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
  const headers = headersFor(request);
  // Only this closed credential flow receives a server-generated trusted origin.
  // Arbitrary auth paths/callbacks are never proxied; incoming cookies/browser requests were rejected above.
  headers.set("origin", new URL(base).origin);
  const response = await nativeAuth.handler(
    new Request(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    }),
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    // The auth limiter intentionally returns only a message; retain its distinct status/code.
    if (response.status === 429)
      throw new DomainError("TOO_MANY_REQUESTS", 429);
    const code = z
      .string()
      .regex(/^[A-Z_]+$/)
      .safeParse(error.code);
    throw new DomainError(
      code.success ? code.data : "AUTHENTICATION_FAILED",
      response.status,
    );
  }
  const token = response.headers.get("set-auth-token");
  requireThat(token, "SESSION_TRANSPORT_FAILED", 500);
  const authenticated = new Request(request.url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const session = await nativeSession(authenticated);
  // Neither Set-Cookie, a raw database session token, nor the password leaves this adapter.
  return loginResultSchema.parse({ ...sessionView(session), token });
}
export async function logout(request: Request) {
  await nativeSession(request, false);
  const base = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
  const headers = headersFor(request);
  headers.set("origin", new URL(base).origin);
  const response = await nativeAuth.handler(
    new Request(`${base}/api/auth/sign-out`, {
      method: "POST",
      headers,
      body: "{}",
    }),
  );
  requireThat(response.ok, "SIGN_OUT_FAILED", 503);
  return { signedOut: true };
}
