"use client";
import { useUiLanguage } from "./ui-language";

import type { Snapshot } from "./types";
import type { Command } from "@/contracts/commands";
export function WorkspaceQuestions({
  state,
  command,
  action,
  busy,
  actor,
  openSource,
}: {
  state: Snapshot;
  command: (c: Command) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  actor: string;
  openSource: (id: string) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const mayContribute = state.members.some(
    (m) => m.user_id === actor && m.active && m.contributes,
  );
  const name = (id: string) =>
    state.members.find((m) => m.user_id === id)?.name ?? "Partecipante";
  return (
    <section
      className="card source-work"
      aria-label={uiText("Domande dello spazio")}
    >
      <h2>{uiText("Domande dello spazio")}</h2>
      {!state.questions.length && (
        <p className="hint">{uiText("Nessuna domanda registrata.")}</p>
      )}
      {mayContribute &&
        (state.messages.length > 0 || state.sources.length > 0) && (
          <details>
            <summary>{uiText("Aggiungi una domanda")}</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const data = new FormData(form);
                void action(async () => {
                  await command({
                    type: "question.open",
                    sourceId: String(data.get("source")),
                    content: String(data.get("content")),
                  });
                  form.reset();
                });
              }}
            >
              <label>
                {uiText("Domanda da chiarire")}
                <input name="content" maxLength={4000} required />
              </label>
              <label>
                {uiText("Fonte che motiva la domanda")}
                <select name="source" required defaultValue="">
                  <option value="" disabled>
                    {uiText("Scegli una fonte dello spazio")}
                  </option>
                  {state.messages.map((m) => (
                    <option value={m.id} key={m.id}>
                      {m.author_name}: {m.content.slice(0, 100)}
                    </option>
                  ))}
                  {state.sources.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.title}
                      {s.document_version
                        ? uiText(" · v{0}", String(s.document_version))
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy}>{uiText("Registra domanda")}</button>
            </form>
          </details>
        )}
      {state.questions.map((q) => (
        <article
          className="source-work-item"
          key={q.id}
          id={`question-${q.id}`}
        >
          <h3>{q.content}</h3>
          <p>
            {q.status === "open"
              ? uiText("Da chiarire")
              : uiText("Risposta di lavoro collegata")}{" "}
            {uiText("· v")}
            {q.version} · {name(q.recorded_by)}
          </p>
          <button
            type="button"
            className="quiet source-link"
            onClick={() => openSource(q.source_id)}
          >
            {uiText("Fonte della domanda")}
          </button>
          {q.status === "answered" && (
            <>
              <p>
                {
                  state.versions.find(
                    (v) =>
                      v.information_id === q.answer_information_id &&
                      v.version === q.answer_information_version,
                  )?.content
                }
              </p>
              <p className="hint">
                {uiText("Riferimento accettato v")}
                {q.answer_information_version}
                {uiText(
                  ". Questo collegamento non modifica decisioni, vincoli o impegni.",
                )}
              </p>
              {state.information.find((i) => i.id === q.answer_information_id)
                ?.current_version !== q.answer_information_version && (
                <p className="processing">
                  {uiText(
                    "Il riferimento ha una versione più recente: rivaluta questa risposta.",
                  )}
                </p>
              )}
            </>
          )}
          {mayContribute && (
            <details key={q.version}>
              <summary>
                {q.status === "open"
                  ? uiText("Collega una risposta")
                  : uiText("Rivedi la risposta")}
              </summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  const reason = String(data.get("reason"));
                  void action(async () => {
                    if (q.status === "answered")
                      await command({
                        type: "question.reopen",
                        questionId: q.id,
                        expectedVersion: q.version,
                        reason,
                      });
                    else {
                      const [informationId, version] = String(
                        data.get("answer"),
                      ).split(":");
                      await command({
                        type: "question.answer",
                        questionId: q.id,
                        expectedVersion: q.version,
                        reason,
                        informationId,
                        informationVersion: Number(version),
                      });
                    }
                  });
                }}
              >
                {q.status === "open" && (
                  <label>
                    {uiText("Riferimento che risponde alla domanda")}
                    <select name="answer" required defaultValue="">
                      <option value="" disabled>
                        {uiText("Scegli un’informazione già accettata")}
                      </option>
                      {state.information.map((i) => (
                        <option
                          value={`${i.id}:${i.current_version}`}
                          key={i.id}
                        >
                          {i.subject}
                          {uiText(" · v")}
                          {i.current_version}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  {uiText("Motivo")}
                  <input name="reason" required maxLength={4000} />
                </label>
                <button
                  disabled={
                    busy || (q.status === "open" && !state.information.length)
                  }
                >
                  {q.status === "open"
                    ? uiText("Collega risposta accettata")
                    : uiText("Riapri la domanda")}
                </button>
              </form>
            </details>
          )}
          <details>
            <summary>{uiText("Storia della domanda")}</summary>
            <ul>
              {state.questionHistory
                .filter((v) => v.question_id === q.id)
                .map((v) => (
                  <li key={v.version}>
                    {uiText("v")}
                    {v.version} ·{" "}
                    {v.status === "open"
                      ? uiText("Aperta")
                      : uiText("Risposta collegata")}{" "}
                    · {name(v.recorded_by)} · {v.reason}
                  </li>
                ))}
            </ul>
          </details>
        </article>
      ))}
    </section>
  );
}
