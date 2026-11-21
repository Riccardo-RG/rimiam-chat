import { attachmentPreviewSchema } from "./attachment-preview.ts";
import {
  nativeSocialExchange,
  nativeSocialOptions,
  nativeLinkedMethods,
} from "./native-social.ts";
import {
  nativePushChange,
  nativePushPreference,
  nativePushReceipt,
  nativePushTarget,
} from "./native-push.ts";
import {
  assistantSettingsSchema,
  saveAssistantSettingsSchema,
} from "./assistant-settings.ts";
import {
  chatDirectorySchema,
  chatStateSchema,
  personalChatInput,
} from "./personal-chats.ts";
import { conversationMilestonesSchema } from "./conversation-milestones.ts";
import {
  directEntrySchema,
  directViewSchema,
  directOpenSchema,
  directInputSchema,
} from "./direct-chat.ts";
import {
  readingInputSchema,
  personalReadingSchema,
} from "./conversation-reading.ts";
import { photoChangeSchema, photoDirectorySchema } from "./identity-photos.ts";
import {
  participantProfileSchema,
  changeOwnProfileSchema,
} from "./participant-profile.ts";
import { conversationHandoffsSchema } from "./conversation-handoff.ts";
import { betaFeedbackViewSchema } from "./beta-feedback.ts";
import { aiUsageViewSchema } from "./ai-usage.ts";
import { betaRulesViewSchema, acceptBetaRulesSchema } from "./beta-rules.ts";
import { activitySchema, referenceDetailSchema } from "./activity.ts";
import { callViewSchema } from "./calls.ts";
import { voiceMessagesSchema } from "./voice.ts";
import { z } from "zod";
import { attentionViewSchema } from "./attention.ts";
import { projectViewSchema } from "./project.ts";
import { accessViewSchema, accessHistorySchema } from "./access.ts";
import {
  tasksViewSchema,
  tasksHistorySchema,
  taskCommentsSchema,
} from "./tasks.ts";
import {
  activeWorkViewSchema,
  activeWorkHistorySchema,
  activeWorkPresenceSchema,
} from "./active-work.ts";
import { calendarViewSchema } from "./calendar.ts";
import {
  agendaViewSchema,
  agendaDestinationSchema,
  workspaceScheduleSchema,
} from "./agenda.ts";
import {
  emailComposeRequestSchema,
  emailCompositionSchema,
  emailViewSchema,
} from "./email.ts";
import {
  incomingInvitationsSchema,
  personalSpaceRequestSchema,
  personalSpaceResultSchema,
  personalHomeSchema,
  contactsSchema,
  acceptInvitationSchema,
  acceptedInvitationSchema,
  commandRequestSchema,
  createWorkspaceSchema,
  receiptSchema,
  errorSchema,
  sessionSchema,
  loginSchema,
  loginResultSchema,
  nativeAccountSchema,
  nativeAccountResultSchema,
  workspacesSchema,
  stateSchema,
  messagesSchema,
  changesSchema,
  historySchema,
} from "./v1.ts";

