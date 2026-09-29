# Google account access — web

Updated 2026-09-29. Repository implementation; **Google Cloud credentials and live OAuth acceptance remain pending**. This optional login/signup path is separate from [Gmail/Calendar integration](GOOGLE_INTEGRATIONS.md). Email/password and verification/recovery delivery remain supported.

## Boundary

- [Better Auth configuration](../../src/server/auth.ts) uses an authorization-code/PKCE flow with `openid email profile` only. No Gmail/Calendar scope, offline grant or reuse of integration credentials. Caller-supplied scope widening is rejected.
- Verified Google identity may create an account or sign in. An existing password account is linked by matching email only when **both** local and Google email are verified; an unverified pre-registration must first verify normally. Existing eligibility is checked; Google cannot restore a disabled account.
- Provider subject/account linkage is persistent. Google access, refresh and ID tokens are discarded before account persistence. Application sessions retain their ordinary server-side checks; authentication grants no membership, history visibility, adherence, mandate or project authority.
- [Account UI](../../src/client/account-access.tsx) exposes “Continua con Google” only when `/api/config` reports both credentials present. That flag establishes configuration presence, not valid credentials or successful Google verification. Safe invite/Workspace return paths survive login and cancellation; invitation acceptance stays explicit. No One Tap or embedded identity SDK.
- This increment covers the **web** flow. Native SwiftUI/Compose password access remains supported; native Google sign-in is not implemented or claimed.

## Configuration and activation

1. In an authorized Google Cloud project, configure Google Auth Platform branding/audience/contact details and a dedicated OAuth client of type **Web application**. Use real support/privacy information wherever Google requires it; the beta-use clause at `/beta` is not a complete privacy notice. Follow the audience/testing restrictions shown by Google for this project.
2. Add the exact redirect URI `${BETTER_AUTH_URL}/api/auth/callback/google`. For the current Render hostname: `https://rimiam-chat-web.onrender.com/api/auth/callback/google`. Local loopback: `http://127.0.0.1:3000/api/auth/callback/google`. Do not substitute the Calendar/Gmail callback or mix localhost and 127.0.0.1. A later domain change requires updating both the registered redirect and `BETTER_AUTH_URL`.
3. Store `GOOGLE_AUTH_CLIENT_ID` and `GOOGLE_AUTH_CLIENT_SECRET` in the server environment/Render runtime group; never Git, browser configuration or chat. These variables are independent from `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`. Redeploy the web service. Keep the existing `BETTER_AUTH_SECRET`, secure origin checks and verified-email requirement for password login.
4. Verify `/api/config` reports `googleSignInAvailable:true`, then perform the controlled live checks below. Missing one or both credentials keeps this provider unavailable and its button hidden. Removing credentials disables subsequent Google logins; existing application sessions follow their normal lifetime/revocation rules.

Google setup references checked on 2026-09-29: [Better Auth Google provider](https://better-auth.com/docs/authentication/google), [Google server OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server). Installed SDK behavior, not an assumed documentation version, governs the implementation.

## Verification

- Deterministic tests: [Google callback and account boundary](../../tests/google-auth.test.ts), [account navigation/rendering](../../tests/account-access.test.ts); existing account-delivery/recovery, native-account and beta-acknowledgement regressions. Real provider responses are simulated **only in tests**; runtime has no fake Google mode. Use local `miriam_test` with `LOCAL_MAIL=true` and no external mail credentials.
- Required live acceptance after activation: a new Google account; an existing verified password account returning to the same identity; unverified matching-email denial; cancellation/retry; logout/relogin; a recipient invitation followed by **explicit** acceptance; ineligible-account denial. Confirm the consent prompt requests identity only and neither native access nor Workspace permissions change.
- Manually review mobile-width/desktop, Light/Dark, keyboard focus and screen-reader announcements. No browser/provider acceptance is implied by static rendering or a production build. No browser tests or real Google calls were run for this increment.

Deployment and subscription overview remains [DEPLOY_EXTERNAL_SERVICES](DEPLOY_EXTERNAL_SERVICES.md); current publication/check evidence is in [STATUS](STATUS.md).
