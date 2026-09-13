import { callView, callConnection, flushCallExit } from "./calls.ts";
import { callAudio } from "./call-transcripts.ts";
import { voiceMessages } from "./voice.ts";
import { composeEmail } from "./email-composition.ts";
import { tasksView, tasksHistory } from "./tasks-queries.ts";
import { activeWorkView, activeWorkHistory } from "./active-work-queries.ts";
import { openAPI } from "../contracts/openapi.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { actorFrom, assertOrigin, body } from "./http.ts";
import { auth } from "./auth.ts";
import { calendarView, calendarHistory } from "./calendar-queries.ts";
import { emailView, emailHistory, emailAttachment } from "./email-queries.ts";
import {
  login,
  logout,
  nativeSession,
  sessionView,
  nativeAccount,
} from "./native-session.ts";
import { createWorkspace, execute, acceptInvitation } from "./commands.ts";
import { listWorkspaces, invitationDetails, snapshot } from "./queries.ts";
import { readDocument } from "./sources.ts";
import { accessView, accessHistory } from "./access-queries.ts";
import { projectView } from "./project-queries.ts";
import { attentionView } from "./attention.ts";
import { handleGoogleIntegration } from "./google-oauth.ts";
import { changes, messages, receipt, state, history } from "./sync.ts";
import { DomainError, requireThat } from "./errors.ts";
import {
  apiVersion,
  commandRequestSchema,
  createWorkspaceSchema,
  errorSchema,
  receiptSchema,
  workspacesSchema,
} from "../contracts/v1.ts";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Miriam-API-Version": apiVersion,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
async function actor(request: Request) {
  if (request.headers.has("authorization"))
    return (await nativeSession(request)).user.id;
  if (request.method !== "GET") assertOrigin(request);
  return actorFrom(request);
}
function cursor(
  url: URL,
  key: string,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
) {
  const value = url.searchParams.get(key);
  if (value === null) return fallback;
  requireThat(/^\d+$/.test(value), "INVALID_CURSOR", 400);
  return z.number().int().nonnegative().max(max).parse(Number(value));
}
// Framework-neutral Request/Response boundary used by Next and the standalone Node listener.
export async function handleAPI(request: Request): Promise<Response> {
  const requestId = randomUUID();
  try {
    const url = new URL(request.url);
    requireThat(url.pathname.startsWith("/api/v1/"), "ROUTE_NOT_FOUND", 404);
    const integration = await handleGoogleIntegration(request);
    if (integration) return integration;
    if (url.pathname === "/api/v1/openapi.json" && request.method === "GET")
      return Response.json(openAPI, { headers });
    let result: unknown;
    if (url.pathname === "/api/v1/native/account") {
      requireThat(request.method === "POST", "METHOD_NOT_ALLOWED", 405);
      result = await nativeAccount(request);
    } else if (url.pathname === "/api/v1/native/session") {
      if (request.method === "POST") result = await login(request);
      else if (request.method === "GET")
        result = sessionView(await nativeSession(request));
      else if (request.method === "DELETE") result = await logout(request);
      else throw new DomainError("METHOD_NOT_ALLOWED", 405);
    } else {
      const a = await actor(request);
      const invitation = url.pathname.match(
        /^\/api\/v1\/invitations\/([A-Za-z0-9_-]{20,200})$/,
      );
      if (invitation) {
        if (request.method === "GET")
          result = await invitationDetails(a, invitation[1]);
        else if (request.method === "POST") {
          const input = z
            .object({ fullHistoryAccepted: z.literal(true) })
            .strict()
            .parse(await body(request));
          result = await acceptInvitation(
            a,
            invitation[1],
            input.fullHistoryAccepted,
          );
        } else throw new DomainError("METHOD_NOT_ALLOWED", 405);
      } else if (url.pathname === "/api/v1/workspaces") {
        if (request.method === "GET")
          result = workspacesSchema.parse({
            workspaces: await listWorkspaces(a),
          });
        else if (request.method === "POST") {
          const input = createWorkspaceSchema.parse(await body(request));
          requireThat(
            !input.expectedActorId || input.expectedActorId === a,
            "AUTH_CONTEXT_CHANGED",
            409,
          );
          result = await createWorkspace(a, input.name, input.commandId);
        } else throw new DomainError("METHOD_NOT_ALLOWED", 405);
      } else {
        const match = url.pathname.match(
          /^\/api\/v1\/workspaces\/([^/]+)\/(calls|call-connect|call-audio|voice|attention|project|access|access-history|workspace|source-file|state|messages|history|changes|events|commands|receipts|calendar|calendar-history|email|email-history|email-attachment|email-compose|tasks|tasks-history|active-work|active-work-history)(?:\/([^/]+))?$/,
        );
        requireThat(match, "ROUTE_NOT_FOUND", 404);
        const w = z.uuid().parse(match[1]),
          resource = match[2];
        requireThat(
          !match[3] || resource === "receipts",
          "ROUTE_NOT_FOUND",
          404,
        );
        if (resource === "call-connect" && request.method === "POST") {
          const input = z
            .object({ callId: z.uuid() })
            .strict()
            .parse(await body(request));
          result = await callConnection(a, w, input.callId);
        } else if (resource === "email-compose" && request.method === "POST") {
          const session = request.headers.has("authorization")
            ? await nativeSession(request)
            : await auth.api.getSession({ headers: request.headers });
          result = await composeEmail(
            a,
            w,
            session?.session.id,
            await body(request),
          );
        } else if (resource === "commands" && request.method === "POST") {
          requireThat(
            request.headers.get("content-type")?.includes("application/json"),
            "JSON_REQUIRED",
            415,
          );
          const input = commandRequestSchema.parse(
            await body(request, 12 * 1024 * 1024),
          );
          requireThat(
            !input.expectedActorId || input.expectedActorId === a,
            "AUTH_CONTEXT_CHANGED",
            409,
          );
          const session = request.headers.has("authorization")
            ? await nativeSession(request)
            : await auth.api.getSession({ headers: request.headers });
          result = receiptSchema.parse({
            commandId: input.commandId,
            status: "committed",
            result: await execute(
              a,
              w,
              input.commandId,
              input.command,
              session?.session.id,
            ),
          });
          await flushCallExit(a, w, input.command);
        } else {
          requireThat(request.method === "GET", "METHOD_NOT_ALLOWED", 405);
          const after = cursor(url, "after", 0);
          const limit = z
            .number()
            .int()
            .min(1)
            .max(200)
            .parse(cursor(url, "limit", 50, 200));
          if (resource === "calls") result = await callView(a, w);
          else if (resource === "call-audio")
            return callAudio(
              a,
              w,
              z.uuid().parse(url.searchParams.get("id")),
              request.headers.get("range"),
            );
          else if (resource === "voice") result = await voiceMessages(a, w);
          else if (resource === "state") result = await state(a, w);
          else if (resource === "project") result = await projectView(a, w);
          else if (resource === "attention")
            result = await attentionView(
              a,
              w,
              url.searchParams.has("before")
                ? cursor(url, "before", 0)
                : undefined,
            );
          else if (resource === "workspace") result = await snapshot(a, w);
          else if (resource === "access")
            result = await accessView(
              a,
              w,
              z
                .uuid()
                .optional()
                .parse(url.searchParams.get("before") ?? undefined),
            );
          else if (resource === "access-history")
            result = await accessHistory(
              a,
              w,
              z.uuid().parse(url.searchParams.get("id")),
              cursor(url, "before", 2147483647, 2147483647),
            );
          else if (resource === "source-file") {
            const file = await readDocument(
              a,
              w,
              z.uuid().parse(url.searchParams.get("id")),
            );
            return new Response(new Uint8Array(file.original_bytes), {
              headers: {
                ...headers,
                "Content-Type": file.media_type,
                "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
              },
            });
          } else if (resource === "active-work")
            result = await activeWorkView(
              a,
              w,
              z
                .uuid()
                .optional()
                .parse(url.searchParams.get("before") ?? undefined),
            );
          else if (resource === "active-work-history")
            result = await activeWorkHistory(
              a,
              w,
              z.uuid().parse(url.searchParams.get("id")),
              cursor(url, "before", 2147483647, 2147483647),
            );
          else if (resource === "tasks")
            result = await tasksView(
              a,
              w,
              z
                .uuid()
                .optional()
                .parse(url.searchParams.get("before") ?? undefined),
            );
          else if (resource === "tasks-history")
            result = await tasksHistory(
              a,
              w,
              z.uuid().parse(url.searchParams.get("id")),
              z.enum(["task", "followup"]).parse(url.searchParams.get("kind")),
              cursor(url, "before", 2147483647, 2147483647),
            );
          else if (resource === "calendar")
            result = await calendarView(
              a,
              w,
              z.string().parse(url.searchParams.get("start")),
              z.string().parse(url.searchParams.get("end")),
              url.searchParams.get("afterAction") ?? undefined,
            );
          else if (resource === "email")
            result = await emailView(
              a,
              w,
              url.searchParams.get("before") ?? undefined,
              url.searchParams.get("observationId") ?? undefined,
            );
          else if (resource === "email-history")
            result = await emailHistory(
              a,
              w,
              z.uuid().parse(url.searchParams.get("draftId")),
            );
          else if (resource === "email-attachment") {
            const attachment = await emailAttachment(
              a,
              w,
              z.uuid().parse(url.searchParams.get("id")),
            );
            return new Response(new Uint8Array(attachment.bytes), {
              headers: {
                ...headers,
                "Content-Type": "application/octet-stream",
                "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
              },
            });
          } else if (resource === "calendar-history")
            result = await calendarHistory(
              a,
              w,
              z.uuid().parse(url.searchParams.get("id")),
              z
                .enum(["action", "scheduled_event", "commitment"])
                .parse(url.searchParams.get("kind")),
            );
          else if (resource === "history") {
            requireThat(
              url.searchParams.has("through"),
              "MESSAGE_BOUNDARY_REQUIRED",
              400,
            );
            const through = cursor(url, "through", 0);
            result = await history(
              a,
              w,
              cursor(url, "before", through + 1),
              through,
              limit,
            );
          } else if (resource === "messages") {
            requireThat(
              url.searchParams.has("through"),
              "MESSAGE_BOUNDARY_REQUIRED",
              400,
            );
            result = await messages(
              a,
              w,
              after,
              cursor(url, "through", 0),
              limit,
            );
          } else if (resource === "changes")
            result = await changes(a, w, after, limit);
          else if (resource === "receipts")
            result = await receipt(a, w, z.uuid().parse(match[3]));
          else if (resource === "events") {
            const last = request.headers.get("last-event-id");
            const from =
              last === null
                ? after
                : z.coerce.number().int().nonnegative().parse(last);
            await changes(a, w, from, 1);
            return eventStream(request, a, w, from);
          } else throw new DomainError("METHOD_NOT_ALLOWED", 405);
        }
      }
    }
    return Response.json(result, {
      headers: { ...headers, "X-Request-ID": requestId },
    });
  } catch (error) {
    const known = error instanceof DomainError;
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
    const status = known ? error.status : invalid ? 400 : 500;
    const code = known
      ? error.code
      : invalid
        ? "INVALID_REQUEST"
        : "REQUEST_FAILED";
    if (!known && !invalid)
      console.error(
        "API failed",
        requestId,
        error instanceof Error ? error.name : "UnknownError",
      );
    const recovery =
      code === "RECEIPT_NOT_FOUND"
        ? "check_receipt"
        : status === 401
          ? "authenticate"
          : status >= 500
            ? "check_receipt"
            : status === 409
              ? "refresh"
              : "none";
    return Response.json(
      errorSchema.parse({ error: { code, requestId, recovery } }),
      { status, headers: { ...headers, "X-Request-ID": requestId } },
    );
  }
}
function eventStream(request: Request, a: string, w: string, initial: number) {
  let stopped = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  let close: () => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let after = initial;
      close = () => {
        if (stopped) return;
        stopped = true;
        if (timer) clearTimeout(timer);
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {}
      };
      request.signal.addEventListener("abort", close, { once: true });
      const tick = async () => {
        if (stopped || request.signal.aborted) {
          close();
          return;
        }
        try {
          requireThat(
            (await actor(request)) === a,
            "AUTHENTICATION_REQUIRED",
            401,
          );
          const batch = await changes(a, w, after, 100);
          if (stopped) return;
          controller.enqueue(
            new TextEncoder().encode(
              batch.changes.length
                ? `id: ${batch.nextAfter}\ndata: ${JSON.stringify(batch)}\n\n`
                : ": heartbeat\n\n",
            ),
          );
          after = batch.nextAfter;
        } catch {
          close();
          return;
        }
        if (!stopped) timer = setTimeout(tick, 1000);
      };
      void tick();
    },
    cancel() {
      close();
    },
  });
  return new Response(stream, {
    headers: {
      ...headers,
      "Content-Type": "text/event-stream",
      "Cache-Control": "private, no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
