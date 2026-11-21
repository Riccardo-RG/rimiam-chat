"use client";
import { useUiLanguage } from "./ui-language";

import { ProductHelp } from "./product-help";
import { useState } from "react";
import type { WorkspaceLink } from "@/contracts/workspace-links";
import type { Command } from "@/contracts/commands";
export function WorkspaceLinks({
  id,
  spaces,
  links,
  change,
  open,
  busy,
}: {
  id: string;
  spaces: { id: string; name: string }[];
  links: WorkspaceLink[];
  change: (c: Command) => void;
  open: (id: string) => void;
  busy: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const [target, setTarget] = useState("");
  return (
    <section>
      <h3>{uiText("Spazi collegati")}</h3>
      <ProductHelp screen="workspace_links" />
      <p className="hint">
        {uiText(
          "Collegamenti visibili solo a chi accede a entrambi gli spazi. Nessun contenuto o permesso viene ereditato.",
        )}
      </p>
      {links
        .filter((l) => l.active)
        .map((l) => (
          <div key={l.id}>
            <button type="button" onClick={() => open(l.id)}>
              {l.name} ↗
            </button>
            <button
              type="button"
              className="quiet"
              disabled={busy}
              onClick={() =>
                change({
                  type: "workspace.link",
                  otherWorkspaceId: l.id,
                  expectedVersion: l.version,
                  linked: false,
                })
              }
            >
              {uiText("Scollega")}
            </button>
            <details>
              <summary>{uiText("Origine del collegamento")}</summary>
              {l.history.map((h) => (
                <p key={h.version}>
                  {uiText("v")}
                  {h.version} ·{" "}
                  {h.active ? uiText("Collegato") : uiText("Scollegato")} ·{" "}
                  {h.actor_id} · {h.created_at}
                </p>
              ))}
            </details>
          </div>
        ))}
      <label>
        {uiText("Altro spazio a cui partecipi")}
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">{uiText("Scegli uno spazio")}</option>
          {spaces
            .filter(
              (s) =>
                s.id !== id && !links.some((l) => l.id === s.id && l.active),
            )
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
      </label>
      <button
        type="button"
        disabled={busy || !target}
        onClick={() => {
          change({
            type: "workspace.link",
            otherWorkspaceId: target,
            expectedVersion: links.find((l) => l.id === target)?.version ?? 0,
            linked: true,
          });
          setTarget("");
        }}
      >
        {uiText("Collega gli spazi")}
      </button>
    </section>
  );
}
