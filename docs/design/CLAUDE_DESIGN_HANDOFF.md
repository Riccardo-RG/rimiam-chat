# RIMIAM — Claude Design handoff

**13 September 2026 · Historical UX/UI exploration brief.** This document can be read without the repository. It describes the product, established constraints and requested design work; it does not approve new powers, capabilities or architecture. English translation: 26 September 2026. This preserves the original brief; consult [STATUS](../development/STATUS.md) for the current implementation and authorization rather than treating the historical work request below as a new instruction to proceed.

Provenance: the user's UX direction and clarifications from 13 September, reconciled in `UX_DIRECTION_RECONCILIATION.md`; pre-design implementation authorized in brief `a1b07e63-26ad-4ff6-b059-da7f53f6d25e/pasted-text.txt`. The canonical sources are `MVP_SPEC_v0.1.md`, ADR-0001–0015 and GTM/Product Discovery. This brief summarizes the constraints needed for design without replacing the complete decisions.

## 1. What RIMIAM is

A shared conversational space where people and a collaborative intelligence can talk, research, build and decide together. RIMIAM preserves continuity: what emerges from Conversation can become working information, a question, a task, a document or a decision through the appropriate path.

Conversation is the primary interface. Behind it is persistent, structured, inspectable and correctable state. RIMIAM is not a collection of chatbots, an integrations dashboard or a task manager with chat added. The name shown to people is **RIMIAM**; technical folders and packages still use MIRIAM.

## 2. Audience, problem and success criterion

The first beta concerns **two real people working on a project without a rigid structure**, through repeated interactions: a trip, a business to open or a shared initiative. These are examples, not Workspace types or mandatory roles. Do not introduce a company structure, project manager or founder as a prerequisite.

The problem is losing continuity between messages, sources, hypotheses, choices and work. Make this cycle feel natural: invitation → conversation → shared understanding → pause → return → continuation. The signal of value is being able to resume together, not the number of open panels. The usefulness of collaborative intelligence still requires validation with real models and users.

## 3. Established UX principles

- **Rich internal structure, calm external surface.** Structure supports collaboration; it need not all be visible at once.
- Conversation-first, with progressive disclosure of details. Make ongoing activity understandable without requiring people to learn the data schema.
- RIMIAM is present but discreet: explicit invocation by default; more proactive participation through an explicit preference. Silence ≠ consent.
- Distinguish proposal, acceptance, effect, history and uncertain outcome. A reassuring badge must not erase a qualification.
- Semantic changes can be requested naturally; effects always depend on identities/versions, authority and the applicable act. No ritual confirmation when the act is already unambiguous; no shortcut that implicitly approves something else.
- Administrative and operational actions remain reachable. A calm surface must not hide errors, conflicts, pending operations or active recording.

## 4. Home

The app Home is separate from a Workspace's Conversation: see spaces, enter one, create one and reach invitations to a specific space. No global AI chat without context and no dashboard of every capability.

New Workspace: name, brief free-text description, optional invitations and quick entry. The description is an introduction attributed to its author, **not** a canonical Goal, Accepted Information or the invitees' adherence. Creation and invitation delivery/acceptance are separate outcomes. Do not turn an email error into a false report that creation failed.

The welcome is brief and appears once per new Workspace. It uses the supplied introduction without asking people to repeat it. A deterministic welcome is acceptable: do not simulate model analysis. A member joining later reads the same history and does not cause the welcome to be republished.

## 5. Workspace / Conversation

The shared timeline is the Workspace's home: people, RIMIAM replies, voice messages, sources and the presence of ongoing work. The composer, continuity on return and clear speaker attribution take priority over tool density.

Make requests such as “Compare these options” or “That constraint needs reviewing” feel natural. The first may start permitted exploratory work; the second does not mean the constraint has already changed. Show understanding/proposal, any clarification, the authorized act and its actual result. Do not present every sentence as an already executed command.

