"use client";
import { useUiLanguage } from "./ui-language";

import { useState } from "react";
import type { CalendarView } from "@/contracts/calendar";
import type { Command } from "@/contracts/commands";
export function CommitmentTime({
  view,
  perform,
  busy,
}: {
  view: CalendarView;
  perform: (c: Command) => Promise<void>;
  busy: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const [id, setId] = useState("");
  if (!view.ownCommitments?.length) return null;
  return (
    <details>
      <summary>{uiText("Data di un tuo impegno già adottato")}</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            commitment = view.ownCommitments.find((c) => c.id === id);
          if (!commitment) return;
          void perform({
            type: "commitment.time.set",
            commitmentId: id,
            expectedVersion: commitment.version,
            expectedContextRevision: view.contextRevision,
            representSelf: true,
            time: {
              start: new Date(String(f.get("start"))).toISOString(),
              end: new Date(String(f.get("end"))).toISOString(),
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            },
            reason: String(f.get("reason")),
          });
        }}
      >
        <label>
          {uiText("Impegno")}
          <select value={id} onChange={(e) => setId(e.target.value)} required>
            <option value="">{uiText("Scegli un tuo impegno")}</option>
            {view.ownCommitments.map((c) => (
              <option value={c.id} key={c.id}>
                {c.content}
              </option>
            ))}
          </select>
        </label>
        <label>
          {uiText("Inizio")}
          <input name="start" type="datetime-local" required />
        </label>
        <label>
          {uiText("Fine")}
          <input name="end" type="datetime-local" required />
        </label>
        <label>
          {uiText("Motivazione")}
          <input name="reason" required maxLength={2000} />
        </label>
        <label className="check">
          <input type="checkbox" required />
          {uiText(
            "Stabilisco questa data soltanto per me; non modifica il contenuto dell’impegno né calendari esterni.",
          )}
        </label>
        <button disabled={busy || !id}>
          {uiText("Stabilisci la data dell’impegno")}
        </button>
      </form>
    </details>
  );
}
