import type {
  CalendarPayload,
  ExternalCalendarEvent,
} from "../contracts/calendar.ts";
import { z } from "zod";
import { googleConfiguration } from "./google-credentials.ts";
import { googleCalendarProvider } from "./google-calendar.ts";

export interface CalendarAccess {
  connectionId: string;
  accountRef: string;
  resourceId: string;
}
export interface CalendarEffect {
  operationKey: string;
  operation: "create" | "update";
  payload: CalendarPayload;
  externalId?: string;
  expectedRevision?: string;
}
export interface CalendarResource {
  id: string;
  label: string;
  canRead: boolean;
  // True only when the adapter has verified personal control, not merely write permission.
  canWriteSelf: boolean;
}
export const calendarResourceResultSchema = z
  .object({
    id: z.string().min(1).max(1000),
    label: z.string().min(1).max(200),
    canRead: z.boolean(),
    canWriteSelf: z.boolean(),
  })
  .strict();
export type CalendarReconciliation =
  | { outcome: "applied"; event: ExternalCalendarEvent }
  | { outcome: "not_applied"; proof: string }
  | { outcome: "unknown" };
export interface CalendarProvider {
  readonly key: string;
  discover(
    accountRef: string,
    signal: AbortSignal,
  ): Promise<CalendarResource[]>;
  checkAccess(
    access: CalendarAccess,
    signal: AbortSignal,
  ): Promise<CalendarResource>;
  read(
    access: CalendarAccess,
    request: {
      mode: "events" | "availability";
      start: string;
      end: string;
      cursor?: string;
    },
    signal: AbortSignal,
  ): Promise<{
    events: ExternalCalendarEvent[];
    busy: { start: string; end: string; timeZone: string }[];
    complete: boolean;
    nextCursor: string | null;
  }>;
  fetch(
    access: CalendarAccess,
    eventId: string,
    signal: AbortSignal,
  ): Promise<ExternalCalendarEvent | null>;
  // Adapter MUST use operationKey for durable duplicate prevention. Update MUST be conditional.
  // No attendees, invitations, notification side effects, recurring series or arbitrary provider payloads.
  create(
    access: CalendarAccess,
    effect: CalendarEffect,
    signal: AbortSignal,
  ): Promise<ExternalCalendarEvent>;
  update(
    access: CalendarAccess,
    effect: CalendarEffect,
    signal: AbortSignal,
  ): Promise<ExternalCalendarEvent>;
  // "not_applied" is positive proof that no pending request can still apply. A missing search result is insufficient.
  // "applied" requires evidence for this operationKey, not just similar content/time.
  reconcile(
    access: CalendarAccess,
    effect: CalendarEffect,
    signal: AbortSignal,
  ): Promise<CalendarReconciliation>;
}

// Only an adapter that proves no effect occurred may throw this. Network/timeouts default to unknown.
export class CalendarNoEffect extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function configuredCalendarProvider(): CalendarProvider | undefined {
  return googleConfiguration() ? googleCalendarProvider() : undefined;
}
