import { actorFrom, assertOrigin, body, endpoint } from "@/server/http";
import { createWorkspace } from "@/server/commands";
import { listWorkspaces } from "@/server/queries";
export async function GET(request: Request) {
  return endpoint(async () => listWorkspaces(await actorFrom(request)));
}
export async function POST(request: Request) {
  return endpoint(async () => {
    assertOrigin(request);
    const actor = await actorFrom(request);
    const input = await body(request);
    return createWorkspace(
      actor,
      input.name,
      input.commandId,
      input.description,
    );
  });
}
