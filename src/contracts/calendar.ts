import { z } from "zod";

const version = z.number().int().positive();
const revision = z.number().int().nonnegative();
export const calendarTimeSchema = z
  .object({
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
    timeZone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Unknown IANA time zone"),
  })
  .strict()
  .refine(
    (v) => Date.parse(v.end) > Date.parse(v.start),
    "End must follow start",
  );
export const calendarPayloadSchema = calendarTimeSchema
  .safeExtend({
    title: z.string().trim().min(1).max(12000),
  })
  .strict();
export const temporalRefSchema = z
  .object({
    kind: z.enum(["scheduled_event", "commitment"]),
    id: z.uuid(),
    version,
  })
  .strict();
const reason = z.string().trim().min(1).max(2000);
const temporalFields = {
  payload: calendarPayloadSchema,
  reason,
  sourceMessageId: z.uuid().optional(),
  representSelf: z.literal(true),
  expectedContextRevision: revision,
};
const proposalFields = {
  connectionId: z.uuid(),
  resourceId: z.uuid(),
  operation: z.enum(["create", "update"]),
  publicationId: z.uuid().optional(),
  temporal: temporalRefSchema.optional(),
  payload: calendarPayloadSchema,
  reason,
  sourceMessageId: z.uuid().optional(),
  shareWithWorkspace: z.literal(true),
};
export const calendarCommandSchemas = [
  z.object({ type: z.literal("temporal.create"), ...temporalFields }).strict(),
  z
    .object({
      type: z.literal("temporal.revise"),
      eventId: z.uuid(),
      expectedVersion: version,
      sourceObservationId: z.uuid().optional(),
      shareObservedContent: z.literal(true).optional(),
      ...temporalFields,
    })
    .strict(),
  z
    .object({
      type: z.literal("commitment.time.set"),
      commitmentId: z.uuid(),
      expectedVersion: revision,
      time: calendarTimeSchema,
      reason,
      representSelf: z.literal(true),
      expectedContextRevision: revision,
    })
    .strict(),
  z.object({ type: z.literal("calendar.propose"), ...proposalFields }).strict(),
  z
    .object({
      type: z.literal("calendar.revise"),
      actionId: z.uuid(),
      expectedVersion: version,
      ...proposalFields,
    })
    .strict(),
  z
    .object({
      type: z.literal("calendar.authorize"),
      actionId: z.uuid(),
      version,
      expectedContextRevision: revision,
      expectedAccessRevision: revision,
      representSelf: z.literal(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("calendar.reject"),
      actionId: z.uuid(),
      version,
      reason,
    })
    .strict(),
  z
    .object({ type: z.literal("calendar.retry"), actionId: z.uuid(), version })
    .strict(),
  z
    .object({
      type: z.literal("calendar.reconcile"),
      actionId: z.uuid(),
      version,
    })
    .strict(),
  z
    .object({
      type: z.literal("calendar.read"),
      connectionId: z.uuid(),
      resourceId: z.uuid(),
      mode: z.enum(["events", "availability"]),
      start: z.iso.datetime({ offset: true }),
      end: z.iso.datetime({ offset: true }),
      cursor: z.string().max(2000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("calendar.disconnect"),
      connectionId: z.uuid(),
      expectedVersion: version,
    })
    .strict(),
] as const;
export const calendarCommandSchema = z.discriminatedUnion(
  "type",
  calendarCommandSchemas,
);
export type CalendarCommand = z.infer<typeof calendarCommandSchema>;
export type CalendarPayload = z.infer<typeof calendarPayloadSchema>;
export type TemporalRef = z.infer<typeof temporalRefSchema>;
export const calendarStatusSchema = z.enum([
  "PROPOSED",
  "AUTHORIZED",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "OUTCOME_UNKNOWN",
  "REJECTED",
]);
export const externalEventSchema = z
  .object({
    id: z.string().min(1).max(1000),
    revision: z.string().min(1).max(1000),
    payload: calendarPayloadSchema,
    operationKey: z.string().max(200).optional(),
    // The adapter must explicitly establish that replacing supported fields cannot notify or bind third parties.
    selfOnly: z.boolean(),
    deleted: z.boolean().default(false),
  })
  .strict();
export type ExternalCalendarEvent = z.infer<typeof externalEventSchema>;
export const observationDataSchema = z
  .object({
    events: z.array(externalEventSchema).max(200),
    busy: z.array(calendarTimeSchema).max(200),
    complete: z.boolean(),
    nextCursor: z.string().max(2000).nullable(),
  })
  .strict();
export const calendarViewSchema = z.object({
  workspaceId: z.uuid(),
  revision,
  contextRevision: revision,
  accessRevision: revision,
  providerConfigured: z.boolean(),
  ownCommitments: z
    .array(z.object({ id: z.uuid(), content: z.string(), version: revision }))
    .default([]),
  window: z.object({ start: z.string(), end: z.string() }),
  temporal: z.array(
    z.object({
      kind: z.enum(["scheduled_event", "commitment"]),
      id: z.uuid(),
      version,
      personId: z.string(),
      payload: calendarPayloadSchema,
      reason: z.string(),
      sourceMessageId: z.uuid().nullable(),
      createdAt: z.string(),
    }),
  ),
  connections: z.array(
    z.object({
      id: z.uuid(),
      version,
      label: z.string(),
      active: z.boolean(),
      resources: z.array(
        z.object({
          id: z.uuid(),
          version,
          label: z.string(),
          canRead: z.boolean(),
          canWriteSelf: z.boolean(),
        }),
      ),
    }),
  ),
  actions: z.array(
    z.object({
      id: z.uuid(),
      version,
      status: calendarStatusSchema,
      personId: z.string(),
      personName: z.string(),
      proposedBy: z.string(),
      connectionId: z.uuid(),
      resourceId: z.uuid(),
      target: z.string(),
      operation: z.enum(["create", "update"]),
      payload: calendarPayloadSchema,
      temporal: temporalRefSchema.nullable(),
      reason: z.string(),
      createdAt: z.string(),
      error: z.string().nullable(),
      externalId: z.string().nullable(),
      canAuthorize: z.boolean(),
      canReject: z.boolean(),
      canRetry: z.boolean(),
      canReconcile: z.boolean(),
    }),
  ),
  nextActions: z.uuid().nullable(),
  publications: z.array(
    z.object({
      id: z.uuid(),
      connectionId: z.uuid(),
      resourceId: z.uuid(),
      externalId: z.string(),
      temporal: temporalRefSchema.nullable(),
    }),
  ),
  observations: z.array(
    z.object({
      id: z.uuid(),
      resourceId: z.uuid(),
      mode: z.string(),
      start: z.string(),
      end: z.string(),
      observedAt: z.string(),
      data: observationDataSchema,
    }),
  ),
  reads: z.array(
    z.object({
      id: z.uuid(),
      status: z.string(),
      error: z.string().nullable(),
    }),
  ),
  alerts: z.array(
    z.object({
      kind: z.enum(["overlap", "external_divergence", "internal_divergence"]),
      first: z.string(),
      second: z.string(),
      detail: z.string(),
    }),
  ),
});
export type CalendarView = z.infer<typeof calendarViewSchema>;
