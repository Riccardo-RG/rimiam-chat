import {
  actorFrom,
  sessionFrom,
  assertOrigin,
  body,
  endpoint,
} from "@/server/http";
import { createWorkspace } from "@/server/commands";
import { createWorkspaceSchema } from "@/contracts/v1";
import { requireThat } from "@/server/errors";
import { listWorkspaces } from "@/server/queries";
export async function GET(request: Request) {
  return endpoint(async () => listWorkspaces(await actorFrom(request)));
}
export async function POST(request: Request) {
  return endpoint(async () => {
    assertOrigin(request);
    const session = await sessionFrom(request);
    const input = createWorkspaceSchema.parse(
      await body(request, 12 * 1024 * 1024),
    );
    requireThat(
      !input.expectedActorId || input.expectedActorId === session.user.id,
      "AUTH_CONTEXT_CHANGED",
      409,
    );
    return createWorkspace(
      session.user.id,
      input.name,
      input.commandId,
      input.description,
      session.session.id,
      input.invitations,
      input.attachments,
      input.assistantConnectionId,
      input.assistantConnectionRevision,
    );
  });
}
