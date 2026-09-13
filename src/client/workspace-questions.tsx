"use client";
import type { Snapshot } from "./types";
import type { Command } from "@/contracts/commands";
export function WorkspaceQuestions({
  state,
  command,
  action,
  busy,
  actor,
}: {
  state: Snapshot;
  command: (c: Command) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  actor: string;
}) {
  const mayContribute = state.members.some(
    (m) => m.user_id === actor && m.active && m.contributes,
  );
  const name = (id: string) =>
    state.members.find((m) => m.user_id === id)?.name ?? "Partecipante";
  return (
    <section className="card source-work" aria-label="Domande dello spazio">
      <h2>Domande aperte</h2>
      <p className="hint">
        Una domanda conserva un’incertezza. Non accetta le sue premesse e non
        assegna un impegno.
      </p>
      {mayContribute &&
        (state.messages.length > 0 || state.sources.length > 0) && (
          <details>
            <summary>Aggiungi una domanda</summary>
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
                Domanda da chiarire
                <input name="content" maxLength={4000} required />
              </label>
              <label>
                Fonte che motiva la domanda
                <select name="source" required defaultValue="">
                  <option value="" disabled>
                    Scegli una fonte dello spazio
                  </option>
                  {state.messages.map((m) => (
                    <option value={m.id} key={m.id}>
                      {m.author_name}: {m.content.slice(0, 100)}
                    </option>
                  ))}
                  {state.sources.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.title}
                      {s.document_version ? ` · v${s.document_version}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy}>Registra domanda</button>
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
              ? "Da chiarire"
              : "Risposta di lavoro collegata"}{" "}
            · v{q.version} · {name(q.recorded_by)}
          </p>
          <a href={`#source-${q.source_id}`}>Fonte della domanda</a>
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
                Riferimento accettato v{q.answer_information_version}. Questo
                collegamento non modifica decisioni, vincoli o impegni.
              </p>
              {state.information.find((i) => i.id === q.answer_information_id)
                ?.current_version !== q.answer_information_version && (
                <p className="processing">
                  Il riferimento ha una versione più recente: rivaluta questa
                  risposta.
                </p>
              )}
            </>
          )}
          {mayContribute && (
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
                  Riferimento che risponde alla domanda
                  <select name="answer" required defaultValue="">
                    <option value="" disabled>
                      Scegli un’informazione già accettata
                    </option>
                    {state.information.map((i) => (
                      <option value={`${i.id}:${i.current_version}`} key={i.id}>
                        {i.subject} · v{i.current_version}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Motivo
                <input name="reason" required maxLength={4000} />
              </label>
              <button
                disabled={
                  busy || (q.status === "open" && !state.information.length)
                }
              >
                {q.status === "open"
                  ? "Collega risposta accettata"
                  : "Riapri la domanda"}
              </button>
            </form>
          )}
          <details>
            <summary>Storia della domanda</summary>
            <ul>
              {state.questionHistory
                .filter((v) => v.question_id === q.id)
                .map((v) => (
                  <li key={v.version}>
                    v{v.version} ·{" "}
                    {v.status === "open" ? "Aperta" : "Risposta collegata"} ·{" "}
                    {name(v.recorded_by)} · {v.reason}
                  </li>
                ))}
            </ul>
          </details>
        </article>
      ))}
    </section>
  );
}
