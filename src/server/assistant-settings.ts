import type {
  AssistantSettings,
  SaveAssistantSettings,
} from "../contracts/assistant-settings.ts";
import {
  listAssistantConnections,
  listAssistantConnectionsWithRevisions,
  assistantConnectionRevision,
} from "./assistant-connections.ts";
import { transaction, type Tx } from "./db.ts";
import { requireThat } from "./errors.ts";
import {
  conversationRules,
  defaultConversationInstructions,
  withConversationInstructions,
} from "./miriam-prompt.ts";
import {
  authenticatedSession,
  eligible,
  lockWorkspace,
  member,
  changed,
} from "./workspace-state.ts";

type Scope = { workspaceId: string } | { personalActor: string };
type Setting = {
  id: string | null;
  revision: number;
  connectionId: string;
  connectionRevision: string;
  displayName: string;
  instructions: string;
};
const fields =
  'id, revision, connection_id AS "connectionId", connection_revision AS "connectionRevision", display_name AS "displayName", instructions';
export const conversationScope = (
  workspaceId: string,
  personalOwner?: string | null,
): Scope =>
  personalOwner ? { personalActor: personalOwner } : { workspaceId };

async function current(tx: Tx, scope: Scope): Promise<Setting> {
  const shared = "workspaceId" in scope;
  const field = shared ? "workspace_id" : "personal_actor";
  const key = shared ? scope.workspaceId : scope.personalActor;
  const result = await tx.query<Setting>(
    `SELECT ${fields} FROM assistant_setting_version WHERE ${field}=$1 ORDER BY revision DESC LIMIT 1`,
    [key],
  );
  return (
    result.rows[0] ?? {
      id: null,
      revision: 0,
      connectionId: "default",
      connectionRevision: assistantConnectionRevision("default")!,
      displayName: "Emme",
      instructions: "",
    }
  );
}

export function readConversationSetting(
  tx: Tx,
  workspaceId: string,
  personalOwner?: string | null,
) {
  return current(tx, conversationScope(workspaceId, personalOwner));
}

export function baseGuidance(displayName: string) {
  return displayName === "Emme"
    ? conversationRules
    : conversationRules
        .replace(
          "You are Emme,",
          `Your display name is ${displayName}. You are Emme,`,
        )
        .replace(
          "Use Emme when referring to yourself today.",
          `Use ${displayName} when referring to yourself today.`,
        );
}
export function conversationGuidance(
  setting: Pick<Setting, "displayName" | "instructions">,
) {
  const base = baseGuidance(setting.displayName);
  return withConversationInstructions(base, setting.instructions);
}

async function assertViewer(
  tx: Tx,
  actor: string,
  session: string,
  workspaceId?: string,
) {
  if (workspaceId) await lockWorkspace(tx, workspaceId);
  await eligible(tx, actor, true);
  await authenticatedSession(tx, actor, session);
  if (!workspaceId) return true;
  await member(tx, workspaceId, actor);
  const row = (
    await tx.query(
      "SELECT created_by,personal_owner_id FROM workspace WHERE id=$1",
      [workspaceId],
    )
  ).rows[0];
  requireThat(!row.personal_owner_id, "WORKSPACE_ACCESS_DENIED", 403);
  return row.created_by === actor;
}

async function view(
  tx: Tx,
  actor: string,
  scope: Scope,
  canManage: boolean,
): Promise<AssistantSettings> {
  const setting = await current(tx, scope);
  const connections = listAssistantConnectionsWithRevisions();
  const managedSpaces =
    "personalActor" in scope
      ? (
          await tx.query<AssistantSettings["managedSpaces"][number]>(
            `SELECT w.id AS "workspaceId",w.name AS "workspaceName",coalesce(s.connection_id,'default') AS "connectionId",coalesce(s.display_name,'Emme') AS "displayName"
     FROM workspace w JOIN membership m ON m.workspace_id=w.id AND m.user_id=$1 AND m.active
     LEFT JOIN LATERAL(SELECT connection_id,display_name FROM assistant_setting_version WHERE workspace_id=w.id ORDER BY revision DESC LIMIT 1)s ON true
     WHERE w.created_by=$1 AND w.personal_owner_id IS NULL ORDER BY w.name,w.id`,
            [actor],
          )
        ).rows
      : [];
  const { revision, connectionId, displayName, instructions } = setting;
  return {
    revision,
    connectionId,
    displayName,
    instructions,
    baseInstructions: baseGuidance(displayName),
    defaultInstructions: defaultConversationInstructions,
    effectiveInstructions: conversationGuidance(setting),
    connections: canManage
      ? connections
      : connections.filter((c) => c.id === connectionId),
    managedSpaces,
    canManage,
    needsReconfirmation:
      setting.connectionRevision !== assistantConnectionRevision(connectionId),
  };
}
export function readAssistantSettings(
  actor: string,
  session: string,
  workspaceId?: string,
) {
  return transaction(async (tx) =>
    view(
      tx,
      actor,
      workspaceId ? { workspaceId } : { personalActor: actor },
      await assertViewer(tx, actor, session, workspaceId),
    ),
  );
}

