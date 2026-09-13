"use client";
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
  const [id, setId] = useState("");
  if (!view.ownCommitments?.length) return null;
  return (
    <details>
      <summary>Data di un tuo impegno già adottato</summary>
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
          Impegno
          <select value={id} onChange={(e) => setId(e.target.value)} required>
            <option value="">Scegli un tuo impegno</option>
            {view.ownCommitments.map((c) => (
              <option value={c.id} key={c.id}>
                {c.content}
              </option>
            ))}
          </select>
        </label>
        <label>
          Inizio
          <input name="start" type="datetime-local" required />
        </label>
        <label>
          Fine
          <input name="end" type="datetime-local" required />
        </label>
        <label>
          Motivazione
          <input name="reason" required maxLength={2000} />
        </label>
        <label className="check">
          <input type="checkbox" required />
          Stabilisco questa data soltanto per me; non modifica il contenuto
          dell’impegno né calendari esterni.
        </label>
        <button disabled={busy || !id}>Stabilisci la data dell’impegno</button>
      </form>
    </details>
  );
}
