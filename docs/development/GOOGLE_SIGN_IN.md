# Google account access

Updated 2026-11-20. The hosted Railway beta has a dedicated Google identity client. See the [deployment record](RAILWAY_DEPLOYMENT.md#current-setup) for production checks. Completing consent with a real user remains a separate acceptance step. This optional login/signup path is independent of [Calendar and Gmail](GOOGLE_INTEGRATIONS.md). Email/password and verification/recovery delivery remain supported.

## Boundary

- [Better Auth configuration](../../src/server/auth.ts) uses an authorization-code/PKCE flow with `openid email profile` only. No Gmail/Calendar scope, offline grant or reuse of integration credentials. Caller-supplied scope widening is rejected.
- Verified Google identity may create an account or sign in. An existing password account is linked by matching email only when **both** local and Google email are verified; an unverified pre-registration must first verify normally. Existing eligibility is checked; Google cannot restore a disabled account.
- Provider subject/account linkage is persistent. Google access, refresh and ID tokens are discarded before account persistence. Application sessions retain their ordinary server-side checks; authentication grants no membership, history visibility, adherence, mandate or project authority.
- The [account screen](../../src/client/account-access.tsx) offers “Continua con Google” when `/api/config` reports both credentials present. A separate message explains unavailability or offers to retry a failed configuration check. Safe invite/Workspace return paths survive login and cancellation; invitation acceptance stays explicit.
- A signed-in member can open **Account → Metodi di accesso** to see whether Google is already linked and explicitly connect a matching verified identity. This action uses the identity-only grant.

## Configuration and activation

1. In an authorized Google Cloud project, configure Google Auth Platform branding/audience/contact details and a dedicated OAuth client of type **Web application**. Use real support/privacy information wherever Google requires it; the beta-use clause at `/beta` is not a complete privacy notice. Follow the audience/testing restrictions shown by Google for this project.
2. Add the exact redirect URI `${BETTER_AUTH_URL}/api/auth/callback/google`. For the Railway beta: `https://rimiam-chat-web-production.up.railway.app/api/auth/callback/google`. Local loopback: `http://127.0.0.1:3000/api/auth/callback/google`. Do not substitute the Calendar/Gmail callback or mix localhost and 127.0.0.1. A later domain change requires updating both the registered redirect and `BETTER_AUTH_URL`.
3. Store `GOOGLE_AUTH_CLIENT_ID` and `GOOGLE_AUTH_CLIENT_SECRET` on the Railway Web service or the corresponding local server. Keep them in server-side secrets. These variables are independent from `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`. Redeploy the web service. Keep the existing `BETTER_AUTH_SECRET`, secure origin checks and verified-email requirement for password login.
4. Verify `/api/config` reports `googleSignInAvailable:true`, then perform the controlled live checks below. If either credential is absent, the sign-in form labels Google unavailable and keeps email/password available. Removing credentials disables subsequent Google logins; existing application sessions follow their normal lifetime/revocation rules.

Google setup references checked on 2026-09-29: [Better Auth Google provider](https://better-auth.com/docs/authentication/google), [Google server OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server). Installed SDK behavior, not an assumed documentation version, governs the implementation.

## Installed iOS and Android apps

The React Native client discovers identity providers from the selected installation at `GET /api/v1/native/social/providers`. A fork supplies its own HTTPS origin and OAuth client on the server. The user selects their own Google or Microsoft identity in the system browser. Both providers return to the existing HTTPS **Web** callback. The installed app and the provider do not need a shared client secret.

A successful callback can redirect to `com.rimiam.chat:/oauth/complete` with a 90-second single-use code. The independent app session is issued only after the device exchanges the code and its original PKCE verifier at the same installation. The grant expires or becomes unusable if the browser session or account loses eligibility. The app stores its pending verifier and resulting session in protected device storage. If an exchange response is lost, restart sign-in. Signing out of the app revokes its own session. Apply migration 074 on the server before distributing clients that use this flow.

In the installed app, **Account → Metodi di accesso** shows the current member’s linked identities. Linking opens a system-browser confirmation for that same verified RIMIAM account. The server checks the signed browser identity again before provider consent and the app reads the resulting account links after return. A different browser identity must explicitly switch accounts first.

The public scheme is fixed in this app and its server callback. A distributor changing the scheme must change both together and rebuild the native clients. Test both platforms on physical devices for browser cancellation, provider error, returning after the OS suspended the app, and sign-out. Identity sign-in and the separate Gmail/Calendar authorizations each require their own live user acceptance.

## Verification

- Deterministic tests: [Google callback and account boundary](../../tests/google-auth.test.ts), [account navigation/rendering](../../tests/account-access.test.ts); existing account-delivery/recovery, native-account and beta-acknowledgement regressions. Real provider responses are simulated **only in tests**; runtime has no fake Google mode. Use local `miriam_test` with `LOCAL_MAIL=true` and no external mail credentials.
- Required live acceptance after activation: a new Google account; an existing verified password account returning to the same identity; unverified matching-email denial; cancellation/retry; logout/relogin; a recipient invitation followed by **explicit** acceptance; ineligible-account denial. Confirm the consent prompt requests identity only and neither native access nor Workspace permissions change.
- [Browser coverage](../../tests/e2e/signin-methods.spec.ts) exercises the login button and the signed-in linking handoff on a 390 px viewport, with and without identity clients configured. The browser intercepts provider navigation locally. The live consent and account checks above remain pending.

Deployment and subscription overview remains [DEPLOY_EXTERNAL_SERVICES](DEPLOY_EXTERNAL_SERVICES.md); current publication/check evidence is in [STATUS](STATUS.md).
