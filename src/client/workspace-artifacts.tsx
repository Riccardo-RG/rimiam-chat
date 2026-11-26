"use client";
import { useUiLanguage } from "./ui-language";

import { GeneratedDocument } from "./generated-document";
import { saveMarkdown } from "./portable-document";
import { ProductHelp } from "./product-help";
import {
  ArtifactBody,
  ArtifactDocumentEditor,
  ArtifactInformationSelection,
  ArtifactRevisionReview,
  staleArtifactInformation,
  useArtifactEditBase,
  type ArtifactInformationReference,
  type SavedArtifactVersion,
} from "./artifact-document";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import type { DocumentExitGuard } from "./workspace-layer";
import { SharedFileLibrary } from "./shared-file-library-view";
import type { PendingCommand } from "./command-journal";
import type { Snapshot } from "./types";
import type { Command } from "@/contracts/commands";
import type { ConversationHandoff } from "@/contracts/conversation-handoff";
import styles from "./shared-file-library.module.css";
type Props = {
  personal?: boolean;
  state: Snapshot;
  actor: string;
  busy: boolean;
  command: (
    c: Command,
    onReceipt?: () => void,
    replay?: PendingCommand,
  ) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  openSource: (id: string) => void;
  onAskFile?: (file: Snapshot["sources"][number]) => void;
  handoff?: ConversationHandoff;
  documentExitGuard?: Ref<DocumentExitGuard>;
};
export function WorkspaceArtifacts(props: Props) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const {
    state,
    actor,
    busy,
    command,
    action,
    personal = false,
    openSource,
  } = props;
  const handoff = personal ? undefined : props.handoff;
  const [generate, setGenerate] = useState(false);
  const documents = personal
    ? state.artifacts.filter((a) =>
        state.artifactVersions.some(
          (v) =>
            v.artifact_id === a.id &&
            v.version === a.current_draft_version &&
            !!v.blocks,
        ),
      )
    : state.artifacts;
  const [editor, setEditor] = useState<{
    kind: "document" | "brief";
    id?: string;
    fromConversation?: boolean;
  } | null>(handoff ? { kind: "document", fromConversation: true } : null);
  const [discardAndLeave, setDiscardAndLeave] = useState<(() => void) | null>(
    null,
  );
  const modified = useRef(false);
  const panel = useRef<HTMLElement>(null);
  const [savedDocument, setSavedDocument] = useState<SavedArtifactVersion>();
  const destination = personal
    ? uiText("Documenti personali")
    : uiText("{0} › Condivisi", state.workspace.name);
  const savedVersion = state.artifactVersions.find(
    (v) =>
      v.artifact_id === savedDocument?.id &&
      v.version === savedDocument.version,
  );
  const heading = useRef<HTMLHeadingElement>(null);
  const returnTarget = useRef<string | undefined>(undefined);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const lastEditorField = useRef<HTMLElement>(null);

  useEffect(() => {
    if (editor) heading.current?.focus();
    else if (returnTarget.current) {
      panel.current
        ?.querySelector<HTMLButtonElement>(
          `[data-document-action="${returnTarget.current}"]`,
        )
        ?.focus();
      returnTarget.current = undefined;
    }
  }, [editor]);
  useEffect(() => {
    if (discardAndLeave) keepEditing.current?.focus();
  }, [discardAndLeave]);

  function closeEditor() {
    returnTarget.current = editor?.id ?? editor?.kind;
    setDiscardAndLeave(null);
    modified.current = false;
    lastEditorField.current = null;
    setEditor(null);
  }
  function cancelEditor() {
    if (modified.current) setDiscardAndLeave(() => closeEditor);
    else closeEditor();
  }
  const contributes = state.members.some(
    (m) => m.user_id === actor && m.active && m.contributes,
  );
  const name = (id: string) =>
    state.members.find((m) => m.user_id === id)?.name ?? "Partecipante";
  const editing = !!editor && contributes;
  useImperativeHandle(
    props.documentExitGuard,
    () => (leave) => {
      if (!editing) return false;
      if (busy) return true;
      if (!modified.current) return false;
      setDiscardAndLeave((pending) => pending ?? leave);
      return true;
    },
    [editing, busy],
  );
  const documentActions = contributes && (
    <div className={styles.actions}>
      <button
        type="button"
        className="quiet"
        data-document-action="document"
        onClick={() => {
          setSavedDocument(undefined);
          setEditor({ kind: "document" });
        }}
      >
        {uiText("Nuovo documento")}
      </button>
      <button type="button" className="quiet" onClick={() => setGenerate(true)}>
        {uiText("Chiedi un documento a Emme")}
      </button>
      {!personal &&
        state.questions.length > 0 &&
        state.information.length > 0 && (
          <button
            type="button"
            className="quiet"
            data-document-action="brief"
            onClick={() => setEditor({ kind: "brief" })}
          >
            {uiText("Prepara un brief")}
          </button>
        )}
    </div>
  );
  return (
    <section
      ref={panel}
      className="card source-work"
      aria-label={
        personal ? uiText("Documenti personali") : uiText("Brief e Artifacts")
      }
    >
      {editing && (
        <div>
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={cancelEditor}
          >
            {uiText("Torna al raccoglitore")}
          </button>
          <h2 tabIndex={-1} ref={heading}>
            {editor.id
              ? uiText("Revisione del documento")
              : editor.kind === "document"
                ? uiText("Nuovo documento")
                : uiText("Prepara un brief")}
          </h2>
          <p className="hint">
            {uiText("Destinazione: {0} › Documenti di lavoro", destination)}
          </p>
          {discardAndLeave && (
            <div
              className={styles.discard}
              role="group"
              aria-label={uiText("Modifiche non salvate")}
            >
              <p>{uiText("Vuoi scartare le modifiche a questa bozza?")}</p>
              <div className="actions">
                <button
                  ref={keepEditing}
                  type="button"
                  onClick={() => {
                    setDiscardAndLeave(null);
                    const field = lastEditorField.current;
                    (field?.isConnected ? field : heading.current)?.focus();
                  }}
                >
                  {uiText("Continua a scrivere")}
                </button>
                <button
                  type="button"
                  className="quiet"
                  onClick={discardAndLeave}
                >
                  {uiText("Scarta modifiche")}
                </button>
              </div>
            </div>
          )}
          <div
            onFocusCapture={(event) => {
              if (event.target.matches("input, textarea, select"))
                lastEditorField.current = event.target;
            }}
            onChangeCapture={() => {
              modified.current = true;
            }}
            onClickCapture={(event) => {
              if (
                (editor.id || editor.fromConversation) &&
                event.target instanceof Element &&
                event.target.closest("[data-changes-document]")
              )
                modified.current = true;
            }}
          >
            {editor.kind === "document" ? (
              <ArtifactDocumentEditor
                personal={personal}
                state={state}
                artifactId={editor.id}
                busy={busy}
                command={command}
                action={action}
                onSaved={(saved) => {
                  closeEditor();
                  setSavedDocument(saved);
                }}
                onCancel={cancelEditor}
                handoff={editor.fromConversation ? handoff : undefined}
              />
            ) : (
              <DraftForm
                {...props}
                artifactId={editor.id}
                onSaved={closeEditor}
                onCancel={cancelEditor}
              />
            )}
          </div>
        </div>
      )}
      <div hidden={!!editing}>
        {savedVersion && (
          <div className={styles.savedReceipt}>
            <p role="status">
              {uiText(
                "«{0}» salvato in {1} › Documenti di lavoro.",
                savedVersion.title,
                destination,
              )}
            </p>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                const key =
                  savedVersion.artifact_id + "-" + savedVersion.version;
                const details =
                  document.getElementById("saved-document-" + key) ??
                  document.getElementById("saved-history-" + key);
                if (details instanceof HTMLDetailsElement) {
                  const history = details.parentElement?.closest("details");
                  if (history) history.open = true;
                  details.open = true;
                  details.querySelector("summary")?.focus();
                  details.scrollIntoView({ block: "nearest" });
                }
              }}
            >
              {uiText("Apri il documento salvato")}
            </button>
          </div>
        )}
        {generate && (
          <GeneratedDocument
            workspace={state.workspace.id}
            actor={actor}
            destination={personal ? undefined : state.workspace.name}
            close={() => setGenerate(false)}
          />
        )}
        <SharedFileLibrary
          personal={personal}
          state={state}
          actor={actor}
          busy={busy}
          contributes={contributes}
          command={command}
          action={action}
          openSource={openSource}
          onAskFile={props.onAskFile}
          documentActions={
            personal && contributes ? (
              <details className={styles.createMenu}>
                <summary>{uiText("Crea documento")}</summary>
                {documentActions}
              </details>
            ) : undefined
          }
        />
        {(documents.length > 0 || (!personal && contributes)) && (
          <div className={styles.workingHeader}>
            <h3 className={styles.collectionTitle}>
              {uiText("Documenti di lavoro")} <span>{documents.length}</span>
            </h3>
            {!personal && documentActions}
          </div>
        )}
        {documents.map((a) => {
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
              aria-label={uiText("Artifact: {0}", String(v.title))}
            >
              <h3>{v.title}</h3>
              <p>
                {personal
                  ? uiText("Documento personale")
                  : adopted?.version === v.version
                    ? uiText("Versione adottata")
                    : uiText("Bozza da valutare")}{" "}
                {uiText("· v")}
                {v.version} · {name(v.authored_by)}
              </p>
              {v.outdated_reasons.length > 0 && (
                <p className="processing">
                  {uiText("Da rivalutare: ")}
                  {v.outdated_reasons.join(" · ")}.
                </p>
              )}
              <details id={"saved-document-" + a.id + "-" + v.version}>
                <summary>
                  {personal
                    ? uiText("Leggi il documento")
                    : uiText("Leggi il documento e le fonti")}
                </summary>
                {!personal && (
                  <p className="hint">
                    {uiText(
                      "Le note restano parte del documento. Decisioni e impegni si adottano separatamente.",
                    )}
                  </p>
                )}
                <ArtifactBody
                  blocks={v.blocks}
                  body={v.body}
                  workspace={state.workspace.id}
                />
                {!personal && (
                  <SourceLinks
                    state={state}
                    artifactId={a.id}
                    version={v.version}
                    openSource={openSource}
                  />
                )}
              </details>
              {!personal && adoptedReview && (
                <p>
                  {uiText("Adottata v")}
                  {adoptedReview.artifact_version}
                  {uiText(" dalle persone nominate: ")}
                  {adoptedReview.people.map(name).join(", ")}
                  {uiText(". Nessun consenso attribuito agli altri membri.")}
                </p>
              )}
              {!personal && adopted && adopted.version !== v.version && (
                <details>
                  <summary>
                    {uiText("Versione adottata ancora in uso · v")}
                    {adopted.version}
                  </summary>
                  <ArtifactBody
                    blocks={adopted.blocks}
                    body={adopted.body}
                    workspace={state.workspace.id}
                  />
                  {adopted.outdated_reasons.length > 0 && (
                    <p className="processing">
                      {uiText("Base da rivalutare: ")}
                      {adopted.outdated_reasons.join(" · ")}
                    </p>
                  )}
                </details>
              )}
              <button
                type="button"
                className="quiet"
                onClick={() =>
                  saveMarkdown(
                    v.title,
                    v.version,
                    v.body,
                    v.blocks,
                    state.workspace.id,
                  )
                }
              >
                {uiText("Scarica copia modificabile")}
              </button>
              {!personal &&
                contributes &&
                adopted?.version !== v.version &&
                v.outdated_reasons.length === 0 && (
                  <details>
                    <summary>
                      {uiText("Richiedi adozione di questa versione")}
                    </summary>
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
                        {uiText(
                          "Ogni persona nominata approva questa specifica versione soltanto per sé. L’adozione non concede mandati per versioni future.",
                        )}
                      </p>
                      {adoptedReview ? (
                        <p>
                          {uiText(
                            "La revisione mantiene il perimetro rappresentato:",
                          )}{" "}
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
                        {uiText(
                          "Propongo l’uso del brief come documento di lavoro non operativo.",
                        )}
                      </label>
                      <button disabled={busy}>
                        {uiText("Avvia review nominativa")}
                      </button>
                    </form>
                  </details>
                )}
              {!personal &&
                reviews.map((r) => {
                  const approvals = state.artifactApprovals.filter(
                    (p) =>
                      p.review_id === r.id &&
                      p.access_revision === state.workspace.access_revision,
                  );
                  const already = approvals.some((p) => p.person_id === actor);
                  return (
                    <div key={r.id} className="proposal">
                      <p>
                        {uiText("Review v")}
                        {r.artifact_version}
                        {uiText(" · proposta di")} {name(r.proposed_by)}
                      </p>
                      <ul>
                        {r.people.map((p) => (
                          <li key={p}>
                            {name(p)} ·{" "}
                            {approvals.some((x) => x.person_id === p)
                              ? uiText("approvazione registrata")
                              : uiText("in attesa di un atto esplicito")}
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
                          {uiText("Approvo per me il brief v")}
                          {r.artifact_version}
                        </button>
                      )}
                    </div>
                  );
                })}
              <details>
                <summary>
                  {personal || v.blocks
                    ? uiText("Storia del documento")
                    : uiText("Storia del brief")}
                </summary>
                {state.artifactVersions
                  .filter((x) => x.artifact_id === a.id)
                  .map((x) => (
                    <div key={x.version}>
                      <h4>
                        {uiText("v")}
                        {x.version} · {name(x.authored_by)} ·{" "}
                        {new Date(x.created_at).toLocaleString(uiLocale)}
                      </h4>
                      <p>{x.reason}</p>
                      {!personal && (
                        <p className="hint">
                          {x.origin === "human_revision"
                            ? uiText("Revisione umana")
                            : uiText(
                                "Raccolta dei riferimenti selezionati",
                              )}{" "}
                          {uiText("· domanda v")}
                          {x.question_version}
                          {uiText(" · contesto")} {x.context_revision}
                          {x.provider ? ` · ${x.provider} / ${x.model}` : ""}
                        </p>
                      )}
                      <details id={"saved-history-" + a.id + "-" + x.version}>
                        <summary>
                          {uiText("Contenuto v")}
                          {x.version}
                        </summary>
                        <button
                          type="button"
                          className="quiet"
                          onClick={() =>
                            saveMarkdown(
                              x.title,
                              x.version,
                              x.body,
                              x.blocks,
                              state.workspace.id,
                            )
                          }
                        >
                          {uiText("Scarica v")}
                          {x.version}
                        </button>
                        <ArtifactBody
                          blocks={x.blocks}
                          body={x.body}
                          workspace={state.workspace.id}
                        />
                        {!personal && (
                          <SourceLinks
                            state={state}
                            artifactId={a.id}
                            version={x.version}
                            openSource={openSource}
                          />
                        )}
                      </details>
                    </div>
                  ))}
                {!personal &&
                  state.artifactAdoptions
                    .filter((x) => x.artifact_id === a.id)
                    .map((x) => {
                      const r = state.artifactReviews.find(
                        (r) => r.id === x.review_id,
                      )!;
                      return (
                        <p key={x.id}>
                          {uiText("Adozione v")}
                          {r.artifact_version} · {r.people.map(name).join(", ")}{" "}
                          · {new Date(x.created_at).toLocaleString(uiLocale)}
                        </p>
                      );
                    })}
              </details>
            </article>
          );
        })}
        {!personal && <ProductHelp screen="artifacts" />}
      </div>
    </section>
  );
}
function SourceLinks({
  state,
  artifactId,
  version,
  openSource,
}: {
  state: Snapshot;
  artifactId: string;
  version: number;
  openSource: (id: string) => void;
}) {
  const { t: uiText } = useUiLanguage();
  return (
    <div>
      <h4>{uiText("Fonti e riferimenti")}</h4>
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
                {info?.subject}
                {uiText(" · versione accettata ")}
                {r.information_version}
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
                <button
                  type="button"
                  className="quiet source-link"
                  onClick={() => openSource(r.source_id)}
                >
                  {source?.title ??
                    (message
                      ? `${message.author_name}: ${message.content.slice(0, 80)}`
                      : uiText("Fonte originale"))}
                  {source?.document_version
                    ? uiText(" · v{0}", String(source.document_version))
                    : ""}
                </button>{" "}
                ·{" "}
                {r.explicitly_selected
                  ? uiText("selezionata")
                  : uiText("origine conservata")}
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
  onCancel,
}: Props & { artifactId?: string; onSaved: () => void; onCancel: () => void }) {
  const { t: uiText } = useUiLanguage();
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
        {uiText("Titolo del brief")}
        <input
          name="title"
          required
          maxLength={160}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        {uiText("Domanda di riferimento")}
        <select
          name="question"
          required
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        >
          <option value="" disabled>
            {uiText("Scegli una domanda e la versione corrente")}
          </option>
          {questionStale && (
            <option value={question} disabled>
              {uiText("Domanda selezionata · v")}
              {question.split(":")[1]}
              {uiText(" · da riesaminare")}
            </option>
          )}
          {state.questions.map((q) => (
            <option value={`${q.id}:${q.version}`} key={`${q.id}:${q.version}`}>
              {q.content}
              {uiText(" · v")}
              {q.version}
            </option>
          ))}
        </select>
        {questionStale && (
          <span className="processing">
            {uiText(
              "La domanda selezionata è cambiata. Esamina e scegli esplicitamente la versione da usare.",
            )}
          </span>
        )}
      </label>
      <fieldset>
        <legend>{uiText("Informazioni accettate da includere")}</legend>
        <ArtifactInformationSelection
          state={state}
          selected={selected}
          onChange={setSelected}
        />
      </fieldset>
      {(state.sources.length > 0 || sourceIds.length > 0) && (
        <fieldset>
          <legend>
            {uiText("Fonti aggiuntive da esaminare (facoltative)")}
          </legend>
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
                {s.document_version
                  ? uiText(" · v{0}", String(s.document_version))
                  : ""}
                {!isCurrentSource(s.id)
                  ? uiText(" · selezione da riesaminare")
                  : ""}
              </label>
            ))}
          {sourceIds
            .filter((id) => !state.sources.some((s) => s.id === id))
            .map((id) => (
              <p key={id}>
                {uiText("Fonte storica selezionata · ")}
                {id}{" "}
                <button
                  type="button"
                  className="quiet"
                  data-changes-document
                  onClick={() =>
                    setSources((old) => old.filter((s) => s !== id))
                  }
                >
                  {uiText("Rimuovi riferimento")}
                </button>
              </p>
            ))}
          {staleSources.length > 0 && (
            <p className="processing">
              {uiText(
                "Una fonte selezionata non è più corrente. Rimuovi il vecchio riferimento e seleziona esplicitamente la nuova versione, se pertinente.",
              )}
            </p>
          )}
        </fieldset>
      )}
      <label>
        {uiText("Note e ipotesi della bozza")}
        <textarea
          name="notes"
          maxLength={12000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={uiText(
            "Osservazioni da discutere; non sono decisioni o impegni.",
          )}
        />
      </label>
      {base && (
        <label>
          {uiText("Motivo della revisione")}
          <input name="reason" required maxLength={4000} />
        </label>
      )}
      <div className="actions">
        <button
          disabled={
            busy ||
            stale ||
            questionStale ||
            informationStale ||
            staleSources.length > 0
          }
        >
          {base ? uiText("Salva nuova bozza") : uiText("Crea bozza del brief")}
        </button>
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={onCancel}
        >
          {uiText("Annulla")}
        </button>
      </div>
    </form>
  );
}
