import { randomUUID } from "node:crypto";
import { bearer } from "better-auth/plugins";
import { betterAuth } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getOAuthState,
  getSessionFromCtx,
} from "better-auth/api";
import { pool } from "./db.ts";
import { enqueueAccountMail } from "./account-delivery.ts";
import { microsoftIdentityOptions } from "./microsoft-signin.ts";

const baseURL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
const googleClientId = process.env.GOOGLE_AUTH_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_AUTH_CLIENT_SECRET?.trim();
export const googleSignInAvailable = Boolean(
  googleClientId && googleClientSecret,
);
const microsoftClientId = process.env.MICROSOFT_AUTH_CLIENT_ID?.trim();
const microsoftClientSecret = process.env.MICROSOFT_AUTH_CLIENT_SECRET?.trim();
export const microsoftSignInAvailable = Boolean(
  microsoftClientId && microsoftClientSecret,
);
const identityScopes = ["openid", "email", "profile"];
const discardedIdentityTokens = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
};
export const localMailEnabled =
  process.env.LOCAL_MAIL === "true" &&
  ["127.0.0.1", "localhost"].includes(new URL(baseURL).hostname) &&
  process.env.NODE_ENV !== "production";
function createAuth(native: boolean) {
  return betterAuth({
    plugins: native ? [bearer({ requireSignature: true })] : [],
    database: pool,
    baseURL,
    secret: process.env.BETTER_AUTH_SECRET,
    trustedOrigins: [baseURL],
    // Keep the same origin/CSRF protections in test and ordinary runtime.
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
    socialProviders: native
      ? {}
      : {
          ...(googleSignInAvailable
            ? {
                google: {
                  clientId: googleClientId!,
                  clientSecret: googleClientSecret!,
                  disableDefaultScope: true,
                  scope: identityScopes,
                  accessType: "online",
                  includeGrantedScopes: false,
                  prompt: "select_account",
                  disableIdTokenSignIn: true,
                  requireEmailVerification: true,
                },
              }
            : {}),
          ...(microsoftSignInAvailable
            ? {
                microsoft: microsoftIdentityOptions(
                  microsoftClientId!,
                  microsoftClientSecret!,
                ),
              }
            : {}),
        },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        const provider = context.body?.provider;
        if (
          !["/sign-in/social", "/link-social"].includes(context.path) ||
          !["google", "microsoft"].includes(provider)
        )
          return;
        const linkActor = context.headers?.get("x-rimiam-link-account");
        if (context.path === "/link-social" && linkActor) {
          const session = await getSessionFromCtx(context);
          if (
            session?.user.id !== linkActor ||
            !session.user.emailVerified ||
            !(
              await pool.query(
                'SELECT 1 FROM "user" WHERE id=$1 AND eligible=true',
                [linkActor],
              )
            ).rowCount
          )
            throw new APIError("FORBIDDEN", {
              code: "LINK_ACCOUNT_MISMATCH",
              message:
                "The browser account must match the selected device account",
            });
        }
        // Identity-only endpoints must never widen mailbox or calendar grants.
        const scopes = context.body.scopes;
        if (
          (scopes &&
            (!Array.isArray(scopes) ||
              scopes.some(
                (scope: unknown) => !identityScopes.includes(String(scope)),
              ))) ||
          Object.keys(context.body.additionalParams ?? {}).length
        )
          throw new APIError("BAD_REQUEST", {
            code:
              provider === "google"
                ? "GOOGLE_AUTH_SCOPE_REJECTED"
                : "MICROSOFT_AUTH_SCOPE_REJECTED",
            message: "Sign-in only supports identity scopes",
          });
      }),
    },
    account: {
      storeAccountCookie: false,
      updateAccountOnSignIn: false,
      accountLinking: {
        enabled: true,
        trustedProviders: [],
        requireLocalEmailVerified: true,
        allowDifferentEmails: false,
        updateUserInfoOnLink: false,
      },
    },
    databaseHooks: {
      account: {
        create: {
          before: async (account) =>
            account.providerId === "google" ||
            account.providerId === "microsoft"
              ? { data: discardedIdentityTokens }
              : undefined,
        },
        update: {
          before: async (account) =>
            account.providerId === "google" ||
            account.providerId === "microsoft"
              ? { data: discardedIdentityTokens }
              : undefined,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        if (localMailEnabled) {
          await pool.query(
            "INSERT INTO local_mail(id,recipient,subject,link) VALUES($1,$2,$3,$4)",
            [randomUUID(), user.email, "Reset your MIRIAM password", url],
          );
          return;
        }
        await enqueueAccountMail("password-reset", user.email, url);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: 3600,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        if (!localMailEnabled) {
          await enqueueAccountMail("verification", user.email, url);
          return;
        }
        await pool.query(
          "INSERT INTO local_mail(id,recipient,subject,link) VALUES($1,$2,$3,$4)",
          [randomUUID(), user.email, "Verify your MIRIAM email", url],
        );
      },
    },
    session: { cookieCache: { enabled: false } },
    user: {
      validateUserInfo: async ({ user, source }) => {
        const provider = source.oauth?.providerId;
        if (provider !== "google" && provider !== "microsoft") return;
        if (provider === "microsoft") {
          if (
            source.action === "link-account" &&
            (await getOAuthState())?.link?.userId !== user.id
          )
            return { error: "microsoft_link_required" };
          if (user.emailVerified !== true)
            return { error: "microsoft_link_required" };
        }
        if (
          provider === "google" &&
          (user.emailVerified !== true ||
            source.oauth?.profile?.email_verified !== true)
        )
          return { error: "google_email_unverified" };
        if (source.action !== "create-user") {
          const current = await pool.query(
            'SELECT eligible,"emailVerified" FROM "user" WHERE id=$1',
            [user.id],
          );
          if (!current.rows[0]?.eligible || !current.rows[0]?.emailVerified)
            return { error: "account_ineligible" };
        }
      },
      additionalFields: {
        eligible: { type: "boolean", defaultValue: true, input: false },
      },
    },
    rateLimit: { enabled: true, window: 60, max: 60 },
  });
}

export const auth = createAuth(false);
// Same accounts/session table, isolated token transport; web auth does not expose bearer tokens.
export const nativeAuth = createAuth(true);