const schemas = {
  AttachmentPreview: attachmentPreviewSchema,
  NativePushChange: nativePushChange,
  NativePushPreference: nativePushPreference,
  NativePushReceipt: nativePushReceipt,
  NativePushTarget: nativePushTarget,
  ConversationMilestones: conversationMilestonesSchema,
  DirectDirectory: z.array(directEntrySchema),
  DirectView: directViewSchema,
  DirectOpen: directOpenSchema,
  DirectInput: directInputSchema,
  DirectId: z.object({ id: z.uuid() }),
  DirectReceipt: z.union([
    z.object({ messageId: z.uuid() }),
    z.object({ recapId: z.uuid() }),
    z.object({ consentVersion: z.int() }),
    z.object({ cursorVersion: z.int() }),
  ]),
  PersonalReading: personalReadingSchema,
  ReadingInput: readingInputSchema,
  ReadingReceipt: z.object({ cursorVersion: z.int().nonnegative() }),
  IdentityPhotos: photoDirectorySchema,
  ParticipantProfile: participantProfileSchema,
  OwnProfileChange: changeOwnProfileSchema,
  IdentityPhotoChange: photoChangeSchema,
  IdentityPhotoResult: z.object({
    version: z.number().int().nonnegative(),
    present: z.boolean(),
  }),
  WorkspaceSchedule: workspaceScheduleSchema,
  Agenda: agendaViewSchema,
  AgendaDestination: agendaDestinationSchema,
  AssistantSettings: assistantSettingsSchema,
  SaveAssistantSettings: saveAssistantSettingsSchema,
  PersonalChatInput: personalChatInput,
  PersonalChatView: z.union([chatDirectorySchema, chatStateSchema]),
  PersonalChatReceipt: z.union([
    z.object({ id: z.uuid(), archiveId: z.uuid() }),
    z.object({}).strict(),
  ]),
  BetaRules: betaRulesViewSchema,
  AcceptBetaRules: acceptBetaRulesSchema,
  BetaFeedback: betaFeedbackViewSchema,
  AIUsage: aiUsageViewSchema,
  Handoffs: conversationHandoffsSchema,
  Activity: activitySchema,
  Reference: referenceDetailSchema,
  Voice: voiceMessagesSchema,
  Calls: callViewSchema,
  CallConnect: z.object({ callId: z.uuid() }),
  CallCredentials: z.object({
    callId: z.uuid(),
    participantId: z.uuid(),
    url: z.url(),
    token: z.string(),
  }),
  Attention: attentionViewSchema,
  Project: projectViewSchema,
  Access: accessViewSchema,
  AccessHistory: accessHistorySchema,
  ActiveWork: activeWorkViewSchema,
  ActiveWorkHistory: activeWorkHistorySchema,
  ActiveWorkPresence: activeWorkPresenceSchema,
  Tasks: tasksViewSchema,
  TasksHistory: tasksHistorySchema,
  TaskComments: taskCommentsSchema,
  MailboxIntegrationStatus: z.object({
    configured: z.boolean(),
    capabilities: z.array(z.enum(["email", "calendar"])),
  }),
  IntegrationRequest: z
    .object({ capability: z.enum(["email", "calendar"]) })
    .strict(),

  IntegrationHandoff: z.object({
    authorizationUrl: z.url(),
    expiresAt: z.iso.datetime(),
  }),
  Email: emailViewSchema,
  EmailComposition: emailCompositionSchema,
  EmailComposeRequest: emailComposeRequestSchema,
  EmailHistory: z.object({
    compositions: z.array(z.record(z.string(), z.unknown())),
    versions: z.array(z.record(z.string(), z.unknown())),
    transitions: z.array(z.record(z.string(), z.unknown())),
  }),
  Calendar: calendarViewSchema,
  CalendarHistory: z.object({
    versions: z.array(z.record(z.string(), z.unknown())),
    transitions: z.array(z.record(z.string(), z.unknown())).optional(),
    approvals: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
  CommandRequest: commandRequestSchema,
  CreateWorkspace: createWorkspaceSchema,
  Receipt: receiptSchema,
  Error: errorSchema,
  Session: sessionSchema,
  Login: loginSchema,
  LoginResult: loginResultSchema,
  NativeSocialExchange: nativeSocialExchange,
  NativeSocialOptions: nativeSocialOptions,
  NativeLinkedMethods: nativeLinkedMethods,
  NativeAccount: nativeAccountSchema,
  NativeAccountResult: nativeAccountResultSchema,
  Workspaces: workspacesSchema,
  PersonalSpaceRequest: personalSpaceRequestSchema,
  PersonalSpaceResult: personalSpaceResultSchema,
  PersonalHome: personalHomeSchema,
  PersonalContacts: contactsSchema,
  IncomingInvitations: incomingInvitationsSchema,
  AcceptInvitation: acceptInvitationSchema,
  AcceptedInvitation: acceptedInvitationSchema,
  State: stateSchema,
  Messages: messagesSchema,
  Changes: changesSchema,
  History: historySchema,
  CreatedWorkspace: z.object({ id: z.uuid() }),
  SignedOut: z.object({ signedOut: z.literal(true) }),
};
const ref = (name: keyof typeof schemas) => ({
  $ref: `#/components/schemas/${name}`,
});
const parameter = (
  name: string,
  where: "path" | "query" | "header",
  required: boolean,
  schema: unknown,
  description?: string,
) => ({
  name,
  in: where,
  required,
  schema,
  ...(description && { description }),
});
const workspace = parameter("workspaceId", "path", true, {
  type: "string",
  format: "uuid",
});
const after = parameter("after", "query", false, {
  type: "integer",
  minimum: 0,
  default: 0,
});
const limit = parameter("limit", "query", false, {
  type: "integer",
  minimum: 1,
  maximum: 200,
  default: 50,
});
function operation(
  response: keyof typeof schemas,
  request?: keyof typeof schemas,
  parameters: unknown[] = [],
) {
  return {
    security: [{ nativeSession: [] }, { webSession: [] }],
    parameters,
    ...(request
      ? {
          requestBody: {
            required: true,
            content: { "application/json": { schema: ref(request) } },
          },
        }
      : {}),
    responses: {
      "200": {
        description: "Successful operation",
        content: { "application/json": { schema: ref(response) } },
      },
      default: {
        description:
          "Structured failure; inspect error.recovery and preserve uncertain command identity",
        content: { "application/json": { schema: ref("Error") } },
      },
    },
  };
}

function fileReadOperation(keys: ReturnType<typeof parameter>[]) {
  const read = operation("AttachmentPreview", undefined, [
    ...keys,
    parameter("view", "query", false, { type: "string", enum: ["preview"] }),
  ]);
  return {
    ...read,
    responses: {
      ...read.responses,
      "200": {
        description:
          "Original attachment bytes, or a private preview with view=preview",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/AttachmentPreview" },
          },
          "application/octet-stream": {
            schema: { type: "string", format: "binary" },
          },
        },
      },
    },
  };
}
export const openAPI = {
  openapi: "3.1.0",
  info: { title: "MIRIAM multi-client API", version: "1.0.0" },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      nativeSession: {
        type: "http",
        scheme: "bearer",
        description:
          "Signed Better Auth session; cookie-less native requests only",
      },
      webSession: {
        type: "apiKey",
        in: "cookie",
        name: "better-auth.session_token",
        description:
          "Better Auth cookie (secure-prefixed on HTTPS); mutations also require the configured web Origin",
      },
    },
    schemas: Object.fromEntries(
      Object.entries(schemas).map(([name, schema]) => [
        name,
        z.toJSONSchema(schema),
      ]),
    ),
  },
  paths: {
    "/workspaces/{workspaceId}/milestones": {
      get: operation("ConversationMilestones", undefined, [
        workspace,
        parameter("first", "query", true, { type: "string", format: "uuid" }),
        parameter("last", "query", true, { type: "string", format: "uuid" }),
      ]),
    },
    "/workspaces/{workspaceId}/reading": {
      get: operation("PersonalReading", undefined, [workspace]),
      post: operation("ReadingReceipt", "ReadingInput", [workspace]),
    },
    "/direct-chats": {
      get: operation("DirectDirectory"),
      post: operation("DirectId", "DirectOpen"),
    },
    "/profile": {
      get: operation("ParticipantProfile"),
      post: operation("ParticipantProfile", "OwnProfileChange"),
    },
    "/workspaces/{workspaceId}/profiles/{personId}": {
      get: operation("ParticipantProfile", undefined, [
        workspace,
        parameter("personId", "path", true, { type: "string" }),
      ]),
    },
    "/direct-chats/{chatId}/profile": {
      get: operation("ParticipantProfile", undefined, [
        parameter("chatId", "path", true, { type: "string", format: "uuid" }),
      ]),
    },
    "/direct-chats/{chatId}": {
      parameters: [
        parameter("chatId", "path", true, { type: "string", format: "uuid" }),
      ],
      get: operation("DirectView"),
      post: operation("DirectReceipt", "DirectInput"),
    },
    "/direct-chats/{chatId}/photo": {
      get: {
        ...operation("DirectView", undefined, [
          parameter("chatId", "path", true, { type: "string", format: "uuid" }),
        ]),
        responses: {
          "200": {
            description: "Authorized contact photo",
            content: {
              "image/jpeg": { schema: { type: "string", format: "binary" } },
            },
          },
          default: operation("DirectView").responses.default,
        },
      },
    },
    "/direct-chats/{chatId}/files/{fileId}": {
      get: fileReadOperation(
        ["chatId", "fileId"].map((id) =>
          parameter(id, "path", true, { type: "string", format: "uuid" }),
        ),
      ),
    },
    "/workspaces/{workspaceId}/source-file": {
      get: fileReadOperation([
        workspace,
        parameter("id", "query", true, { type: "string", format: "uuid" }),
      ]),
    },
    "/identity-photos": {
      get: {
        ...operation("IdentityPhotos", undefined, [
          parameter("workspace", "query", false, {
            type: "string",
            format: "uuid",
          }),
          parameter("image", "query", false, { type: "string", enum: ["1"] }),
          parameter("person", "query", false, { type: "string" }),
        ]),
        responses: {
          ...operation("IdentityPhotos").responses,
          "200": {
            description:
              "Actor-scoped directory, or the authorized JPEG when image=1.",
            content: {
              "application/json": { schema: ref("IdentityPhotos") },
              "image/jpeg": { schema: { type: "string", format: "binary" } },
            },
          },
        },
      },
      post: operation("IdentityPhotoResult", "IdentityPhotoChange"),
    },
    "/contacts": {
      get: operation("PersonalContacts", undefined, [
        parameter("q", "query", false, { type: "string", maxLength: 120 }),
        parameter("offset", "query", false, { type: "integer", minimum: 0 }),
      ]),
    },
    "/invitations": { get: operation("IncomingInvitations") },
    "/invitations/{invitationId}/accept": {
      post: operation("AcceptedInvitation", "AcceptInvitation", [
        parameter("invitationId", "path", true, {
          type: "string",
          format: "uuid",
        }),
      ]),
    },
    "/beta-rules": {
      get: operation("BetaRules"),
      post: operation("BetaRules", "AcceptBetaRules"),
    },
    "/workspaces/{workspaceId}/schedule": {
      get: operation("WorkspaceSchedule", undefined, [
        parameter("workspaceId", "path", true, {
          type: "string",
          format: "uuid",
        }),
        parameter("mine", "query", false, { type: "boolean" }),
        parameter("limit", "query", false, {
          type: "integer",
          minimum: 1,
          maximum: 500,
        }),
      ]),
    },
    "/workspaces/{workspaceId}/tasks": {
      get: operation("Tasks", undefined, [
        workspace,
        parameter("focus", "query", false, { type: "string", format: "uuid" }),
        parameter("before", "query", false, { type: "string", format: "uuid" }),
      ]),
    },
    "/assistant-settings": {
      get: operation("AssistantSettings", undefined, [
        parameter("workspaceId", "query", false, {
          type: "string",
          format: "uuid",
        }),
      ]),
      post: operation("AssistantSettings", "SaveAssistantSettings"),
    },
    "/personal-chats": {
      get: operation("PersonalChatView", undefined, [
        parameter("thread", "query", false, { type: "string", format: "uuid" }),
        parameter("q", "query", false, { type: "string" }),
        parameter("offset", "query", false, { type: "integer", minimum: 0 }),
      ]),
      post: operation("PersonalChatReceipt", "PersonalChatInput"),
    },
    "/personal-space": {
      get: operation("PersonalHome"),
      post: operation("PersonalSpaceResult", "PersonalSpaceRequest"),
    },
    "/agenda/destination": {
      get: operation("AgendaDestination", undefined, [
        parameter("workspace", "query", true, {
          type: "string",
          format: "uuid",
        }),
      ]),
    },
    "/agenda": {
      get: operation("Agenda", undefined, [
        parameter("day", "query", true, { type: "string", format: "date" }),
        parameter("zone", "query", true, { type: "string" }),
      ]),
    },
    "/workspaces/{workspaceId}/task-comments": {
      get: operation("TaskComments", undefined, [
        workspace,
        parameter("id", "query", true, { type: "string", format: "uuid" }),
        parameter("before", "query", false, {
          type: "integer",
          minimum: 1,
          maximum: 2147483647,
        }),
      ]),
    },
    "/workspaces/{workspaceId}/tasks-history": {
      get: operation("TasksHistory", undefined, [
        workspace,
        parameter("id", "query", true, { type: "string", format: "uuid" }),
        parameter("kind", "query", true, {
          type: "string",
          enum: ["task", "followup"],
        }),
        parameter("before", "query", false, { type: "integer", minimum: 1 }),
        parameter(
          "beforeDeliveryVersion",
          "query",
          false,
          { type: "integer", minimum: 1 },
          "Paired with beforeDeliveryAt for follow-up receipts within the same version window.",
        ),
        parameter(
          "beforeDeliveryAt",
          "query",
          false,
          { type: "string", format: "date-time" },
          "Paired with beforeDeliveryVersion.",
        ),
      ]),
    },
    "/integrations/google/status": {
      get: operation("MailboxIntegrationStatus"),
    },
    "/integrations/microsoft/status": {
      get: operation("MailboxIntegrationStatus"),
    },
    "/workspaces/{workspaceId}/google-connect": {
      post: operation("IntegrationHandoff", "IntegrationRequest", [workspace]),
    },
    "/workspaces/{workspaceId}/microsoft-connect": {
      post: operation("IntegrationHandoff", "IntegrationRequest", [workspace]),
    },
    "/workspaces/{workspaceId}/email-compose": {
      post: operation("EmailComposition", "EmailComposeRequest", [workspace]),
    },
    "/workspaces/{workspaceId}/email": {
      get: operation("Email", undefined, [
        workspace,
        parameter("before", "query", false, { type: "string", format: "uuid" }),
        parameter("observationId", "query", false, {
          type: "string",
          format: "uuid",
        }),
      ]),
    },
    "/workspaces/{workspaceId}/email-history": {
      get: operation("EmailHistory", undefined, [
        workspace,
        parameter("draftId", "query", true, { type: "string", format: "uuid" }),
      ]),
    },
    "/workspaces/{workspaceId}/email-attachment": {
      get: {
        security: [{ nativeSession: [] }, { webSession: [] }],
        parameters: [
          workspace,
          parameter("id", "query", true, { type: "string", format: "uuid" }),
        ],
        responses: {
          "200": {
            description: "Private attachment bytes; download only",
            content: {
              "application/octet-stream": {
                schema: { type: "string", contentEncoding: "binary" },
              },
            },
          },
          default: { description: "Access denied or missing attachment" },
        },
      },
    },
    "/workspaces/{workspaceId}/calendar-history": {
      get: operation("CalendarHistory", undefined, [
        workspace,
        parameter("id", "query", true, { type: "string", format: "uuid" }),
        parameter("kind", "query", true, {
          type: "string",
          enum: ["action", "scheduled_event", "commitment"],
        }),
      ]),
    },
    "/workspaces/{workspaceId}/calendar": {
      get: operation("Calendar", undefined, [
        workspace,
        parameter("start", "query", true, {
          type: "string",
          format: "date-time",
        }),
        parameter("end", "query", true, {
          type: "string",
          format: "date-time",
        }),
        parameter("afterAction", "query", false, {
          type: "string",
          format: "uuid",
        }),
      ]),
    },
    "/native/push": {
      get: {
        ...operation("NativePushPreference", undefined, [
          parameter("workspace", "query", true, {
            type: "string",
            format: "uuid",
          }),
          parameter("provider", "query", true, {
            type: "string",
            enum: ["fcm", "apns"],
          }),
          parameter("device", "query", false, {
            type: "string",
            format: "uuid",
          }),
        ]),
        security: [{ nativeSession: [] }],
      },
      post: {
        ...operation("NativePushReceipt", "NativePushChange"),
        security: [{ nativeSession: [] }],
      },
    },
    "/native/push/target": {
      get: {
        ...operation(
          "NativePushTarget",
          undefined,
          ["id", "device"].map((k) =>
            parameter(k, "query", true, { type: "string", format: "uuid" }),
          ),
        ),
        security: [{ nativeSession: [] }],
      },
    },
    "/native/social/providers": {
      get: { ...operation("NativeSocialOptions"), security: [] },
    },
    "/native/social/accounts": { get: operation("NativeLinkedMethods") },
    "/native/social/exchange": {
      post: {
        ...operation("LoginResult", "NativeSocialExchange"),
        security: [],
      },
    },
    "/native/session": {
      post: { ...operation("LoginResult", "Login"), security: [] },
      get: { ...operation("Session"), security: [{ nativeSession: [] }] },
      delete: { ...operation("SignedOut"), security: [{ nativeSession: [] }] },
    },
    "/native/account": {
      post: {
        ...operation("NativeAccountResult", "NativeAccount"),
        security: [],
      },
    },
    "/workspaces": {
      get: operation("Workspaces"),
      post: operation("CreatedWorkspace", "CreateWorkspace"),
    },
    "/workspaces/{workspaceId}/state": {
      get: operation("State", undefined, [workspace]),
    },
    "/workspaces/{workspaceId}/attention": {
      get: operation("Attention", undefined, [
        workspace,
        parameter("before", "query", false, { type: "integer", minimum: 0 }),
      ]),
    },
    "/workspaces/{workspaceId}/project": {
      get: operation("Project", undefined, [workspace]),
    },
    "/workspaces/{workspaceId}/access": {
      get: operation("Access", undefined, [workspace]),
    },
    "/workspaces/{workspaceId}/access-history": {
      get: operation("AccessHistory", undefined, [
        workspace,
        parameter("id", "query", true, { type: "string", format: "uuid" }),
        parameter("before", "query", false, { type: "integer", minimum: 1 }),
      ]),
    },
    "/workspaces/{workspaceId}/voice": {
      get: operation("Voice", undefined, [workspace]),
    },
    "/workspaces/{workspaceId}/calls": {
      get: operation("Calls", undefined, [workspace]),
    },
    "/workspaces/{workspaceId}/call-connect": {
      post: operation("CallCredentials", "CallConnect", [workspace]),
    },
    "/workspaces/{workspaceId}/call-audio": {
      get: {
        ...operation("Error", undefined, [
          workspace,
          parameter("id", "query", true, { type: "string", format: "uuid" }),
        ]),
        responses: {
          "200": {
            description: "Authorized audio stream",
            content: {
              "audio/mpeg": { schema: { type: "string", format: "binary" } },
            },
          },
          "206": { description: "Authorized audio byte range" },
          "401": { description: "Authentication required" },
          "403": { description: "Workspace access denied" },
        },
      },
    },
    "/workspaces/{workspaceId}/active-work": {
      get: operation("ActiveWork", undefined, [
        workspace,
        parameter("workId", "query", false, { type: "string", format: "uuid" }),
        parameter("completion", "query", false, {
          type: "integer",
          minimum: 1,
        }),
        parameter("before", "query", false, { type: "string", format: "uuid" }),
      ]),
    },
    "/workspaces/{workspaceId}/active-work-history": {
      get: operation("ActiveWorkHistory", undefined, [
        workspace,
        parameter("id", "query", true, { type: "string", format: "uuid" }),
        parameter("before", "query", false, { type: "integer", minimum: 1 }),
      ]),
    },
    "/workspaces/{workspaceId}/active-work-presence": {
      get: operation("ActiveWorkPresence", undefined, [workspace]),
    },
    "/workspaces/{workspaceId}/handoffs": {
      get: operation("Handoffs", undefined, [
        workspace,
        parameter("sourceId", "query", false, {
          type: "string",
          format: "uuid",
        }),
      ]),
    },
    "/workspaces/{workspaceId}/beta-feedback": {
      get: operation("BetaFeedback", undefined, [workspace]),
    },
    "/workspaces/{workspaceId}/ai-usage": {
      get: operation("AIUsage", undefined, [
        workspace,
        parameter("days", "query", false, {
          type: "integer",
          enum: [7, 30],
          default: 30,
        }),
      ]),
    },
    "/workspaces/{workspaceId}/activity": {
      get: operation("Activity", undefined, [
        workspace,
        limit,
        parameter("before", "query", false, { type: "string" }),
      ]),
    },
    "/workspaces/{workspaceId}/reference": {
      get: operation("Reference", undefined, [
        workspace,
        parameter("kind", "query", true, { type: "string" }),
        parameter("id", "query", true, { type: "string", format: "uuid" }),
        parameter("version", "query", true, { type: "integer", minimum: 1 }),
        parameter("eventId", "query", false, { type: "string" }),
      ]),
    },
    "/workspaces/{workspaceId}/messages": {
      get: operation("Messages", undefined, [
        workspace,
        parameter("workstreamId", "query", false, {
          type: "string",
          format: "uuid",
        }),
        after,
        limit,
        parameter("through", "query", true, { type: "integer", minimum: 0 }),
      ]),
    },
    "/workspaces/{workspaceId}/history": {
      get: operation("History", undefined, [
        workspace,
        parameter("workstreamId", "query", false, {
          type: "string",
          format: "uuid",
        }),
        limit,
        parameter("before", "query", false, { type: "integer", minimum: 0 }),
        parameter("through", "query", true, { type: "integer", minimum: 0 }),
      ]),
    },
    "/workspaces/{workspaceId}/changes": {
      get: operation("Changes", undefined, [workspace, after, limit]),
    },
    "/workspaces/{workspaceId}/commands": {
      post: operation("Receipt", "CommandRequest", [workspace]),
    },
    "/workspaces/{workspaceId}/receipts/{commandId}": {
      get: operation("Receipt", undefined, [
        workspace,
        parameter("commandId", "path", true, {
          type: "string",
          format: "uuid",
        }),
      ]),
    },
    "/workspaces/{workspaceId}/events": {
      get: {
        ...operation("Changes", undefined, [
          workspace,
          after,
          parameter("Last-Event-ID", "header", false, { type: "integer" }),
        ]),
        description:
          "SSE data contains a Changes batch. Last-Event-ID is an HTTP header; after is the fallback cursor. A received event is not proof the client applied its state.",
        responses: {
          "200": {
            description: "Authorized reconnectable change hints",
            content: { "text/event-stream": { schema: { type: "string" } } },
          },
        },
      },
    },
  },
};
