"use client";
import { useUiLanguage } from "./ui-language";
import type { Snapshot } from "./types";
import { errors } from "./api";

/** Processing incidents live apart from editorial proposals. Keep each retry
 * bound to its original interpretation, even when many share one cause. */
export function ContextReadings({
  state,
  chatFailures,
  disabled,
  openSource,
  retry,
}: {
  state: Pick<Snapshot, "interpretations" | "messages" | "sources">;
  chatFailures: Pick<ReadonlyMap<string, unknown>, "has">;
  disabled: boolean;
  openSource: (id: string) => void;
  retry: (id: string) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const waiting = state.interpretations.filter((r) =>
    ["queued", "running"].includes(r.status),
  ).length;
  const failed = state.interpretations.filter((r) =>
    ["failed", "stale"].includes(r.status),
  );
  if (!failed.length && !waiting) return null;
  const labels = new Map(
    state.messages.map((m) => [m.id, `Messaggio ${m.sequence}`]),
  );
  for (const s of state.sources) labels.set(s.id, s.title);
  const groups = new Map<string, typeof failed>();
  for (const reading of failed) {
    const key =
      reading.status === "stale" ? "stale" : reading.error_code || "failed";
    const group = groups.get(key) ?? [];
    group.push(reading);
    groups.set(key, group);
  }
  return (
    <aside
      className="context-readings"
      aria-label={uiText("Stato delle letture")}
    >
      {waiting > 0 && (
        <p role="status">
          {waiting === 1
            ? uiText("Una lettura in corso")
            : uiText("{0} letture in corso", String(waiting))}
        </p>
      )}
      {failed.length > 0 && (
        <details>
          <summary>
            {uiText("Letture da verificare ")}
            <span>{failed.length}</span>
          </summary>
          {[...groups].map(([key, items]) => (
            <section key={key}>
              <h4>
                {key === "AI_USAGE_LIMIT_REACHED"
                  ? uiText("Limite di utilizzo AI raggiunto")
                  : key === "stale"
                    ? uiText("Fonti cambiate dopo la lettura")
                    : uiText(errors[key] ?? "Lettura interrotta")}
              </h4>
              <ul>
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => openSource(item.source_id)}
                    >
                      {labels.get(item.source_id) ?? uiText("Apri fonte")}
                    </button>
                    {!chatFailures.has(item.source_id) && (
                      <button
                        type="button"
                        className="quiet"
                        disabled={disabled}
                        onClick={() => retry(item.id)}
                      >
                        {uiText("Riprova lettura")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </details>
      )}
    </aside>
  );
}
