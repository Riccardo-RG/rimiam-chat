# RIMIAM clients and the shared API

<a id="miriam--multi-client-contract-and-native-slice"></a>

The Web beta uses Next.js. The local iOS and Android app shares one React Native frontend under `mobile/`. Both use the same PostgreSQL-backed application and versioned API. Mobile distribution and live provider/device acceptance are separate steps.

## Run the mobile app

1. Start PostgreSQL, apply the migrations and start the Web service and worker as described in the [README](../../README.md). Alternatively run `npm run api` for a standalone versioned API (default port 3002). Web and standalone API must use the same database, auth secret and public Web origin.
2. From the root run `npm ci --prefix mobile`. In `mobile/` run `npm run ios` with Xcode/CocoaPods or `npm run android` with Android Studio, an SDK and JDK 17. These are native builds. Expo Go does not include the calling modules. Expo generates the platform projects locally from [app.config.ts](../../mobile/app.config.ts).
3. At sign-in choose the installation URL, or set `EXPO_PUBLIC_RIMIAM_URL` before bundling. Use your HTTPS Web origin for login and capability connections. Debug also accepts the iOS simulator's loopback and Android emulator's `10.0.2.2` alias. Sign in with a verified eligible account. Each account authorizes its own provider connections.
4. Run `npm --prefix mobile run check` for lint (including React Hooks), formatting, TypeScript and unit tests. The tests import the shared API contracts, which use the root package dependencies. For a test-only checkout, install those with `npm ci --omit=dev` at the root. `npm --prefix mobile run bundle` exports production Hermes bundles for iOS and Android. [Native CI](../../.github/workflows/native-ci.yml) runs both commands. Native keyboard, pickers, permissions, OAuth redirects and push delivery need separate runtime checks.

For a local two-person simulator test, first run `npm run build:backend`, then `node --env-file=.env --import tsx tests/run-native-server.ts` from the root. The [fixture](../../tests/run-native-server.ts) uses a separate loopback PostgreSQL database named `miriam_native`, applies migrations and starts the test API/worker on port 3102 with fictional accounts. Choose `http://127.0.0.1:3102` on the iOS simulator or `http://10.0.2.2:3102` on the standard Android emulator. Rebuild and restart the fixture after changing server handlers.

The UI follows the Web hierarchy for Home, conversations and tools. Native uses OS controls for the keyboard, camera, sharing, notifications and provider consent. Source and attachment access still requires a current account and Workspace relationship. See [mobile push setup](NATIVE_PUSH.md) and [external services](DEPLOY_EXTERNAL_SERVICES.md) before physical-device testing or distribution.

The navigation menu in Home, You and Emme, and Today lists workspaces directly below Your spaces. On phones it opens as a drawer. Wide windows can keep it alongside the content. Today and the Home calendar shortcut open the internal agenda. The day picker, new reminders and new appointments work independently of external calendars. In personal reminders, the displayed time is the scheduled time for a one-off reminder or the next occurrence for a repeating one.

An iPhone 13 Pro simulator on iOS 18.2 exercised the personal-area drawer, internal agenda, native day picker and new-reminder editor against the local two-person fixture. A second run created a personal reminder, opened it from Today and checked that its editable title matched the saved value.

## Responsive reading and input

