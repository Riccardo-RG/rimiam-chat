# MIRIAM — product experience completion

2026-09-11. Engineering/design direction under the user's MVP-completion brief and the subsequent dedicated frontend/design request (`7f4eb54d-3963-4ceb-a472-311781d32ffd`). This is a reversible implementation choice, not a new product ADR. Canonical authority: [MVP §§2, 6–7, 16](../product/MVP_SPEC_v0.1.md), [ADR-0010](../decisions/ADR-0010-client-nativi-backend-comune.md), [ADR-0014](../decisions/ADR-0014-active-work-specialist-contribution.md).

## Exploration before implementation

| Direction | Composition and interaction | Strengths | Material risks |
| --- | --- | --- | --- |
| **Conversation canvas** | Quiet editorial timeline; compact Goal; contextual inspector. Home is a useful Workspace list. Generous reading width, restrained surfaces, text-led attribution. | Closest to Conversation-first, readable analysis and source inspection; simple responsive composition. | Requires visible, well-named entry points so deeper capabilities remain discoverable. |
| **Conversation and action tray** | Phone-first focused timeline with reachable composer, expandable work tray and temporary sheets. Home emphasizes resume/create/join. | Natural phone interaction, little persistent chrome, clear next action. | Nested sheets and keyboards can obscure context; weak use of desktop space if merely stretched. |
| **Adaptive studio** | Workspace rail, central conversation, persistent side pane for current focus/results; denser typography and stronger dividers. | Good comparison and complex-work orientation on large displays. | Risks recreating a management dashboard, permanent capability clutter and higher navigation maintenance. |

**Selected synthesis:** canvas hierarchy, native reachability from the tray, supporting panes from the studio only when useful and space permits. No equally prominent home sections for every capability. This preserves clarity for small groups while allowing inspection of complex state.

## Shared information architecture

- **Application Home:** existing Workspaces, create/join, account access and a concise explanation through the product: people converse; Miriam helps maintain shared understanding and ongoing work. No dashboard metrics or large marketing site.
- **Workspace home:** Goal as orientation, compact actual attention, human/AI Conversation and reachable composer. Miriam's work has a small durable presence; details and completed history are available on demand.
- **Inspectable layers:** Context (qualified understanding, questions and governed decisions), work, materials (Sources/Artifacts), connected capabilities and people/access. These support the conversation and retain their existing authorization and provenance controls.
- **States:** distinguish proposal, accepted reference, authorized action, provider receipt and unadopted Contribution in both words and structure. Human account names never determine whether a message is AI. No fake thinking, progress percentages or chain-of-thought.

## Visual and platform language

Warm neutral canvas, charcoal text, restrained deep teal accent; system UI typography for controls and body, editorial heading rhythm on web. Consistent 4/8-based spacing, quiet borders, modest radii, visible focus and sufficient contrast. Color supplements text/state rather than carrying meaning alone. No required animations, glass or gradients.

Web uses a Workspace rail and a readable central canvas; an optional supporting pane uses wide screens, and narrower windows use a focused detail layer. Keyboard navigation, focus restoration, escape/back and persistent drafts are required. iOS uses NavigationStack, safe-area composer, sheets for temporary focused operations and Dynamic Type. Android uses Scaffold, IME/system-back handling and a supporting pane only at expanded widths. Layouts are related, not pixel-identical.

## Research and limits

Primary sources informed the layout principles, not copied branding: [Android canonical layouts](https://developer.android.com/develop/adaptive-apps/guides/canonical-layouts) distinguishes supporting content from the primary surface and adapts panes to width; [Apple sheets](https://developer.apple.com/design/human-interface-guidelines/sheets) informs focused temporary operations; [Slack split view](https://slack.com/help/articles/47144721728275-Use-split-view-in-Slack) demonstrates retaining conversational context while inspecting another object. Apple's Layout page required JavaScript in the research reader, so no unseen details are treated as evidence.

The design remains to be checked at actual desktop/laptop/narrow/tablet/mobile widths and representative native sizes. Real-model behavioral acceptance is separate and currently credential-blocked; structural design decisions can be verified now, while judgments about intervention quality require actual provider evidence. Completion/verification evidence belongs in STATUS and acceptance records, not in this rationale.

## Claude Design handoff

2026-09-12: final visual composition is deliberately deferred under the user's latest brief. [Pre-design functional coverage](PRE_DESIGN_COMPLETENESS.md) and [CODEMAP](CODEMAP.md) identify reusable API clients, command journals, native WorkspaceModels, capability views and speech/capture controllers. Replace their presentation without recreating server product logic. Preserve exact-content previews, explicit consent, current revisions, unresolved conflicts, recovery states and visible Contribution/adoption distinctions. No browser or visual acceptance is implied by the current build/typecheck evidence.
