# Active Work — manual acceptance record

**2026-09-10 · Preparation only; manual multi-user acceptance NOT complete.** The user accepted the bounded BUILD and authorized this local acceptance checkpoint, without BUILD, WIRE, provider activation, deployment or semantic changes. [Behavior](ACTIVE_WORK.md), [approved ADR-0014 v2](../decisions/ADR-0014-active-work-specialist-contribution.md), [checkpoint](STATUS.md).

## Observed preparation evidence

- Existing development database `miriam`, web `127.0.0.1:3000`, compiled common API `127.0.0.1:3002` and ordinary worker were already available. Web returned HTTP 200; unauthenticated native-session lookup returned 401. No service restart, migration, account reset or fixture injection was performed.
- Read-only membership checks found two distinct, verified, eligible, active contributors in **Start up**, Workspace `85ada27e-7bcd-4cab-a741-74073cfa81d1`. The existing Goal is “TESTARE L'APP”. Neither Goal adherence nor a new mandate is needed for the approved shared operational controls.
- Codex browser displayed that Workspace authenticated as the human account named **Miriam**. Chrome was opened to the same Workspace URL in a separate browser session and displayed **Accedi**. Riccardo must sign in there with his existing account; the second authenticated session has not yet been observed. Credentials and verification behavior remain unchanged.
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
- **PRE-02 — UX/interaction weakness candidate, observed setup:** in Start up, the logged-in human name and one message author are **Miriam**, alongside the branding **miriam** and section **Il lavoro di Miriam**. This may confuse human attribution with AI activity. Reproduce by opening this Workspace in the existing second-member session. Name collision is observed; user confusion and its severity are not yet confirmed. No misattribution or invariant violation has been demonstrated, and no account was renamed.

No Active Work product/semantic defect or implementation defect has been established by this preparation. No human acceptance step, natural-language attempt, shared control, conflict, reload or native scenario is marked passed.

For each executed step append only actual evidence: actor/client, exact text/action, work ID and contract/revision, observed state/message before and after, expected behavior and evidence source (direct observation or user report). Classify findings as product/semantic defect, implementation defect, UX/interaction weakness, expected bounded-BUILD limitation, or future behavioral-evaluation candidate; retain uncertainty. Stop on a suspected approved-invariant violation before proposing a fix. Reported qualitative cases may inform the [non-normative evaluation direction](../product/MVP_SPEC_v0.1.md#191-direzione-futura-valutazioni-comportamentali), not automatic changes.
