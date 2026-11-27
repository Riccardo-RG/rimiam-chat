# RIMIAM clients and the shared API

<a id="miriam--multi-client-contract-and-native-slice"></a>

The Web beta uses Next.js. The local iOS and Android app shares one Flutter frontend under `mobile/`. Both use the same PostgreSQL-backed application and versioned API. Mobile distribution and live provider/device acceptance are separate steps.

### Web and mobile experience

Riccardo wants people to recognize the same space, people, content and outcomes on every device. For the Flutter work, keep message identity, permissions, mention counts and private versus shared destinations consistent with the Web. Choose interactions for each platform: a desktop user can drag a photo into the conversation, while a mobile user can take one or share one from the system photo library.

The cross-device acceptance journey passed on the local production Web build and the Android 15 Flutter emulator. A sender selected a contact in the Web composer. The recipient's open Web Home displayed **@ 1**. Tapping **@** on Android opened the exact message and recorded it as read. The original browser tab removed the badge on its next directory read, with zero main-frame navigations or manual refreshes. Both sessions used the same local PostgreSQL database. This test opened the mention from Home. Opening a push notification on physical hardware requires its own evidence.

## Run the mobile app

1. Start PostgreSQL, apply the migrations and start the Web service and worker as described in the [README](../../README.md). Alternatively run `npm run api` for a standalone versioned API (default port 3002). Web and standalone API must use the same database, auth secret and public Web origin.
2. Install Flutter 3.50.1, Xcode for iOS or the Android SDK and JDK for Android. From `mobile/` run `flutter pub get --enforce-lockfile` and `dart run tool/prepare_host.dart`. Enter the generated directory, run `flutter pub get --enforce-lockfile`, select a device and run `flutter run`.
3. At sign-in choose your HTTPS installation. Debug builds can use the iOS simulator loopback address or the Android emulator's `10.0.2.2` alias. [Two-account fixture and instructions](../../mobile/README.md)
4. In `mobile/` run `dart analyze lib test tool` and `flutter test`. [Mobile CI](../../.github/workflows/flutter-ci.yml) also generates both hosts and compiles a debug app on each platform.

For a local two-person simulator test, first run `npm run build:backend`, then `node --env-file=.env --import tsx tests/run-native-server.ts` from the root. The [fixture](../../tests/run-native-server.ts) uses a separate loopback PostgreSQL database named `miriam_native`, applies migrations and starts the test API/worker on port 3102 with fictional accounts. Choose `http://127.0.0.1:3102` on the iOS simulator or `http://10.0.2.2:3102` on the standard Android emulator. Rebuild and restart the fixture after changing server handlers.

The UI follows the Web hierarchy for Home, conversations and tools. Native uses OS controls for the keyboard, camera, sharing, notifications and provider consent. Source and attachment access still requires a current account and Workspace relationship. See [mobile push setup](NATIVE_PUSH.md) and [external services](DEPLOY_EXTERNAL_SERVICES.md) before physical-device testing or distribution.

The navigation menu in Home, You and Emme, and Today lists workspaces directly below Your spaces. On phones it opens as a drawer. Wide windows can keep it alongside the content. Today and the Home calendar shortcut open the internal agenda. The day picker, new reminders and new appointments work independently of external calendars. In personal reminders, the displayed time is the scheduled time for a one-off reminder or the next occurrence for a repeating one.

An iPhone 13 Pro simulator on iOS 18.2 exercised the personal-area drawer, internal agenda, native day picker and new-reminder editor against the local two-person fixture. A second run created a personal reminder, opened it from Today and checked that its editable title matched the saved value.

## Responsive reading and input

