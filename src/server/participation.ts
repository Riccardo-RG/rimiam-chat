import type { Tx } from "./db.ts";
import {
  isAssistantAddress,
  potentiallyHumanAddress,
} from "../shared/miriam-address.ts";
type CollaborationMode = "discreet" | "collaborative" | "proactive";

export type TurnOccasion = "group_request" | "material_risk" | "other";

export function permitsGroupIntervention(
  preference: CollaborationMode,
  content: string,
  occasion?: TurnOccasion,
  citesSource = false,
) {
  if (preference === "discreet") return false;
  const words = content
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\p{Cf}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (
    !words ||
    /^(?:ciao|salve|buongiorno|buonasera|buonanotte|ehi|hey|hi|hello|grazie|thanks)(?: (?:a tutti|a tutte|ragazzi|ragazze|everyone|all))?$/u.test(
      words,
    )
  )
    return false;
  // Older external agents may omit the classification. A question remains usable.
  if (!occasion) return /[?？؟]/u.test(content);
  return (
    occasion === "group_request" ||
    (preference === "proactive" && occasion === "material_risk" && citesSource)
  );
}

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

/** Resolve explicit vocatives against actual members, including membership at send time. */
export async function addressTargetsMember(
  tx: Tx,
  workspace: string,
  speaker: string,
  content: string,
  sourceId?: string,
  displayName = "Emme",
) {
  const assistant = isAssistantAddress(content, displayName);
  const vocative = content
    .trim()
    .match(
      /^(?:(?:ciao|ehi|hey|hi|hello)[\s,]+)?(?:@([\p{L}\p{M}\p{N}_’'.-]+)|([\p{L}\p{M}’'.-]+(?: [\p{L}\p{M}’'.-]+){0,3})\s*[,：:])/iu,
    );
  const alias = assistant
    ? potentiallyHumanAddress(content, displayName)
    : (vocative?.[1] ?? vocative?.[2])?.toLowerCase();
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
