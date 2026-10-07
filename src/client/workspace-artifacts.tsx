"use client";
import { ProductHelp } from "./product-help";
import {
  ArtifactBody,
  ArtifactDocumentEditor,
  ArtifactInformationSelection,
  ArtifactRevisionReview,
  staleArtifactInformation,
  useArtifactEditBase,
  type ArtifactInformationReference,
} from "./artifact-document";
import { useState } from "react";
import type { Snapshot } from "./types";
import type { Command } from "@/contracts/commands";
import type { ConversationHandoff } from "@/contracts/conversation-handoff";
type Props = {
  state: Snapshot;
  actor: string;
  busy: boolean;
  command: (c: Command) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  handoff?: ConversationHandoff;
};
export function WorkspaceArtifacts(props: Props) {
  const { state, actor, busy, command, action, handoff } = props;
  const [editing, setEditing] = useState<{ id: string; rich: boolean } | null>(
    null,
  );
  const contributes = state.members.some(
    (m) => m.user_id === actor && m.active && m.contributes,
  );
  const name = (id: string) =>
    state.members.find((m) => m.user_id === id)?.name ?? "Partecipante";
  return (
    <section className="card source-work" aria-label="Brief e Artifacts">
      <details open>
        <summary>Documenti e risultati</summary>
        <h2>Ciò che costruiamo insieme</h2>
        <ProductHelp screen="artifacts" />
        {contributes && (
          <details open={!!handoff || undefined}>
            <summary>Nuovo documento</summary>
            <ArtifactDocumentEditor
              state={state}
              busy={busy}
              command={command}
              action={action}
              onSaved={() => {}}
              handoff={handoff}
            />
          </details>
        )}
        <p className="hint">
          Raccogli riferimenti selezionati e note in un documento versionato. La
          bozza resta distinta dalla versione adottata.
        </p>
        {contributes &&
        state.questions.length > 0 &&
        state.information.length > 0 ? (
          <details>
            <summary>Prepara un brief</summary>
            <DraftForm {...props} onSaved={() => {}} />
          </details>
        ) : (
          <p className="muted">
            Puoi creare liberamente una bozza. Per un brief guidato, collega una
            domanda e informazioni accettate.
          </p>
        )}
        {state.artifacts.map((a) => {
          const v = state.artifactVersions.find(
            (v) =>
              v.artifact_id === a.id && v.version === a.current_draft_version,
          )!;
          const adoption = state.artifactAdoptions.find(
            (x) => x.id === a.current_adoption_id,
          );
          const adoptedReview = state.artifactReviews.find(
            (r) => r.id === adoption?.review_id,
          );
          const adopted = state.artifactVersions.find(
            (v) =>
              v.artifact_id === a.id &&
              v.version === adoptedReview?.artifact_version,
          );
          const reviews = state.artifactReviews.filter(
            (r) =>
              r.artifact_id === a.id &&
              r.artifact_version === v.version &&
              r.previous_adoption_id === a.current_adoption_id,
          );
          return (
            <article
              className="source-work-item"
              key={a.id}
              aria-label={`Artifact: ${v.title}`}
            >
              <h3>{v.title}</h3>
              <p>
                {adopted?.version === v.version
                  ? "Versione adottata"
                  : "Bozza da valutare"}{" "}
                · v{v.version} · {name(v.authored_by)}
              </p>
              <p className="hint">
                Contenuto non operativo: non modifica decisioni, vincoli,
                impegni o autorizzazioni. Le note non diventano informazioni
                accettate.
              </p>
              {v.outdated_reasons.length > 0 && (
                <p className="processing">
                  Da rivalutare: {v.outdated_reasons.join(" · ")}. Prepara una
                  nuova versione con i riferimenti aggiornati.
                </p>
              )}
              <details>
                <summary>Leggi il documento e le fonti</summary>
                <ArtifactBody
                  blocks={v.blocks}
                  body={v.body}
                  workspace={state.workspace.id}
                />
                <SourceLinks
                  state={state}
                  artifactId={a.id}
                  version={v.version}
                />
              </details>
              {adoptedReview && (
                <p>
                  Adottata v{adoptedReview.artifact_version} dalle persone
                  nominate: {adoptedReview.people.map(name).join(", ")}. Nessun
                  consenso attribuito agli altri membri.
                </p>
              )}
              {adopted && adopted.version !== v.version && (
                <details>
                  <summary>
                    Versione adottata ancora in uso · v{adopted.version}
                  </summary>
                  <ArtifactBody
                    blocks={adopted.blocks}
                    body={adopted.body}
                    workspace={state.workspace.id}
                  />
                  {adopted.outdated_reasons.length > 0 && (
                    <p className="processing">
                      Base da rivalutare: {adopted.outdated_reasons.join(" · ")}
                    </p>
                  )}
                </details>
              )}
              {contributes && (
                <button
                  disabled={busy}
                  onClick={() =>
                    setEditing(
                      editing?.id === a.id
                        ? null
                        : { id: a.id, rich: !!v.blocks },
                    )
                  }
                >
                  Prepara una revisione
                </button>
              )}
              {editing?.id === a.id &&
                (editing.rich ? (
                  <ArtifactDocumentEditor
                    key={a.id}
                    state={state}
                    artifactId={a.id}
                    busy={busy}
                    command={command}
                    action={action}
                    onSaved={() => setEditing(null)}
                  />
                ) : (
                  <DraftForm
                    key={a.id}
                    {...props}
                    artifactId={a.id}
                    onSaved={() => setEditing(null)}
                  />
                ))}
              {contributes &&
                adopted?.version !== v.version &&
                v.outdated_reasons.length === 0 && (
                  <details>
                    <summary>Richiedi adozione di questa versione</summary>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const data = new FormData(e.currentTarget);
                        const people =
                          adoptedReview?.people ??
                          data.getAll("person").map(String);
                        void action(async () => {
                          await command({
                            type: "artifact.review",
                            artifactId: a.id,
                            version: v.version,
                            people,
                            nonOperative: true,
                          });
                        });
                      }}
                    >
                      <p>
                        Ogni persona nominata approva questa specifica versione
                        soltanto per sé. L’adozione non concede mandati per
                        versioni future.
                      </p>
                      {adoptedReview ? (
                        <p>
                          La revisione mantiene il perimetro rappresentato:{" "}
                          {adoptedReview.people.map(name).join(", ")}.
                        </p>
                      ) : (
                        state.members
                          .filter((m) => m.active && m.contributes)
                          .map((m) => (
                            <label className="check" key={m.user_id}>
                              <input
                                type="checkbox"
                                name="person"
                                value={m.user_id}
                              />
                              {m.name}
                            </label>
                          ))
                      )}
                      <label className="check">
                        <input type="checkbox" required />
                        Propongo l’uso del brief come documento di lavoro non
                        operativo.
                      </label>
                      <button disabled={busy}>Avvia review nominativa</button>
                    </form>
                  </details>
                )}
              {reviews.map((r) => {
                const approvals = state.artifactApprovals.filter(
                  (p) =>
                    p.review_id === r.id &&
                    p.access_revision === state.workspace.access_revision,
                );
                const already = approvals.some((p) => p.person_id === actor);
                return (
                  <div key={r.id} className="proposal">
                    <p>
                      Review v{r.artifact_version} · proposta di{" "}
                      {name(r.proposed_by)}
                    </p>
                    <ul>
                      {r.people.map((p) => (
                        <li key={p}>
                          {name(p)} ·{" "}
                          {approvals.some((x) => x.person_id === p)
                            ? "approvazione registrata"
                            : "in attesa di un atto esplicito"}
                        </li>
                      ))}
                    </ul>
                    {contributes && r.people.includes(actor) && !already && (
                      <button
                        disabled={busy || v.outdated_reasons.length > 0}
                        onClick={() =>
                          void action(async () => {
                            await command({
                              type: "artifact.approve",
                              reviewId: r.id,
                              expectedAccessRevision:
                                state.workspace.access_revision,
                              representSelf: true,
                              nonOperative: true,
                            });
                          })
                        }
                      >
                        Approvo per me il brief v{r.artifact_version}
                      </button>
                    )}
                  </div>
                );
              })}
              <details>
                <summary>Storia del brief</summary>
                {state.artifactVersions
                  .filter((x) => x.artifact_id === a.id)
                  .map((x) => (
                    <div key={x.version}>
                      <h4>
                        v{x.version} · {name(x.authored_by)} ·{" "}
                        {new Date(x.created_at).toLocaleString("it-IT")}
                      </h4>
                      <p>{x.reason}</p>
                      <p className="hint">
                        {x.origin === "human_revision"
                          ? "Revisione umana"
                          : "Raccolta dei riferimenti selezionati"}{" "}
                        · domanda v{x.question_version} · contesto{" "}
                        {x.context_revision}
                        {x.provider ? ` · ${x.provider} / ${x.model}` : ""}
                      </p>
                      <details>
                        <summary>Contenuto v{x.version}</summary>
                        <pre className="artifact-body">{x.body}</pre>
                        <SourceLinks
                          state={state}
                          artifactId={a.id}
                          version={x.version}
                        />
                      </details>
                    </div>
                  ))}
                {state.artifactAdoptions
                  .filter((x) => x.artifact_id === a.id)
                  .map((x) => {
                    const r = state.artifactReviews.find(
                      (r) => r.id === x.review_id,
                    )!;
                    return (
                      <p key={x.id}>
                        Adozione v{r.artifact_version} ·{" "}
                        {r.people.map(name).join(", ")} ·{" "}
                        {new Date(x.created_at).toLocaleString("it-IT")}
                      </p>
                    );
                  })}
              </details>
            </article>
          );
        })}
      </details>
    </section>
  );
}
function SourceLinks({
  state,
  artifactId,
  version,
}: {
  state: Snapshot;
  artifactId: string;
  version: number;
}) {
  return (
    <div>
      <h4>Riferimenti e provenance</h4>
      <ul>
        {state.artifactInformation
          .filter(
            (r) =>
              r.artifact_id === artifactId && r.artifact_version === version,
          )
          .map((r) => {
            const info = state.information.find(
              (i) => i.id === r.information_id,
            );
            return (
              <li key={r.information_id}>
                {info?.subject} · versione accettata {r.information_version}
              </li>
            );
          })}
        {state.artifactSources
          .filter(
            (r) =>
              r.artifact_id === artifactId && r.artifact_version === version,
          )
          .map((r) => {
            const source = state.sources.find((s) => s.id === r.source_id),
              message = state.messages.find((m) => m.id === r.source_id);
            return (
              <li key={r.source_id}>
                <a href={`#source-${r.source_id}`}>
                  {source?.title ??
                    `${message?.author_name}: ${message?.content.slice(0, 80)}`}
                  {source?.document_version
                    ? ` · v${source.document_version}`
                    : ""}
                </a>{" "}
                ·{" "}
                {r.explicitly_selected
                  ? "selezionata"
                  : "provenance conservata"}
              </li>
            );
          })}
      </ul>
    </div>
  );
}
function DraftForm({
  state,
  busy,
  command,
  action,
  artifactId,
  onSaved,
}: Props & { artifactId?: string; onSaved: () => void }) {
  const { base, current, stale, setBase } = useArtifactEditBase(
    state,
    artifactId,
  );
  const [title, setTitle] = useState(base?.title ?? "");
  const [notes, setNotes] = useState(base?.notes ?? "");
  const [selected, setSelected] = useState<ArtifactInformationReference[]>(() =>
    state.artifactInformation
      .filter(
        (i) =>
          i.artifact_id === artifactId && i.artifact_version === base?.version,
      )
      .map((i) => ({ id: i.information_id, version: i.information_version })),
  );
  const [sourceIds, setSources] = useState<string[]>(() =>
    state.artifactSources
      .filter(
        (s) =>
          s.artifact_id === artifactId &&
          s.artifact_version === base?.version &&
          s.explicitly_selected,
      )
      .map((s) => s.source_id),
  );
  const [question, setQuestion] = useState(
    base?.question_id ? `${base.question_id}:${base.question_version}` : "",
  );
  const questionStale =
    !!question &&
    !state.questions.some((q) => `${q.id}:${q.version}` === question);
  const informationStale =
    staleArtifactInformation(selected, state.information).length > 0;
  const isCurrentSource = (id: string) => {
    const source = state.sources.find((s) => s.id === id);
    // The projection may omit an older message/source. Preserve its exact ID;
    // only a known newer document version proves this selection stale here.
    if (!source) return true;
    return (
      !source.document_id ||
      !state.sources.some(
        (newer) =>
          newer.document_id === source.document_id &&
          newer.document_version! > source.document_version!,
      )
    );
  };
  const staleSources = sourceIds.filter((id) => !isCurrentSource(id));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        const [questionId, version] = question.split(":");
        const selection = {
          questionId,
          questionVersion: Number(version),
          title: String(data.get("title")),
          notes: String(data.get("notes")),
          information: selected,
          sourceIds,
        };
        void action(async () => {
          if (stale)
            throw new Error(
              "Il documento è cambiato: confronta la versione corrente prima di salvare. La tua bozza è conservata.",
            );
          if (questionStale || informationStale || staleSources.length)
            throw new Error(
              "Riesamina i riferimenti cambiati prima di salvare il brief.",
            );
          if (base && artifactId)
            await command({
              ...selection,
              type: "artifact.revise",
              artifactId,
              expectedVersion: base.version,
              reason: String(data.get("reason")),
            });
          else await command({ ...selection, type: "artifact.draft" });
          form.reset();
          if (!artifactId) {
            setTitle("");
            setNotes("");
            setQuestion("");
            setSelected([]);
            setSources([]);
          }
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
        Titolo del brief
        <input
          name="title"
          required
          maxLength={160}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        Domanda di riferimento
        <select
          name="question"
          required
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        >
          <option value="" disabled>
            Scegli una domanda e la versione corrente
          </option>
          {questionStale && (
            <option value={question} disabled>
              Domanda selezionata · v{question.split(":")[1]} · da riesaminare
            </option>
          )}
          {state.questions.map((q) => (
            <option value={`${q.id}:${q.version}`} key={`${q.id}:${q.version}`}>
              {q.content} · v{q.version}
            </option>
          ))}
        </select>
        {questionStale && (
          <span className="processing">
            La domanda selezionata è cambiata. Esamina e scegli esplicitamente
            la versione da usare.
          </span>
        )}
      </label>
      <fieldset>
        <legend>Informazioni accettate da includere</legend>
        <ArtifactInformationSelection
          state={state}
          selected={selected}
          onChange={setSelected}
        />
      </fieldset>
      {(state.sources.length > 0 || sourceIds.length > 0) && (
        <fieldset>
          <legend>Fonti aggiuntive da esaminare (facoltative)</legend>
          {state.sources
            .filter((s) => sourceIds.includes(s.id) || isCurrentSource(s.id))
            .map((s) => (
              <label className="check" key={s.id}>
                <input
                  type="checkbox"
                  name="source"
                  value={s.id}
                  checked={sourceIds.includes(s.id)}
                  onChange={(e) =>
                    setSources((old) =>
                      e.target.checked
                        ? [...old, s.id]
                        : old.filter((id) => id !== s.id),
                    )
                  }
                />
                {s.title}
                {s.document_version ? ` · v${s.document_version}` : ""}
                {!isCurrentSource(s.id) ? " · selezione da riesaminare" : ""}
              </label>
            ))}
          {sourceIds
            .filter((id) => !state.sources.some((s) => s.id === id))
            .map((id) => (
              <p key={id}>
                Fonte storica selezionata · {id}{" "}
                <button
                  type="button"
                  className="quiet"
                  onClick={() =>
                    setSources((old) => old.filter((s) => s !== id))
                  }
                >
                  Rimuovi riferimento
                </button>
              </p>
            ))}
          {staleSources.length > 0 && (
            <p className="processing">
              Una fonte selezionata non è più corrente. Rimuovi il vecchio
              riferimento e seleziona esplicitamente la nuova versione, se
              pertinente.
            </p>
          )}
        </fieldset>
      )}
      <label>
        Note e ipotesi della bozza
        <textarea
          name="notes"
          maxLength={12000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Osservazioni da discutere; non sono decisioni o impegni."
        />
      </label>
      {base && (
        <label>
          Motivo della revisione
          <input name="reason" required maxLength={4000} />
        </label>
      )}
      <button
        disabled={
          busy ||
          stale ||
          questionStale ||
          informationStale ||
          staleSources.length > 0
        }
      >
        {base ? "Salva nuova bozza" : "Crea bozza del brief"}
      </button>
    </form>
  );
}
