"use client";
import type { CalendarView, CalendarCommand } from "@/contracts/calendar";
export function CalendarRevision({
  view,
  action,
  actor,
  perform,
  busy,
}: {
  view: CalendarView;
  action: CalendarView["actions"][number];
  actor: string;
  perform: (c: CalendarCommand) => Promise<void>;
  busy: boolean;
}) {
  const temporal = view.temporal.find(
    (t) => t.id === action.temporal?.id && t.kind === action.temporal?.kind,
  );
  const publication = view.publications.find(
    (p) =>
      p.connectionId === action.connectionId &&
      p.resourceId === action.resourceId &&
      p.temporal?.id === temporal?.id &&
      p.temporal?.kind === temporal?.kind,
  );
  if (
    !temporal ||
    action.proposedBy !== actor ||
    action.personId !== actor ||
    !["PROPOSED", "AUTHORIZED", "FAILED"].includes(action.status) ||
    (action.operation === "update" && !publication)
  )
    return null;
  return (
    <details>
      <summary>Rivedi la proposta Calendar</summary>
      <p>
        {temporal.payload.title} ·{" "}
        {new Date(temporal.payload.start).toLocaleString()} →{" "}
        {new Date(temporal.payload.end).toLocaleString()} ·{" "}
        {temporal.payload.timeZone}
      </p>
      <p className="hint">
        Crea una nuova versione dalla situazione interna corrente; ogni
        autorizzazione precedente decade. Nessuna scrittura esterna.
      </p>
      <button
        disabled={busy}
        onClick={() =>
          void perform({
            type: "calendar.revise",
            actionId: action.id,
            expectedVersion: action.version,
            connectionId: action.connectionId,
            resourceId: action.resourceId,
            operation: action.operation,
            ...(action.operation === "update"
              ? { publicationId: publication!.id }
              : {}),
            temporal: {
              id: temporal.id,
              kind: temporal.kind,
              version: temporal.version,
            },
            payload: temporal.payload,
            reason: "Riallineamento esplicito alla versione interna corrente",
            shareWithWorkspace: true,
          })
        }
      >
        Riallinea questa proposta alla versione interna
      </button>
    </details>
  );
}
