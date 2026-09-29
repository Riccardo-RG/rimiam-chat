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
import { tasksViewSchema, tasksHistorySchema } from "./tasks.ts";
import {
  activeWorkViewSchema,
  activeWorkHistorySchema,
} from "./active-work.ts";
import { calendarViewSchema } from "./calendar.ts";
import {
  emailComposeRequestSchema,
  emailCompositionSchema,
  emailViewSchema,
} from "./email.ts";
import {
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
  Tasks: tasksViewSchema,
  TasksHistory: tasksHistorySchema,
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
  NativeAccount: nativeAccountSchema,
  NativeAccountResult: nativeAccountResultSchema,
  Workspaces: workspacesSchema,
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
) => ({ name, in: where, required, schema });
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
    "/beta-rules": {
      get: operation("BetaRules"),
      post: operation("BetaRules", "AcceptBetaRules"),
    },
    "/workspaces/{workspaceId}/tasks": {
      get: operation("Tasks", undefined, [
        workspace,
        parameter("before", "query", false, { type: "string", format: "uuid" }),
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
      ]),
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
