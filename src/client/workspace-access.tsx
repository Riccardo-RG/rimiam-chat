"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import type { Command } from "@/contracts/commands";
import { accessHistorySchema, type AccessView } from "@/contracts/access";
import type { z } from "zod";
type History = z.infer<typeof accessHistorySchema>;
const kindName = {
  stewardship: "Gestione dell’accesso",
  delegation: "Delega agli inviti",
  revoke: "Revoca delega agli inviti",
};
export function WorkspaceAccess({
  workspace,
  actor,
  revision = 0,
  command,
  action,
  busy,
}: {
  workspace: string;
  actor: string;
  revision?: number;
  command: (c: Command) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
}) {
  const [loaded, setLoaded] = useState<{
      workspace: string;
      view: AccessView;
    } | null>(null),
    [error, setError] = useState(""),
    [before, setBefore] = useState<string | null>(null),
    [history, setHistory] = useState<{
      workspace: string;
      value: History;
    } | null>(null);
  const [kind, setKind] = useState<"stewardship" | "delegation">("stewardship");
  const url = `/api/v1/workspaces/${workspace}/access${before ? `?before=${before}` : ""}`;
  useEffect(() => {
    let live = true,
      running = false;
    const read = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        const view = await api<AccessView>(url);
        if (live) {
          setLoaded({ workspace, view });
          setError("");
        }
      } catch (e) {
        if (live) {
          setLoaded(null);
          setHistory(null);
          setError((e as Error).message);
        }
      } finally {
        running = false;
      }
    };
    void read();
    const timer = setInterval(() => void read(), 4000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [url, workspace, actor, revision]);
  const view = loaded?.workspace === workspace ? loaded.view : null;
  const perform = (c: Command) =>
    action(async () => {
      await command(c);
      setLoaded({ workspace, view: await api<AccessView>(url) });
    });
  const name = (id: string) =>
    view?.members.find((m) => m.id === id)?.name ?? "Partecipante storico";
  return (
    <section className="card source-work" aria-label="Accordi di accesso">
      <h2>Accordi di accesso</h2>
      <p className="hint">
        Invitare persone e amministrare l’accesso non autorizza a decidere sul
        progetto. La storia condivisa è visibile ai membri ammessi.
      </p>
      {error && <p role="alert">{error}</p>}
      {view && (
        <>
          <div>
            {view.relationships
              .filter((r) => r.active)
              .map((r) => (
                <article key={r.id} className="item">
                  <strong>{r.holderName}</strong> ·{" "}
                  {r.kind === "stewardship"
                    ? "gestione dell’accesso"
                    : "solo inviti"}{" "}
                  · v{r.version}
                  <p>
                    {r.available
                      ? "Partecipazione disponibile"
                      : "Partecipazione attualmente non esercitabile"}
                  </p>
                  <p>
                    Modifiche:{" "}
                    {r.conditions
                      .map(
                        (c) =>
                          `${name(c.holderId)}${c.available ? "" : " (indisponibile)"}`,
                      )
                      .join(" + ") || "Secondo l’accordo corrente"}
                    .
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () =>
                        setHistory({
                          workspace,
                          value: await api<History>(
                            `/api/v1/workspaces/${workspace}/access-history?id=${r.id}`,
                          ),
                        }),
                      )
                    }
                  >
                    Storia dell’accordo
                  </button>
                  {r.holderId === actor && (
                    <details>
                      <summary>Rinunciare alla mia partecipazione</summary>
                      <p>
                        Rimani membro. Le condizioni degli altri non vengono
                        ridotte e la gestione potrebbe diventare indisponibile.
                        Non è necessario nominare un successore.
                      </p>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void perform({
                            type: "access.relinquish",
                            confirmed: true,
                          })
                        }
                      >
                        Confermo la rinuncia alla gestione dell’accesso
                      </button>
                    </details>
                  )}
                </article>
              ))}
          </div>
          {!view.relationships.some((r) => r.available && r.changeAccess) && (
            <p role="status">
              Nessuna gestione dell’accesso è attualmente esercitabile. La
              partecipazione già permessa continua; nessuno viene promosso
              automaticamente.
            </p>
          )}
          <details>
            <summary>Proporre un accordo di accesso</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void perform({
                  type: "access.propose",
                  expectedAccessRevision: view.accessRevision,
                  change:
                    kind === "stewardship"
                      ? { kind, people: f.getAll("people").map(String) }
                      : { kind, personId: String(f.get("person")) },
                  reason: String(f.get("reason")),
                });
              }}
            >
              <label>
                Accordo
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as typeof kind)}
                >
                  <option value="stewardship">
                    Gestione nominativa dell’accesso
                  </option>
                  <option value="delegation">
                    Delega limitata agli inviti
                  </option>
                </select>
              </label>
              {kind === "stewardship" ? (
                <fieldset>
                  <legend>Nuovo insieme completo dei gestori</legend>
                  <p>
                    Sostituisce l’insieme corrente. Se scegli più persone, le
                    loro partecipazioni saranno protette da approvazione
                    congiunta nominativa.
                  </p>
                  {view.members
                    .filter((m) => m.active)
                    .map((m) => (
                      <label key={m.id}>
                        <input type="checkbox" name="people" value={m.id} />
                        {m.name}
                      </label>
                    ))}
                </fieldset>
              ) : (
                <label>
                  Destinatario
                  <select name="person" required>
                    {view.members
                      .filter((m) => m.active)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                Motivazione
                <textarea name="reason" required maxLength={4000} />
              </label>
              <button disabled={busy}>Prepara proposta e termini</button>
            </form>
          </details>
          {view.relationships
            .filter((r) => r.active && r.kind === "invitation_delegate")
            .map((r) => (
              <details key={r.id}>
                <summary>
                  Revocare la delega agli inviti di {r.holderName}
                </summary>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void perform({
                      type: "access.propose",
                      expectedAccessRevision: view.accessRevision,
                      change: { kind: "revoke", relationshipId: r.id },
                      reason: String(
                        new FormData(e.currentTarget).get("reason"),
                      ),
                    });
                  }}
                >
                  <label>
                    Motivazione
                    <input name="reason" required maxLength={4000} />
                  </label>
                  <button disabled={busy}>Proponi revoca</button>
                </form>
              </details>
            ))}
          {view.proposals.map((p) => (
            <details key={p.id} open={p.status === "pending"}>
              <summary>
                {kindName[p.kind]} ·{" "}
                {p.status === "adopted"
                  ? "adottato"
                  : p.status === "stale"
                    ? "da riproporre: stato cambiato"
                    : "in attesa"}
              </summary>
              <p>
                {p.reason} · proposta di {name(p.proposedBy)}
              </p>
              <p>
                Partecipazioni risultanti:{" "}
                {p.targets
                  .filter((t) => t.active)
                  .map(
                    (t) =>
                      `${name(t.holderId)} (${t.kind === "stewardship" ? "gestione" : "inviti"})`,
                  )
                  .join(", ") || "La delega indicata termina"}
                .
              </p>
              <ul>
                {p.terms.map((term) => (
                  <li key={term}>{term}</li>
                ))}
              </ul>
              {p.required.map((r, i) => (
                <p key={i}>
                  {r.role === "holder"
                    ? "Accettazione dei termini"
                    : "Autorizzazione della modifica"}
                  : {name(r.personId)} ·{" "}
                  {p.approvals.some(
                    (a) => a.role === r.role && a.personId === r.personId,
                  )
                    ? "registrata"
                    : "in attesa"}
                  {p.status === "pending" &&
                    r.personId === actor &&
                    !p.approvals.some(
                      (a) => a.role === r.role && a.personId === actor,
                    ) && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void perform({
                            type: "access.approve",
                            proposalId: p.id,
                            expectedAccessRevision: view.accessRevision,
                            role: r.role,
                            acceptTerms: true,
                          })
                        }
                      >
                        {r.role === "holder"
                          ? "Accetto questi termini per me"
                          : "Autorizzo questa modifica esatta"}
                      </button>
                    )}
                </p>
              ))}
            </details>
          ))}
          {view.next && (
            <button onClick={() => setBefore(view.next)}>
              Proposte precedenti
            </button>
          )}
          {before && (
            <button onClick={() => setBefore(null)}>Proposte recenti</button>
          )}
          {history?.workspace === workspace && (
            <details open>
              <summary>Storia attribuita dell’accordo</summary>
              {history.value.versions.map((v) => (
                <article key={v.version}>
                  <strong>Versione {v.version}</strong> ·{" "}
                  {v.active ? "attiva" : "terminata"}
                  <p>
                    {name(v.actor)} · {new Date(v.createdAt).toLocaleString()} ·{" "}
                    {v.basis}
                  </p>
                  <p>
                    Condizioni nominative:{" "}
                    {v.requiredParticipations
                      .map((id) =>
                        name(
                          view.relationships.find((r) => r.id === id)
                            ?.holderId ?? "",
                        ),
                      )
                      .join(" + ")}
                  </p>
                </article>
              ))}
              {history.value.nextBefore !== null && (
                <button
                  onClick={() =>
                    void action(async () =>
                      setHistory({
                        workspace,
                        value: await api<History>(
                          `/api/v1/workspaces/${workspace}/access-history?id=${history.value.relationshipId}&before=${history.value.nextBefore}`,
                        ),
                      }),
                    )
                  }
                >
                  Versioni precedenti
                </button>
              )}
            </details>
          )}
        </>
      )}
    </section>
  );
}
