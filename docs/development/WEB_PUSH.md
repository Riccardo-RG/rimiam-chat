# Optional Web Push

Explicit per-person, per-browser-session, per-Workspace opt-in. The [Railway beta](RAILWAY_DEPLOYMENT.md) enabled Web Push on 2026-11-18. The authenticated settings showed the activation button. Physical-device delivery remains unverified. Notifications carry operational hints; viewing one grants no authority or membership.

## User behavior

- A dismissible introduction beside the chat bell opens the notification settings for this Workspace. Dismissal or visiting settings is remembered for the account in this browser. The introduction is omitted when the service is unavailable, permission is blocked or the Workspace is already opted in. An iPhone/iPad browser tab offers Home Screen instructions. Only an explicit **Attiva per questo spazio** click requests browser permission and registers the device. The bell remains available independently.
- Enabled events: other participants’ text and voice messages, including focused Workstreams, Emme’s responses, Active Work completion or `Needs Input`, and, in the local build, due reminders in that Workspace’s Conversation. In a group, each eligible subscriber can receive the generic reminder notice, including its creator. In a personal space only the owner can subscribe. Older pending owner-only notifications keep their original audience. A human message is attributed to its exact source even when the same command appends an immediate reply. Invitations appear in the recipient’s Web account and support a personal link and optional email; they do not trigger a chat push notification.
- A finished [personal research](PERSONAL_CHAT.md) adds a Home indicator. A device notice additionally requires the requester’s “Avvisami” choice on that exact search and the device’s current chat opt-in. A result already opened is suppressed on subsequent delivery checks.
- Notification title/body are generic: no Workspace name, participant name, message text, source, Task, transcript, email or calendar content. Opening the notification requires the current authenticated session, membership and opt-in again.
- Disabling a Workspace preference stops that device's future notices for it, even when provider configuration is unavailable. Stored opt-in is displayed separately from current deliverability. Logout clears the local binding best-effort and ends server delivery through the revoked session. Re-entry, another account or another session does not inherit permission. Re-enable explicitly after signing in again; reusing an endpoint in a new session invalidates its other Workspace preferences rather than reviving them.
- Returning to open settings rechecks browser permission and subscription. Re-enabling an unchanged device or adding another Workspace preserves pending deliveries. A changed session, VAPID key or encryption key requires fresh opt-in.

## Implementation boundaries

- [Migration 039](../../migrations/039_web_push.sql): device credentials encrypted with the existing application-secret encryption boundary; exact session and Workspace membership/preference versions; delivery outbox referencing immutable `workspace_change` revisions. No product-state event sourcing.
- [Outbox](../../src/server/web-push-outbox.ts): inserted atomically with the relevant Workspace change, only for already opted-in recipients. No historical backfill. Exact Active Work/follow-up references permit later relevance checks.
- [Server](../../src/server/web-push.ts): current session/account/member checks on subscription, dispatch/retry and notification target lookup. An endpoint cannot be rebound to a different account. A returned member needs fresh consent for their new membership version.
- [Provider configuration](../../src/server/web-push-config.ts): HTTPS browser-vendor endpoint allowlist, bounded/validated encryption keys, no arbitrary webhook/private-network URL. `web-push` uses a direct HTTPS request, rejects non-2xx responses and does not follow redirects. Do not log endpoints, encryption material, payloads or vendor response bodies.
- Graphile handles `web_push`; recovery scans bounded due/expired-lease batches. Delivery identity survives retries. Provider acceptance is recorded as `submitted`, **not delivered/read**. 404/410 disables the endpoint; transient/unknown outcomes retry the same identity, with bounded backoff and five attempts. Notices older than one hour are suppressed; provider TTL is one hour.
- [Service worker](../../public/sw.js): opaque delivery IDs, authenticated target lookup, persistent IndexedDB receipt deduplication plus notification tags. No API response/Workspace cache or offline mutation queue. Claim-before-display favors avoiding duplicates; a process crash or display failure can lose a notification. Exactly-once network/OS delivery is not promised.
- [Web controls](../../src/client/workspace-push.tsx): exact actor/session requests, Web Lock serialization and atomic expected-binding writes protect shared-browser account changes. An old tab checks the live identity before clearing another binding. Logout cleanup is bounded and never blocks logout indefinitely.

