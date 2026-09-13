import { z } from "zod";
import { auth } from "./auth.ts";
import { DomainError, requireThat } from "./errors.ts";

export async function actorFrom(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  requireThat(session, "AUTHENTICATION_REQUIRED", 401);
  return session.user.id;
}
export function assertOrigin(request: Request) {
  requireThat(
    request.headers.get("origin") ===
      new URL(process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000").origin,
    "ORIGIN_REJECTED",
    403,
  );
  requireThat(
    request.headers.get("content-type")?.includes("application/json"),
    "JSON_REQUIRED",
    415,
  );
}
export async function body(request: Request, limit = 24000) {
  requireThat(
    Number(request.headers.get("content-length") ?? 0) < limit,
    "REQUEST_TOO_LARGE",
    413,
  );
  const reader = request.body?.getReader();
  requireThat(reader, "INVALID_REQUEST", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size >= limit) {
        await reader.cancel();
        requireThat(false, "REQUEST_TOO_LARGE", 413);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function endpoint(fn: () => Promise<unknown>) {
  try {
    return Response.json(await fn(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof DomainError)
      return Response.json({ error: error.code }, { status: error.status });
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
    // No private request, prompt, database query or provider payload in logs.
    console.error(
      "Request failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return Response.json({ error: "REQUEST_FAILED" }, { status: 500 });
  }
}
