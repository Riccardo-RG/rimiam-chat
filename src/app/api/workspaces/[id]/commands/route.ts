import { flushCallExit } from "@/server/calls";
import { actorFrom, assertOrigin, body, endpoint } from "@/server/http";
import { execute } from "@/server/commands";
import { auth } from "@/server/auth";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    assertOrigin(request);
    const actor = await actorFrom(request);
    const input = await body(request, 12 * 1024 * 1024);
    const session = await auth.api.getSession({ headers: request.headers });
    const w = (await params).id;
    const result = await execute(
      actor,
      w,
      input.commandId,
      input.command,
      session?.session.id,
    );
    await flushCallExit(actor, w, input.command);
    return result;
  });
}
