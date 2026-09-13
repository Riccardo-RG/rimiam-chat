import { actorFrom, endpoint } from "@/server/http";
import { snapshot } from "@/server/queries";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return endpoint(async () =>
    snapshot(await actorFrom(request), (await params).id),
  );
}
