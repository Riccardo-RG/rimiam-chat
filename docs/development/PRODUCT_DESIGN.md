# RIMIAM — product experience completion

## Current Web refinement — 2026-10-07

The user authorized a decisive Web redesign and delegated palette/composition choices. The implemented [Workspace composition](../../src/app/page.tsx) puts Conversation first, with compact Goal orientation, actual work/attention signals, readable attributed messages and a clear composer. Returning users resume from their Workspace list; Context, work and documents remain supporting views, with tools/people disclosed progressively. Account entry, responsive navigation and Light/Dark/System presentation use the [cobalt/slate palette](../design/BRAND.md#current-web-presentation--2026-10-07); the supplied multicolor logo is unchanged.

This reversible presentation choice supersedes earlier Web styling/composition where different, without changing canonical semantics, authority, provenance or command boundaries. Native clients are unchanged; their visual alignment is deferred until the user confirms Web testing is finished. No browser or visual acceptance was performed. [STATUS](STATUS.md) records actual checks and remaining limits; the historical directions below are not a claim of current visual acceptance.

## Previous brand refinement — 2026-09-28

The user's supplied geometric logo now defines the [brand assets and palette](../design/BRAND.md): green actions, restrained purple/orange accents, neutral Light/Dark surfaces. This supersedes earlier teal/monochrome palette wording while preserving the approved Ritmo hierarchy and platform-native behavior. The multicolor SVG is the shared source for web and native icons; no product semantics change.

## Earlier integration — Ritmo, 2026-09-14

The user approved integrating the Ritmo direction and completing the actual Web/SwiftUI/Compose product, superseding the later handoff-only pause recorded below. The hierarchy is **Home → Conversation + Activity → Lens → Goal / Context / Work / Outputs**. Sources, People, Calendar and Email remain reachable secondary surfaces. Activity opens real historical references; returning to Conversation preserves the object/version and never performs its governed action. Workstream focus reads the same shared history, not a private channel.

The requested visual refinement uses stronger typographic hierarchy, intentional borders/dividers and neutral Light/Dark surfaces. Web uses responsive reading space and an optionally pinned inspector; iOS uses native navigation/sheets and safe areas; Android uses Compose/Material compact/expanded layouts and system Back. The isolated study's Android representation is an application surface rather than a copied iPhone frame. The example is Riccardo and Giulia developing RIMIAM; illustrative prototype content never becomes runtime data.

This is an authorized, reversible presentation/integration refinement, not an ADR or new product authority. [STATUS](STATUS.md) records implementation progress and actual verification. Earlier exploration below is retained as history; its old five-area composition and handoff deferral do not override this refinement.

## Earlier direction

2026-09-11. Engineering/design direction under the user's MVP-completion brief and the subsequent dedicated frontend/design request (`7f4eb54d-3963-4ceb-a472-311781d32ffd`). This is a reversible implementation choice, not a new product ADR. Canonical authority: [MVP §§2, 6–7, 16](../product/MVP_SPEC_v0.1.md), [ADR-0010](../decisions/ADR-0010-client-nativi-backend-comune.md), [ADR-0014](../decisions/ADR-0014-active-work-specialist-contribution.md).

## Exploration before implementation

| Direction                        | Composition and interaction                                                                                                                                       | Strengths                                                                                              | Material risks                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **Conversation canvas**          | Quiet editorial timeline; compact Goal; contextual inspector. Home is a useful Workspace list. Generous reading width, restrained surfaces, text-led attribution. | Closest to Conversation-first, readable analysis and source inspection; simple responsive composition. | Requires visible, well-named entry points so deeper capabilities remain discoverable.                    |
| **Conversation and action tray** | Phone-first focused timeline with reachable composer, expandable work tray and temporary sheets. Home emphasizes resume/create/join.                              | Natural phone interaction, little persistent chrome, clear next action.                                | Nested sheets and keyboards can obscure context; weak use of desktop space if merely stretched.          |
| **Adaptive studio**              | Workspace rail, central conversation, persistent side pane for current focus/results; denser typography and stronger dividers.                                    | Good comparison and complex-work orientation on large displays.                                        | Risks recreating a management dashboard, permanent capability clutter and higher navigation maintenance. |

**Selected synthesis:** canvas hierarchy, native reachability from the tray, supporting panes from the studio only when useful and space permits. No equally prominent home sections for every capability. This preserves clarity for small groups while allowing inspection of complex state.

## Shared information architecture

- **Application Home:** existing Workspaces, create/join, account access and a concise explanation through the product: people converse; Miriam helps maintain shared understanding and ongoing work. No dashboard metrics or large marketing site.
- **Workspace home:** Goal as orientation, compact actual attention, human/AI Conversation and reachable composer. Miriam's work has a small durable presence; details and completed history are available on demand.
- **Inspectable layers:** Context (qualified understanding, questions and governed decisions), work, materials (Sources/Artifacts), connected capabilities and people/access. These support the conversation and retain their existing authorization and provenance controls.
- **States:** distinguish proposal, accepted reference, authorized action, provider receipt and unadopted Contribution in both words and structure. Human account names never determine whether a message is AI. No fake thinking, progress percentages or chain-of-thought.

## Earlier visual and platform language

Warm neutral canvas, charcoal text, restrained deep teal accent; system UI typography for controls and body, editorial heading rhythm on web. Consistent 4/8-based spacing, quiet borders, modest radii, visible focus and sufficient contrast. Color supplements text/state rather than carrying meaning alone. No required animations, glass or gradients.

Web uses a Workspace rail and a readable central canvas; an optional supporting pane uses wide screens, and narrower windows use a focused detail layer. Keyboard navigation, focus restoration, escape/back and persistent drafts are required. iOS uses NavigationStack, safe-area composer, sheets for temporary focused operations and Dynamic Type. Android uses Scaffold, IME/system-back handling and a supporting pane only at expanded widths. Layouts are related, not pixel-identical.

## Research and limits

Primary sources informed the layout principles, not copied branding: [Android canonical layouts](https://developer.android.com/develop/adaptive-apps/guides/canonical-layouts) distinguishes supporting content from the primary surface and adapts panes to width; [Apple sheets](https://developer.apple.com/design/human-interface-guidelines/sheets) informs focused temporary operations; [Slack split view](https://slack.com/help/articles/47144721728275-Use-split-view-in-Slack) demonstrates retaining conversational context while inspecting another object. Apple's Layout page required JavaScript in the research reader, so no unseen details are treated as evidence.

The design remains to be checked at actual desktop/laptop/narrow/tablet/mobile widths and representative native sizes. Real-model behavioral acceptance is separate; judgments about intervention quality require actual provider evidence. Current provider readiness and completion/verification evidence belong in STATUS and acceptance records, not in this rationale.

## Historical Claude Design handoff

2026-09-12: final visual composition is deliberately deferred under the user's latest brief. [Pre-design functional coverage](PRE_DESIGN_COMPLETENESS.md) and [CODEMAP](CODEMAP.md) identify reusable API clients, command journals, native WorkspaceModels, capability views and speech/capture controllers. Replace their presentation without recreating server product logic. Preserve exact-content previews, explicit consent, current revisions, unresolved conflicts, recovery states and visible Contribution/adoption distinctions. No browser or visual acceptance is implied by the current build/typecheck evidence.
