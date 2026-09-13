import { actorFrom, assertOrigin, body, endpoint } from "@/server/http";
import { invitationDetails } from "@/server/queries";
import { acceptInvitation } from "@/server/commands";
import { z } from "zod";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  return endpoint(async () =>
    invitationDetails(await actorFrom(request), (await params).token),
  );
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  return endpoint(async () => {
    assertOrigin(request);
    const input = z
      .object({ fullHistoryAccepted: z.literal(true) })
      .parse(await body(request));
    return acceptInvitation(
      await actorFrom(request),
      (await params).token,
      input.fullHistoryAccepted,
    );
  });
}
