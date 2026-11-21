import type { Tx } from "./db.ts";
import { potentiallyHumanAddress } from "../shared/miriam-address.ts";
type CollaborationMode = "discreet" | "collaborative" | "proactive";

export async function collaborationMode(
  tx: Tx,
  w: string,
): Promise<CollaborationMode> {
  return (
    (
      await tx.query<{ mode: CollaborationMode }>(
        "SELECT mode FROM collaboration_preference WHERE workspace_id=$1 ORDER BY version DESC LIMIT 1",
        [w],
      )
    ).rows[0]?.mode ?? "discreet"
  );
}

/** Resolve an assistant alias against humans locally. A queued message keeps its
 * human addressee even if that participant leaves before the worker runs. */
export async function legacyAddressTargetsMember(
  tx: Tx,
  workspace: string,
  speaker: string,
  content: string,
  sourceId?: string,
  displayName = "Emme",
) {
  const alias = potentiallyHumanAddress(content, displayName);
  if (!alias) return false;
  const match = await tx.query(
    `SELECT 1 FROM membership m JOIN "user" u ON u.id=m.user_id
     WHERE m.workspace_id=$1 AND m.user_id<>$2
       AND (lower(trim(u.name))=$3 OR lower(substring(trim(u.name) from '^([^[:space:]]+)'))=$3)
       AND (m.active OR ($4::uuid IS NOT NULL AND
         (SELECT h.active FROM membership_history h
          WHERE h.workspace_id=m.workspace_id AND h.user_id=m.user_id
            AND h.created_at <= (SELECT s.created_at FROM workspace_source s WHERE s.workspace_id=$1 AND s.id=$4)
          ORDER BY h.version DESC LIMIT 1)))
     LIMIT 1`,
    [workspace, speaker, alias, sourceId ?? null],
  );
  return Boolean(match.rowCount);
}
