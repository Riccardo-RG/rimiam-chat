# Security policy

RIMIAM is an experimental application undergoing release preparation. No stable supported-release or response-time commitment is currently declared. Use the current approved release checkpoint to determine what has actually been verified; historical provisioning notes do not establish current security or availability.

## Report privately

Do not post credentials, real Workspace material or actionable exploit details in public issues, pull requests or discussions. Contact the repository owner through a private channel already established with them. If GitHub private vulnerability reporting is enabled for the repository, its **Security → Report a vulnerability** flow is appropriate; this document does not claim that setting is enabled.

If no private route is available, ask the owner for one without describing the vulnerability publicly. There is no dedicated security email or bug-bounty program declared here.

Provide the affected commit/version, minimal reproduction using fictional data, expected versus observed behavior, and the impact you can substantiate. Redact secrets and personal data. Do not access another user's Workspace, test against a hosted environment without permission or generate paid provider traffic to demonstrate an issue.

## Security boundaries to preserve

- Server-side session, eligibility and Workspace checks; technical access does not grant project authority.
- Explicit, attributed, version-bound acts for governed changes. AI confidence and Conversation content do not establish consent.
- Immutable source/history references, scoped current state, and recovery that cannot override a later human restriction.
- Private integration observations remain private until explicitly disclosed; model and external-service access must respect the applicable boundary.
- Ambiguous external outcomes must remain distinguishable from failure or success; retrying must not duplicate consequential effects.

See [AGENTS](AGENTS.md), [the ADR index](docs/development/CODEMAP.md#topic--approved-adr--canonical-reference) and [deployment guidance](docs/development/DEPLOY_EXTERNAL_SERVICES.md) for the detailed constraints.

## Before operating or publishing

1. Review dependency advisories and validate relevant fixes. A clean advisory report does not prove absence of vulnerabilities.
2. Keep production secrets in the deployment secret store. Use unique credentials and HTTPS, disable the development mail viewer, and verify database/storage access and backup restoration.
3. Inspect the exact staged files and the branch/tag history intended for publication. `.gitignore` does not remove previously committed data. Audit remote settings and reporting channels separately.
4. Publish only reviewed branches/tags. Do not mirror every local Git ref or copy the whole working directory: local tool snapshots, private documents, dumps and untracked files may exist outside normal commit history.
5. If a credential was exposed, revoke/rotate it and assess where it was used; removing a file alone is insufficient. Coordinate any history rewrite with the owner before changing shared history.
6. Recheck retained test artifacts, screenshots, logs and metadata for private material. Automated pattern scans are a screening aid, not a complete privacy or credential audit.

Real-user deployment also needs the operator's explicit privacy, retention, deletion and incident-handling arrangements. The beta-use notice is not a substitute for those operational decisions.
