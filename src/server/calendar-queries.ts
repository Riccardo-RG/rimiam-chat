import { z } from "zod";
import { transaction } from "./db.ts";
import { member } from "./workspace-state.ts";
import { requireThat } from "./errors.ts";
import {
  calendarViewSchema,
  type CalendarView,
} from "../contracts/calendar.ts";
import {
  payloadEqual,
  rowPayload,
  temporalAt,
  temporalReference,
} from "./calendar-state.ts";
import { configuredCalendarProvider } from "./calendar-provider.ts";

export async function calendarView(
  actor: string,
  w: string,
  start: string,
  end: string,
  after?: string,
): Promise<CalendarView> {
  z.iso.datetime({ offset: true }).parse(start);
  z.iso.datetime({ offset: true }).parse(end);
  requireThat(
    Date.parse(end) > Date.parse(start) &&
      Date.parse(end) - Date.parse(start) <= 31 * 86400000,
    "CALENDAR_READ_WINDOW_INVALID",
    400,
  );
  if (after) z.uuid().parse(after);
  return transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await member(tx, w, actor);
    const ws = (
      await tx.query(
        "SELECT revision,context_revision,access_revision FROM workspace WHERE id=$1",
        [w],
      )
    ).rows[0];
    const scheduled = (
      await tx.query(
        `SELECT e.id,e.person_id,v.* FROM scheduled_event e JOIN scheduled_event_version v ON v.workspace_id=e.workspace_id AND v.event_id=e.id AND v.version=e.current_version
      WHERE e.workspace_id=$1 AND v.starts_at<$3 AND v.ends_at>$2 ORDER BY v.starts_at,e.id`,
        [w, start, end],
      )
    ).rows;
    const commitments = (
      await tx.query(
        `SELECT p.id,p.content AS title,v.*,v.actor_id AS person_id FROM commitment_time t JOIN normative_proposal p ON p.id=t.proposal_id JOIN current_project_act a ON (a.workspace_id,a.proposal_id)=(p.workspace_id,p.id)
      JOIN commitment_time_version v ON v.workspace_id=t.workspace_id AND v.proposal_id=t.proposal_id AND v.version=t.current_version WHERE t.workspace_id=$1 AND v.starts_at<$3 AND v.ends_at>$2 ORDER BY v.starts_at,p.id`,
        [w, start, end],
      )
    ).rows;
    const temporal: CalendarView["temporal"] = [
      ...scheduled.map((r) => ({ ...r, kind: "scheduled_event" })),
      ...commitments.map((r) => ({ ...r, kind: "commitment" })),
    ].map((r) => ({
      kind: r.kind,
      id: r.id,
      version: r.version,
      personId: r.person_id,
      payload: rowPayload(r),
      reason: r.reason,
      sourceMessageId: r.source_message_id ?? null,
      createdAt: new Date(r.created_at).toISOString(),
    }));
    const connections = (
      await tx.query(
        `SELECT c.* FROM calendar_connection c JOIN membership m ON m.workspace_id=c.workspace_id AND m.user_id=c.person_id
      WHERE c.workspace_id=$1 AND c.person_id=$2 AND c.membership_version=m.version`,
        [w, actor],
      )
    ).rows;
    const resources = (
      await tx.query(
        "SELECT r.* FROM calendar_resource r JOIN calendar_connection c ON c.id=r.connection_id WHERE r.workspace_id=$1 AND c.person_id=$2",
        [w, actor],
      )
    ).rows;
    const actions = (
      await tx.query(
        `SELECT a.*,v.*,a.id,(SELECT name FROM "user" WHERE id=v.person_id) AS person_name FROM calendar_action a JOIN calendar_action_version v ON v.workspace_id=a.workspace_id AND v.action_id=a.id AND v.version=a.current_version
      WHERE a.workspace_id=$1 AND ($2::uuid IS NULL OR a.id>$2) ORDER BY a.id LIMIT 101`,
        [w, after ?? null],
      )
    ).rows;
    const reads = (
      await tx.query(
        "SELECT id,status,error_code FROM calendar_read WHERE workspace_id=$1 AND person_id=$2 ORDER BY created_at DESC LIMIT 20",
        [w, actor],
      )
    ).rows;
    const observations = (
      await tx.query(
        `SELECT o.*,r.mode,r.starts_at,r.ends_at FROM calendar_observation o JOIN calendar_read r ON r.id=o.read_id
      JOIN calendar_connection c ON c.id=r.connection_id JOIN membership m ON m.workspace_id=c.workspace_id AND m.user_id=c.person_id
      WHERE o.workspace_id=$1 AND o.person_id=$2 AND c.active AND c.version=r.connection_version AND m.version=r.membership_version
      AND (r.mode='reconcile' OR (r.starts_at<$4 AND r.ends_at>$3)) ORDER BY o.observed_at DESC LIMIT 50`,
        [w, actor, start, end],
      )
    ).rows;
    const publications = (
      await tx.query(
        "SELECT p.* FROM calendar_publication p JOIN calendar_connection c ON c.id=p.connection_id WHERE p.workspace_id=$1 AND c.person_id=$2",
        [w, actor],
      )
    ).rows;
    const alerts: CalendarView["alerts"] = [];
    const candidates = temporal.map((t) => ({
      key: `${t.kind}:${t.id}`,
      payload: t.payload,
    }));
    const observed = new Map<
      string,
      {
        resourceId: string;
        event: CalendarView["observations"][number]["data"]["events"][number];
      }
    >();
    for (const o of observations)
      for (const event of o.data.events) {
        const key = `${o.resource_id}:${event.id}`;
        if (!observed.has(key))
          observed.set(key, { resourceId: o.resource_id, event });
      }
    for (const p of publications) {
      const obs = observed.get(`${p.resource_id}:${p.external_id}`)?.event;
      if (
        obs &&
        (obs.deleted || !payloadEqual(obs.payload, p.published_payload))
      )
        alerts.push({
          kind: "external_divergence",
          first: p.id,
          second: p.external_id,
          detail:
            "La rappresentazione esterna differisce dall’ultima pubblicazione. Lo stato interno non è stato modificato.",
        });
      if (p.temporal_id) {
        try {
          const t = await temporalAt(tx, w, {
            kind: p.temporal_kind,
            id: p.temporal_id,
            version: p.temporal_version,
          });
          if (!payloadEqual(t.payload, p.published_payload))
            throw new Error("changed");
        } catch {
          alerts.push({
            kind: "internal_divergence",
            first: p.id,
            second: p.temporal_id,
            detail:
              "Lo stato interno ha una versione diversa da quella pubblicata. Nessun aggiornamento esterno automatico.",
          });
        }
      }
    }
    for (const { resourceId, event } of observed.values()) {
      if (
        event.deleted ||
        Date.parse(event.payload.end) <= Date.parse(start) ||
        Date.parse(event.payload.start) >= Date.parse(end)
      )
        continue;
      const linked = publications.find(
        (p) => p.resource_id === resourceId && p.external_id === event.id,
      );
      // A changed representation can overlap other events, but remains the same logical identity.
      candidates.push({
        key: linked?.temporal_id
          ? `${linked.temporal_kind}:${linked.temporal_id}`
          : `external:${resourceId}:${event.id}`,
        payload: event.payload,
      });
    }
    const overlapPairs = new Set<string>();
    for (let i = 0; i < candidates.length; i++)
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i],
          b = candidates[j];
        const pair = [a.key, b.key].sort().join("|");
        if (a.key === b.key || overlapPairs.has(pair)) continue;
        if (
          Date.parse(a.payload.start) < Date.parse(b.payload.end) &&
          Date.parse(b.payload.start) < Date.parse(a.payload.end)
        ) {
          overlapPairs.add(pair);
          alerts.push({
            kind: "overlap",
            first: a.key,
            second: b.key,
            detail:
              "Possibile sovrapposizione temporale; identità distinte, nessuna modifica o fusione automatica.",
          });
        }
      }
    const view = calendarViewSchema.parse({
      workspaceId: w,
      revision: ws.revision,
      contextRevision: ws.context_revision,
      accessRevision: ws.access_revision,
      providerConfigured: Boolean(configuredCalendarProvider()),
      ownCommitments: (
        await tx.query(
          `SELECT p.id,p.content,coalesce(t.current_version,0) AS version FROM normative_proposal p JOIN current_project_act a ON (a.workspace_id,a.proposal_id)=(p.workspace_id,p.id) LEFT JOIN commitment_time t ON (t.workspace_id,t.proposal_id)=(p.workspace_id,p.id) WHERE p.workspace_id=$1 AND p.kind='commitment' AND (SELECT array_agg(r.person_id) FROM required_project_approval r WHERE r.workspace_id=p.workspace_id AND r.proposal_id=p.id)=ARRAY[$2::text] ORDER BY p.id`,
          [w, actor],
        )
      ).rows,
      window: { start, end },
      temporal,
      connections: connections.map((c) => ({
        id: c.id,
        version: c.version,
        label: c.label,
        active: c.active,
        resources: resources
          .filter((r) => r.connection_id === c.id)
          .map((r) => ({
            id: r.id,
            version: r.version,
            label: r.label,
            canRead: r.can_read,
            canWriteSelf: r.can_write_self,
          })),
      })),
      actions: actions.slice(0, 100).map((a) => {
        const mine = a.person_id === actor,
          connection = connections.find(
            (c) =>
              c.id === a.connection_id &&
              c.active &&
              c.version === a.connection_version,
          );
        return {
          id: a.id,
          version: a.current_version,
          status: a.status,
          personId: a.person_id,
          personName: a.person_name,
          proposedBy: a.proposed_by,
          connectionId: a.connection_id,
          resourceId: a.resource_id,
          target: a.target_label,
          operation: a.operation,
          payload: a.payload,
          temporal: temporalReference(a) ?? null,
          reason: a.reason,
          createdAt: new Date(a.created_at).toISOString(),
          error: a.error_code,
          externalId: a.external_id,
          canAuthorize:
            mine &&
            Boolean(connection) &&
            ["PROPOSED", "FAILED"].includes(a.status),
          canReject:
            mine && ["PROPOSED", "AUTHORIZED", "FAILED"].includes(a.status),
          canRetry:
            mine &&
            Boolean(connection) &&
            a.status === "FAILED" &&
            a.safe_to_retry,
          canReconcile:
            mine &&
            Boolean(connection) &&
            ["SUCCEEDED", "OUTCOME_UNKNOWN"].includes(a.status),
        };
      }),
      nextActions: actions.length > 100 ? actions[99].id : null,
      publications: publications.map((p) => ({
        id: p.id,
        connectionId: p.connection_id,
        resourceId: p.resource_id,
        externalId: p.external_id,
        temporal: temporalReference(p) ?? null,
      })),
      observations: observations.map((o) => ({
        id: o.id,
        resourceId: o.resource_id,
        mode: o.mode,
        start: o.starts_at ? new Date(o.starts_at).toISOString() : start,
        end: o.ends_at ? new Date(o.ends_at).toISOString() : end,
        observedAt: new Date(o.observed_at).toISOString(),
        data: o.data,
      })),
      reads: reads.map((r) => ({
        id: r.id,
        status: r.status,
        error: r.error_code,
      })),
      alerts,
    });
    return view;
  });
}

