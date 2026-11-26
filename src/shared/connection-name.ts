import type { AssistantSettings } from "../contracts/assistant-settings";

/** Describes the configured credential boundary, without guessing a tariff. */
export function connectionUsage(
  connection: Pick<
    AssistantSettings["connections"][number],
    "provider" | "configured"
  >,
  t: (source: string) => string,
) {
  if (!connection.configured) return t("Connessione inattiva. Nessun consumo.");
  if (connection.provider === "openai" || connection.provider === "anthropic")
    return t(
      "L’uso è a carico dell’account API configurato per questa installazione. Gli abbonamenti personali alla chat sono separati.",
    );
  if (connection.provider === "ollama")
    return t(
      "Le richieste usano il server Ollama scelto dal gestore. I costi dipendono da chi ospita il modello.",
    );
  return t(
    "Le richieste usano il servizio collegato dal gestore. La tariffa dipende da quel servizio.",
  );
}

export function customSpaceAssistantLabels(
  settings?: AssistantSettings | null,
) {
  const labels = new Map<string, string>();
  for (const space of settings?.managedSpaces ?? []) {
    const connection = settings?.connections.find(
      (entry) => entry.id === space.connectionId && entry.id !== "default",
    );
    const label = connection?.label ?? space.displayName;
    if (label !== "Emme") labels.set(space.workspaceId, label);
  }
  return labels;
}

/** User-defined connection names and the model identifier are opaque. */
export function connectionName(
  connection: { id: string; label: string },
  t: (source: string, ...values: string[]) => string,
): string {
  if (connection.id !== "default") return connection.label;
  const prefix = "Predefinito · ";
  if (connection.label === "Predefinito") return t("Predefinito");
  if (connection.label.startsWith(prefix))
    return t("Predefinito · {0}", connection.label.slice(prefix.length));
  return connection.label;
}
