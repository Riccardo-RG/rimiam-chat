import { sessionFrom, assertOrigin, body, endpoint } from "@/server/http";
import { pushPreferences, setPushPreference } from "@/server/web-push";

export async function GET(request: Request) {
  return endpoint(async () => {
    const session = await sessionFrom(request);
    const query = new URL(request.url).searchParams;
    return pushPreferences(
      session.user.id,
      session.session.id,
      query.get("workspace") ?? "",
      query.get("device") ?? undefined,
    );
  });
}
export async function POST(request: Request) {
  return endpoint(async () => {
    assertOrigin(request);
    const session = await sessionFrom(request);
    return setPushPreference(
      session.user.id,
      session.session.id,
      await body(request, 8000),
    );
  });
}
