# Microsoft sign-in

Register a Web application in Microsoft Entra ID with the supported account type **Accounts in any organizational directory and personal Microsoft accounts**. Register the exact Web callback `<BETTER_AUTH_URL>/api/auth/callback/microsoft` for each environment. Use HTTPS in production. Configure `MICROSOFT_AUTH_CLIENT_ID` and `MICROSOFT_AUTH_CLIENT_SECRET` on the Web server and rotate the secret before its expiration. The sign-in button appears when both values are configured. [Microsoft application registration](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)

The authorization-code flow uses PKCE and the identity scopes `openid profile email`. No Graph permissions, mailbox consent or offline access are required. Account tokens from this flow are discarded. Outlook mailbox connections use separate registration and consent.

A personal Microsoft account can register directly if Microsoft supplies positive verification for the exact mailbox. For a work/school account, an existing RIMIAM account, or a personal account without mailbox proof, first sign in to a verified RIMIAM account. Open **Account → Metodi di accesso → Collega Microsoft** and select the identity with the same address. Subsequent logins use the immutable Microsoft object identity. A directory administrator can change an email address or username. RIMIAM never implicitly links an existing account using that match. [Microsoft identity claims](https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference)

The installed apps reuse the same installation’s Web identity client and account-linking rules through the [native system-browser handoff](GOOGLE_SIGN_IN.md#installed-ios-and-android-apps).

## Live acceptance after registration

Use a consenting personal account and a separate work/school account. Check new registration or the verified-account fallback as applicable, explicit linking, repeat sign-in and cancellation while opening a Workspace invitation. Check that sign-in returns to the invitation for explicit acceptance. Confirm the requested identity permissions on the consent screen and any enterprise tenant access policies. Local tests use signed provider fixtures and the actual Better Auth callbacks and local database. [Browser checks](../../tests/e2e/signin-methods.spec.ts) cover the sign-in and explicit linking handoffs at mobile width with provider navigation intercepted locally. Real registration, consent and delivery require live verification.
