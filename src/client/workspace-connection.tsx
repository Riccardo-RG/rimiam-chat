"use client";
import { useUiLanguage } from "./ui-language";
import type { WorkspaceConnection } from "./workspace-sync";

export function WorkspaceConnectionNotice({
  state,
  retry,
}: {
  state: WorkspaceConnection;
  retry: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  if (state === "live" || state === "loading") return null;
  return (
    <div className="connection-notice" data-state={state}>
      <p role="status">
        {state === "offline"
          ? uiText(
              "Sei offline. I contenuti potrebbero non essere aggiornati; la bozza resta in questa pagina.",
            )
          : state === "reconnecting"
            ? uiText(
                "Riconnessione agli aggiornamenti… Puoi continuare a leggere e preparare la tua bozza.",
              )
            : uiText(
                "Non riesco ad aggiornare lo spazio. I contenuti mostrati potrebbero non essere aggiornati.",
              )}
      </p>
      {state !== "offline" && (
        <button type="button" className="quiet" onClick={retry}>
          {uiText("Aggiorna lo spazio")}
        </button>
      )}
    </div>
  );
}
