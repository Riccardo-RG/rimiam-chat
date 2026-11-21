# Contributing to RIMIAM

The hosted beta uses the responsive Web client. A single [React Native app](mobile/App.tsx) serves iOS and Android. Both clients use the common server contracts. Discuss changes that alter product semantics, authorization or persistent data before implementing them.

## Start with the relevant evidence

Read [AGENTS.md](AGENTS.md), [STATUS](docs/development/STATUS.md) and the relevant entries in [CODEMAP](docs/development/CODEMAP.md). Use the [canonical MVP](docs/product/MVP_SPEC_v0.1.md) and its linked approved ADRs for product/domain changes. Search for callers and existing tests rather than reconstructing the whole repository for every patch.

Set up the project using [README](README.md#run-locally). Use fictional local/test data, never another person's private Workspace or production credentials. Keep `.env`, dumps, browser traces and personal files out of commits. Do not rewrite applied migrations; add a new migration when persistent schema changes are necessary.

## Keep a change reviewable

- Implement the smallest complete behavior within the agreed scope, including loading, unavailable/error and recovery states.
- Reuse validated commands, current access checks, provenance and version fences. A client convenience must not manufacture consent or authority.
- Treat model/tool output as untrusted. Production paths must not quietly substitute test doubles or invented results.
- Keep user-facing copy in the intended product language. Model-facing prompts and agent operating instructions are English.
- When a user journey changes, update its entry in the [Web workflow guide](docs/development/WEB_WORKFLOWS.md), the affected in-app instructions and the corresponding acceptance scenario. Link existing decisions. Record actual verification and limits in the checkpoint.

## Verification cadence

For a mobile change, follow the [React Native setup and simulator checks](docs/development/MULTICLIENT.md) and run `npm --prefix mobile run check`. Native platform projects are generated from [the Expo configuration](mobile/app.config.ts).

Use the smallest relevant test while coding, then targeted regression for the coherent increment. Run broad checks at meaningful milestones and before release. Increase verification for authority, access isolation, sessions, provenance, canonical state, migrations, idempotency, external effects and recovery.

```sh
npm run test:setup
npm test -- tests/api-contract.test.ts
npm run typecheck
npm run lint
npm run format:check
```

Choose a test file that actually covers the behavior being changed; the API-contract example is not a substitute for capability tests. Browser checks can be bounded with `npm run test:e2e -- tests/e2e/slice01.spec.ts`. The harness uses isolated local databases and test-only provider doubles. Do not run concurrent suites against a shared test database when their setup/cleanup can interfere.

Before a release candidate, run the repository's broader checks/builds and verify the affected live boundaries separately. Report failures and blocked checks honestly; passing type checks or mocked provider tests does not demonstrate a working deployed integration.

The [Web quality workflow](.github/workflows/web-ci.yml) runs the repository checks with isolated PostgreSQL, bounded Chromium coverage and the deployable Docker image. It uses no production secrets and does not deploy. Check the actual run before claiming CI passed.

## Pull request contents

Explain the concrete problem and resulting behavior, then list relevant verification and material limits. Identify migrations, external configuration or rollout steps. Distinguish a local branch, a Draft PR, merge readiness and a deployed/accepted result.

Do not combine unrelated native changes, generated evidence, personal data or credentials with a Web patch. Publication, paid provider activation, remote migrations and external sends require their own authorization; a local coding task does not authorize them.

For a security concern, follow [SECURITY.md](SECURITY.md) instead of opening an issue containing exploit details or private data.
