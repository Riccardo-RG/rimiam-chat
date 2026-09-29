import { randomUUID } from "node:crypto";
import { bearer } from "better-auth/plugins";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { pool } from "./db.ts";
import { enqueueAccountMail } from "./account-delivery.ts";

const baseURL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
const googleClientId = process.env.GOOGLE_AUTH_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_AUTH_CLIENT_SECRET?.trim();
export const googleSignInAvailable = Boolean(
  googleClientId && googleClientSecret,
);
const googleScopes = ["openid", "email", "profile"];
const discardedGoogleTokens = {
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
    socialProviders:
      !native && googleSignInAvailable
        ? {
            google: {
              clientId: googleClientId!,
              clientSecret: googleClientSecret!,
              disableDefaultScope: true,
              scope: googleScopes,
              accessType: "online",
              includeGrantedScopes: false,
              prompt: "select_account",
              disableIdTokenSignIn: true,
              requireEmailVerification: true,
            },
          }
        : {},
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (
          !["/sign-in/social", "/link-social"].includes(context.path) ||
          context.body?.provider !== "google"
        )
          return;
        // Authentication cannot become an alternate Google integration consent flow.
        const scopes = context.body.scopes;
        if (
          (scopes &&
            (!Array.isArray(scopes) ||
              scopes.some(
                (scope: unknown) => !googleScopes.includes(String(scope)),
              ))) ||
          Object.keys(context.body.additionalParams ?? {}).length
        )
          throw new APIError("BAD_REQUEST", {
            code: "GOOGLE_AUTH_SCOPE_REJECTED",
            message: "Google sign-in only supports identity scopes",
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
            account.providerId === "google"
              ? { data: discardedGoogleTokens }
              : undefined,
        },
        update: {
          before: async (account) =>
            account.providerId === "google"
              ? { data: discardedGoogleTokens }
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
        if (source.oauth?.providerId !== "google") return;
        if (
          user.emailVerified !== true ||
          source.oauth.profile?.email_verified !== true
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
