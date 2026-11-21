# Home, navigation and invitations

The Android captures use the installed React Native app on a Pixel 5 emulator running Android 15. Chromium and Android show the same local PostgreSQL test account, conversations and agenda. Sizes below are logical pixels. The screenshots are compressed and scaled for comparison. Android system bars are included.

| View | Previous Android | Current Android | Current Web |
| --- | --- | --- | --- |
| Phone, 390 × 844 | [Previous Home](before-phone.webp) | [Home](native-after-phone.webp) | [Home](web-after-phone.webp) |
| Tablet, 768 × 1024 | [Previous Home](before-tablet.webp) | [Home and sidebar](native-after-tablet.webp) | [Home and sidebar](web-after-tablet.webp) |
| New space | | [Selected contact and history notice](native-after-create-contact.webp) | [Initial form](web-after-create-phone.webp) |

On the phone, the [navigation drawer](native-after-drawer-phone.webp) opens from the Home header. On wider layouts the same destinations stay beside the content. The shortcut to create a workspace remains in the heading when the device uses [large text at 320 × 568](native-after-small.webp). The [844 × 390 landscape view](native-after-landscape.webp) scrolls independently of its sidebar.

The four Android sizes were exercised through opening and cancelling the creation form. At 390 × 844, entering a contact name returned the existing personal contact. Selecting the contact and tapping the history disclosure enabled the invitation action. The unsubmitted form was cancelled. The emulator's original size and system text scale were restored.

## Multiple incoming invitations

Two pending invitations previously occupied 434 CSS pixels at 390 × 844 in Chromium. The collapsed inbox occupies 72 pixels after the change, in both the Home and a workspace. Opening the list and choosing one invitation reveals the history admission. An isolated WebKit regression covers both pages and confirms that the checkbox starts unchecked. [Before](web-before-invites-workspace.webp) · [After](web-after-invites-workspace.webp) · [Regression test](../../../../tests/e2e/workspace-create-invites.spec.ts)

On Android at the same phone size, the collapsed inbox had a 46 dp touch target. From the list, selecting a group opened its admission notice. The acceptance button stayed disabled until the participant explicitly confirmed history visibility. The tester then closed the notice and verified the same inbox in the workspace. Both locally created invitations were withdrawn after the test. [Home summary](native-after-invites-home.webp) · [List](native-after-invites-list.webp) · [Admission](native-after-invites-detail.webp) · [Workspace summary](native-after-invites-workspace.webp)

All people and conversations in these captures are synthetic. The tests ran locally.

## Large text, keyboard and assistant configuration

Android 15, 140% font scaling. With Gboard open at 844 × 390, the send action stayed entirely above the keyboard in [private chat](verify-landscape-diagnose-direct.webp), [You and Emme](verify-landscape-diagnose-personal.webp) and [the workspace](verify-landscape-diagnose-space.webp). In the emulator's physical pixels their lower bounds were 362, 346 and 374 respectively. The keyboard began at 390. No message was sent to an external provider.

At 360 × 640 the assistant settings previously put every space above the editable fields. The new conversation selector shows the active scope and lets people search, switch or keep unsaved changes. With an unsaved change to the assistant name, the test exercised both staying put and switching without saving. [Before](verify-small-account-model.webp) · [After](verify-small-scope-after.webp)

## Language selection

The local Android test used the same signed-in fixture account for both languages. From the profile it selected English, terminated and reopened the app, verified the English Home, switched to Italian, and verified the Italian Home after a second cold start. It restored the device-language preference at the end. User-written reminder titles remained in the language in which they were entered.

| | Home after restart | Language preference |
| --- | --- | --- |
| English | [Your spaces](native-language-home-en.webp) | [Profile](native-language-account-en.webp) |
| Italiano | [I tuoi spazi](native-language-home-it.webp) | [Profilo](native-language-account-it.webp) |
