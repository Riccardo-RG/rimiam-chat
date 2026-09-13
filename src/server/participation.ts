import type { Tx } from "./db.ts";
export async function collaborationMode(
  tx: Tx,
  w: string,
): Promise<"discreet" | "collaborative" | "proactive"> {
  return (
    (
      await tx.query(
        "SELECT mode FROM collaboration_preference WHERE workspace_id=$1 ORDER BY version DESC LIMIT 1",
        [w],
      )
    ).rows[0]?.mode ?? "discreet"
  );
}