export async function appendAssistantSettings(
  tx: Tx,
  actor: string,
  scope: Scope,
  input: Pick<
    SaveAssistantSettings,
    | "connectionId"
    | "connectionRevision"
    | "instructions"
    | "displayName"
    | "expectedRevision"
  >,
) {
  // The Workspace lock serializes shared writes including creation. Personal settings span chat threads.
  if ("personalActor" in scope)
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "assistant-settings:" + scope.personalActor,
    ]);
  const setting = await current(tx, scope);
  requireThat(
    setting.revision === input.expectedRevision,
    "ASSISTANT_SETTINGS_STALE",
  );
  const connection = listAssistantConnections().find(
    (c) => c.id === input.connectionId,
  );
  requireThat(
    connection && (connection.configured || connection.id === "default"),
    "ASSISTANT_CONNECTION_UNAVAILABLE",
  );
  requireThat(
    assistantConnectionRevision(connection.id) === input.connectionRevision,
    "ASSISTANT_CONNECTION_CHANGED",
  );
  if (
    setting.id &&
    setting.connectionId === input.connectionId &&
    setting.connectionRevision === input.connectionRevision &&
    setting.displayName === input.displayName &&
    setting.instructions === input.instructions
  )
    return;
  await tx.query(
    "INSERT INTO assistant_setting_version(personal_actor,workspace_id,revision,actor_id,connection_id,connection_revision,display_name,instructions) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      "personalActor" in scope ? scope.personalActor : null,
      "workspaceId" in scope ? scope.workspaceId : null,
      setting.revision + 1,
      actor,
      input.connectionId,
      input.connectionRevision,
      input.displayName,
      input.instructions,
    ],
  );
  if ("workspaceId" in scope)
    await changed(tx, scope.workspaceId, "assistant.settings");
}
export function saveAssistantSettings(
  actor: string,
  session: string,
  input: SaveAssistantSettings,
) {
  requireThat(input.expectedActorId === actor, "AUTH_CONTEXT_CHANGED", 409);
  return transaction(async (tx) => {
    const scope: Scope = input.workspaceId
      ? { workspaceId: input.workspaceId }
      : { personalActor: actor };
    requireThat(
      await assertViewer(tx, actor, session, input.workspaceId),
      "ASSISTANT_CREATOR_REQUIRED",
      403,
    );
    await appendAssistantSettings(tx, actor, scope, input);
    return view(tx, actor, scope, true);
  });
}

export async function bindAssistantTurn(
  tx: Tx,
  scope: Scope,
  interpretation: string,
  epoch: number,
) {
  const setting = await current(tx, scope);
  await tx.query(
    "INSERT INTO assistant_turn_binding(interpretation_id,routing_epoch,settings_id,connection_id,connection_revision) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
    [
      interpretation,
      epoch,
      setting.id,
      setting.connectionId,
      setting.connectionRevision,
    ],
  );
  const binding = (
    await tx.query<{
      settings_id: string | null;
      connection_revision: string;
      display_name: string;
    }>(
      `SELECT b.settings_id,b.connection_revision,coalesce(s.display_name,'Emme') AS display_name
       FROM assistant_turn_binding b LEFT JOIN assistant_setting_version s ON s.id=b.settings_id
       WHERE b.interpretation_id=$1 AND b.routing_epoch=$2`,
      [interpretation, epoch],
    )
  ).rows[0];
  return { scope, setting, binding };
}
export async function turnSettingsCurrent(
  tx: Tx,
  turn: Awaited<ReturnType<typeof bindAssistantTurn>>,
) {
  if ("personalActor" in turn.scope)
    await tx.query(
      "SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
      ["assistant-settings:" + turn.scope.personalActor],
    );
  const setting = await current(tx, turn.scope);
  return (
    setting.id === turn.setting.id &&
    setting.id === turn.binding.settings_id &&
    setting.connectionRevision === turn.binding.connection_revision &&
    setting.connectionRevision ===
      assistantConnectionRevision(setting.connectionId)
  );
}
