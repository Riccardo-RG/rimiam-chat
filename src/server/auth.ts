import { randomUUID } from "node:crypto";
import { bearer } from "better-auth/plugins";
import { betterAuth } from "better-auth";
import { pool } from "./db.ts";
import { enqueueAccountMail } from "./account-delivery.ts";

const baseURL = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
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
