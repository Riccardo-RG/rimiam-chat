/* eslint-disable @next/next/no-img-element -- Private same-origin source URLs require authenticated original-media delivery. */
"use client";
import { useState } from "react";
import type { ArtifactBlock } from "@/contracts/artifact-document";
import type { ConversationHandoff } from "@/contracts/conversation-handoff";
import type { Command } from "@/contracts/commands";
import type { Snapshot } from "./types";

export type ArtifactInformationReference = { id: string; version: number };

export function staleArtifactInformation(
  selected: ArtifactInformationReference[],
  information: Snapshot["information"],
) {
  return selected.filter(
    (ref) =>
      !information.some(
        (item) => item.id === ref.id && item.current_version === ref.version,
      ),
  );
}

export function selectArtifactInformation(
  selected: ArtifactInformationReference[],
  reference: ArtifactInformationReference,
) {
  return [...selected.filter((item) => item.id !== reference.id), reference];
}

export function ArtifactInformationSelection({
  state,
  selected,
  onChange,
  allowHistorical = false,
}: {
  state: Snapshot;
  selected: ArtifactInformationReference[];
  onChange: (selected: ArtifactInformationReference[]) => void;
  allowHistorical?: boolean;
}) {
  const stale = staleArtifactInformation(selected, state.information);
  return (
    <>
      {stale.length > 0 && (
        <div role="status" className="processing">
          <p>
            {allowHistorical
              ? "Alcuni riferimenti selezionati non sono correnti. La bozza conserva quelle versioni come riferimenti storici. Puoi mantenerle oppure esaminare e selezionare esplicitamente le versioni correnti."
              : "Alcuni riferimenti selezionati sono cambiati. La tua selezione non è stata aggiornata: esamina e seleziona la versione corrente, oppure rimuovi il riferimento prima di salvare."}
          </p>
          {stale.map((ref) => {
            const item = state.information.find((i) => i.id === ref.id);
            const historical = state.versions.find(
              (v) => v.information_id === ref.id && v.version === ref.version,
            );
            return (
              <p key={ref.id}>
                {item?.subject ?? "Informazione non disponibile"} · selezionata
                v{ref.version}
                {historical ? `: ${historical.content}` : ""}{" "}
                <button
                  type="button"
                  className="quiet"
                  onClick={() =>
                    onChange(selected.filter((i) => i.id !== ref.id))
                  }
                >
                  Rimuovi riferimento v{ref.version}
                </button>
              </p>
            );
          })}
        </div>
      )}
      {state.information.map((item) => (
        <label className="check" key={item.id}>
          <input
            type="checkbox"
            checked={selected.some(
              (ref) =>
                ref.id === item.id && ref.version === item.current_version,
            )}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? selectArtifactInformation(selected, {
                      id: item.id,
                      version: item.current_version,
                    })
                  : selected.filter((ref) => ref.id !== item.id),
              )
            }
          />
          {item.subject} · v{item.current_version}: {item.content}
        </label>
      ))}
    </>
  );
}

export function useArtifactEditBase(state: Snapshot, artifactId?: string) {
  const current = state.artifactVersions.find(
    (v) =>
      v.artifact_id === artifactId &&
      v.version ===
        state.artifacts.find((a) => a.id === artifactId)?.current_draft_version,
  );
  // A refreshed snapshot is not permission to rebase the member's unsaved draft.
  const [base, setBase] = useState(current);
  const stale =
    !!artifactId && (!base || !current || base.version !== current.version);
  return { base, current, stale, setBase };
}