## Activation

The same values are required on Web and worker:

```dotenv
WEB_PUSH_ENABLED=true
WEB_PUSH_VAPID_PUBLIC_KEY=<public P-256 key>
WEB_PUSH_VAPID_PRIVATE_KEY=<private P-256 key>
WEB_PUSH_VAPID_SUBJECT=mailto:<operational contact>
```

Generate VAPID keys once with the installed `web-push` CLI, transfer the private key directly into the deployment secret store, and never commit/log it. HTTPS, a running worker and migrated PostgreSQL are required. There is no extra push SaaS account in this implementation; hosting/network costs still apply. Browser-vendor push infrastructure remains an external dependency.

Preserve VAPID keys across deployments. Rotation requires browser resubscription and fresh opt-in. `BETTER_AUTH_SECRET` also protects stored subscription credentials; rotating it without a controlled migration makes previous encrypted subscriptions unreadable and requires re-enabling. Do not silently reset either secret during a restart.

The manifest and PNG icons reuse the existing brand. The service worker controls notifications only; installation does not make the application usable offline.

## Browser limits and verification

The Workspace bell stays available after the introductory prompt is dismissed. Closing the browser's permission prompt leaves the option to retry. Following a denial, the panel shows the browser-specific route to change permission. It listens for permission changes and rechecks when the page regains focus or visibility. Web pages have no standard link to open the corresponding OS settings panel. Registration still requires the user's explicit action for the Workspace. [Notifications API](https://notifications.spec.whatwg.org/), [Permissions API](https://www.w3.org/TR/permissions/).

On iOS/iPadOS 16.4+, install RIMIAM on the Home Screen, enable “Open as Web App” if offered, open it from its icon and activate from the Workspace bell. On Mac, Safari exposes per-site notification permissions under Settings → Websites → Notifications. Chrome users can open the site controls beside the address on desktop and Android. The app also requires Web Locks for shared-device safety. [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Apple Home Screen setup](https://support.apple.com/it-it/guide/iphone/iphea86e5236/ios), [Safari website settings](https://support.apple.com/it-it/guide/safari/ibrwe2159f50/mac), [Chrome site permissions](https://support.google.com/chrome/answer/3220216), [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API).

**Diagnosing a missing notice.** In the bell panel, “Prova avviso sul dispositivo” asks the local service worker to display one generic test notice. To check the remote delivery path, have another member send a message after activation, then open “Controlla l’ultimo invio” and refresh it. This shows the latest status and time for the current device, session and Workspace subscription. A queued notice has yet to be submitted. Provider acceptance still requires device confirmation. If it was accepted but the screen stayed silent, check notification settings and Focus.

Suppressed notices fail closed when current authorization cannot be checked. A browser may still emit its own generic fallback under `userVisibleOnly`; background throttling, offline conditions, Focus/battery policies, permission revocation and storage clearing affect delivery/deduplication. See [notification options](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification).

Local verification on 2026-11-20 passed 25 [PostgreSQL/transport](../../tests/web-push.test.ts) and [service-worker](../../tests/web-push-worker.test.ts) tests. Six [Chromium scenarios](../../tests/e2e/web-push.spec.ts) cover the setup, dismissed prompt, permission recovery, local preview and session controls. The foreground recovery test changes Chromium's permission through its browser context and bridges the headless static getter to the resulting permission state. A WebKit run confirmed the iPhone setup branch. Safari on an iPhone 13 Pro simulator opened the Workspace bell, displayed the Home Screen guide, returned to chat and reopened the panel. OS notification presentation and delivery to physical devices still need live verification.

Before release, with explicitly authorized provider activation: enable from a real HTTPS app; send from a second account; close the recipient app and verify one generic notification on compatible Android and Home Screen iPhone/iPad; open it and verify the right authenticated Workspace. Repeat opt-out/logout, account switch, ended membership, expired subscription and reconnect. Confirm that two retries do not produce duplicate visible notices. Record actual browsers/OS versions, timing and limits; do not substitute these deterministic tests for that evidence.