Web and native share the action catalog, glyphs, screen hierarchy and [interface languages](INTERFACE_LANGUAGES.md). Phone composers give the editor its own row. On wide, short native layouts, ancillary header content yields to the keyboard. The screen adapts to the available window, including rotation, safe areas and system text scale. Controls remain reachable by scrolling when the available height shrinks. Action hit areas can be larger than the visible icon. [Apple layout tips](https://developer.apple.com/design/tips/) · [Android touch targets](https://developer.android.com/develop/ui/compose/accessibility/api-defaults) · [WCAG reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) · [WCAG text resize](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)

**Historical checks · 21 November (previous mobile client).** Local checks used a populated test account. Browser layouts ranged from 320 × 568 to 1440 × 900, with additional landscape and enlarged-text checks. The iPhone SE, iPhone 13 Pro, iPhone 16 Pro and iPad simulators exercised different parts of the sign-in, Home, conversation and tool journeys. Android used an Android 15 Pixel emulator for Home, language persistence, the keyboard in group, direct and personal conversations, and drawing with touch. The [Home comparison](../design/reviews/2026-11-20-native-home/README.md) lists exact viewports and captures. These are local results; live push delivery and physical-device keyboard and drawing comfort require a device session.

That release passed the root suite (605 tests), the native suite (32), the subsequent focused language, voice, commands and push-worker checks, Web and backend production builds, and both Hermes exports. Chromium exercised the optimized Web build, Firefox the 200% text flow and WebKit the two-member drawing and language flows. For the WebKit run on macOS 15, use the matching Playwright browser build. Running two Next development servers simultaneously caused repeated hot reloads during one run. The single-server development check and the optimized build passed. The repository lint run had one existing warning in an archived design prototype.

### Verification on 26 November 2026

A production Web build was compared with its predecessor using Chromium on loopback.
Each build opened the same local PostgreSQL workspace with 28 synthetic messages three times per profile.
Home measures navigation to a usable workspace button. Chat measures that button to the last message
being rendered. The scroll sample visits 24 positions using animation frames. The table reports medians
in milliseconds across the three runs; these are developer-machine timings, with no network throttling.

| Web profile | Home, before → after | Chat, before → after | Scroll frame p95, before → after |
| --- | --- | --- | --- |
| Desktop Chrome, 1280 × 720 | 285 → 264 | 253 → 159 | 18 → 18 |
| Pixel 7 browser, 412 × 839 | 283 → 164 | 281 → 139 | 19 → 18 |

Decoded JavaScript at Home dropped from 1,956,389 to 1,350,778 bytes (31%). Four secondary workspace tools
load on demand. The chat now requests the WebRTC SDK only after admission to a call. The availability
control works before that download. Localized date formatters are reused when rendering history.
The measurements support a payload reduction. Opening times vary with local load and need sampling
on physical phones before treating any latency movement as typical.
[Repeatable browser journey](../../tests/e2e/workspace-performance.spec.ts).

On the Android Pixel-profile emulator, a separate Flutter 3.50.1 arm64 **profile** APK compared the generated 20:18 native chat with the version that groups consecutive authors. It opened the real workspace widget with 600 synthetic messages, three people and Emme. Both versions shared the same process, in-memory dataset, Italian locale, light Graphite theme, 1080 × 2340 display, 440 dpi and 60 Hz refresh. After one warm-up per version, four visits per version ran in A/B/B/A/A/B/B/A order. Each scrolled 4,800 logical pixels into history and back over two 1.55-second animations.

| Native measurement | Earlier layout | Grouped authors |
| --- | ---: | ---: |
| Open to visible messages and a scrollable timeline, median | 34.0 ms | 45.4 ms |
| Flutter build time during scrolling, median of per-run p95 | 10.4 ms | 12.4 ms |
| Flutter raster time during scrolling, median of per-run p95 | 105.7 ms | 107.0 ms |
| Messages with their center visible upon entry | 5 | 7 |

All eight measured visits returned to the last message. Opening ranged from 31–56 ms in the earlier layout and 35–162 ms with grouped authors. The Android 15 emulator used Impeller/OpenGLES through software SwiftShader. During scrolling, 245/256 earlier frames and 222/232 current frames exceeded 16.7 ms in the build or raster phase. The current layout fits more messages, while these samples establish no rendering speedup. The experiment isolates rendering with an already running engine. Network loading, cold process start, finger input latency and sustained frame pacing on physical devices need separate measurements.

Chromium and WebKit exercised the release check with reduced motion and a blocked response, the
personal composer with a simulated 300 px visual viewport and a 35 px pan, and two-member delivery
with the keyboard viewport changing. The iPhone 13 Pro **simulator** on iOS 18.2 also sent from the
native app with the system keyboard actually open. XCTest measured the field at y=405–449 and
Send at y=451–495, above the keyboard's y=553. A separately admitted Web participant received the
message and shared a photo in the same space. No physical device was attached.

In a separate Web run, Mobile Safari on the same simulator followed a synthetic verification
link, admitted the invited account and delivered exactly one message to the second account.
The Web editor ended at y=334 pt and Send at y=422 pt, with the system keyboard starting at
y=553 pt. Android's system WebView on the emulator also delivered one message with the IME
open. Its Send control ended 20 CSS pixels above the visible viewport edge. These Android
results were obtained in a local test host embedding the system WebView. Standalone Chrome
on that emulator was at first-run setup.

On Web, a fresh session lookup can reach the authentication service's per-IP rate limit even
when the account cookie is valid. Home and direct chat wait for the server's retry interval
before reading the session again. Other temporary lookup failures offer a retry. This recovery
only repeats the session read. The [browser regression](../../tests/e2e/loading-and-keyboard.spec.ts)
covers a returning account, a throttled read and a temporary service error.

### Flutter chat feasibility on 26 November 2026

The [Flutter 3.50.1 client](../../mobile/README.md) signs in through the versioned API, checks the beta rules, lists the member's workspaces and reads and writes group chat. The Android and iOS debug apps have their own test identifiers. They used the same PostgreSQL-backed local installation and a second admitted account.

| Test environment | Observed result |
| --- | --- |
| iPhone 13 Pro simulator, iOS 18.2 | The text field and Send ended at y=500 pt. The system keyboard started at y=553 pt. A single tap delivered one message to the second member. |
| Pixel emulator, Android 15 | With Gboard open, the field and Send ended 22 physical pixels above the keyboard. A single tap delivered one message to the second member. |
| Flutter tests with controlled transport and storage | The [three chat journeys and Home](../../mobile/test/) cover read-only membership, group mention targets, private consent, recovering an interrupted send, account isolation and 200% text at 320 px. |

On subsequent Flutter builds, the system keychain or Android encrypted storage retained the session, workspace text draft and unresolved send across process termination. A fresh server session and membership check precedes opening the draft. On the iPhone 13 Pro simulator, XCTest entered a draft, sent the app to the background, terminated it and launched it again. It recovered the draft, sent it once and verified the cleared field on a second restart. A separate account read exactly one copy. On Android 15, Gboard remained usable after restoration. A proxy held back a successful response after commit. After another force-stop, an explicit receipt check recovered the original ID. The network trace showed one POST command and the recipient saw one copy. The [chat tests](../../mobile/test/journey_test.dart) and [session tests](../../mobile/test/session_test.dart) also cover revocation, access isolation, a lost request and an interrupted sign-out.

On the Android 15 emulator, a personal question sent with Gboard open reappeared after leaving and reopening **Tu ed Emme**. On the iPhone 13 Pro simulator, XCTest opened a new personal conversation from Home and sent with the system keyboard visible. After terminating the process and signing in automatically with the stored test session, the same question reappeared. A separate API read found one copy, attributed to the sender. The second account received HTTP 403 on the private conversation. Both platforms submitted to the local queue with external model calls disabled.

On Android a second account could also send and receive a direct message with the tester. A separate group had two mentions separated by twelve messages. Tapping the group's name positioned the newest mention on screen. Tapping **@** opened the older one. The server's remaining count changed from two to one to zero. The next ordinary visit displayed the last message.

| Mobile capability | Flutter evidence at this checkpoint |
| --- | --- |
| Sign-in, restored session, group messages and drafts | Two local platform builds using the versioned API and test accounts. After process termination the successful send had one receipt and one recipient copy. |
| Direct chat with a person and private chat with Emme | Direct delivery tested from the Android Home with two accounts. Personal chat tested on iOS and Android. Flutter tests also cover both people's consent to a private summary, revocation and source selection for a personal consultation. |
| Creating and joining a space | A two-account Flutter/API test created a space with an introduction and TXT, selected the same contact by address and email, and produced one invitation. The second account received 403 before acceptance and could read the introduction and exact file bytes afterwards. A lost creation reply was recovered from the receipt. The Home inbox and explicit history consent have widget coverage. |
| Device attachments | The Android 15 system file picker imported a TXT. After force-stop and relaunch, the sender recovered the draft with its attachment, sent it and opened its preview. The second account received one copy and downloaded the same 41 bytes. On the iPhone 13 Pro simulator the system photo picker returned a PNG, the draft survived termination and the recipient got one message. iOS re-encoded the image and the 200 × 120 RGB pixels matched the selected photo. Physical camera capture and screen reader operation still need device checks. |
| Agenda | Nine local Flutter tests and four two-account API scenarios cover personal and space reminders, editing one occurrence or subsequent dates, appointment invitations and RSVP. On the Android 15 emulator, Home → Oggi opened the agenda. After a force-stop, the tester recovered a draft, then created a reminder and an appointment. The owner saw each once. A second account could not see the personal items. |
| Shared collection and personal files | A [two-member local database test](../../mobile/test/file_library_local_fixture.dart) created a private note, explicitly copied it into a selected workspace, checked its preview and original, then checked personal favorites, authorized withdrawal and restoration. Plain text notes and uploaded files have this coverage. The structured document editor and generated documents require separate evidence. |
| Tasks | Using the Flutter menu in the group on a Pixel 5 emulator running Android 15, the invited member accepted the task, commented, placed it on hold and completed it. The second account saw each status and one copy of the comment. A separate [API test](../../mobile/test/workspace_tasks_local_fixture.dart) simulated a lost reply to the comment. |
| Assistant settings and accounts | A [two-member integration test](../../mobile/test/assistant_settings_local_fixture.dart) exercised personal and workspace instructions and the creator’s right to change the workspace connection. [Account tests](../../mobile/test/account_entry_test.dart) exercise registration, recovery and matching the browser callback to the original login. Provider sign-in and email delivery still require external acceptance. |
| Contesto condiviso and Direzione | Two-account local API tests checked the original source, goal version history, rejection of a concurrent edit and the difference between a proposal and an adopted decision. A private consultation failure from an unavailable test provider did not add a message to the group. |
| People, permissions and profile | The two-account local installation exercised invitations, revocation, read access to a member profile, photo, delegation and exit. The Pixel emulator opened the group member and personal profile screens. |
| Group composer | The group file reference and explicit mentions survive a restart and uncertain send. On the two-account local installation the selected recipient's unread mentions contained the exact message after one committed send. A widget test covers two members with the same display name and the choice of one recipient. Group chat, shared files and the native tools use the same space ID. |
| Activity and questions | The [two-account fixture](../../mobile/test/workspace_activity_local_fixture.dart) recorded a question on the original message. A second member archived a topic and the first restored it. The server rejected an edit to the old version, kept the source and returned one chat notice for each transition. [Flutter widget tests](../../mobile/test/workspace_activity_test.dart) cover confirming a question, opening archived topics as a reader and confirming archival. |
| Local upgrade and live checks | The in-place update from React Native was exercised on an iPhone 16 simulator and Pixel 5 emulator. Actual calendar/email OAuth consent, two-device audio calls and signed push delivery still require configured services and consenting devices. [Upgrade](NATIVE_UPGRADE.md) · [External-service checks](DEPLOY_EXTERNAL_SERVICES.md) |

Those first installations used dedicated application IDs. The subsequent local Android and iOS upgrades used the same RIMIAM identifier as the old client. Both restored the legacy text and attachment and retained the original identity of an uncertain send. Flutter is the mobile frontend in the working tree. Distribution with the existing release signing identities, VoiceOver, TalkBack and physical devices require separate acceptance. [In-place upgrade evidence](NATIVE_UPGRADE.md)

The final iPhone 13 Pro simulator run opened **Nuovo spazio**, filled the space name, selected the synthetic contact **Luca Collaudo Web**, confirmed full-history visibility, and chose **Crea spazio e invita**. The newly named chat and its composer appeared. XCTest executed one case with zero failures. The incoming acceptance and retained-content checks above were separate tests against the server. The full Flutter test suite passed 65 cases and Dart analysis reported no issues.

The integrated local suite subsequently passed 118 Flutter tests and Dart analysis reported no issues. The iPhone 16 simulator exercised two paths from the same image preview. **Vai al messaggio** opened the original group message. **Chiedi a Emme su questo file** returned to the group composer with the chosen version attached as a reference, ready for an explicit question. On the iPhone 13 Pro simulator, **Direzione** displayed the adopted decision, reopened goal version history and navigated to its original message. These simulator checks used the local installation. Publication, external providers and physical-device tests remain separate.

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

The app pins credentials to the selected API origin and refuses redirects on authenticated API calls. [Native secure storage](../../mobile/lib/local_secure_storage.dart) keeps the session and the scoped outgoing command journal. The iOS keychain entries are available only on the same unlocked device. The app keeps workspace snapshots in memory, deletes temporary media after use and cleans its private preview/export directory at startup. An interrupted sign-out keeps the app locked until it can retry remote revocation.

Native transport does not confer membership, adherence, editorial acceptance, project authority or connection permissions. Every data request rechecks access; SSE rechecks session and membership for every batch. The direct Node listener replaces incoming IP-forwarding headers with the socket address. A hosted reverse proxy, trusted forwarding configuration, abuse controls and production TLS/cookie checks still require deployment verification.

## Recovery and synchronization

Persist the ID and exact command before sending. A response can be lost after commit. Look up the receipt first; a missing receipt is **unknown**, because the original transaction may still be in flight. An explicit retry uses the same ID/body and existing server preconditions. Changed payload under the same identity is rejected. A stale approval is not regenerated or updated automatically. Receipt access does not override departure/removal: an inaccessible Workspace remains inaccessible and the client cannot infer a failed command merely from denial.

Unsent text, reply references and attachment selections in a chat are saved separately in protected device storage, scoped by installation, member and conversation. The app flushes the draft when navigating away or entering the background. A receipt clears only the submitted version. If the operating system removes a staged attachment, the user can remove or replace it before resending.

Current state, source/history changes, queue insertion where required and command receipt retain their domain transaction boundaries. No additional schema or full event sourcing is introduced. Workspace creation writes a receipt. Invitation admission has its own explicit single-use endpoint and does not become a generic journal command; native clients preserve its actual server outcome and never infer Goal adherence from joining.

The Flutter workspace reads the authorized snapshot on entry, then polls the durable change feed using its last loaded revision. It refreshes the snapshot when the revision changes, pauses polling in the background and checks again on return. Historical messages can be loaded through the versioned history endpoints. Each view discards responses from an earlier workspace or session. Push notifications are delivery hints and have their own permission, device and workspace checks.

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
