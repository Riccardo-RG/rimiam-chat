# Web verification and runtime packaging

[Web CI](../../.github/workflows/web-ci.yml) runs on pull requests, pushes to `main` and manual dispatch. It does not deploy, activate providers, publish images or change repository visibility. Execution on GitHub remains unverified until the workflow is committed and an authorized run completes.

The job uses Node 24, Python 3.11 and ephemeral PostgreSQL 18.3. It rejects known high/critical npm advisories, generates a local authentication secret, applies the existing migrations to `miriam_test`, runs type/lint/format and deterministic regressions, then checks two-person collaboration and lost-command recovery in Chromium against separate `miriam_e2e`. Provider doubles are confined to the existing test harness; no production credentials are configured. Native clients are outside this workflow.

For chat editor changes, run the [phone Web regression](../../tests/e2e/chat-mobile-send.spec.ts). It checks a newline, temporary loss of focus while the keyboard pans, opening Voice and sending to a second member exactly once without refreshing. On Safari with the software keyboard open, also tap Attach, cancel the native picker, and open and close Actions, Voice and Call with a draft in place. Check the [camera](../../tests/e2e/chat-camera.spec.ts) and [Ask Emme](../../tests/e2e/chat-mobile-ask.spec.ts) paths separately. Close a physical-device report only after checking the released Web version on the affected phone.

The final Docker build compiles both production entry points. The runtime check runs the compiled extraction boundary with the real PDF/DOCX fixtures, installed parsers and FFmpeg, as a non-root user with no network and a read-only filesystem. It verifies extraction and source qualification without a database or external services:

```sh
docker build -t rimiam-local-check .
sh scripts/check-runtime-image.sh rimiam-local-check
```

The Docker build context is allowlisted in [.dockerignore](../../.dockerignore); [Dockerfile](../../Dockerfile) copies explicit production paths. Root personal files, `.git`, local configuration, docs, tests and native projects are not build inputs. The extractor is included explicitly in the runtime. The check above mounts only the repository's synthetic test fixtures read-only; it does not mount the repository or pass `.env`.

Workflow permissions are read-only, checkout credentials are not persisted, and untrusted pull requests do not use `pull_request_target` or secrets. GitHub-maintained action major versions are explicit. Immutable SHA pinning requires a separately authorized public-reference lookup; the attempted read-only lookup was blocked by automatic approval review under the user's GitHub-operation restriction. No remote lookup workaround or GitHub mutation was performed.

Local packaging verification on **2026-11-17** reproduced the missing extractor in the earlier image, then built `rimiam-web-release-check:20261117` successfully and passed the isolated runtime check above. The first allowlisted build context was 1.07 MB; production backend/Next builds passed with two pre-existing dynamic-filesystem tracing warnings. Shell syntax, workflow YAML structure and formatting checks passed. The final image was subsequently rebuilt with Web Push and its last session-retirement correction; compiled-runtime PDF/DOCX/provenance/FFmpeg smoke checks passed again. Final local regression evidence is in [WEB_RELEASE](WEB_RELEASE.md). No GitHub-hosted run or deploy is claimed.

This is reproducible local/CI evidence, not a claim of provider quality, mobile-device behavior, production readiness or a successful Render deploy. Keep live acceptance in [STATUS](STATUS.md).
