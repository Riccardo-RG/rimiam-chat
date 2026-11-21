import { actorFrom, endpoint } from "@/server/http";
import { readDocument } from "@/server/sources";
import { requireThat } from "@/server/errors";
import { isSharedPhoto } from "@/shared/photo-media-type";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; sourceId: string }> },
) {
  let download: Response | undefined;
  const failure = await endpoint(async () => {
    const actor = await actorFrom(request),
      { id, sourceId } = await params;
    const file = await readDocument(actor, id, sourceId);
    const preview = new URL(request.url).searchParams.get("preview") === "1";
    requireThat(
      !preview || isSharedPhoto(file.media_type),
      "PREVIEW_UNAVAILABLE",
      415,
    );
    download = new Response(new Uint8Array(file.original_bytes), {
      headers: {
        "Content-Type": file.media_type,
        "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="document"; filename*=UTF-8''${encodeURIComponent(file.filename).replace(/['()*]/g, (char) => "%" + char.charCodeAt(0).toString(16))}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      },
    });
    return {};
  });
  return download ?? failure;
}
