import { flushCallExit } from "@/server/calls";
import { sessionFrom, assertOrigin, body, endpoint } from "@/server/http";
import { execute } from "@/server/commands";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    assertOrigin(request);
    const session = await sessionFrom(request);
    const actor = session.user.id;
    const input = await body(request, 12 * 1024 * 1024);
    const w = (await params).id;
    const result = await execute(
      actor,
      w,
      input.commandId,
      input.command,
      session.session.id,
    );
    await flushCallExit(actor, w, input.command);
    return result;
  });
}
