import { sessionFrom, assertOrigin, body, endpoint } from "@/server/http";
import { execute } from "@/server/commands";
import { uploadDocumentSchema } from "@/server/sources";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    assertOrigin(request);
    const session = await sessionFrom(request);
    const input = await body(request, 1500000);
    return execute(
      session.user.id,
      (await params).id,
      input.commandId,
      uploadDocumentSchema.parse(input.command),
      session.session.id,
    );
  });
}