// Inspect immutable shared acts without exposing session IDs, credential references or private observations.
export async function calendarHistory(
  actor: string,
  w: string,
  id: string,
  kind: "action" | "scheduled_event" | "commitment",
) {
  z.uuid().parse(id);
  return transaction(async (tx) => {
    await member(tx, w, actor);
    if (kind === "action") {
      const versions = (
        await tx.query(
          "SELECT version,proposed_by,target_label,operation,payload,reason,source_message_id,precondition_observation_id,created_at FROM calendar_action_version WHERE workspace_id=$1 AND action_id=$2 ORDER BY version",
          [w, id],
        )
      ).rows;
      requireThat(versions.length, "CALENDAR_ACTION_NOT_FOUND", 404);
      const transitions = (
        await tx.query(
          "SELECT status,action_version,actor_id,detail,created_at FROM calendar_transition WHERE workspace_id=$1 AND action_id=$2 ORDER BY created_at,id",
          [w, id],
        )
      ).rows;
      const approvals = (
        await tx.query(
          "SELECT action_version,person_id,context_revision,access_revision,created_at FROM calendar_authorization WHERE workspace_id=$1 AND action_id=$2 ORDER BY created_at",
          [w, id],
        )
      ).rows;
      return { versions, transitions, approvals };
    }
    const table =
        kind === "scheduled_event"
          ? "scheduled_event_version"
          : "commitment_time_version",
      key = kind === "scheduled_event" ? "event_id" : "proposal_id";
    const versions = (
      await tx.query(
        `SELECT * FROM ${table} WHERE workspace_id=$1 AND ${key}=$2 ORDER BY version`,
        [w, id],
      )
    ).rows;
    requireThat(versions.length, "TEMPORAL_NOT_FOUND", 404);
    return { versions };
  });
}