Active Work persists beyond a single reply: its contract, meaningful state, assumptions and history must be inspectable. Currently eligible contributors can steer, pause, stop and resume shared exploratory work. Requesting it does not make someone its normative owner. Material conflicts require clarification; the last message, creator or an implicit majority does not win.

## 6. Activity component

A compact presence separate from the Lens: roughly two pills, with access to detail/storyboard and relevant history. The visible count is an exposure choice, not a limit on work or history. Do not invent events to fill space.

**Only observable/verifiable events**, not internal thoughts, chain of thought, Specialist routing or fictional progress. Examples:

- “Venue analysis started” → Active Work actually started, with an inspectable contract and sources.
- “Scope clarification needed” → a real conflict/Needs Input state, without favoring anyone.
- “Comparison ready” → an available Contribution, distinct from an adopted document and current validity.
- “A cost hypothesis emerged” → a candidate and its proposal basis, not Accepted Information.

“Verifiable” means that the event/proposal exists, not that its content is certain. An approval shown here belongs to its governed capability: Activity does not expand its scope or effects.

The detail may offer **Ask RIMIAM**, returning to Conversation with the correct object/version reference. Do not add CTAs that turn a pill directly into a Task, Goal, adoption or execution. Operational work controls and governed acts remain reachable through their appropriate paths.

Show only authorized shared material: no private mailbox, other Workspace or unrequested call analysis. Persistent access to Activity does not mean continuous intervention or a technical feed.

## 7. Workspace Lens

A secondary entry into the space's structure, conceptually organized as **Goal / Context / Work / Outputs**. These are browsing groups, not four databases, four chats or modules that must remain permanently open.

The Lens allows deeper inspection and a quick return to Conversation. Within the same account/Workspace session, preserve the path, selection and position where appropriate; revalidate state and access on reopening. Do not restore an expired confirmation or content after logout/access loss. This navigation need not be synchronized across devices or promise permanent restoration after restart.

The designer may explore native containers and interactions without turning the Lens into an always-expanded dashboard or removing paths to history, sources and recovery.

## 8. Goal / Context / Work / Outputs

| Area        | What it must make understandable                                                                                                                                                                                                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Goal**    | Readable but not dominant direction; it may be absent initially. One current primary Goal per Workspace, with inspectable previous identities/versions, Sub-goals and explicit personal adherences. A paraphrase is not a new Goal.                                                                                   |
| **Context** | Distinguishable Accepted Information used as working references, attributed statements, candidates, questions, constraints and decisions. Accepted ≠ certain; confidence ≠ authority; source ≠ truth. Corrections preserve author, version and history. No **“Not relevant”** CTA or new universal dismiss operation. |
| **Work**    | Tasks and Active Work close together where useful, with distinct semantics. Suggestion ≠ Task ≠ responsibility ≠ Commitment. Responsibility for another person requires their explicit acceptance. Active Work has no authority over the objects it addresses. No mandatory board or hierarchy.                       |
| **Outputs** | Inspectable results: distinguish Contributions, drafts and adopted Artifacts. A reply does not automatically become a document; an uploaded PDF is a Source. “Completed” means the output was produced at that time, not that it is adopted or still valid.                                                           |

Editorial acceptance is a contribution capability attributed to the person exercising it; it is not collective consent, representation or a mandate. Adopting a Decision, undertaking a Commitment and executing an action are different acts with their own boundaries.

## 9. Sources

Sources are accessible from the relevant context without requiring an always-visible primary area. People must still be able to find newly uploaded, unused, unprocessed or failed uploads without starting from a derived document.

Distinguish original, transcript/extraction, version, provenance and interpretation. Retain links to messages, documents, pages, Contributions and qualifications. A contributor uploading a contract is not automatically the author of the statements within it.

Voice recording, transcription and spoken replies are in scope. Show upload progress, processing authorization, unavailability and errors without a fake result. RIMIAM uses sufficient context and retrieves additional relevant material when necessary; it does not automatically inject full transcripts into every inference.

