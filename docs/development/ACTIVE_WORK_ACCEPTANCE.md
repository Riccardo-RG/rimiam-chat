# Active Work — manual acceptance record

**2026-09-10 · Preparation only; manual multi-user acceptance NOT complete.** The user accepted the bounded BUILD and authorized this local acceptance checkpoint, without BUILD, WIRE, provider activation, deployment or semantic changes. [Behavior](ACTIVE_WORK.md), [approved ADR-0014 v2](../decisions/ADR-0014-active-work-specialist-contribution.md), [checkpoint](STATUS.md).

## Observed preparation evidence

- The local Web client returned HTTP 200, and the common API returned 401 for an anonymous native-session request. The existing database and worker were available throughout the check.
- Read-only membership checks confirmed that two distinct verified accounts could contribute to the same workspace. The existing access relationships covered the shared operational controls tested in this scenario.
- One browser session showed the workspace for a signed-in participant. A separate browser session reached the sign-in screen. Verifying a second signed-in participant remained pending.
- UI showed **Nessun lavoro avviato.** A read-only database query found no existing Active Work. No work or test message was created during preparation.
- Local configuration has no analysis key or selected model; the configured Specialist is unavailable. The UI displayed **Il modello AI non è ancora collegato.** The worker's `AI_CONFIGURATION_REQUIRED` / Needs Input path was inspected in code, but has NOT yet been exercised manually.

## Coverage boundaries for this session

| Evidence class | Scope |
| --- | --- |
| Available to exercise now; all scenarios pending | Explicit start; current contract/source attribution/history; two-member control; compatible format/assumption updates; conflicting direction and withdrawal/clarification; restrictions and pause/resume/stop; attributed additional input; reload continuity. Inspect the actual reason for Needs Input, not just the phase label. |
| Existing deterministic/test-double evidence only | Produced Contributions/citations remaining unadopted, completed-result outdated handling, selected-context expansion and relevant-version reassessment, autonomous initiation/overlap, late results/recovery/concurrency and native cross-client checks. See prior evidence in STATUS; no automated suite was rerun for this checkpoint. |
| Requires later real-model validation | Actual brief usefulness, contextual judgment, question/intervention quality and timing, appropriate autonomous initiative/non-intervention, live context sufficiency/citations and real output after changes. No provider is authorized here. |

Without a provider the worker stops before collecting an analysis input manifest. Recording new input or seeing an outdated label after a contract edit cannot establish correct retrieval or obsolescence of a completed result. No completed Contribution exists to inspect in this database; do not fabricate one or import a test result as manual production evidence. Two browser sessions exercise the web/shared boundary, not native UX parity; one focused native control/relaunch observation can follow, without repeating the entire script on every client.

## Acceptance findings

- **PRE-01 — expected bounded-BUILD limitation, confirmed configuration:** analysis is unconfigured; semantic/control UX is testable but useful AI collaboration is not yet assessable. Needs Input behavior remains a pending manual observation, not a passing result.
- **Potential attribution ambiguity.** A participant and the assistant shared a display name in this test. A message in the timeline and the assistant activity heading used that same name. A future usability check can reproduce the collision with synthetic accounts and ask a reader to identify who wrote the message. The effect on readers and its severity remain unverified.

No Active Work product/semantic defect or implementation defect has been established by this preparation. No human acceptance step, natural-language attempt, shared control, conflict, reload or native scenario is marked passed.

For each executed step, record the client, the test action, the expected behavior, the observed result and its evidence source. Use synthetic actors and examples in the public record. Keep account identifiers, workspace content, operational IDs and raw session evidence in the private test log. Classify the finding and preserve uncertainty. Pause if a result appears to violate a product invariant. Qualitative cases can inform future behavioral evaluation. [Evaluation direction](../product/MVP_SPEC_v0.1.md#191-direzione-futura-valutazioni-comportamentali)
