import { getOAuthState } from "better-auth/api";
import { microsoft, type MicrosoftOptions } from "better-auth/social-providers";
import { verifyProviderIdToken } from "@better-auth/core/oauth2";
import { pool } from "./db.ts";

const consumerTenant = "9188040d-6c67-4c5b-b112-36a304b66dad";
const guid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

export function microsoftIdentityOptions(
  clientId: string,
  clientSecret: string,
): MicrosoftOptions {
  const options: MicrosoftOptions = {
    clientId,
    clientSecret,
    tenantId: "common",
    disableDefaultScope: true,
    scope: ["openid", "profile", "email"],
    disableProfilePhoto: true,
    disableIdTokenSignIn: true,
    requireEmailVerification: true,
    prompt: "select_account",
  };
  const provider = microsoft(options);
  return {
    ...options,
    async getUserInfo(tokens) {
      // Only an ID token received in the server-side PKCE code exchange reaches
      // this method. Use the installed verifier's Microsoft keys and tenant binding.
      if (
        !tokens.idToken ||
        !(await verifyProviderIdToken(
          { id: provider.id, idToken: provider.idToken },
          tokens.idToken,
        ))
      )
        return null;
      const result = await provider.getUserInfo(tokens);
      if (!result || !guid.test(result.data.tid) || !guid.test(result.data.oid))
        return null;
      const profile = result.data;
      const state = await getOAuthState();
      if (state?.link) {
        // Better Auth binds link-state to a live authenticated session. Accept
        // its independently verified mailbox only for the exact requested link.
        const localEmail = state.link.email.toLowerCase();
        const hint = profile.email ?? profile.preferred_username;
        const matches =
          typeof hint === "string" && hint.toLowerCase() === localEmail;
        return {
          ...result,
          user: {
            ...result.user,
            email: matches ? localEmail : profile.email,
            emailVerified: matches,
          },
        };
      }
      // OIDs are Microsoft's immutable, non-reassignable, tenant-specific object IDs.
      // On repeat sign-in a tenant's mutable directory address must not change the
      // local account, its verified mailbox, or the recipient of invitations.
      const bound = (
        await pool.query<{ email: string; emailVerified: boolean }>(
          'SELECT u.email,u."emailVerified" FROM account a JOIN "user" u ON u.id=a."userId" WHERE a."providerId"=\'microsoft\' AND a."accountId"=$1',
          [profile.oid],
        )
      ).rows[0];
      if (bound)
        return {
          ...result,
          user: {
            ...result.user,
            email: bound.email,
            emailVerified: bound.emailVerified,
          },
        };
      // A tenant administrator can assign even a well-formed email or UPN.
      // Only Microsoft consumer identities with positive *mailbox* evidence may
      // register directly. Domain verification and UPN are never mailbox proof.
      return {
        ...result,
        user: {
          ...result.user,
          emailVerified:
            profile.tid === consumerTenant &&
            result.user.emailVerified === true,
        },
      };
    },
  };
}
