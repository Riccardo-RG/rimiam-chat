"use client";
import { localizedDate } from "../shared/i18n/date";
import { useUiLanguage } from "./ui-language";

import { PrivateWorkspaceReading } from "./private-consultation";
import type { ConsultationRef } from "../contracts/private-consultation";
import { useState } from "react";
import type { Command } from "../contracts/commands";
import type { ConversationHandoff } from "../contracts/conversation-handoff";
import type { Candidate, Snapshot } from "./types";
import { ProductHelp } from "./product-help";
import { ContextReadings } from "./context-readings";
import { WorkspaceQuestions } from "./workspace-questions";
import { WorkspaceIcon } from "./workspace-icon";
import styles from "./workspace-context.module.css";

type View = "references" | "review" | "questions";
type Period = "all" | "week" | "earlier";
const views = {
  references: "Riferimenti",
  review: "Da valutare",
  questions: "Domande",
} as const;
const kinds = {
  descriptive: "Informazione proposta",
  question: "Domanda proposta",
  normative: "Possibile impegno",
  uncertain: "Da chiarire",
};
const date = localizedDate({
  day: "numeric",
  month: "short",
  year: "numeric",
});
const dateTime = localizedDate({
  dateStyle: "short",
  timeStyle: "short",
});

export function contextPeriodStart(today: Date) {
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  return start.getTime();
}
export function inContextPeriod(
  createdAt: string,
  period: Period,
  start: number,
) {
  if (period === "all") return true;
  const time = Date.parse(createdAt);
  return period === "week" ? time >= start : time < start;
}

function Origin({ candidate }: { candidate: Candidate }) {
  return candidate.origin === "inferred"
    ? "Deduzione di Emme"
    : "Da una fonte condivisa";
}
function Qualifications({ value }: { value: string }) {
  const { t: uiText } = useUiLanguage();
  if (!value) return null;
  return (
    <div className={styles.notes}>
      <strong>{uiText("Note sulle fonti e sulla lettura")}</strong>
      {value
        .split("\n")
        .filter(Boolean)
        .map((line, i) => (
          <p key={i}>
            {line ===
            "Affermazione umana attribuita, non verificata indipendentemente."
              ? uiText(
                  "Una delle fonti è un messaggio umano. Il suo contenuto non è verificato indipendentemente.",
                )
              : line}
          </p>
        ))}
    </div>
  );
}
function Provenance({
  candidate,
  state,
  openSource,
}: {
  candidate?: Candidate;
  state: Snapshot;
  openSource: (id: string) => void;
}) {
  const { t: uiText } = useUiLanguage();
  if (!candidate) return null;
  return (
    <details className={styles.more}>
      <summary>{uiText("Fonte e attribuzione")}</summary>
      <p>
        {candidate.origin === "inferred"
          ? uiText("Emme ha dedotto questa proposta dalle fonti indicate.")
          : uiText("Emme ha interpretato il contenuto della fonte.")}
      </p>
      <blockquote>
        <cite>{candidate.author_name}</cite>
        {candidate.source_content}
      </blockquote>
      {candidate.source_ids.map((id) => {
        const document = state.sources.find((s) => s.id === id);
        const message = state.messages.find((m) => m.id === id);
        return (
          <button
            type="button"
            className="quiet source-link"
            key={id}
            onClick={() => openSource(id)}
          >
            {document?.title ??
              (message
                ? uiText("Apri messaggio {0}", String(message.sequence))
                : uiText("Apri la fonte originale"))}
          </button>
        );
      })}
    </details>
  );
}

