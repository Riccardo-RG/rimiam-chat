import { actorFrom, endpoint } from "@/server/http";
import { currentRevision } from "@/server/queries";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let actor: string;
  try {
    actor = await actorFrom(request);
    await currentRevision(actor, id);
  } catch {
    return endpoint(async () => {
      await actorFrom(request);
      return currentRevision(await actorFrom(request), id);
    });
  }
  const encoder = new TextEncoder();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      let cursor = -1;
      const close = () => {
        if (stopped) return;
        stopped = true;
        if (timer) clearTimeout(timer);
        try {
          controller.close();
        } catch {}
      };
      request.signal.addEventListener("abort", close, { once: true });
      const tick = async () => {
        if (stopped) return;
        try {
          // Session and membership are checked on every delivery batch, not just connection creation.
          const currentActor = await actorFrom(request);
          if (currentActor !== actor) {
            close();
            return;
          }
          const revision = await currentRevision(actor, id);
          if (stopped) return;
          if (revision !== cursor) {
            controller.enqueue(
              encoder.encode(
                `id: ${revision}\ndata: ${JSON.stringify({ revision })}\n\n`,
              ),
            );
            cursor = revision;
          } else controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          close();
          return;
        }
        timer = setTimeout(tick, 1000);
      };
      void tick();
    },
    cancel() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
