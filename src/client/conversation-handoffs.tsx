"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useState } from "react";
import {
  conversationHandoffsSchema,
  type ConversationHandoff,
} from "@/contracts/conversation-handoff";
import { api, errorText } from "./api";
import { EmmeMessageMark } from "./brand-signature";
import { WorkspaceIcon } from "./workspace-icon";

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

function handoffLabel(handoff: ConversationHandoff) {
  if (handoff.status === "applied")
    return handoff.application?.prepared
      ? "Proposta preparata"
      : "Passaggio registrato";
  if (handoff.status === "stale") return "Suggerimento da rivedere";
  return "Suggerimento di Emme";
}

export function ConversationHandoffs({
  items,
  open,
}: {
  items: ConversationHandoff[];
  open: (handoff: ConversationHandoff) => void;
}) {
  const { t: uiText } = useUiLanguage();
  if (!items.length) return null;
  return (
    <details className="conversation-handoffs">
      <summary>
        <EmmeMessageMark />
        {items.length === 1
          ? handoffLabel(items[0])
          : uiText("{0} passaggi di Emme", String(items.length))}
        <WorkspaceIcon name="chevron" />
      </summary>
      <ul>
        {items.map((handoff) => (
          <li key={handoff.id}>
            {items.length > 1 && <strong>{handoffLabel(handoff)}</strong>}
            <p>{handoff.summary}</p>
            <small>
              {handoff.status === "applied"
                ? handoff.application?.prepared
                  ? uiText(
                      "La proposta è pronta. Le eventuali approvazioni si verificano nel dettaglio.",
                    )
                  : uiText(
                      "Puoi consultare l’atto registrato e la sua origine.",
                    )
                : handoff.status === "stale"
                  ? uiText(
                      "Il riferimento è cambiato dopo questo suggerimento.",
                    )
                  : handoff.status === "navigation"
                    ? uiText(
                        "Si apre il tuo percorso personale. Sei tu a scegliere cosa condividere o inviare.",
                      )
                    : uiText(
                        "Puoi esaminare il suggerimento e decidere se confermarlo.",
                      )}
            </small>
            <button
              type="button"
              className="quiet"
              onClick={() => open(handoff)}
            >
              {handoff.status === "applied"
                ? uiText("Vedi il passaggio")
                : handoff.status === "stale"
                  ? uiText("Vedi il riferimento")
                  : handoff.status === "navigation"
                    ? uiText("Apri il percorso personale")
                    : uiText("Valuta il suggerimento")}
            </button>
          </li>
        ))}
      </ul>
    </details>
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
  const { t: uiText } = useUiLanguage();
  return (
    <aside
      className="handoff-context"
      aria-label={uiText("Richiesta dalla conversazione")}
    >
      <strong>{uiText("Dalla conversazione")}</strong>
      <p>{handoff.summary}</p>
      {handoff.status === "stale" && (
        <p role="alert">
          {uiText(
            "Questa proposta è superata. Torna al riferimento e chiedi di rivalutarla prima di applicarla.",
          )}
        </p>
      )}
      <p className="hint">
        {uiText(
          "La richiesta originale resta in chat. Qui puoi controllare i dettagli prima di confermare.",
        )}
      </p>
      <button className="quiet" onClick={source}>
        {uiText("Messaggio di partenza")}
      </button>
      <button className="quiet" onClick={close}>
        {uiText("Esci da questo percorso")}
      </button>
    </aside>
  );
}