export function ArtifactRevisionReview({
  state,
  base,
  current,
  onReviewed,
}: {
  state: Snapshot;
  base: Snapshot["artifactVersions"][number] | undefined;
  current: Snapshot["artifactVersions"][number] | undefined;
  onReviewed: () => void;
}) {
  return (
    <div role="status" className="processing">
      <p>
        La tua bozza resta basata sulla v{base?.version ?? "non disponibile"}.
        {current
          ? ` È ora disponibile la v${current.version}.`
          : " Il documento corrente non è disponibile."}{" "}
        Il tuo testo è conservato. Prima di salvare, confronta le modifiche:
        usare una nuova base non le incorpora automaticamente nella tua bozza.
      </p>
      {current && (
        <details>
          <summary>
            Confronta con la versione corrente · v{current.version}
          </summary>
          <h4>{current.title}</h4>
          {current.purpose && <p>{current.purpose}</p>}
          <ArtifactBody
            blocks={current.blocks}
            body={current.body}
            workspace={state.workspace.id}
          />
          <p className="hint">
            Riferimenti della v{current.version}: la tua selezione rimane
            distinta e non viene sostituita durante il confronto.
          </p>
          <ul>
            {state.artifactInformation
              .filter(
                (r) =>
                  r.artifact_id === current.artifact_id &&
                  r.artifact_version === current.version,
              )
              .map((r) => (
                <li key={r.information_id}>
                  {state.information.find((i) => i.id === r.information_id)
                    ?.subject ?? "Informazione accettata"}{" "}
                  · v{r.information_version}:{" "}
                  {state.versions.find(
                    (v) =>
                      v.information_id === r.information_id &&
                      v.version === r.information_version,
                  )?.content ??
                    "contenuto storico consultabile nei riferimenti del documento"}
                </li>
              ))}
            {state.artifactSources
              .filter(
                (r) =>
                  r.artifact_id === current.artifact_id &&
                  r.artifact_version === current.version,
              )
              .map((r) => (
                <li key={r.source_id}>
                  Fonte:{" "}
                  {state.sources.find((s) => s.id === r.source_id)?.title ??
                    state.messages.find((m) => m.id === r.source_id)?.content ??
                    r.source_id}
                </li>
              ))}
          </ul>
          <button type="button" className="quiet" onClick={onReviewed}>
            Ho confrontato: usa v{current.version} come base e conserva la mia
            bozza
          </button>
        </details>
      )}
    </div>
  );
}

