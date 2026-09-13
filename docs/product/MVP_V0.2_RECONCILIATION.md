# MVP v0.2 draft — implementation reconciliation

2026-09-09. Implementation note, not an ADR or replacement of approved semantics.

**Reading note · 2026-09-13:** this is the historical reconciliation of the original draft and early increments, not a current feature inventory. Later approved ADRs through ADR-0015 and [MVP v0.1](MVP_SPEC_v0.1.md) govern current scope; [STATUS](../development/STATUS.md) records foundation closure. Voice/dialogue/human audio calls now follow [ADR-0015](../decisions/ADR-0015-voce-chiamate-consenso-registrazione.md). Earlier limited file/Artifact descriptions below describe the 2026-09-09 checkpoint and do not exclude later completed capability.

The user’s BUILD brief (`3f826fd8-ebe5-4cbe-831f-186407e37599/pasted-text.txt`, Codex thread `01a082d6-6a10-7d30-8e76-71c7928fcb96`) authorizes progressive development using the [attached v0.2 draft](MVP_SPEC_v0.2_DRAFT.md) as intended evolution. The file is retained verbatim. [MVP v0.1](MVP_SPEC_v0.1.md) remains canonical; ADR-0001–0009 take precedence. Neither a new canonical spec version nor a new architecture approval is implied.

The continuation brief (`4cb1a362-c006-4462-b506-0c94d411b266/pasted-text.txt`, same thread, 2026-09-09) explicitly includes account registration, login/logout, persistent sessions, protected routes, onboarding, new/existing-user invitations and essential recovery in BUILD. External delivery/credentials remain WIRE. This is operational scope clarification, not a new identity/access/authority decision.

## Reconciliation

| Area                                          | Interpretation for development                                                                                                                                                                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goal, adherence, authority and access         | Preserve the approved ADRs; the draft refers to them rather than replacing their semantics. Do not infer membership authority or carry mandates/adherence across Goal changes.                                                                             |
| Sources and information                       | Source material, AI proposals, editorial acceptance and normative acts remain distinct. Files/web do not create truth or authorize action. Imported obligations are reported evidence of possible pre-existing obligations, not newly adopted commitments. |
| Context                                       | Incremental application-owned retrieval with provenance and selective expansion. Numerical operational limits are not correctness boundaries.                                                                                                              |
| Specialists/tools/Active Work                 | Already part of v0.1 §§11–13. Draft §§13–17 makes their vertical capability requirements explicit. Research is a bounded specialist/tool capability; provider identity is integration metadata, not a domain authority.                                    |
| Files/web/calendar                            | Already in canonical MVP scope. This run starts files and web; calendar remains required work, not post-MVP. Uploaded source versions are not a substitute for editable governed Artifacts.                                                                |
| Workspace email                               | The draft explicitly adds search/read/draft/send. This is intended MVP work. Account verification delivery is a separate security service and does not implement Workspace email.                                                                          |
| Tasks/Artifacts/Goal evolution                | Remain required beyond initial creation and the current small slice. Recording an Open Question or a draft never binds someone to carry out work.                                                                                                          |
| Canonical requirements less explicit in draft | Keep image/voice inputs, presence/catch-up, Workstreams/Sub-goals and context-aware follow-up in the backlog; omission from a draft summary does not remove v0.1 requirements.                                                                             |
| Architecture v0.2                             | Remains a proposal. No generic `context_item`, automatic Fact promotion, fixed history/token cutoffs or creator authority is adopted. Explicit SQL/pg and existing small-monolith boundaries continue.                                                     |

No direct semantic conflict requiring an ADR change was found in the capabilities implemented during this run. Artifact adoption and external-write Commit Points must follow the existing authority rules in subsequent increments; connecting an account does not by itself supply authority to bind people or publish Workspace content.

## Capability boundaries at the 2026-09-09 checkpoint

- Documents are bounded UTF-8 TXT/MD/CSV sources, with immutable original bytes and versions. No arbitrary URL/file execution or rich-format parser is implied.
- Research requires an explicit exact query and disclosure acknowledgement. Results are evidence, never automatically accepted information. Only that query is sent; result pages are not fetched.
- Questions are explicit editorial records of uncertainty. An answer links a specific existing Accepted Information version, with attribution and history. It does not resolve a normative decision or alter a commitment.
- Artifacts currently support a non-operative research brief compiled from explicitly selected question/information/source versions plus human notes. Adoption uses exact-version named self-approvals, separately from editorial acceptance. Existing adopted versions survive subsequent drafts. This is neither AI synthesis nor the entire Artifact lifecycle.
- Account recovery changes authentication credentials and revokes sessions; it does not verify an email, restore ended membership/governance or establish Goal adherence. Invitations preserve their destination across account creation and verification, but still require explicit admission.
- Real provider adapters remain inactive until WIRE. Deterministic doubles exist only in tests. Unconfigured AI does not produce pretend interpretations.

Coverage, limitations, verification and the exact next increment belong in the [development checkpoint](../development/STATUS.md), not in duplicated ADR text.

**2026-09-10 continuation:** native/common-backend direction follows ADR-0010; the Calendar brief `25f3d646-de1d-4073-9855-e9e9ee8095b9/pasted-text.txt` authorizes Calendar BUILD under [ADR-0011](../decisions/ADR-0011-calendar-stato-temporale-osservazioni-azioni.md). The earlier “calendar remains required work” wording describes the prior checkpoint. Current supported scope and limitations are in [Calendar BUILD](../development/CALENDAR.md); This was the Calendar checkpoint; the following Email update records subsequent scope.


**2026-09-10 Email continuation:** brief `937d13d3-a684-4e7f-88c2-5cba858f859a/pasted-text.txt` authorizes Workspace Email BUILD under [ADR-0012](../decisions/ADR-0012-workspace-email-privacy-bozze-invio.md). Private observations, explicit Workspace disclosure, internal drafts and exact self-authorized send actions remain separate. Current implementation/limits: [Email BUILD](../development/EMAIL.md). No WIRE/service activation.
