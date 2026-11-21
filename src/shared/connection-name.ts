import type { AssistantSettings } from "../contracts/assistant-settings";

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