export function WorkspaceContext({
  state,
  openConsulted,
  actor,
  handoff,
  busy,
  aiUnavailable,
  chatFailures,
  command,
  action,
  openSource,
  openDirection,
  correct,
  proposeCommitment,
}: {
  state: Snapshot;
  openConsulted: (ref: ConsultationRef) => void;
  actor: string;
  handoff: ConversationHandoff | null;
  busy: boolean;
  aiUnavailable: boolean;
  chatFailures: Pick<ReadonlyMap<string, unknown>, "has">;
  command: (command: Command) => Promise<unknown>;
  action: (run: () => Promise<void>) => Promise<void>;
  openSource: (id: string) => void;
  openDirection: () => void;
  correct: (candidate: Candidate) => void;
  proposeCommitment: (candidate: Candidate) => void;
}) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const [inspect, setInspect] = useState(!!handoff);
  const [view, setView] = useState<View>(
    handoff?.candidateId ? "review" : "references",
  );
  const [period, setPeriod] = useState<Period>("all");
  const [periodStart, setPeriodStart] = useState(0);
  const pending = state.candidates.filter(
    (c) =>
      !c.uses.information.length &&
      !c.uses.questions.length &&
      !c.uses.proposals.length,
  );
  const counts = {
    references: state.information.length,
    review: pending.length,
    questions: state.questions.length,
  };
  const disabled =
    busy ||
    !state.members.some(
      (m) => m.user_id === actor && m.active && m.contributes,
    );
  const accepted = state.information.filter((i) =>
    inContextPeriod(i.created_at, period, periodStart),
  );
  const proposals = pending.filter((c) =>
    inContextPeriod(c.created_at, period, periodStart),
  );
  const run = (c: Command) =>
    void action(async () => {
      await command(c);
    });
  const noMatches = (
    <div className={styles.empty}>
      {uiText("Nessun aggiornamento in questo periodo.")}{" "}
      <button className="quiet" type="button" onClick={() => setPeriod("all")}>
        {uiText("Mostra tutto il periodo")}
      </button>
    </div>
  );
  return (
    <div className={styles.dashboard}>
      <PrivateWorkspaceReading
        actor={actor}
        workspace={state.workspace.id}
        open={openConsulted}
        canShare={!disabled}
      />
      <button
        className="quiet"
        aria-expanded={inspect}
        type="button"
        onClick={() => setInspect((v) => !v)}
      >
        {inspect
          ? uiText("Chiudi riferimenti e proposte")
          : uiText("Consulta riferimenti e proposte")}
      </button>
      {inspect && (
        <>
          <p className={styles.intro}>
            {uiText(
              "Ritrova le informazioni accettate nello spazio, verifica le proposte di Emme e segui le domande ancora aperte.",
            )}
          </p>
          <div
            className={styles.sectors}
            role="group"
            aria-label={uiText("Sezioni del contesto")}
          >
            {(Object.keys(views) as View[]).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={v === view}
                aria-label={views[v]}
                aria-describedby={`context-count-${v}`}
                onClick={() => setView(v)}
              >
                <span>{views[v]}</span>
                <strong id={`context-count-${v}`}>{counts[v]}</strong>
              </button>
            ))}
          </div>
          {view !== "questions" && (
            <div className={styles.toolbar}>
              <h2>
                {view === "references"
                  ? uiText("Riferimenti accettati")
                  : uiText("Proposte da verificare")}
              </h2>
              {counts[view] > 0 && (
                <label>
                  {view === "references"
                    ? uiText("Ultima accettazione")
                    : uiText("Data della proposta")}
                  <select
                    value={period}
                    onChange={(e) => {
                      setPeriodStart(contextPeriodStart(new Date()));
                      setPeriod(e.target.value as Period);
                    }}
                  >
                    <option value="all">{uiText("Tutto il periodo")}</option>
                    <option value="week">{uiText("Ultimi 7 giorni")}</option>
                    <option value="earlier">
                      {uiText("Più di 7 giorni fa")}
                    </option>
                  </select>
                </label>
              )}
            </div>
          )}
          {view === "references" && (
            <>
              {!state.information.length ? (
                <p className={styles.empty}>
                  {uiText(
                    "Il gruppo non ha ancora scelto informazioni da usare come riferimento.",
                  )}
                </p>
              ) : !accepted.length ? (
                noMatches
              ) : (
                accepted.map((info) => {
                  const candidate = state.candidates.find(
                    (c) => c.id === info.candidate_id,
                  );
                  const name =
                    state.members.find((m) => m.user_id === info.accepted_by)
                      ?.name ?? "Membro";
                  return (
                    <details
                      key={info.id}
                      className={`${styles.record} information`}
                    >
                      <summary>
                        <span className={styles.summaryText}>
                          <strong>{info.subject}</strong>
                          {info.content !== info.subject && (
                            <span className={styles.preview}>
                              {info.content}
                            </span>
                          )}
                          <span>
                            {uiText("Accettata da ")}
                            {name} ·{" "}
                            {date(uiLocale).format(new Date(info.created_at))}
                            {uiText(" · v")}
                            {info.current_version}
                          </span>
                        </span>
                        <WorkspaceIcon name="chevron" />
                      </summary>
                      <div className={styles.detail}>
                        <p className={styles.body}>{info.content}</p>
                        {candidate && (
                          <p className={styles.meta}>
                            <Origin candidate={candidate} />
                          </p>
                        )}
                        <Qualifications value={info.qualification} />
                        <Provenance
                          candidate={candidate}
                          state={state}
                          openSource={openSource}
                        />
                        <details className={styles.more}>
                          <summary>
                            {uiText("Fonti e storia delle correzioni")}
                          </summary>
                          {state.versions
                            .filter((v) => v.information_id === info.id)
                            .map((v) => (
                              <div className="version" key={v.version}>
                                <strong>
                                  {uiText("Versione ")}
                                  {v.version} · {v.accepted_by_name}
                                </strong>
                                <p>{v.content}</p>
                                <Qualifications value={v.qualification} />
                                <small>
                                  {v.reason} ·{" "}
                                  {dateTime(uiLocale).format(
                                    new Date(v.created_at),
                                  )}
                                </small>
                                <Provenance
                                  candidate={state.candidates.find(
                                    (c) => c.id === v.candidate_id,
                                  )}
                                  state={state}
                                  openSource={openSource}
                                />
                              </div>
                            ))}
                        </details>
                      </div>
                    </details>
                  );
                })
              )}
              <button type="button" className="quiet" onClick={openDirection}>
                {uiText("Vedi obiettivo, decisioni e deleghe ")}
                <span aria-hidden="true">→</span>
              </button>
            </>
          )}
          {view === "review" && (
            <>
              {!pending.length ? (
                <p className={styles.empty}>
                  {uiText("Nessuna proposta in attesa di verifica.")}
                </p>
              ) : !proposals.length ? (
                noMatches
              ) : (
                proposals.map((c) => {
                  const info = state.information.find(
                    (i) => i.subject === c.subject,
                  );
                  const targeted = handoff?.candidateId === c.id;
                  return (
                    <details
                      id={`candidate-${c.id}`}
                      tabIndex={-1}
                      key={c.id}
                      open={targeted}
                      className={`${styles.record} proposal${targeted ? " linked-handoff-target" : ""}`}
                    >
                      <summary>
                        <span className={styles.summaryText}>
                          <strong>{c.subject}</strong>
                          <span>
                            {uiText(kinds[c.classification])} ·{" "}
                            <Origin candidate={c} />
                          </span>
                        </span>
                        <WorkspaceIcon name="chevron" />
                      </summary>
                      <div className={styles.detail}>
                        <p className={styles.body}>{c.content}</p>
                        <small>
                          {dateTime(uiLocale).format(new Date(c.created_at))}
                        </small>
                        {info && info.content !== c.content && (
                          <div className={styles.warning}>
                            <strong>
                              {uiText("Riferimento attuale · v")}
                              {info.current_version}
                            </strong>
                            <p>{info.content}</p>
                          </div>
                        )}
                        <Qualifications value={c.qualification} />
                        <Provenance
                          candidate={c}
                          state={state}
                          openSource={openSource}
                        />
                        {c.context_revision !==
                        state.workspace.context_revision ? (
                          <button
                            type="button"
                            className="quiet"
                            disabled={disabled}
                            onClick={() =>
                              run({
                                type: "interpretation.retry",
                                interpretationId: c.interpretation_id,
                              })
                            }
                          >
                            {uiText("Rileggi alla luce degli aggiornamenti")}
                          </button>
                        ) : (
                          <div className={styles.actions}>
                            {c.classification === "question" && (
                              <button
                                type="button"
                                disabled={disabled}
                                onClick={() =>
                                  run({
                                    type: "question.open",
                                    sourceId: c.source_id,
                                    candidateId: c.id,
                                    content: c.content,
                                  })
                                }
                              >
                                {uiText("Conserva come domanda aperta")}
                              </button>
                            )}
                            {c.classification === "descriptive" &&
                              (info ? (
                                <button
                                  type="button"
                                  disabled={disabled}
                                  onClick={() => correct(c)}
                                >
                                  {uiText("Valuta come correzione")}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={disabled}
                                  onClick={() =>
                                    run({
                                      type: "information.accept",
                                      candidateId: c.id,
                                      descriptiveOnly: true,
                                      ...(targeted &&
                                      handoff?.kind === "information.accept"
                                        ? {
                                            conversationOrigin: {
                                              handoffId: handoff.id,
                                            },
                                          }
                                        : {}),
                                    })
                                  }
                                >
                                  {uiText(
                                    "Accetta come riferimento descrittivo",
                                  )}
                                </button>
                              ))}
                            {(c.classification === "normative" ||
                              c.classification === "uncertain") && (
                              <p className={styles.meta}>
                                {uiText(
                                  "Puoi chiarire il significato in chat. Per assumere un impegno servono le approvazioni pertinenti.",
                                )}
                              </p>
                            )}
                            <button
                              type="button"
                              className="quiet"
                              disabled={disabled}
                              onClick={() => proposeCommitment(c)}
                            >
                              {uiText("Proponi come impegno esplicito")}
                            </button>
                          </div>
                        )}
                      </div>
                    </details>
                  );
                })
              )}
            </>
          )}
          {view === "questions" && (
            <WorkspaceQuestions
              state={state}
              actor={actor}
              command={command}
              action={action}
              busy={busy}
              openSource={openSource}
            />
          )}
          <ContextReadings
            state={state}
            chatFailures={chatFailures}
            disabled={disabled}
            openSource={openSource}
            retry={(id) =>
              run({ type: "interpretation.retry", interpretationId: id })
            }
          />
          <ProductHelp screen="information" />
          {aiUnavailable && (
            <p className={styles.meta}>
              {uiText("Lettura AI non disponibile.")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
