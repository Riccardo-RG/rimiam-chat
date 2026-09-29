import { createHash } from "node:crypto";
import {
  betaRulesViewSchema,
  type AcceptBetaRules,
} from "../contracts/beta-rules.ts";
import { betaRules } from "../shared/beta-rules.ts";
import { transaction, type Tx } from "./db.ts";
import { requireThat } from "./errors.ts";
import { authenticatedSession, eligible } from "./workspace-state.ts";

const contentDigest = createHash("sha256").update(betaRules.text).digest("hex");

async function view(tx: Tx, actor: string) {
  const result = await tx.query<{ accepted_at: Date }>(
    "SELECT accepted_at FROM beta_rules_acceptance WHERE user_id=$1 AND version=$2 AND content_digest=$3",
    [actor, betaRules.version, contentDigest],
  );
  return betaRulesViewSchema.parse({
    actorId: actor,
    ...betaRules,
    contentDigest,
    acceptedAt: result.rows[0]?.accepted_at.toISOString() ?? null,
  });
}

export async function betaRulesView(actor: string, sessionId: string) {
  return transaction(async (tx) => {
    await authenticatedSession(tx, actor, sessionId);
    await eligible(tx, actor, true);
    return view(tx, actor);
  });
}

// Account acknowledgement only: no privacy consent, Workspace state or authority.
export async function acceptBetaRules(
  actor: string,
  sessionId: string,
  input: AcceptBetaRules,
) {
  requireThat(input.expectedActorId === actor, "AUTH_CONTEXT_CHANGED", 409);
  requireThat(
    input.version === betaRules.version &&
      input.contentDigest === contentDigest,
    "BETA_RULES_VERSION_STALE",
    409,
  );
  return transaction(async (tx) => {
    await authenticatedSession(tx, actor, sessionId);
    await eligible(tx, actor, true);
    await tx.query(
      "INSERT INTO beta_rules_acceptance(user_id,version,content_digest,content) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,version) DO NOTHING",
      [actor, betaRules.version, contentDigest, betaRules.text],
    );
    const result = await view(tx, actor);
    // Never reinterpret a recorded acceptance if a deployment reuses a version.
    requireThat(result.acceptedAt, "BETA_RULES_VERSION_STALE", 409);
    return result;
  });
}
