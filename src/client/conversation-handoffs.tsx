"use client";

import { useEffect, useState } from "react";
import {
  conversationHandoffsSchema,
  type ConversationHandoff,
} from "@/contracts/conversation-handoff";
import { api, errorText } from "./api";

export function useConversationHandoffs(
  workspace: string,
  actor: string | undefined,
  revision: number,
) {
  const [result, setResult] = useState<{
    scope: string;
    handoffs: ConversationHandoff[];
    sourceId?: string;
    error?: string;
  }>();
  const [retry, setRetry] = useState(0);
  const [historical, setHistorical] = useState<{
    scope: string;
    sourceId: string;
  }>();
  const scope = `${actor}:${workspace}`;
  const sourceId =
    historical?.scope === scope ? historical.sourceId : undefined;
  useEffect(() => {
    if (!workspace || !actor) return;
    let live = true;
    void Promise.all([
      api<unknown>(`/api/v1/workspaces/${workspace}/handoffs`),
      ...(sourceId
        ? [
            api<unknown>(
              `/api/v1/workspaces/${workspace}/handoffs?sourceId=${encodeURIComponent(sourceId)}`,
            ),
          ]
        : []),
    ])
      .then((payloads) => {
        const handoffs = new Map<string, ConversationHandoff>();
        const rank = { navigation: 0, ready: 1, stale: 2, applied: 3 };
        for (const payload of payloads) {
          for (const h of conversationHandoffsSchema.parse(payload).handoffs) {
            const existing = handoffs.get(h.id);
            // Concurrent history/latest reads must not hide a recorded application
            // or restore a superseded version. The server still validates every act.
            if (!existing || rank[h.status] >= rank[existing.status])
              handoffs.set(h.id, h);
          }
        }
        if (live)
          setResult({ scope, handoffs: [...handoffs.values()], sourceId });
      })
      .catch((error: unknown) => {
        if (live) setResult({ scope, handoffs: [], error: errorText(error) });
      });
    return () => {
      live = false;
    };
  }, [workspace, actor, scope, revision, retry, sourceId]);
  return {
    handoffs: result?.scope === scope ? result.handoffs : [],
    error: result?.scope === scope ? result.error : undefined,
    sourceRead: result?.scope === scope ? result.sourceId : undefined,
    retry: () => setRetry((n) => n + 1),
    loadSource: (sourceId: string) => {
      setHistorical({ scope, sourceId });
      setRetry((n) => n + 1);
    },
  };
}

export const handoffDestination = (handoff: ConversationHandoff) => {
  if (handoff.kind.startsWith("goal.") || handoff.kind.startsWith("project."))
    return "goal";
  if (handoff.kind.startsWith("information.")) return "context";
  if (handoff.kind.startsWith("task.")) return "work";
  if (handoff.kind === "artifact.prepare") return "artifacts";
  if (handoff.kind === "email.prepare") return "email";
  return "calendar";
};

export function ConversationHandoffs({
  items,
  open,
}: {
  items: ConversationHandoff[];
  open: (handoff: ConversationHandoff) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="conversation-handoffs">
      {items.map((handoff) => (
        <article className="conversation-handoff" key={handoff.id}>
          <span className="eyebrow">
            {handoff.status === "applied"
              ? "PASSAGGIO REGISTRATO"
              : "PASSO PROPOSTO DA RIMIAM"}
          </span>
          <p>{handoff.summary}</p>
          <small>
            {handoff.status === "applied"
              ? handoff.application?.prepared
                ? "Proposta preparata. Le approvazioni e gli effetti rimangono distinti."
                : "Operazione registrata con il suo atto e la sua provenienza."
              : handoff.status === "stale"
                ? "Il riferimento è cambiato. La proposta richiede una nuova valutazione."
                : handoff.status === "navigation"
                  ? "Apri il percorso personale. Nessuna condivisione o azione esterna viene eseguita."
                  : "Aprire il controllo non accetta, assegna o autorizza nulla."}
          </small>
          <button type="button" className="quiet" onClick={() => open(handoff)}>
            {handoff.status === "applied"
              ? "Vedi il passaggio"
              : handoff.status === "stale"
                ? "Ispeziona il riferimento"
                : "Valuta questo passo"}{" "}
            ↗
          </button>
        </article>
      ))}
    </div>
  );
}

export function HandoffContext({
  handoff,
  source,
  close,
}: {
  handoff: ConversationHandoff;
  source: () => void;
  close: () => void;
}) {
  return (
    <aside
      className="handoff-context"
      aria-label="Richiesta dalla conversazione"
    >
      <strong>Dalla conversazione</strong>
      <p>{handoff.summary}</p>
      {handoff.status === "stale" && (
        <p role="alert">
          Questa proposta è superata. Torna al riferimento e chiedi di
          rivalutarla prima di applicarla.
        </p>
      )}
      <p className="hint">
        La preparazione conserva la richiesta originale. L’atto esplicito e i
        controlli di questa area mantengono i propri effetti.
      </p>
      <button className="quiet" onClick={source}>
        Messaggio di partenza
      </button>
      <button className="quiet" onClick={close}>
        Esci da questo percorso
      </button>
    </aside>
  );
}
