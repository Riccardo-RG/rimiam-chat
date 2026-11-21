import { attachmentResponse } from "./attachment-preview.ts";
import { nativePushRequest } from "./native-push.ts";
import {
  readAssistantSettings,
  saveAssistantSettings,
} from "./assistant-settings.ts";
import { saveAssistantSettingsSchema } from "../contracts/assistant-settings.ts";
import { pool } from "./db.ts";
import {
  chatDirectory,
  personalChatState,
  personalChatAct,
} from "./personal-chats.ts";
import { personalChatInput } from "../contracts/personal-chats.ts";
import { conversationMilestones } from "./conversation-milestones.ts";
import {
  workspaceConsultation,
  latestConsultation,
} from "./private-consultation.ts";
import { privateConsultationInput } from "../contracts/private-consultation.ts";
import {
  directCommand,
  directDirectory,
  directFile,
  directView,
  directPeerPhoto,
  directPeerProfile,
  openDirect,
} from "./direct-chat.ts";
import {
  directOpenSchema,
  directInputSchema,
} from "../contracts/direct-chat.ts";
import { identityPhotoEndpoint } from "./identity-photos.ts";
import { ownProfile, workspaceProfile } from "./participant-profiles.ts";
import { changeOwnProfileSchema } from "../contracts/participant-profile.ts";
import { readingInputSchema } from "../contracts/conversation-reading.ts";
import {
  readPersonalAttention,
  updateReading,
} from "./conversation-reading.ts";
import { handoffs } from "./conversation-handoffs.ts";
import { betaFeedbackView } from "./beta-feedback.ts";
import { aiUsageView } from "./ai-usage.ts";
import { betaRulesView, acceptBetaRules } from "./beta-rules.ts";
import { acceptBetaRulesSchema } from "../contracts/beta-rules.ts";
import { activity } from "./activity.ts";
import { referenceDetail } from "./conversation-reference.ts";
import { conversationReferenceSchema } from "../contracts/activity.ts";
import { callView, callConnection, flushCallExit } from "./calls.ts";
import { callAudio } from "./call-transcripts.ts";
import { voiceMessages } from "./voice.ts";
import { composeEmail } from "./email-composition.ts";
import { tasksView, tasksHistory, taskComments } from "./tasks-queries.ts";
import { agendaView, agendaDestination, workspaceSchedule } from "./agenda.ts";
import {
  activeWorkView,
  activeWorkHistory,
  activeWorkPresence,
} from "./active-work-queries.ts";
import { openAPI } from "../contracts/openapi.ts";
import { randomUUID } from "node:crypto";
import {
  exchangeNativeSocial,
  nativeSocialProviders,
  linkedNativeIdentities,
} from "./native-social.ts";
import { z } from "zod";
import { sessionFrom, assertOrigin, body } from "./http.ts";
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
import {
  createWorkspace,
  openPersonalSpace,
  execute,
  acceptInvitation,
} from "./commands.ts";
import {
  listWorkspaces,
  personalHome,
  invitationDetails,
  incomingInvitations,
  snapshot,
} from "./queries.ts";
import { readDocument } from "./sources.ts";
import { accessView, accessHistory } from "./access-queries.ts";
import { personalContacts } from "./personal-contacts.ts";
import { projectView } from "./project-queries.ts";
import { attentionView } from "./attention.ts";
import { handleIntegrationOAuth } from "./google-oauth.ts";
import { changes, messages, receipt, state, history } from "./sync.ts";
import { DomainError, requireThat } from "./errors.ts";
import {
  acceptInvitationSchema,
  acceptedInvitationSchema,
  contactsSchema,
  incomingInvitationsSchema,
  apiVersion,
  commandRequestSchema,
  createWorkspaceSchema,
  errorSchema,
  receiptSchema,
  workspacesSchema,
  personalHomeSchema,
  personalSpaceRequestSchema,
  personalSpaceResultSchema,
} from "../contracts/v1.ts";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Miriam-API-Version": apiVersion,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
async function requestSession(request: Request) {
  if (request.headers.has("authorization")) return nativeSession(request);
  if (request.method !== "GET") assertOrigin(request);
  return sessionFrom(request);
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
    const integration = await handleIntegrationOAuth(request);
    if (integration) return integration;
    if (url.pathname === "/api/v1/openapi.json" && request.method === "GET")
      return Response.json(openAPI, { headers });
    let result: unknown;
    if (url.pathname === "/api/v1/native/social/providers") {
      requireThat(request.method === "GET", "METHOD_NOT_ALLOWED", 405);
      result = nativeSocialProviders();
    } else if (url.pathname === "/api/v1/native/social/accounts") {
      requireThat(request.method === "GET", "METHOD_NOT_ALLOWED", 405);
      result = await linkedNativeIdentities(request);
    } else if (url.pathname === "/api/v1/native/social/exchange") {
      requireThat(request.method === "POST", "METHOD_NOT_ALLOWED", 405);
      result = await exchangeNativeSocial(request);
    } else if (url.pathname === "/api/v1/native/account") {
      requireThat(request.method === "POST", "METHOD_NOT_ALLOWED", 405);
      result = await nativeAccount(request);
    } else if (
      url.pathname === "/api/v1/native/push" ||
      url.pathname === "/api/v1/native/push/target"
    ) {
      const session = await nativeSession(request);
      result = await nativePushRequest(
        request,
        url,
        session.user.id,
        session.session.id,
      );
    } else if (url.pathname === "/api/v1/native/session") {
      if (request.method === "POST") result = await login(request);
      else if (request.method === "GET")
        result = sessionView(await nativeSession(request));
      else if (request.method === "DELETE") result = await logout(request);
      else throw new DomainError("METHOD_NOT_ALLOWED", 405);
    } else if (url.pathname === "/api/v1/beta-rules") {
      requireThat(
        request.method === "GET" || request.method === "POST",
        "METHOD_NOT_ALLOWED",
        405,
      );
      const native = request.headers.has("authorization");
      if (!native && request.method === "POST") assertOrigin(request);
      const session = native
        ? await nativeSession(request)
        : await auth.api.getSession({ headers: request.headers });
      requireThat(session, "AUTHENTICATION_REQUIRED", 401);
      result =
        request.method === "GET"
          ? await betaRulesView(session.user.id, session.session.id)
          : await acceptBetaRules(
              session.user.id,
              session.session.id,
              acceptBetaRulesSchema.parse(await body(request)),
            );
    } else {
      // Carry the same authenticated identity into the transaction. A later
      // revocation must not turn a failed reread into an optional session guard.
      const session = await requestSession(request);
      const a = session.user.id;
      if (url.pathname === "/api/v1/identity-photos")
        return await identityPhotoEndpoint(
          request,
          url,
          a,
          session.session.id,
          { ...headers, "X-Request-ID": requestId },
        );
      const invitation = url.pathname.match(
        /^\/api\/v1\/invitations\/([A-Za-z0-9_-]{20,200})$/,
      );
      const inboxAcceptance = url.pathname.match(
        /^\/api\/v1\/invitations\/([0-9a-f-]{36})\/accept$/i,
      );
      const direct = url.pathname.match(
        /^\/api\/v1\/direct-chats\/([a-f0-9-]{36})(?:\/files\/([a-f0-9-]{36})|\/(photo))?$/i,
      );
      const profile = url.pathname.match(
        /^\/api\/v1\/workspaces\/([a-f0-9-]{36})\/profiles\/([^/]{1,768})$/i,
      );
      const directProfile = url.pathname.match(
        /^\/api\/v1\/direct-chats\/([a-f0-9-]{36})\/profile$/i,
      );
      if (url.pathname === "/api/v1/profile") {
        requireThat(
          request.method === "GET" || request.method === "POST",
          "METHOD_NOT_ALLOWED",
          405,
        );
        result = await ownProfile(
          a,
          session.session.id,
          request.method === "POST"
            ? changeOwnProfileSchema.parse(await body(request, 2048))
            : undefined,
        );
      } else if (profile) {
        requireThat(request.method === "GET", "METHOD_NOT_ALLOWED", 405);
        result = await workspaceProfile(
          a,
          session.session.id,
          z.uuid().parse(profile[1]),
          decodeURIComponent(profile[2]),
        );
      } else if (directProfile) {
        requireThat(request.method === "GET", "METHOD_NOT_ALLOWED", 405);
        result = await directPeerProfile(
          a,
          session.session.id,
          z.uuid().parse(directProfile[1]),
        );
      } else if (url.pathname === "/api/v1/direct-chats") {
        if (request.method === "POST") {
          const c = directOpenSchema.parse(await body(request));
          requireThat(c.expectedActorId === a, "AUTH_CONTEXT_CHANGED", 409);
          result = await openDirect(a, session.session.id, c.contactId);
        } else {
          requireThat(request.method === "GET", "METHOD_NOT_ALLOWED", 405);
          result = await directDirectory(a, session.session.id);
        }
      } else if (direct) {
        const id = z.uuid().parse(direct[1]);
        if (direct[3]) {
          requireThat(request.method === "GET", "METHOD_NOT_ALLOWED", 405);
          return new Response(
            new Uint8Array(await directPeerPhoto(a, session.session.id, id)),
            {
              headers: {
                ...headers,
                "Content-Type": "image/jpeg",
                "X-Content-Type-Options": "nosniff",
              },
            },
          );
        }
        if (direct[2]) {
          requireThat(request.method === "GET", "METHOD_NOT_ALLOWED", 405);
          const f = await directFile(
            a,
            session.session.id,
            id,
            z.uuid().parse(direct[2]),
          );
          return await attachmentResponse(
            request,
            f.filename,
            f.content_type,
            f.original_bytes,
            {
              ...headers,
              "X-Request-ID": requestId,
            },
          );
        }
        if (request.method === "GET")
          result = await directView(a, session.session.id, id);
        else {
          requireThat(request.method === "POST", "METHOD_NOT_ALLOWED", 405);
          result = await directCommand(
            a,
            session.session.id,
            id,
            directInputSchema.parse(await body(request, 12582912)),
          );
        }
      } else if (url.pathname === "/api/v1/assistant-settings") {
        if (request.method === "POST")
          result = await saveAssistantSettings(
            a,
            session.session.id,
            saveAssistantSettingsSchema.parse(await body(request)),
          );
        else {
          requireThat(request.method === "GET", "METHOD_NOT_ALLOWED", 405);
          const workspaceId = z
            .uuid()
            .optional()
            .parse(url.searchParams.get("workspaceId") ?? undefined);
          result = await readAssistantSettings(
            a,
            session.session.id,
            workspaceId,
          );
        }
      } else if (url.pathname === "/api/v1/personal-chats") {
        if (request.method === "POST")
          result = await personalChatAct(
            a,
            session.session.id,
            personalChatInput.parse(await body(request)),
          );
        else {
          requireThat(request.method === "GET", "METHOD_NOT_ALLOWED", 405);
          const thread = url.searchParams.get("thread");
          result = thread
            ? await personalChatState(
                a,
                session.session.id,
                z.uuid().parse(thread),
              )
            : await chatDirectory(
                a,
                session.session.id,
                url.searchParams.get("q") ?? "",
                z.coerce
                  .number()
                  .int()
                  .min(0)
                  .parse(url.searchParams.get("offset") ?? 0),
              );
        }
      } else if (url.pathname === "/api/v1/agenda") {
        requireThat(request.method === "GET", "METHOD_NOT_ALLOWED", 405);
        result = await agendaView(
          a,
          session.session.id,
          url.searchParams.get("day") ?? "",
          url.searchParams.get("zone") ?? "",
        );
      } else if (url.pathname === "/api/v1/agenda/destination") {
        requireThat(request.method === "GET", "METHOD_NOT_ALLOWED", 405);
        result = await agendaDestination(
          a,
          session.session.id,
          z.uuid().parse(url.searchParams.get("workspace")),
        );
      } else if (url.pathname === "/api/v1/personal-space") {
        if (request.method === "GET")
          result = personalHomeSchema.parse(
            await personalHome(a, session.session.id),
          );
        else if (request.method === "POST") {
          const input = personalSpaceRequestSchema.parse(await body(request));
          requireThat(input.expectedActorId === a, "AUTH_CONTEXT_CHANGED", 409);
          result = personalSpaceResultSchema.parse(
            await openPersonalSpace(a, session.session.id),
          );
        } else throw new DomainError("METHOD_NOT_ALLOWED", 405);
      } else if (url.pathname === "/api/v1/contacts") {
        requireThat(request.method === "GET", "METHOD_NOT_ALLOWED", 405);
        const q = z
          .string()
          .trim()
          .max(120)
          .parse(url.searchParams.get("q") ?? "");
        result = contactsSchema.parse(
          await personalContacts(
            a,
            session.session.id,
            q,
            cursor(url, "offset", 0),
          ),
        );
      } else if (url.pathname === "/api/v1/invitations") {
        requireThat(request.method === "GET", "METHOD_NOT_ALLOWED", 405);
        result = incomingInvitationsSchema.parse(
          await incomingInvitations(a, session.session.id),
        );
      } else if (inboxAcceptance) {
        requireThat(request.method === "POST", "METHOD_NOT_ALLOWED", 405);
        const input = acceptInvitationSchema.parse(await body(request));
        result = acceptedInvitationSchema.parse(
          await acceptInvitation(
            a,
            { recipientInvitationId: z.uuid().parse(inboxAcceptance[1]) },
            input.fullHistoryAccepted,
            session.session.id,
          ),
        );
      } else if (invitation) {
        if (request.method === "GET")
          result = await invitationDetails(a, invitation[1]);
        else if (request.method === "POST") {
          const input = acceptInvitationSchema.parse(await body(request));
          result = await acceptInvitation(
            a,
            invitation[1],
            input.fullHistoryAccepted,
            session.session.id,
          );
        } else throw new DomainError("METHOD_NOT_ALLOWED", 405);
      } else if (url.pathname === "/api/v1/workspaces") {
        if (request.method === "GET")
          result = workspacesSchema.parse({
            workspaces: await listWorkspaces(a),
          });
        else if (request.method === "POST") {
          const input = createWorkspaceSchema.parse(
            await body(request, 12 * 1024 * 1024),
          );
          requireThat(
            !input.expectedActorId || input.expectedActorId === a,
            "AUTH_CONTEXT_CHANGED",
            409,
          );
          result = await createWorkspace(
            a,
            input.name,
            input.commandId,
            input.description,
            session.session.id,
            input.invitations,
            input.attachments,
            input.assistantConnectionId,
            input.assistantConnectionRevision,
          );
        } else throw new DomainError("METHOD_NOT_ALLOWED", 405);
      } else {
        const match = url.pathname.match(
          /^\/api\/v1\/workspaces\/([^/]+)\/(consultation|milestones|reading|ai-usage|beta-feedback|handoffs|activity|reference|calls|call-connect|call-audio|voice|attention|project|access|access-history|workspace|source-file|state|messages|history|changes|events|commands|receipts|calendar|calendar-history|email|email-history|email-attachment|email-compose|schedule|tasks|tasks-history|task-comments|active-work|active-work-history|active-work-presence)(?:\/([^/]+))?$/,
        );
        requireThat(match, "ROUTE_NOT_FOUND", 404);
        const w = z.uuid().parse(match[1]),
          resource = match[2];
        requireThat(
          !match[3] || resource === "receipts",
          "ROUTE_NOT_FOUND",
          404,
        );
        if (
          ![
            "commands",
            "receipts",
            "workspace",
            "reading",
            "reference",
            "source-file",
            "messages",
            "events",
            "changes",
            "state",
            "history",
            "consultation",
          ].includes(resource)
        )
          requireThat(
            !(
              await pool.query(
                "SELECT 1 FROM workspace WHERE id=$1 AND personal_archive_id IS NOT NULL AND personal_owner_id=$2",
                [w, a],
              )
            ).rowCount,
            "PERSONAL_SPACE_UNSUPPORTED",
            403,
          );
        if (resource === "consultation" && request.method === "GET") {
          const kind = z
            .enum(["recap", "context"])
            .parse(url.searchParams.get("kind") ?? "context");
          result = await latestConsultation(a, session.session.id, w, kind);
        } else if (resource === "consultation" && request.method === "POST") {
          result = await workspaceConsultation(
            a,
            session.session.id,
            w,
            privateConsultationInput.parse(await body(request)),
          );
        } else if (resource === "milestones" && request.method === "GET") {
          result = await conversationMilestones(
            a,
            w,
            z.uuid().parse(url.searchParams.get("first")),
            z.uuid().parse(url.searchParams.get("last")),
          );
        } else if (resource === "reading" && request.method === "GET") {
          result = await readPersonalAttention(a, session.session.id, w);
        } else if (resource === "reading" && request.method === "POST") {
          result = await updateReading(
            a,
            session.session.id,
            w,
            readingInputSchema.parse(await body(request)),
          );
        } else if (resource === "call-connect" && request.method === "POST") {
          const input = z
            .object({ callId: z.uuid() })
            .strict()
            .parse(await body(request));
          result = await callConnection(
            a,
            w,
            input.callId,
            undefined,
            session.session.id,
          );
        } else if (resource === "email-compose" && request.method === "POST") {
          result = await composeEmail(
            a,
            w,
            session.session.id,
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
          result = receiptSchema.parse({
            commandId: input.commandId,
            status: "committed",
            result: await execute(
              a,
              w,
              input.commandId,
              input.command,
              session.session.id,
            ),
          });
          await flushCallExit(a, w, input.command);
        } else {
          requireThat(request.method === "GET", "METHOD_NOT_ALLOWED", 405);
          const after = cursor(url, "after", 0);
          const maxLimit = resource === "schedule" ? 500 : 200;
          const limit = z
            .number()
            .int()
            .min(1)
            .max(maxLimit)
            .parse(
              cursor(url, "limit", resource === "schedule" ? 20 : 50, maxLimit),
            );
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
            return await attachmentResponse(
              request,
              file.filename,
              file.media_type,
              file.original_bytes,
              {
                ...headers,
                "X-Request-ID": requestId,
              },
            );
          } else if (resource === "active-work-presence")
            result = await activeWorkPresence(a, w);
          else if (resource === "active-work") {
            requireThat(
              !url.searchParams.has("completion") ||
                url.searchParams.has("workId"),
              "INVALID_REQUEST",
              400,
            );
            requireThat(
              !(
                url.searchParams.has("workId") && url.searchParams.has("before")
              ),
              "INVALID_REQUEST",
              400,
            );
            result = await activeWorkView(
              a,
              w,
              z
                .uuid()
                .optional()
                .parse(url.searchParams.get("before") ?? undefined),
              z
                .uuid()
                .optional()
                .parse(url.searchParams.get("workId") ?? undefined),
              z.coerce
                .number()
                .int()
                .positive()
                .optional()
                .parse(url.searchParams.get("completion") ?? undefined),
            );
          } else if (resource === "active-work-history")
            result = await activeWorkHistory(
              a,
              w,
              z.uuid().parse(url.searchParams.get("id")),
              cursor(url, "before", 2147483647, 2147483647),
            );
          else if (resource === "schedule")
            result = await workspaceSchedule(
              a,
              w,
              z
                .enum(["true", "false"])
                .parse(url.searchParams.get("mine") ?? "false") === "true",
              limit,
            );
          else if (resource === "tasks")
            result = await tasksView(
              a,
              w,
              z
                .uuid()
                .optional()
                .parse(url.searchParams.get("before") ?? undefined),
              z
                .uuid()
                .optional()
                .parse(url.searchParams.get("focus") ?? undefined),
            );
          else if (resource === "task-comments")
            result = await taskComments(
              a,
              w,
              z.uuid().parse(url.searchParams.get("id")),
              url.searchParams.has("before")
                ? z
                    .number()
                    .positive()
                    .parse(cursor(url, "before", 0, 2147483647))
                : undefined,
            );
          else if (resource === "tasks-history") {
            const kind = z
              .enum(["task", "followup"])
              .parse(url.searchParams.get("kind"));
            const deliveryVersion = url.searchParams.get(
              "beforeDeliveryVersion",
            );
            const deliveryAt = url.searchParams.get("beforeDeliveryAt");
            requireThat(
              (deliveryVersion === null) === (deliveryAt === null) &&
                (deliveryAt === null || kind === "followup"),
              "INVALID_CURSOR",
              400,
            );
            const beforeDelivery =
              deliveryAt === null
                ? undefined
                : {
                    version: z
                      .number()
                      .int()
                      .positive()
                      .parse(
                        cursor(url, "beforeDeliveryVersion", 0, 2147483647),
                      ),
                    scheduledAt: z.iso
                      .datetime({ offset: true })
                      .parse(deliveryAt),
                  };
            result = await tasksHistory(
              a,
              w,
              z.uuid().parse(url.searchParams.get("id")),
              kind,
              cursor(url, "before", 2147483647, 2147483647),
              beforeDelivery,
            );
          } else if (resource === "calendar")
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
          else if (resource === "ai-usage")
            result = await aiUsageView(
              a,
              w,
              Number(url.searchParams.get("days") ?? 30),
            );
          else if (resource === "beta-feedback")
            result = await betaFeedbackView(a, w);
          else if (resource === "handoffs")
            result = await handoffs(
              a,
              w,
              url.searchParams.has("sourceId")
                ? z.uuid().parse(url.searchParams.get("sourceId"))
                : undefined,
            );
          else if (resource === "activity")
            result = await activity(
              a,
              w,
              url.searchParams.get("before") ?? undefined,
              limit,
            );
          else if (resource === "reference")
            result = await referenceDetail(
              a,
              w,
              conversationReferenceSchema.parse({
                kind: url.searchParams.get("kind"),
                id: url.searchParams.get("id"),
                version: z.coerce
                  .number()
                  .int()
                  .positive()
                  .parse(url.searchParams.get("version")),
                ...(url.searchParams.has("eventId")
                  ? { eventId: url.searchParams.get("eventId") }
                  : {}),
              }),
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
              z
                .uuid()
                .optional()
                .parse(url.searchParams.get("workstreamId") ?? undefined),
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
              z
                .uuid()
                .optional()
                .parse(url.searchParams.get("workstreamId") ?? undefined),
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
            (await requestSession(request)).user.id === a,
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