## 10. Email / Calendar and calls

Email and Calendar have their own surfaces and connections to central content; they need not be permanently open sections in Conversation. Private observations remain private until the person explicitly shares them. Email sending and Calendar effects require the specified authenticated acts, with exact content/version. Unknown outcome ≠ certain failure: preserve recovery without suggesting blind resending.

Human audio calls take place inside the Workspace; RIMIAM does not participate or speak live. Recording requires the personal consent of **everyone whose audio is captured**, covering transcription, retention as a shared Source and historical visibility to admitted members. A new arrival pauses capture before including them; consent withdrawal stops subsequent recording. Leaving/withdrawal does not automatically delete already authorized material.

Recording must be clearly visible and stoppable, even with Activity/Lens closed. After the call, RIMIAM analysis/summary requires **a separate request**. Recording and transcription adopt nothing. Incoming calls while the app is terminated, push and video are outside this scope.

## 11. People

People, invitations and access management are secondary to collaboration. Membership, contribution, access governance and decision authority are distinct. Admission includes retained shared history, including material from before admission: make this clear in the invitation/acceptance flow.

Owner / Member / Guest, if useful, are only faithful descriptions of existing powers. No new role system, mandatory single owner or permanent creator privilege. Guest does not promise limited history or separate privacy. If a label is inaccurate, omit it or describe the actual capabilities; do not invent a selector to create those powers.

Peer protection and joint conditions remain binding. Managing access does not authorize project decisions or Workspace closure/deletion. Personal departure requires no successor and does not extinguish existing obligations.

## 12. Sub-context / Workstream

A focused thread **inside the same Workspace**, with the same members, visibility and applicable authority. It is not a private room, mini-app or child canonical Context. Original events remain in their history and may be linked to multiple threads.

Explicit human creation or a RIMIAM proposal requiring deliberate activation. Lifecycle: **Active → Resolved → Archived**; reopen the same identity to Active while preserving history and sources. Resolved/Archived threads do not compete with active ones and remain inspectable. Reopened is the act of returning to activity, not a new identity.

Resolving a thread does not complete Tasks/Goals, satisfy Commitments, remove constraints or adopt Contributions. Any return to the main context is an attributed reference or summary, with subsequent governed adoption if requested. No automatic merge. The focused UX and its retrieval connection will be implemented through the direction chosen after design; lifecycle alone does not already provide that experience.

## 13. Shared mobile behavior

Mobile is primary. Prioritize Conversation reading/writing, one-handed use, predictable return from details, stable keyboard/drafts, progressive disclosure and accessibility. An adaptive Lens opens appropriately for the depth of its content; do not reproduce desktop columns on a narrow screen.

Make pending sends, recovery after a lost response, reconnection, expired sessions, lost access, conflict and potentially outdated content understandable. Reloading must not duplicate commands or welcomes. An offline client cannot promise that server approval has occurred.

## 14. Web / Next.js

Conversation is primary, with a Lens entry that may sit alongside it when space allows. Explore density, widths, resizing and long content; do not keep every capability permanently visible just because it exists in code.

Support keyboard use, focus/dialogs, narrow responsive layouts and reachable history/sources. The browser uses the same commands and server rules as mobile; cookies/sessions and the journal must not be replaced by authoritative local state.

## 15. iOS / SwiftUI constraints

Native SwiftUI UI, currently targeting iOS 18+. Consider NavigationStack, appropriate sheets/detents, safe areas, Dynamic Type, VoiceOver, keyboard and native gestures. The exact container framework is an implementation choice; the user journey is design work.

Sessions and pending commands use secure storage; reopening, foreground/background transitions and Workspace changes invalidate data/operations that are no longer allowed. Microphone permission, audio interruptions and visible recording cannot be hidden by a new composition. Do not propose a WebView instead of the native client.

