// Deterministic external service double. Never imported by production runtime.
import { createHash } from "node:crypto";
import {
  CalendarNoEffect,
  type CalendarAccess,
  type CalendarEffect,
  type CalendarProvider,
  type CalendarReconciliation,
} from "../../src/server/calendar-provider";
import type { ExternalCalendarEvent } from "../../src/contracts/calendar";
export class FixtureCalendar implements CalendarProvider {
  readonly key = "calendar-test-double";
  events = new Map<string, ExternalCalendarEvent>();
  receipts = new Map<string, ExternalCalendarEvent>();
  writes = 0;
  checks = 0;
  allow = true;
  loseResponse = false;
  proveAbsence = false;
  beforeCheck?: () => Promise<void>;
  afterWrite?: () => Promise<void>;
  async discover() {
    return [
      {
        id: "personal",
        label: "Calendario personale di test",
        canRead: true,
        canWriteSelf: true,
      },
      {
        id: "shared",
        label: "Calendario condiviso leggibile",
        canRead: true,
        canWriteSelf: false,
      },
    ];
  }
  async checkAccess(a: CalendarAccess) {
    this.checks++;
    await this.beforeCheck?.();
    return {
      id: a.resourceId,
      label: "Test",
      canRead: this.allow,
      canWriteSelf: this.allow && a.resourceId === "personal",
    };
  }
  keyFor(a: CalendarAccess, id: string) {
    return `${a.accountRef}:${a.resourceId}:${id}`;
  }
  async read(
    a: CalendarAccess,
    r: {
      start: string;
      end: string;
      mode: "events" | "availability";
      cursor?: string;
    },
  ) {
    const events = [...this.events.entries()]
      .filter(
        ([k, e]) =>
          k.startsWith(`${a.accountRef}:${a.resourceId}:`) &&
          !e.deleted &&
          Date.parse(e.payload.start) < Date.parse(r.end) &&
          Date.parse(e.payload.end) > Date.parse(r.start),
      )
      .map(([, e]) => structuredClone(e));
    return {
      events: r.mode === "events" ? events : [],
      busy:
        r.mode === "availability"
          ? events.map((e) => ({
              start: e.payload.start,
              end: e.payload.end,
              timeZone: e.payload.timeZone,
            }))
          : [],
      complete: true,
      nextCursor: null,
    };
  }
  async fetch(a: CalendarAccess, id: string) {
    return structuredClone(this.events.get(this.keyFor(a, id)) ?? null);
  }
  async create(a: CalendarAccess, e: CalendarEffect) {
    return this.write(a, e);
  }
  async update(a: CalendarAccess, e: CalendarEffect) {
    return this.write(a, e);
  }
  async write(a: CalendarAccess, e: CalendarEffect) {
    const key = this.keyFor(a, e.operationKey),
      receipt = this.receipts.get(key);
    if (receipt) return structuredClone(receipt);
    const id =
        e.externalId ??
        createHash("sha256").update(key).digest("hex").slice(0, 32),
      old = this.events.get(this.keyFor(a, id));
    if (
      e.operation === "update" &&
      (!old || old.revision !== e.expectedRevision)
    )
      throw new CalendarNoEffect("CALENDAR_EXTERNAL_PRECONDITION_CHANGED");
    this.writes++;
    const event = {
      id,
      revision: String(Number(old?.revision ?? 0) + 1),
      payload: structuredClone(e.payload),
      operationKey: e.operationKey,
      selfOnly: true,
      deleted: false,
    };
    this.events.set(this.keyFor(a, id), event);
    this.receipts.set(key, structuredClone(event));
    await this.afterWrite?.();
    if (this.loseResponse || e.payload.title.includes("[response-loss]"))
      throw new Error("Response lost after commit");
    return structuredClone(event);
  }
  async reconcile(
    a: CalendarAccess,
    e: CalendarEffect,
  ): Promise<CalendarReconciliation> {
    const event = this.receipts.get(this.keyFor(a, e.operationKey));
    return event
      ? { outcome: "applied", event: structuredClone(event) }
      : this.proveAbsence
        ? {
            outcome: "not_applied",
            proof: "Test service guarantees no accepted or in-flight request",
          }
        : { outcome: "unknown" };
  }
}