export function ArtifactBody({
  blocks,
  body,
  workspace,
}: {
  blocks?: ArtifactBlock[] | null;
  body: string;
  workspace: string;
}) {
  if (!blocks) return <div className="artifact-body">{body}</div>;
  return (
    <div className="document-body">
      {blocks.map((b, i) =>
        b.type === "heading" ? (
          <h3 key={i}>{b.text}</h3>
        ) : b.type === "paragraph" ? (
          <p key={i}>{b.text}</p>
        ) : b.type === "checklist" ? (
          <ul className="document-checklist" key={i}>
            {b.items.map((x, n) => (
              <li key={n}>
                <span aria-label={x.checked ? "Spuntato" : "Non spuntato"}>
                  {x.checked ? "☑" : "☐"}
                </span>{" "}
                {x.text}
              </li>
            ))}
          </ul>
        ) : b.type === "table" ? (
          <div key={i} className="table-scroll">
            <table>
              <thead>
                <tr>
                  {b.columns.map((c, n) => (
                    <th key={n}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, n) => (
                  <tr key={n}>
                    {row.map((c, k) => (
                      <td key={k}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <figure key={i}>
            {/* Protected same-origin source; verified raster MIME only. */}
            <img
              src={`/api/v1/workspaces/${workspace}/source-file?id=${b.sourceId}`}
              alt={b.alt}
              loading="lazy"
            />
            <figcaption>{b.caption}</figcaption>
          </figure>
        ),
      )}
    </div>
  );
}
export function ArtifactDocumentEditor({
  state,
  artifactId,
  busy,
  command,
  action,
  onSaved,
  handoff,
}: {
  state: Snapshot;
  artifactId?: string;
  busy: boolean;
  command: (c: Command) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  onSaved: () => void;
  handoff?: ConversationHandoff;
}) {
  const { base, current, stale, setBase } = useArtifactEditBase(
    state,
    artifactId,
  );
  const [title, setTitle] = useState(
      base?.title ??
        (handoff ? [...handoff.summary].slice(0, 160).join("") : ""),
    ),
    [purpose, setPurpose] = useState(base?.purpose ?? handoff?.summary ?? ""),
    [blocks, setBlocks] = useState<ArtifactBlock[]>(
      base?.blocks ?? [
        {
          type: "paragraph",
          text: base?.body ?? handoff?.suggestedText ?? "",
        },
      ],
    );
  const initialInfo = state.artifactInformation
    .filter(
      (r) =>
        r.artifact_id === artifactId && r.artifact_version === base?.version,
    )
    .map((r) => ({ id: r.information_id, version: r.information_version }));
  const [selected, setSelected] =
      useState<ArtifactInformationReference[]>(initialInfo),
    [sourceIds, setSources] = useState<string[]>(
      handoff?.sourceIds ??
        state.artifactSources
          .filter(
            (r) =>
              r.artifact_id === artifactId &&
              r.artifact_version === base?.version,
          )
          .map((r) => r.source_id),
    );
  const update = (index: number, b: ArtifactBlock) =>
    setBlocks((old) => old.map((x, i) => (i === index ? b : x)));
  const add = (type: ArtifactBlock["type"]) =>
    setBlocks((old) => [
      ...old,
      type === "paragraph" || type === "heading"
        ? { type, text: "" }
        : type === "checklist"
          ? { type, items: [{ text: "", checked: false }] }
          : type === "table"
            ? { type, columns: ["Voce", "Dettaglio"], rows: [["", ""]] }
            : { type, sourceId: "", alt: "", caption: "" },
    ]);
  return (
    <form
      className="document-editor"
      onSubmit={(e) => {
        e.preventDefault();
        const reason = String(
          new FormData(e.currentTarget).get("reason") ?? "Prima bozza",
        );
        void action(async () => {
          if (handoff && handoff.status !== "ready")
            throw new Error(
              "La proposta non è più applicabile. Rivalutala o esci dal percorso prima di preparare una nuova bozza.",
            );
          if (stale)
            throw new Error(
              "Il documento è cambiato: confronta la versione corrente prima di salvare. La tua bozza è conservata.",
            );
          await command({
            type: "artifact.compose",
            ...(artifactId
              ? { artifactId, expectedVersion: base!.version }
              : {}),
            title,
            purpose,
            blocks,
            information: selected,
            sourceIds,
            reason,
            nonOperative: true,
            ...(handoff
              ? { conversationOrigin: { handoffId: handoff.id } }
              : {}),
          });
          onSaved();
        });
      }}
    >
      {stale && (
        <ArtifactRevisionReview
          state={state}
          base={base}
          current={current}
          onReviewed={() => setBase(current)}
        />
      )}
      <label>
        Titolo
        <input
          required
          maxLength={160}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        A cosa ci serve?
        <input
          required
          maxLength={2000}
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder="Per esempio: confrontare tre ipotesi per la beta di RIMIAM"
        />
      </label>
      {blocks.map((b, i) => (
        <fieldset key={i}>
          <legend>
            {i + 1}.{" "}
            {
              {
                paragraph: "Testo",
                heading: "Sezione",
                checklist: "Checklist",
                table: "Tabella",
                image: "Immagine",
              }[b.type]
            }
          </legend>
          {(b.type === "paragraph" || b.type === "heading") && (
            <label className="block-input">
              Contenuto
              <textarea
                value={b.text}
                required
                maxLength={b.type === "heading" ? 240 : 24000}
                rows={b.type === "heading" ? 1 : 4}
                onChange={(e) => update(i, { ...b, text: e.target.value })}
              />
            </label>
          )}
          {b.type === "checklist" && (
            <>
              {b.items.map((x, n) => (
                <div className="checklist-edit" key={n}>
                  <input
                    type="checkbox"
                    aria-label={`Spunta voce ${n + 1}`}
                    checked={x.checked}
                    onChange={(e) =>
                      update(i, {
                        ...b,
                        items: b.items.map((r, k) =>
                          k === n ? { ...r, checked: e.target.checked } : r,
                        ),
                      })
                    }
                  />
                  <input
                    aria-label={`Voce ${n + 1}`}
                    required
                    maxLength={2000}
                    value={x.text}
                    onChange={(e) =>
                      update(i, {
                        ...b,
                        items: b.items.map((r, k) =>
                          k === n ? { ...r, text: e.target.value } : r,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="quiet"
                    aria-label={`Rimuovi voce ${n + 1}`}
                    disabled={b.items.length === 1}
                    onClick={() =>
                      update(i, {
                        ...b,
                        items: b.items.filter((_, k) => k !== n),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="quiet"
                onClick={() =>
                  update(i, {
                    ...b,
                    items: [...b.items, { text: "", checked: false }],
                  })
                }
              >
                Aggiungi voce
              </button>
              <small>
                Le spunte sono contenuto della bozza; non completano Task o
                impegni.
              </small>
            </>
          )}
          {b.type === "table" && (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      {b.columns.map((v, n) => (
                        <th key={n}>
                          <input
                            aria-label={`Colonna ${n + 1}`}
                            value={v}
                            maxLength={160}
                            onChange={(e) =>
                              update(i, {
                                ...b,
                                columns: b.columns.map((x, k) =>
                                  k === n ? e.target.value : x,
                                ),
                              })
                            }
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, n) => (
                      <tr key={n}>
                        {row.map((cell, k) => (
                          <td key={k}>
                            <input
                              aria-label={`Riga ${n + 1}, colonna ${k + 1}`}
                              maxLength={2000}
                              value={cell}
                              onChange={(e) =>
                                update(i, {
                                  ...b,
                                  rows: b.rows.map((r, j) =>
                                    j === n
                                      ? r.map((x, q) =>
                                          q === k ? e.target.value : x,
                                        )
                                      : r,
                                  ),
                                })
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="actions">
                <button
                  type="button"
                  className="quiet"
                  onClick={() =>
                    update(i, {
                      ...b,
                      rows: [...b.rows, b.columns.map(() => "")],
                    })
                  }
                >
                  Aggiungi riga
                </button>
                <button
                  type="button"
                  className="quiet"
                  disabled={b.columns.length >= 12}
                  onClick={() =>
                    update(i, {
                      ...b,
                      columns: [...b.columns, ""],
                      rows: b.rows.map((r) => [...r, ""]),
                    })
                  }
                >
                  Aggiungi colonna
                </button>
              </div>
            </>
          )}
          {b.type === "image" && (
            <>
              <label>
                Immagine condivisa
                <select
                  required
                  value={b.sourceId}
                  onChange={(e) =>
                    update(i, { ...b, sourceId: e.target.value })
                  }
                >
                  <option value="">Scegli una fonte immagine</option>
                  {state.sources
                    .filter((s) => s.media_type?.startsWith("image/"))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title} · v{s.document_version}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Descrizione accessibile
                <input
                  required
                  maxLength={500}
                  value={b.alt}
                  onChange={(e) => update(i, { ...b, alt: e.target.value })}
                />
              </label>
              <label>
                Didascalia
                <input
                  maxLength={2000}
                  value={b.caption}
                  onChange={(e) => update(i, { ...b, caption: e.target.value })}
                />
              </label>
            </>
          )}
          <div className="actions">
            <button
              type="button"
              className="quiet"
              disabled={i === 0}
              onClick={() =>
                setBlocks((old) => {
                  const next = [...old];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  return next;
                })
              }
            >
              Sposta su
            </button>
            <button
              type="button"
              className="quiet"
              disabled={blocks.length === 1}
              onClick={() => setBlocks((old) => old.filter((_, n) => n !== i))}
            >
              Rimuovi dalla bozza
            </button>
          </div>
        </fieldset>
      ))}
      <div className="actions" aria-label="Aggiungi al documento">
        {(["paragraph", "heading", "checklist", "table", "image"] as const).map(
          (type) => (
            <button
              key={type}
              type="button"
              className="quiet"
              onClick={() => add(type)}
            >
              ＋{" "}
              {
                {
                  paragraph: "Testo",
                  heading: "Sezione",
                  checklist: "Checklist",
                  table: "Tabella",
                  image: "Immagine",
                }[type]
              }
            </button>
          ),
        )}
      </div>
      <details>
        <summary>Collega fonti e informazioni accettate</summary>
        <ArtifactInformationSelection
          state={state}
          selected={selected}
          onChange={setSelected}
          allowHistorical
        />
        {state.sources.map((s) => (
          <label className="check" key={s.id}>
            <input
              type="checkbox"
              checked={sourceIds.includes(s.id)}
              onChange={(e) =>
                setSources((old) =>
                  e.target.checked
                    ? [...old, s.id]
                    : old.filter((x) => x !== s.id),
                )
              }
            />
            {s.title} · fonte non automaticamente accettata
          </label>
        ))}
      </details>
      {base && (
        <label>
          Motivo della revisione
          <input name="reason" required maxLength={4000} />
        </label>
      )}
      <p className="hint">
        Salva una bozza condivisa, con storia e fonti. Non adotta il contenuto
        né modifica impegni, decisioni o permessi.
      </p>
      {staleArtifactInformation(selected, state.information).length > 0 && (
        <p className="processing">
          La bozza conserva riferimenti storici. Puoi esaminarli e aggiornarli
          esplicitamente in «Collega fonti e informazioni accettate».
        </p>
      )}
      <button disabled={busy || stale}>Salva bozza</button>
    </form>
  );
}
