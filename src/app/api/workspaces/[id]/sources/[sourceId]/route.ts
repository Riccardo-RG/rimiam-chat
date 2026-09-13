import { actorFrom, endpoint } from "@/server/http";
import { readDocument } from "@/server/sources";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; sourceId: string }> },
) {
  let download: Response | undefined;
  const failure = await endpoint(async () => {
    const actor = await actorFrom(request),
      { id, sourceId } = await params;
    const file = await readDocument(actor, id, sourceId);
    download = new Response(new Uint8Array(file.original_bytes), {
      headers: {
        "Content-Type": file.media_type,
        "Content-Disposition": `attachment; filename="document.txt"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      },
    });
    return {};
  });
  return download ?? failure;
}
