import { pageLanguage } from "@/app/ui-language-server";
import { sessionFrom, endpoint } from "@/server/http";
import { pushDeliveryTarget } from "@/server/web-push";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return endpoint(async () => {
    const session = await sessionFrom(request);
    const destination = await pushDeliveryTarget(
      session.user.id,
      session.session.id,
      (await params).id,
      new URL(request.url).searchParams.get("device") ?? "",
    );
    return { ...destination, locale: (await pageLanguage()).initialLocale };
  });
}
