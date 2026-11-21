import { NextResponse, type NextRequest } from "next/server";
import { releaseHeader, releaseId, staleHeader } from "./shared/web-release";

// This is a compatibility precondition for the Web client. Authentication and
// authorization still belong to each route. API consumers do not need a Web build ID.
export function proxy(request: NextRequest) {
  const client = request.headers.get(releaseHeader);
  const current = process.env.RIMIAM_WEB_RELEASE;
  // Previous Web builds did not identify themselves. A same-origin browser
  // write from such a tab must also wait for a fresh page. Keep top-level OAuth
  // navigations, service-worker delivery reads and bearer API clients independent.
  const legacyBrowserWrite =
    client === null &&
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    request.headers.get("sec-fetch-site") === "same-origin" &&
    request.headers.get("sec-fetch-dest") === "empty" &&
    !request.headers.has("authorization");
  if (
    releaseId(current) &&
    ((client !== null && client !== current) || legacyBrowserWrite)
  ) {
    return NextResponse.json(
      { error: { code: "WEB_UPDATE_REQUIRED" } },
      {
        status: 409,
        headers: {
          [staleHeader]: current,
          "Cache-Control": "private, no-store",
        },
      },
    );
  }
  return NextResponse.next();
}
export const config = { matcher: "/api/:path*" };
