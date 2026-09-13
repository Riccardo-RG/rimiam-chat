import { z } from "zod";
import type { Tx } from "./db.ts";
import { workspaceLinkCommandSchema } from "../contracts/workspace-links.ts";
import { member, changed } from "./workspace-state.ts";
import { requireThat } from "./errors.ts";

export async function applyWorkspaceLink(
  tx: Tx,
  w: string,
  actor: string,
  c: z.infer<typeof workspaceLinkCommandSchema>,
) {
  requireThat(w !== c.otherWorkspaceId, "WORKSPACE_LINK_INVALID", 400);
  // Both Workspace locks were acquired in stable order by execute. No implicit grant from a link.
  await member(tx, w, actor, true, true);
  await member(tx, c.otherWorkspaceId, actor, true, true);
  const [a, b] = [w, c.otherWorkspaceId].sort();
  const current =
    (
      await tx.query(
        "SELECT current_version FROM workspace_link WHERE first_workspace=$1 AND second_workspace=$2",
        [a, b],
      )
    ).rows[0]?.current_version ?? 0;
  requireThat(current === c.expectedVersion, "STATE_STALE");
  requireThat(current > 0 || c.linked, "WORKSPACE_LINK_INVALID", 400);
  await tx.query(
    "INSERT INTO workspace_link(first_workspace,second_workspace,current_version,active) VALUES($1,$2,$3,$4) ON CONFLICT(first_workspace,second_workspace) DO UPDATE SET current_version=excluded.current_version,active=excluded.active",
    [a, b, current + 1, c.linked],
  );
  await tx.query(
    "INSERT INTO workspace_link_version(first_workspace,second_workspace,version,active,actor_id) VALUES($1,$2,$3,$4,$5)",
    [a, b, current + 1, c.linked, actor],
  );
  // Hints carry no target identity/content. Context revisions and relevant Active Work inputs are unchanged.
  await changed(tx, a, "navigation.updated");
  await changed(tx, b, "navigation.updated");
  return { version: current + 1 };
}
export async function readWorkspaceLinks(tx: Tx, w: string, actor: string) {
  // Caller guards this Workspace. The other endpoint is independently checked on every read.
  return (
    await tx.query(
      `SELECT other.id,other.name,l.current_version AS version,l.active,
    (SELECT json_agg(json_build_object('version',h.version,'active',h.active,'actor_id',h.actor_id,'created_at',h.created_at) ORDER BY h.version)
     FROM workspace_link_version h WHERE h.first_workspace=l.first_workspace AND h.second_workspace=l.second_workspace) AS history
    FROM workspace_link l JOIN workspace other ON other.id=CASE WHEN l.first_workspace=$1 THEN l.second_workspace ELSE l.first_workspace END
    JOIN membership m ON m.workspace_id=other.id AND m.user_id=$2 AND m.active
    WHERE l.first_workspace=$1 OR l.second_workspace=$1 ORDER BY other.name`,
      [w, actor],
    )
  ).rows;
}
