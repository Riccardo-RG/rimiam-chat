/* eslint-disable @next/next/no-img-element -- Private same-origin source URLs require authenticated original-media delivery. */
"use client";
import { useState } from "react";
import type { ArtifactBlock } from "@/contracts/artifact-document";
import type { Command } from "@/contracts/commands";
import type { Snapshot } from "./types";
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
}: {
  state: Snapshot;
  artifactId?: string;
  busy: boolean;
  command: (c: Command) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  onSaved: () => void;
}) {
  const current = state.artifactVersions.find(
    (v) =>
      v.artifact_id === artifactId &&
      v.version ===
        state.artifacts.find((a) => a.id === artifactId)?.current_draft_version,
  );
  const [title, setTitle] = useState(current?.title ?? ""),
    [purpose, setPurpose] = useState(current?.purpose ?? ""),
    [blocks, setBlocks] = useState<ArtifactBlock[]>(
      current?.blocks ?? [{ type: "paragraph", text: current?.body ?? "" }],
    );
  const initialInfo = state.artifactInformation
    .filter(
      (r) =>
        r.artifact_id === artifactId && r.artifact_version === current?.version,
    )
    .map((r) => r.information_id);
  const [selected, setSelected] = useState<string[]>(initialInfo),
    [sourceIds, setSources] = useState<string[]>(
      state.artifactSources
        .filter(
          (r) =>
            r.artifact_id === artifactId &&
            r.artifact_version === current?.version,
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
          await command({
            type: "artifact.compose",
            ...(artifactId
              ? { artifactId, expectedVersion: current!.version }
              : {}),
            title,
            purpose,
            blocks,
            information: state.information
              .filter((i) => selected.includes(i.id))
              .map((i) => ({ id: i.id, version: i.current_version })),
            sourceIds,
            reason,
            nonOperative: true,
          });
          onSaved();
        });
      }}
    >
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
          placeholder="Per esempio: confrontare tre locali"
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
        {state.information.map((i) => (
          <label className="check" key={i.id}>
            <input
              type="checkbox"
              checked={selected.includes(i.id)}
              onChange={(e) =>
                setSelected((old) =>
                  e.target.checked
                    ? [...old, i.id]
                    : old.filter((x) => x !== i.id),
                )
              }
            />
            {i.subject} · v{i.current_version}
          </label>
        ))}
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
      {current && (
        <label>
          Motivo della revisione
          <input name="reason" required maxLength={4000} />
        </label>
      )}
      <p className="hint">
        Salva una bozza condivisa, con storia e fonti. Non adotta il contenuto
        né modifica impegni, decisioni o permessi.
      </p>
      <button disabled={busy}>Salva bozza</button>
    </form>
  );
}