Web and native share the action catalog, glyphs, screen hierarchy and [interface languages](INTERFACE_LANGUAGES.md). Phone composers give the editor its own row. On wide, short native layouts, ancillary header content yields to the keyboard. The screen adapts to the available window, including rotation, safe areas and system text scale. Controls remain reachable by scrolling when the available height shrinks. Action hit areas can be larger than the visible icon. [Apple layout tips](https://developer.apple.com/design/tips/) · [Android touch targets](https://developer.android.com/develop/ui/compose/accessibility/api-defaults) · [WCAG reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) · [WCAG text resize](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)

Local checks used a populated test account. Browser layouts ranged from 320 × 568 to 1440 × 900, with additional landscape and enlarged-text checks. The iPhone SE, iPhone 13 Pro, iPhone 16 Pro and iPad simulators exercised different parts of the sign-in, Home, conversation and tool journeys. Android used an Android 15 Pixel emulator for Home, language persistence, the keyboard in group, direct and personal conversations, and drawing with touch. The [Home comparison](../design/reviews/2026-11-20-native-home/README.md) lists exact viewports and captures. These are local results; live push delivery and physical-device keyboard and drawing comfort require a device session.

The final local release run passed the root suite (605 tests), the native suite (32), the subsequent focused language, voice, commands and push-worker checks, Web and backend production builds, and both Hermes exports. Chromium exercised the optimized Web build, Firefox the 200% text flow and WebKit the two-member drawing and language flows. For the WebKit run on macOS 15, use the matching Playwright browser build. Running two Next development servers simultaneously caused repeated hot reloads during one run. The single-server development check and the optimized build passed. The repository lint run had one existing warning in an archived design prototype.

## Common HTTP boundary

Public DTOs and command schemas live in `src/contracts/`, independently of server implementation. Machine-readable OpenAPI 3.1 is available at **`GET /api/v1/openapi.json`**, derived from these schemas. `src/server/api.ts` handles standard Request/Response objects; `src/api.ts` supplies a bounded Node HTTP listener and `src/app/api/v1/[...path]/route.ts` is the Next adapter.

| Endpoint under `/api/v1` | Semantics |
| --- | --- |
| `POST /native/session` | Verified email/password sign-in, returning a signed session token and public user fields. |
| `GET /native/session` | Revalidate current session and account eligibility. |
| `DELETE /native/session` | Revoke this session, including when account eligibility is restricted. |
| `GET /workspaces` | Currently accessible Workspaces only. |
| `POST /workspaces` | Idempotent creation with stable `commandId` = new Workspace identity; transaction includes its receipt. |
| `GET /workspaces/{id}/state` | Compact, coherent current projection with revision and message high-water mark; not a replacement for full canonical history. |
| `GET /workspaces/{id}/history?through=…&before=…` | Most recent/older message pages; `nextBefore` advances backwards. |
| `GET /workspaces/{id}/messages?after=…&through=…` | Ascending incremental message pages within a captured high-water mark. |
| `GET /workspaces/{id}/changes?after=…` | Durable ordered revision hints, `nextAfter`, `headRevision`, `hasMore`. |
| `GET /workspaces/{id}/events` | SSE batches of the same change hints, resuming from `Last-Event-ID` or `after`. |
| `POST /workspaces/{id}/commands` | Validated commands through existing transactional services; public committed receipt. |
| `GET /workspaces/{id}/calendar?start=…&end=…&afterAction=…` | Canonical temporal view, shared exact-action proposals and own private observations; selectable windows/action paging. |
| `GET /workspaces/{id}/calendar-history?id=…&kind=…` | Shared version/provenance/approval history, excluding private observation contents and session/credential references. |
| `GET /workspaces/{id}/receipts/{commandId}` | The authenticated actor's committed receipt, still subject to current Workspace access. |

Responses include `X-Miriam-API-Version: 1`, private/no-store caching and structured failures `{error:{code,requestId,recovery}}`. Response fields can be added compatibly; clients ignore unknown fields. Incompatible changes require a new major route/version; do not silently change existing command meaning for installed clients. The compact projection keeps identities, relevant versions and epistemic qualifiers. Native capability views use common detail/history/source endpoints in the same handler; the table above lists transport entry points, not every route. Some web views retain legacy adapters to the same services. Public views exclude server diagnostics, credentials and unrelated private observations.

Command bodies are the existing public vocabulary, not a generic permission system. `expectedActorId`, supplied by the web journal and native commands, is an optional account-switch precondition; it never selects the authenticated actor or grants authority. Workspace authorization remains inside application commands and queries, independent of transport.

## Session security

Web authentication uses Better Auth cookies, trusted origins and CSRF protection. Native API requests use signed bearer sessions for the same accounts. Identity-provider consent runs in the system browser. The fixed app callback carries a single-use code and state; the app exchanges that code with its locally stored PKCE verifier. Each installation configures its own providers. Linking a login method is independent of granting access to a mailbox or calendar.

The app pins credentials to the selected API origin and refuses redirects on authenticated API calls. [Expo SecureStore](../../mobile/src/session.ts) keeps the session and the scoped outgoing command journal. The iOS keychain entries are available only on the same unlocked device. The app keeps workspace snapshots in memory, deletes temporary media after use and cleans its private preview/export directory at startup. An interrupted sign-out keeps the app locked until it can retry remote revocation.

Native transport does not confer membership, adherence, editorial acceptance, project authority or connection permissions. Every data request rechecks access; SSE rechecks session and membership for every batch. The direct Node listener replaces incoming IP-forwarding headers with the socket address. A hosted reverse proxy, trusted forwarding configuration, abuse controls and production TLS/cookie checks still require deployment verification.

## Recovery and synchronization

Persist the ID and exact command before sending. A response can be lost after commit. Look up the receipt first; a missing receipt is **unknown**, because the original transaction may still be in flight. An explicit retry uses the same ID/body and existing server preconditions. Changed payload under the same identity is rejected. A stale approval is not regenerated or updated automatically. Receipt access does not override departure/removal: an inaccessible Workspace remains inaccessible and the client cannot infer a failed command merely from denial.

Unsent text, reply references and attachment selections in a chat are saved separately in protected device storage, scoped by installation, member and conversation. The app flushes the draft when navigating away or entering the background. A receipt clears only the submitted version. If the operating system removes a staged attachment, the user can remove or replace it before resending.

Current state, source/history changes, queue insertion where required and command receipt retain their domain transaction boundaries. No additional schema or full event sourcing is introduced. Workspace creation writes a receipt. Invitation admission has its own explicit single-use endpoint and does not become a generic journal command; native clients preserve its actual server outcome and never infer Goal adherence from joining.

The React Native workspace reads the authorized snapshot on entry, then polls the durable change feed using its last loaded revision. It refreshes the snapshot when the revision changes, pauses polling in the background and checks again on return. Historical messages can be loaded through the versioned history endpoints. Each view discards responses from an earlier workspace or session. Push notifications are delivery hints and have their own permission, device and workspace checks.

The initial history window/page limits are presentation/transport choices, not retention, visibility or Context Engine correctness boundaries. Historical sources remain selectively retrievable by the existing server Context Engine. HTTP polling/SSE and Graphile remain infrastructure choices, not Goal or Active Work semantics.

## Acceptance

Use separate test accounts against the same installation to check invitations, cross-client delivery, history, permissions, interrupted sends and foreground resume. Test camera, media access, calls, OS notifications and system-browser OAuth on physical devices with the intended build and provider configuration. [STATUS](STATUS.md) distinguishes executed checks from outstanding live acceptance.

### Local evidence, 2026-11-21

On the iPhone 13 Pro simulator, XCTest checked the sidebar order with populated spaces, opened the personal chat and reached Today from its sidebar. It opened the native date picker, entered and left the reminder form, then saved a personal reminder and reopened it for editing. The test used fictional accounts and the local API.

The same iPhone opened a participant profile, read the fictional member’s email, closed it and opened the invitation form from the directory. The directory showed one Invite action. Back from the invitation restored the participants list. The Pixel 5 emulator running Android 15 also showed a protected profile photo beside an initials fallback, opened the profile and returned to the directory. It displayed the confirmation dialogs for revoking a pending invitation and removing another member’s access. Cancelling kept both records available. A second pass confirmed revocation and removal against the disposable fixture. The pending invitation disappeared and the active participant count fell from two to one.

On Android, Shared opened a document from the Links tab. Hardware Back restored the selected Links tab, then returned to chat. The same emulator shared a long link, filtered the collection to Links, hid that entry on the device, restored it and followed it to the original chat message. Unit tests cover persistence and isolation of hidden entries by installation origin, account and workspace. These native tests used a local API and synthetic state. Physical phones, store builds and external delivery were outside this run.

### Local evidence, 2026-11-20

The iPhone 13 Pro simulator and Android 15 emulator used separate fictional accounts in the same test Workspace. The iOS app signed in, accepted its beta notice, restored the session after relaunch, opened the Workspace and displayed the message sent from Android. Sending a reply with the iOS composer displayed it on Android.

Android also created a separate Workspace and invited the iOS account from its contacts. The iOS Home showed the named invitation, displayed the shared-history disclosure and opened the correct chat after explicit acceptance. Returning to Home showed the joined space and no pending invitation. In the reverse direction, iOS cancelled one new-space form, then created a different space with an Android contact and a second, typed email. Adding the email required a fresh history acknowledgement. The confirmation opened the correct chat. Android accepted its invitation, and the database showed two members, no added access authority and the separate email invitation still pending. The cancelled space was absent. On Android, a self-invitation left no workspace and the error kept the fields editable. After correcting it, entering the same person by email and contact ID produced one invitation bound to the account. The worker reported missing email configuration.

On Web, [the conversation reading regression](../../tests/e2e/conversation-reading.spec.ts) verified ordinary entry on Chromium and WebKit at phone size. The newest unseen mention was visible at the top of the chat viewport while the earlier mention stayed unread. With no mentions, a late-loading image preserved the bottom position.

An iPhone 13 Pro simulator (iOS 18.2, 390 × 844 pt) opened the ordinary Home row three times in a space with 21 synthetic member messages. The first entry showed mention 10, with 11 newer messages below it. The second showed mention 2. PostgreSQL recorded each mention as seen only on its respective visit. On the third entry, the last message ended 24 pt above the composer and stayed there after three further swipes toward the bottom.

An Android navigation check used 420 synthetic messages of varying heights, with unread mentions at positions 17 and 96. Opening the ordinary Home row landed on 96 with 324 newer messages below it. Only that mention was acknowledged. The next entry landed on 17. With both seen, regular entry and four further flings settled on message 420 above the composer.

Android also uploaded a standalone text source from Tools. The file appeared in Condivisi with its text preview. Export opened the operating-system share sheet with the named original. PostgreSQL retained the exact fixture bytes and the chat message count stayed unchanged.

On the Android 15 emulator, the tester opened WAV attachments from a group message and a direct message. Android reported playback started, paused and resumed for both. Closing either preview during playback stopped its audio and removed the temporary WAV from the app cache. Reopening showed “Ascolta allegato” with an empty playback cache and no active audio track.

On Android 15 at 320 dp with the system font at 160%, the populated Home exposed “Nuovo spazio” without scrolling. In a draft with a contact and a typed email, tapping the history disclosure changed the switch state and enabled “Crea spazio e invita”. The tester left the draft without submitting it.

An iOS XCTest restored a partially written group message after returning Home and after terminating and relaunching the app. It sent the message and verified the field stayed empty on reopening. A separate simulator journey switched between a direct chat and the personal assistant and recovered each distinct unsent text. Another iOS XCTest searched the member’s private mailbox using the keyboard Search key, opened the returned message, then requested and displayed a private calendar reading. These checks used the local server, PostgreSQL, worker and the deterministic providers in [the native fixture](../../tests/run-native-server.ts). The iOS simulator build needs its ordinary ad hoc signing and keychain entitlements to store a session.

Android 15 created a daily reminder in the app, displayed the single-occurrence and following-series edit scopes, confirmed closure of one occurrence, and retained the active series. A local two-account HTTP exercise used the same command builders to propose and accept an exact task revision, replay its receipt, replace one group occurrence and reschedule a personal reminder from its original group message. The other member could still read the authored message and could not read the personal reminder. [Agenda regressions](../../tests/agenda.test.ts) check that upcoming work immediately advances past closed dates without changing the worker’s delivery cursor.

On the iPhone 13 Pro simulator, a recipient cleared their own request for an answer. From the original message the tester opened a question, linked version 1 of an accepted reference as its answer, reopened it with a reason and read the three-entry history. A second run prepared a brief from a question and an accepted reference, then verified its revised version in the archive.

The workspace chat was exercised against the same populated local space in WebKit and React Native on iPhone 13 Pro (390 × 844) and iPhone SE (375 × 667). The checks covered the resting and expanded composer, the keyboard in both orientations, returning from Shared to the original draft, and opening the same file collection with `/file`. On iPhone 13 Pro the tester also filtered the timeline by a topic, sent a message carrying its version, returned to the full conversation and quoted a message from its menu. On SE, a drawing created with `/h` could be removed before sending. A second drawing survived app termination in its draft. Explicit sending produced exactly one message and one 1280 × 880 PNG with a non-empty stroke, then released the app-local drawing file. No external provider participated in these checks. Android 15 also completed drawing, removing, redrawing, sending and opening the PNG in English. The new file was named Sketch.png; the earlier Schizzo.png retained its original name. The downloaded 640 × 440 Android image contained the drawn stroke. Shared → Files included the space’s original Italian text filename and Media excluded it. The same chat was then checked in English on WebKit and iPhone 13 Pro: searching for “shared photos” surfaced the shared files collection on both clients, while the existing Italian space name, messages and filename were preserved.

The shared library check used the same workspace and original text file on Web and native. Chromium at 390 × 844, 667 × 375 and 1194 × 834 showed the original by name under Files and the correct empty Media filter without horizontal overflow. On iOS 18.2, XCTest on iPhone 16 Pro and iPad Pro 11 opened the original’s library row, filtered Media by the last seven days, cleared the filter, cancelled a new note and opened Upcoming in portrait and landscape. The iPad kept the chat in place behind the library panel. In English, Chromium and Android 15 showed the same original Italian filename in Files and excluded it from Media. Chromium also showed the English and Italian filters and empty states. These checks used local fixtures and simulated devices.

Separate [Google](../../tests/google-auth.test.ts) and [Microsoft](../../tests/microsoft-auth.test.ts) identity tests exercise the actual server callback and device exchange against PostgreSQL, including single-use PKCE, independent sessions and revoked eligibility. [Call tests](../../tests/voice-calls.test.ts) cover consent, recording fences, transcription and the separate analysis request with provider doubles. Browser consent on a physical phone, genuine mailbox/calendar access, signed push delivery and a two-device LiveKit audio session with recording, withdrawal and playback remain live checks. Human audio calls currently require the app in the foreground.