## 16. Android / Jetpack Compose constraints

Native Compose UI, currently targeting API 26+. Consider system Back, sheets and adaptive paths, keyboard/insets, TalkBack, font sizes and Activity recreation. Do not automatically copy iOS gestures, bars and navigation.

Keep the Keystore-protected journal, restoration after recreation and current server checks. Microphone permissions, audio lifecycle and recording state take priority over decoration. Do not introduce a new cross-platform framework or change the server boundary to standardize layout.

## 17. Actual foundation state before design

**Implemented and verified in the pre-design increment:** correct qualifications/provenance in existing views; references to current and historical acceptances; atomic description/welcome at the creation boundary and in Web/iOS/Android journals; versioned Workstream lifecycle, explicit proposal activation and stale/retry protection; minimal filtering distinguishing active threads from proposed/concluded ones.

**Decided but to be composed/integrated after Claude:** final description/invitation forms and new Home, Lens/navigation/restoration, common Activity/storyboard, focused thread experience and retrieval connection, complete conversational mutation flows. The creation forms currently collect only a name; persistent description transport is ready. New lifecycle controls are available through the contract/API, not a new interim UI.

**Not validated by these checks:** visual experience or behavior with real users. Providers/credentials have not been activated; model usefulness, timing, quality and latency, real calls and physical-device tests remain to be verified. Local tests do not demonstrate product-market fit or release readiness. Design can be explored now; service-dependent behavior should be tested before freezing it.

## 18. What Claude may explore

Hierarchy, composition, navigation, density, progressive disclosure, Activity/Lens presentation, transitions and return paths, adaptation to screen size, visual design, typography, colors, iconography and microcopy. Distinguish native conventions from shared constraints. Include empty, loading, error, unavailable, conflict and historical states rather than only the happy path.

Client technologies, capabilities and semantics are not a request for a visual inventory. Any section present on the primary surface only for technical convenience may be removed from it, provided an appropriate path remains available when needed.

## 19. What must not be reconsidered

Authority/adherence, privacy and shared history, representation, qualifications/provenance, canonical lifecycles, the description/Goal distinction, the internal nature of threads and observable-only Activity are fixed. No new ACL, agent hierarchy, requester ownership, consent through silence or automatic adoption.

Do not add roles, billing, social features, post-MVP capabilities or an agent runtime; do not replace SwiftUI/Compose/Next.js. Do not hide a normative change behind an editorial correction. The server remains authoritative for state, permissions and Commit Points. Ideas requiring a new rule must be identified as out of scope, not silently incorporated into a mockup.

## What we want from Claude Design

Propose **at least three materially different UX/UI directions**, not three palettes applied to the same wireframe. Each direction must have a clear thesis about hierarchy, navigation, information density, interaction model, progressive disclosure, Conversation-first, Activity, Lens, adaptive/responsive behavior and visual language.

For **each direction**, study these separately:

1. **Web / Next.js:** wide Workspace and narrow viewport, Conversation and Lens, deeper inspection and return.
2. **iOS / SwiftUI:** compact native flow, Lens opening/depth, keyboard, gestures and accessibility.
3. **Android / Jetpack Compose:** native flow, Back/restoration, disclosure and adaptation, without copying iOS.

Semantics must remain consistent; **we do not want the same layout copied across all three platforms**. For each direction show entry/creation, returning to a Workspace, natural dialogue, work in progress/Needs Input/result, Context with a source and correction, a resolved/reopened thread, and access to Sources/People/Email/Calendar. Show at least one flow with two contributors and a restriction the UI cannot bypass.

Compare each direction's benefits, friction and risks, explaining what actually changes in the experience and which you recommend. Do not choose authority, provenance, lifecycle, privacy, the nature of sub-contexts, the Goal/description distinction or Activity semantics: they are already established here. The requested output is design exploration and a proposal, not new implementation or authorization to activate services.
