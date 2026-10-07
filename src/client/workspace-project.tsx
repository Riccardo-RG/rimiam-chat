"use client";
import { ProductHelp } from "./product-help";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Command } from "@/contracts/commands";
import type { ProjectView, ProjectCommand } from "@/contracts/project";
import type { ConversationHandoff } from "@/contracts/conversation-handoff";
type GoalMode = Extract<ProjectCommand, { type: "goal.propose" }>["mode"];
type SelectedGoal = { id: string; version: number; content: string };
type Capability = Extract<
  ProjectCommand,
  { type: "mandate.offer" }
>["capability"];
const modes: Record<GoalMode, string> = {
  revise: "Nuova versione dello stesso Goal",
  replace: "Nuovo Goal che sostituisce il precedente",
  subgoal: "Sub-goal",
  complete: "Dichiarare concluso il Goal",
  abandon: "Abbandonare il Goal",
};
const capabilities: Record<Capability, string> = {
  "goal.change": "Modificare o sostituire questo Goal",
  "goal.conclude": "Concludere o abbandonare questo Goal",
  "goal.subgoal": "Stabilire un Sub-goal",
  "act.create": "Prendere un atto su questo Goal",
  "act.replace": "Sostituire questo atto",
  "act.revoke": "Revocare questo atto",
};
const kinds = {
  decision: "Decisione",
  constraint: "Vincolo",
  commitment: "Impegno",
};
export function WorkspaceProject({
  workspace,
  actor,
  revision = 0,
  command,
  action,
  busy,
  handoff,
}: {
  workspace: string;
  actor: string;
  revision?: number;
  command: (c: Command) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  handoff?: ConversationHandoff;
}) {
  const [loaded, setLoaded] = useState<{
      workspace: string;
      view: ProjectView;
    } | null>(null),
    [error, setError] = useState("");
  const [mode, setMode] = useState<GoalMode>("revise"),
    [goalEdit, setGoalEdit] = useState<{
      id: string;
      version: number;
      content: string;
      proposed: string;
    } | null>(null),
    [scopeKind, setScopeKind] = useState<"goal" | "act">("goal"),
    [editingAct, setEditingAct] = useState<string>(""),
    [operation, setOperation] = useState<"establish" | "replace" | "revoke">(
      handoff?.kind === "project.replace"
        ? "replace"
        : handoff?.kind === "project.revoke"
          ? "revoke"
          : "establish",
    );
  const url = `/api/v1/workspaces/${workspace}/project`;
  const [actGoal, setActGoal] = useState<SelectedGoal | null>(null);
  const [mandateHolder, setMandateHolder] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [mandateScope, setMandateScope] = useState<{
    id: string;
    version: number;
    label: string;
  } | null>(null);
  const initializedGoalHandoff = useRef("");
  const initializedActHandoff = useRef("");
  useEffect(() => {
    let live = true,
      running = false;
    const read = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        const view = await api<ProjectView>(url);
        if (live) {
          setLoaded({ workspace, view });
          setError("");
          if (
            handoff?.status === "ready" &&
            ["project.replace", "project.revoke"].includes(handoff.kind) &&
            initializedActHandoff.current !== handoff.id
          ) {
            const target = view.acts.find(
              (a) => a.proposalId === handoff.target?.id,
            );
            if (target?.actId) {
              initializedActHandoff.current = handoff.id;
              setEditingAct(target.actId);
            }
          }
          if (
            handoff?.kind === "goal.change" &&
            handoff.status === "ready" &&
            handoff.target &&
            initializedGoalHandoff.current !== handoff.id
          ) {
            const target = view.goals.find((g) => g.id === handoff.target!.id);
            const base = target?.versions.find(
              (v) => v.version === handoff.target!.version,
            );
            if (target && base) {
              initializedGoalHandoff.current = handoff.id;
              setGoalEdit({
                id: target.id,
                version: base.version,
                content: base.content,
                proposed: handoff.suggestedText,
              });
            }
          }
        }
      } catch (e) {
        if (live) {
          if (
            [
              "ACCOUNT_INELIGIBLE",
              "WORKSPACE_ACCESS_DENIED",
              "AUTHENTICATION_REQUIRED",
              "AUTHENTICATED_SESSION_REQUIRED",
            ].includes((e as Error).message)
          )
            setLoaded(null);
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
  }, [url, workspace, actor, revision, handoff]);
  const view = loaded?.workspace === workspace ? loaded.view : null;
  const root = useRef<HTMLElement>(null);
  const revealedPrepared = useRef("");
  const prepared = handoff?.application?.prepared;
  useEffect(() => {
    if (!prepared || revealedPrepared.current === prepared.id) return;
    const element = root.current?.querySelector<HTMLElement>(
      `[data-prepared-id="${CSS.escape(prepared.id)}"]`,
    );
    if (element) {
      element.closest("details")?.setAttribute("open", "");
      element.scrollIntoView({ block: "center" });
      element.focus({ preventScroll: true });
      revealedPrepared.current = prepared.id;
    }
  }, [prepared, view]);
  const handoffAct =
    handoff?.status === "ready"
      ? view?.acts.find(
          (a) =>
            a.proposalId === handoff.target?.id && a.status === "effective",
        )
      : undefined;
  const actId = editingAct || handoffAct?.actId || "";
  const originFor = (c: Command) => {
    if (!handoff || handoff.status !== "ready") return {};
    const matches =
      (c.type === "goal.establish" && handoff.kind === "goal.establish") ||
      (c.type === "goal.propose" &&
        handoff.kind === "goal.change" &&
        c.goalId === handoff.target?.id) ||
      (c.type === "project.propose" &&
        ((c.operation === "establish" && handoff.kind === "project.propose") ||
          (c.operation === "replace" &&
            handoff.kind === "project.replace" &&
            c.replacesActId === handoffAct?.actId) ||
          (c.operation === "revoke" &&
            handoff.kind === "project.revoke" &&
            c.replacesActId === handoffAct?.actId)));
    return matches ? { conversationOrigin: { handoffId: handoff.id } } : {};
  };
  const perform = (c: Command) =>
    action(async () => {
      const origin = originFor(c);
      if (
        handoff &&
        ["goal.establish", "goal.propose", "project.propose"].includes(
          c.type,
        ) &&
        !origin.conversationOrigin
      )
        throw new Error(
          "Questo percorso non corrisponde più alla proposta selezionata. Rivalutala o esci dal percorso prima di preparare un altro atto.",
        );
      await command({ ...c, ...origin });
      try {
        setLoaded({ workspace, view: await api<ProjectView>(url) });
      } catch {
        setError(
          "Operazione registrata. Non è stato possibile aggiornare la vista: sarà ricaricata automaticamente.",
        );
      }
    });
  const name = (id: string) =>
    view?.members.find((m) => m.id === id)?.name ?? "Partecipante storico";
  const people = (field: string, required = false) => (
    <fieldset>
      <legend>
        {required
          ? "Persone rappresentate da questo atto"
          : "Altre persone coinvolte, se pertinenti"}
      </legend>
      {view?.members
        .filter((m) => m.active && m.eligible)
        .map((m) => (
          <label key={m.id}>
            <input
              type="checkbox"
              name={field}
              value={m.id}
              defaultChecked={required && m.id === actor}
            />
            {m.name}
          </label>
        ))}
    </fieldset>
  );
  const approvals = (
    ids: string[],
    records: ProjectView["acts"][number]["approvals"],
    scope: { kind: "goal" | "act"; id: string; version: number },
    capability: Capability,
    base:
      | { type: "project.approve"; proposalId: string }
      | { type: "goal.approve"; transitionId: string },
    enabled: boolean,
  ) => (
    <div>
      {ids.map((person) => (
        <div key={person}>
          <p>
            {name(person)}:{" "}
            {records.some((r) => r.personId === person)
              ? "atto di approvazione registrato"
              : "approvazione richiesta"}
          </p>
          {records
            .filter((r) => r.personId === person)
            .map((r) => (
              <small key={`${r.personId}:${r.actorId}`}>
                Da {name(r.actorId)}
                {r.mandateId
                  ? ` con mandato v${r.mandateVersion}`
                  : " per sé"}{" "}
                · {new Date(r.createdAt).toLocaleString()}
              </small>
            ))}
          {enabled && person === actor && (
            <button
              disabled={busy}
              onClick={() =>
                void perform({
                  ...base,
                  expectedAccessRevision: view!.accessRevision,
                  representedPersonId: actor,
                  confirmExactContent: true,
                })
              }
            >
              Approvo questo contenuto per me
            </button>
          )}
          {enabled &&
            view?.mandates
              .filter(
                (m) =>
                  m.available &&
                  m.holderId === actor &&
                  m.grantorId === person &&
                  m.capability === capability &&
                  m.scope.kind === scope.kind &&
                  m.scope.id === scope.id &&
                  m.scope.version === scope.version,
              )
              .map((m) => (
                <button
                  key={m.id}
                  disabled={busy}
                  onClick={() =>
                    void perform({
                      ...base,
                      expectedAccessRevision: view.accessRevision,
                      representedPersonId: person,
                      mandateId: m.id,
                      confirmExactContent: true,
                    })
                  }
                >
                  Approvo per {name(person)} con il mandato indicato v
                  {m.version}
                </button>
              ))}
        </div>
      ))}
    </div>
  );
  const goal = view?.goals.find((g) => g.id === goalEdit?.id),
    effective = view?.acts.filter((a) => a.status === "effective") ?? [];
  const currentGoal = (selected: SelectedGoal) =>
    view?.goals.some(
      (g) =>
        g.id === selected.id &&
        g.version === selected.version &&
        g.status === "active",
    );
  const actGoalStale = actGoal !== null && !currentGoal(actGoal);
  const mandateScopeStale =
    mandateScope !== null &&
    (scopeKind === "goal"
      ? !currentGoal({ ...mandateScope, content: mandateScope.label })
      : !effective.some((a) => a.actId === mandateScope.id));
  const holderEligible =
    mandateHolder !== null &&
    view?.members.some(
      (m) =>
        m.id === mandateHolder.id && m.id !== actor && m.active && m.eligible,
    );
  return (
    <section
      ref={root}
      className="card source-work"
      aria-label="Goal, decisioni e mandati"
    >
      <h2>Goal, decisioni e mandati</h2>
      <ProductHelp screen="goal" />
      <p className="hint">
        Intenzione, adesione, rappresentanza e adozione di un atto sono
        distinte. Una proposta conserva il contenuto e le persone coinvolte
        prima di qualsiasi effetto.
      </p>
      {error && <p role="alert">{error}</p>}
      {view && (
        <>
          {!view.goals.some((g) => g.currentPrimary) && !view.goals.length && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void perform({
                  type: "goal.establish",
                  content: String(new FormData(e.currentTarget).get("content")),
                });
              }}
            >
              <label>
                Il mio intento iniziale
                <textarea
                  name="content"
                  required
                  maxLength={12000}
                  defaultValue={
                    handoff?.kind === "goal.establish" &&
                    handoff.status === "ready"
                      ? handoff.suggestedText
                      : ""
                  }
                />
              </label>
              <button disabled={busy}>
                Stabilisci il Goal come mio intento
              </button>
            </form>
          )}
          {view.goals.map((g) => (
            <article className="item" key={g.id}>
              <h3>{g.content}</h3>
              <p>
                {g.currentPrimary
                  ? "Goal principale"
                  : g.parentGoalId
                    ? "Sub-goal"
                    : "Goal storico"}{" "}
                · versione {g.version} · {g.status}
              </p>
              {g.parentGoalId && (
                <p>
                  Parte di:{" "}
                  {view.goals.find((x) => x.id === g.parentGoalId)?.content} · v
                  {g.parentGoalVersion}
                </p>
              )}
              <p>
                Intenti rappresentati:{" "}
                {g.participants.map(name).join(", ") ||
                  "Nessuno nella versione corrente"}
                . Adesioni a questa versione:{" "}
                {g.adherences
                  .filter((a) => a.version === g.version)
                  .map((a) => name(a.personId))
                  .join(", ") || "Nessuna"}
                .
              </p>
              {g.status === "active" &&
                !g.adherences.some(
                  (a) => a.personId === actor && a.version === g.version,
                ) && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform({
                        type: "goal.adhere",
                        goalId: g.id,
                        version: g.version,
                      })
                    }
                  >
                    Aderisco personalmente a questo Goal v{g.version}
                  </button>
                )}
              {g.status === "active" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    setGoalEdit({
                      id: g.id,
                      version: g.version,
                      content: g.content,
                      proposed: g.content,
                    })
                  }
                >
                  Proponi evoluzione
                </button>
              )}
              <details>
                <summary>Identità, versioni e adesioni</summary>
                <p>Identità: {g.id}</p>
                {g.versions.map((v) => (
                  <article key={v.version}>
                    <strong>
                      v{v.version}: {v.content}
                    </strong>
                    <p>
                      {name(v.actor)} · {new Date(v.createdAt).toLocaleString()}{" "}
                      · {v.reason}
                    </p>
                    {v.sourceId && (
                      <small>Fonte conservata: {v.sourceId}</small>
                    )}
                  </article>
                ))}
                <p>
                  Adesioni storiche:{" "}
                  {g.adherences
                    .map((a) => `${name(a.personId)} → v${a.version}`)
                    .join(", ") || "Nessuna"}
                </p>
                {view.relations
                  .filter((r) => r.fromGoalId === g.id || r.toGoalId === g.id)
                  .map((r) => (
                    <p key={r.id}>
                      {r.kind === "replaces"
                        ? "Sostituzione"
                        : "Relazione Sub-goal"}
                      : {view.goals.find((x) => x.id === r.fromGoalId)?.content}{" "}
                      v{r.fromVersion} →{" "}
                      {view.goals.find((x) => x.id === r.toGoalId)?.content} v
                      {r.toVersion}
                    </p>
                  ))}
              </details>
            </article>
          ))}
          {goal && goalEdit && (
            <form
              key={goalEdit.id}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void perform({
                  type: "goal.propose",
                  goalId: goal.id,
                  expectedVersion: goalEdit.version,
                  mode,
                  content: ["complete", "abandon"].includes(mode)
                    ? goalEdit.content
                    : goalEdit.proposed,
                  reason: String(f.get("reason")),
                  previousBecomesSubgoal: f.has("subgoal"),
                  affectedPeople: f.getAll("people").map(String),
                  blockingActIds: f.getAll("blocking").map(String),
                  preserveExistingObligations: true,
                });
              }}
            >
              <h3>Evoluzione di: {goalEdit.content}</h3>
              <p>Versione di partenza: v{goalEdit.version}</p>
              {goal.version !== goalEdit.version && (
                <div role="alert">
                  <p>
                    Il Goal è cambiato mentre preparavi la proposta. La tua
                    bozza è conservata.
                  </p>
                  <p>
                    Versione attuale v{goal.version}: {goal.content}
                  </p>
                  {handoff ? (
                    <p>
                      Esci dal percorso conversazionale per rivalutare una
                      proposta sulla versione attuale.
                    </p>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setGoalEdit({
                          ...goalEdit,
                          version: goal.version,
                          content: goal.content,
                        })
                      }
                    >
                      Ho confrontato i contenuti: preparo sulla v{goal.version}
                    </button>
                  )}
                </div>
              )}
              <label>
                Tipo di cambiamento
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as GoalMode)}
                >
                  {Object.entries(modes).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {!["complete", "abandon"].includes(mode) && (
                <label>
                  Contenuto proposto
                  <textarea
                    name="content"
                    value={goalEdit.proposed}
                    onChange={(e) =>
                      setGoalEdit({ ...goalEdit, proposed: e.target.value })
                    }
                    required
                    maxLength={12000}
                  />
                </label>
              )}
              {mode === "replace" && (
                <label>
                  <input type="checkbox" name="subgoal" />
                  Il Goal precedente resta come Sub-goal del nuovo Goal
                </label>
              )}
              {people("people")}
              <p>
                Le persone il cui intento è già rappresentato e le adesioni
                esatte pertinenti saranno incluse nel percorso di approvazione.
                Nessuna adesione viene trasferita automaticamente.
              </p>
              {effective.length > 0 && (
                <fieldset>
                  <legend>
                    Questa evoluzione richiede necessariamente modificare uno di
                    questi atti?
                  </legend>
                  {effective.map((a) => (
                    <label key={a.actId}>
                      <input type="checkbox" name="blocking" value={a.actId!} />
                      {kinds[a.kind]}: {a.content}
                    </label>
                  ))}
                </fieldset>
              )}
              <p>
                Gli atti esistenti restano validi nel loro perimetro. Le
                modifiche necessarie agli atti selezionati devono essere
                autorizzate separatamente prima dell’evoluzione del Goal.
              </p>
              <label>
                Motivazione
                <textarea name="reason" required maxLength={4000} />
              </label>
              <button disabled={busy || goal.version !== goalEdit.version}>
                Prepara proposta
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setGoalEdit(null)}
              >
                Chiudi
              </button>
            </form>
          )}
          {view.goalProposals.map((p) => (
            <details
              key={p.id}
              data-prepared-id={p.id}
              tabIndex={-1}
              open={p.status === "pending" || p.status === "blocked"}
            >
              <summary>
                {modes[p.mode]} · {p.status}
              </summary>
              <p>{p.content}</p>
              <p>
                {p.reason} · proposta da {name(p.actor)}
              </p>
              {p.obligations.some((o) => o.blocking) && (
                <p>
                  La proposta segnala modifiche necessarie ad atti governati: il
                  Goal non le autorizza.
                </p>
              )}
              {approvals(
                p.people,
                p.approvals,
                { kind: "goal", id: p.goalId, version: p.goalVersion },
                p.mode === "subgoal"
                  ? "goal.subgoal"
                  : ["complete", "abandon"].includes(p.mode)
                    ? "goal.conclude"
                    : "goal.change",
                { type: "goal.approve", transitionId: p.id },
                p.status === "pending",
              )}
            </details>
          ))}
          <details open={handoff?.kind.startsWith("project.") || undefined}>
            <summary>Decisioni, vincoli e impegni</summary>
            {view.acts.map((a) => (
              <article
                className="item"
                key={a.proposalId}
                data-prepared-id={a.proposalId}
                tabIndex={-1}
              >
                <strong>
                  {kinds[a.kind]} ·{" "}
                  {a.status === "effective"
                    ? "efficace"
                    : a.status === "superseded"
                      ? "sostituito"
                      : "proposto"}
                </strong>
                <p>{a.content}</p>
                {a.replacesActId && (
                  <p>
                    {a.operation === "revoke" ? "Revoca" : "Sostituisce"}:{" "}
                    {
                      view.acts.find((x) => x.actId === a.replacesActId)
                        ?.content
                    }
                  </p>
                )}
                {approvals(
                  a.people,
                  a.approvals,
                  {
                    kind: a.replacesActId ? "act" : "goal",
                    id: a.replacesActId ?? a.goalId ?? "",
                    version: a.replacesActId ? 1 : (a.goalVersion ?? 1),
                  },
                  a.operation === "replace"
                    ? "act.replace"
                    : a.operation === "revoke"
                      ? "act.revoke"
                      : "act.create",
                  { type: "project.approve", proposalId: a.proposalId },
                  a.status === "proposed",
                )}
                {a.status === "effective" && (
                  <button
                    onClick={() => {
                      setEditingAct(a.actId!);
                      setOperation("replace");
                    }}
                  >
                    Proponi modifica di questo atto
                  </button>
                )}
                <small>
                  Provenance:{" "}
                  {a.sourceId
                    ? `fonte ${a.sourceId}`
                    : `candidato ${a.candidateId}`}
                </small>
              </article>
            ))}
            <form
              key={actId + operation}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void perform({
                  type: "project.propose",
                  kind:
                    operation === "revoke"
                      ? "decision"
                      : (String(f.get("kind")) as
                          "decision" | "constraint" | "commitment"),
                  content: String(f.get("content")),
                  people: f.getAll("people").map(String),
                  goal: actGoal
                    ? { id: actGoal.id, version: actGoal.version }
                    : null,
                  operation,
                  ...(operation !== "establish"
                    ? { replacesActId: actId }
                    : {}),
                  reason: String(f.get("reason")),
                });
              }}
            >
              <h3>{actId ? "Modifica proposta" : "Nuovo atto proposto"}</h3>
              {actId && (
                <label>
                  Operazione
                  <select
                    value={operation}
                    onChange={(e) =>
                      setOperation(e.target.value as typeof operation)
                    }
                  >
                    <option value="replace">Sostituzione versionata</option>
                    <option value="revoke">Revoca esplicita</option>
                  </select>
                </label>
              )}
              {operation !== "revoke" && (
                <label>
                  Tipo
                  <select
                    name="kind"
                    defaultValue={
                      effective.find((a) => a.actId === actId)?.kind ??
                      "decision"
                    }
                  >
                    {Object.entries(kinds).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Contenuto esatto
                <textarea
                  name="content"
                  required
                  maxLength={12000}
                  defaultValue={
                    handoff?.status === "ready" &&
                    handoff.kind.startsWith("project.") &&
                    (!editingAct || editingAct === handoffAct?.actId)
                      ? handoff.suggestedText
                      : operation === "replace"
                        ? effective.find((a) => a.actId === actId)?.content
                        : ""
                  }
                />
              </label>
              <label>
                Goal pertinente
                <select
                  name="goal"
                  value={actGoal ? `${actGoal.id}:${actGoal.version}` : ""}
                  onChange={(e) => {
                    const selected = view.goals.find(
                      (g) => `${g.id}:${g.version}` === e.target.value,
                    );
                    setActGoal(
                      selected
                        ? {
                            id: selected.id,
                            version: selected.version,
                            content: selected.content,
                          }
                        : null,
                    );
                  }}
                >
                  <option value="">Nessun Goal specifico</option>
                  {actGoalStale && actGoal && (
                    <option value={`${actGoal.id}:${actGoal.version}`} disabled>
                      {actGoal.content} · v{actGoal.version} — da riesaminare
                    </option>
                  )}
                  {view.goals
                    .filter((g) => g.status === "active")
                    .map((g) => (
                      <option
                        value={`${g.id}:${g.version}`}
                        key={`${g.id}:${g.version}`}
                      >
                        {g.content} · v{g.version}
                      </option>
                    ))}
                </select>
                {actGoalStale && (
                  <span role="alert">
                    Il Goal selezionato è cambiato. Rileggi e seleziona
                    esplicitamente il riferimento attuale, oppure rimuovi il
                    collegamento.
                  </span>
                )}
              </label>
              {people("people", true)}
              {actId && (
                <p>
                  Le persone rappresentate dall’atto precedente restano
                  necessarie, anche se non selezionate qui.
                </p>
              )}
              <label>
                Motivazione
                <input name="reason" required maxLength={4000} />
              </label>
              <button disabled={busy || actGoalStale}>
                Registra proposta da approvare
              </button>
              {actId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingAct("");
                    setOperation("establish");
                  }}
                >
                  Torna a nuovo atto
                </button>
              )}
            </form>
          </details>
          <details>
            <summary>Mandati di rappresentanza</summary>
            <p>
              Un mandato riguarda esclusivamente la rappresentanza del
              concedente per una capability e una identità/versione precise. Non
              delega l’accesso né consente di rappresentare altre persone.
            </p>
            {view.mandates.map((m) => (
              <article key={m.id} className="item">
                <strong>
                  {name(m.grantorId)} → {name(m.holderId)}
                </strong>
                <p>
                  {capabilities[m.capability]} ·{" "}
                  {m.scope.kind === "goal"
                    ? view.goals.find((g) => g.id === m.scope.id)?.content
                    : view.acts.find((a) => a.actId === m.scope.id)
                        ?.content}{" "}
                  · v{m.scope.version}
                </p>
                <p>
                  {m.status} · versione del mandato {m.version} ·{" "}
                  {m.available ? "esercitabile" : "non esercitabile"}
                </p>
                <p>{m.terms}</p>
                <p>
                  {m.reason}
                  {m.expiresAt
                    ? ` · fino a ${new Date(m.expiresAt).toLocaleString()}`
                    : ""}
                </p>
                {(actor === m.grantorId || actor === m.holderId) &&
                  ["offered", "accepted", "contested"].includes(m.status) && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void perform({
                          type: "mandate.respond",
                          mandateId: m.id,
                          expectedVersion: m.version,
                          response: String(f.get("response")) as Extract<
                            ProjectCommand,
                            { type: "mandate.respond" }
                          >["response"],
                          reason: String(f.get("reason")),
                        });
                      }}
                    >
                      <label>
                        Atto personale
                        <select name="response">
                          {m.holderId === actor && m.status === "offered" && (
                            <>
                              <option value="accept">
                                Accetto questi termini
                              </option>
                              <option value="decline">Rifiuto</option>
                            </>
                          )}
                          {m.grantorId === actor && (
                            <option value="revoke">
                              Revoco il mio mandato
                            </option>
                          )}
                          {m.status === "accepted" && m.grantorId === actor && (
                            <option value="contest">
                              Contesto: sospendi la rappresentanza
                            </option>
                          )}
                          {m.holderId === actor && m.status !== "offered" && (
                            <option value="relinquish">
                              Rinuncio alla rappresentanza
                            </option>
                          )}
                          {m.grantorId === actor &&
                            m.status === "contested" && (
                              <option value="confirm">
                                Riconfermo esplicitamente il mio mandato
                              </option>
                            )}
                        </select>
                      </label>
                      <label>
                        Motivazione
                        <input name="reason" required maxLength={4000} />
                      </label>
                      <button disabled={busy}>Registra atto</button>
                    </form>
                  )}
                <details>
                  <summary>Storia del mandato</summary>
                  {m.versions.map((v) => (
                    <p key={v.version}>
                      v{v.version} · {v.status} · {name(v.actor)} · {v.reason} ·{" "}
                      {new Date(v.createdAt).toLocaleString()}
                    </p>
                  ))}
                </details>
              </article>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!mandateScope || !mandateHolder) return;
                const f = new FormData(e.currentTarget);
                void perform({
                  type: "mandate.offer",
                  holderId: mandateHolder.id,
                  scope: {
                    kind: scopeKind,
                    id: mandateScope.id,
                    version: mandateScope.version,
                  },
                  capability: String(f.get("capability")) as Capability,
                  expiresAt: f.get("expires")
                    ? new Date(String(f.get("expires"))).toISOString()
                    : null,
                  reason: String(f.get("reason")),
                  representSelf: true,
                });
              }}
            >
              <h3>Offrire la mia rappresentanza</h3>
              <label>
                Destinatario
                <select
                  name="holder"
                  required
                  value={mandateHolder?.id ?? ""}
                  onChange={(e) => {
                    const member = view.members.find(
                      (m) => m.id === e.target.value,
                    );
                    setMandateHolder(
                      member ? { id: member.id, name: member.name } : null,
                    );
                  }}
                >
                  <option value="">Seleziona a chi offrire il mandato</option>
                  {mandateHolder && !holderEligible && (
                    <option value={mandateHolder.id} disabled>
                      {mandateHolder.name} — non disponibile
                    </option>
                  )}
                  {view.members
                    .filter((m) => m.active && m.eligible && m.id !== actor)
                    .map((m) => (
                      <option value={m.id} key={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
                {mandateHolder && !holderEligible && (
                  <span role="alert">
                    Il destinatario scelto non è più disponibile. Il mandato non
                    viene offerto a un’altra persona: rivaluta la selezione.
                  </span>
                )}
              </label>
              <label>
                Perimetro
                <select
                  value={scopeKind}
                  onChange={(e) => {
                    setScopeKind(e.target.value as typeof scopeKind);
                    setMandateScope(null);
                  }}
                >
                  <option value="goal">Goal e versione precisa</option>
                  <option value="act">Atto esistente preciso</option>
                </select>
              </label>
              <label>
                Oggetto
                <select
                  name="scope"
                  required
                  key={scopeKind}
                  value={
                    mandateScope
                      ? `${mandateScope.id}:${mandateScope.version}`
                      : ""
                  }
                  onChange={(e) => {
                    const g = view.goals.find(
                      (g) => `${g.id}:${g.version}` === e.target.value,
                    );
                    const a = effective.find(
                      (a) => `${a.actId}:1` === e.target.value,
                    );
                    setMandateScope(
                      scopeKind === "goal" && g
                        ? { id: g.id, version: g.version, label: g.content }
                        : scopeKind === "act" && a?.actId
                          ? { id: a.actId, version: 1, label: a.content }
                          : null,
                    );
                  }}
                >
                  <option value="">Seleziona il perimetro esatto</option>
                  {mandateScopeStale && mandateScope && (
                    <option
                      value={`${mandateScope.id}:${mandateScope.version}`}
                      disabled
                    >
                      {mandateScope.label} · v{mandateScope.version} — da
                      riesaminare
                    </option>
                  )}
                  {scopeKind === "goal"
                    ? view.goals
                        .filter((g) => g.status === "active")
                        .map((g) => (
                          <option
                            key={`${g.id}:${g.version}`}
                            value={`${g.id}:${g.version}`}
                          >
                            {g.content} · v{g.version}
                          </option>
                        ))
                    : effective.map((a) => (
                        <option value={`${a.actId}:1`} key={a.actId}>
                          {kinds[a.kind]}: {a.content}
                        </option>
                      ))}
                </select>
                {mandateScopeStale && (
                  <span role="alert">
                    Il perimetro è cambiato. Nessuna rappresentanza viene
                    trasferita: riseleziona un perimetro attuale dopo averlo
                    riletto.
                  </span>
                )}
              </label>
              <label>
                Unico potere delegato
                <select name="capability" key={scopeKind}>
                  {Object.entries(capabilities)
                    .filter(([id]) =>
                      scopeKind === "act"
                        ? ["act.replace", "act.revoke"].includes(id)
                        : !["act.replace", "act.revoke"].includes(id),
                    )
                    .map(([id, label]) => (
                      <option value={id} key={id}>
                        {label}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Scadenza facoltativa
                <input name="expires" type="datetime-local" />
              </label>
              <label>
                Motivazione
                <input name="reason" required maxLength={4000} />
              </label>
              <p>
                Questa offerta resta limitata alle membership correnti ed
                eleggibili di entrambi, all’oggetto/versione e al potere
                indicati. Non consente successive deleghe. Il destinatario deve
                accettare.
              </p>
              <button
                disabled={
                  busy || !mandateScope || mandateScopeStale || !holderEligible
                }
              >
                Offri il mandato per la sola mia rappresentanza
              </button>
            </form>
          </details>
        </>
      )}
    </section>
  );
}
