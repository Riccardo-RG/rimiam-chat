"use client";
import { useUiLanguage } from "./ui-language";

import { ProductHelp } from "./product-help";
import { ProjectGoalSummary } from "./project-goal-summary";
import { WorkspaceIcon } from "./workspace-icon";
import styles from "./workspace-project.module.css";
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
  revise: "Aggiorna lo stesso obiettivo",
  replace: "Sostituisci l’obiettivo",
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
  canContribute,
  revision = 0,
  command,
  action,
  busy,
  handoff,
}: {
  workspace: string;
  actor: string;
  canContribute: boolean;
  revision?: number;
  command: (c: Command) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  handoff?: ConversationHandoff;
}) {
  const { t: uiText } = useUiLanguage();
  const [loaded, setLoaded] = useState<{
      workspace: string;
      view: ProjectView;
    } | null>(null),
    [error, setError] = useState("");
  const [sharedEdit, setSharedEdit] = useState<boolean | null>(false);
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
              setSharedEdit(
                target.currentPrimary && target.status === "active"
                  ? null
                  : false,
              );
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
  function revealAct(id: string) {
    const target = root.current?.querySelector<HTMLElement>(
      `[data-prepared-id="${CSS.escape(id)}"]`,
    );
    if (!target) return;
    let parent = target.parentElement;
    while (parent && parent !== root.current) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      parent = parent.parentElement;
    }
    target.scrollIntoView({ block: "nearest" });
    target.focus({ preventScroll: true });
  }
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
      ((c.type === "goal.editShared" || c.type === "goal.propose") &&
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
        [
          "goal.establish",
          "goal.editShared",
          "goal.propose",
          "project.propose",
        ].includes(c.type) &&
        !origin.conversationOrigin
      )
        throw new Error(
          "Questo percorso non corrisponde più alla proposta selezionata. Rivalutala o esci dal percorso prima di preparare un altro atto.",
        );
      await command({ ...c, ...origin });
      if (c.type === "goal.editShared") setGoalEdit(null);
      try {
        setLoaded({ workspace, view: await api<ProjectView>(url) });
      } catch {
        setError(
          uiText(
            "Operazione registrata. Non è stato possibile aggiornare la vista: sarà ricaricata automaticamente.",
          ),
        );
      }
    });
  const name = (id: string) =>
    view?.members.find((m) => m.id === id)?.name ?? "Partecipante storico";
  const people = (field: string, required = false) => (
    <fieldset>
      <legend>
        {required
          ? uiText("Persone rappresentate da questo atto")
          : uiText("Altre persone coinvolte, se pertinenti")}
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
              ? uiText("atto di approvazione registrato")
              : uiText("approvazione richiesta")}
          </p>
          {records
            .filter((r) => r.personId === person)
            .map((r) => (
              <small key={`${r.personId}:${r.actorId}`}>
                {uiText("Da ")}
                {name(r.actorId)}
                {r.mandateId
                  ? uiText(" con mandato v{0}", String(r.mandateVersion))
                  : uiText(" per sé")}{" "}
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
              {uiText("Approvo questo contenuto per me")}
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
                  {uiText("Approvo per ")}
                  {name(person)}
                  {uiText(" con il mandato indicato v")}
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
  const adoptedDecisions = effective.filter(
    (a) => a.kind === "decision" && a.operation !== "revoke",
  );
  const addressedProposals =
    view?.acts.filter(
      (a) =>
        a.status === "proposed" &&
        a.people.includes(actor) &&
        !a.approvals.some((ap) => ap.personId === actor),
    ) ?? [];
  const register = (
    <section
      aria-label={uiText("Decisioni già prese")}
      className={styles.decisionRegister}
    >
      <h4>{uiText("Decisioni già prese")}</h4>
      {adoptedDecisions.length ? (
        <ul>
          {adoptedDecisions.map((a) => (
            <li key={a.proposalId}>
              <button type="button" onClick={() => revealAct(a.proposalId)}>
                {a.content}
                <WorkspaceIcon name="chevron" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>{uiText("Ancora nessuna decisione adottata.")}</p>
      )}
      {!!addressedProposals.length && (
        <details>
          <summary>
            {uiText("In attesa di te · ")}
            {addressedProposals.length}
          </summary>
          <ul>
            {addressedProposals.map((a) => (
              <li key={a.proposalId}>
                <button type="button" onClick={() => revealAct(a.proposalId)}>
                  {a.content}
                  <WorkspaceIcon name="chevron" />
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
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
      className={`card source-work ${styles.project}`}
      aria-label={uiText("Obiettivo, decisioni e deleghe")}
    >
      {!view && !error && (
        <p role="status">{uiText("Caricamento della direzione…")}</p>
      )}
      {error && <p role="alert">{error}</p>}
      {view && (
        <>
          {canContribute &&
            !view.goals.some((g) => g.currentPrimary) &&
            !view.goals.length && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void perform({
                    type: "goal.establish",
                    content: String(
                      new FormData(e.currentTarget).get("content"),
                    ),
                  });
                }}
              >
                <h3>{uiText("Qual è l’obiettivo dello spazio?")}</h3>
                <p className="hint">
                  {uiText(
                    "Chi contribuisce potrà aggiornarlo. Le modifiche compariranno in chat.",
                  )}
                </p>
                <label>
                  {uiText("Obiettivo dello spazio")}
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
                <button disabled={busy}>{uiText("Imposta obiettivo")}</button>
              </form>
            )}
          {!view.goals.some((g) => g.currentPrimary) && register}
          {[...view.goals]
            .sort((a, b) => Number(b.currentPrimary) - Number(a.currentPrimary))
            .map((g) => (
              <ProjectGoalSummary
                key={g.id}
                goal={g}
                canContribute={canContribute}
                view={view}
                actor={actor}
                busy={busy}
                name={name}
                adhere={() =>
                  void perform({
                    type: "goal.adhere",
                    goalId: g.id,
                    version: g.version,
                  })
                }
                propose={(shared) => {
                  setSharedEdit(shared);
                  setGoalEdit({
                    id: g.id,
                    version: g.version,
                    content: g.content,
                    proposed: g.content,
                  });
                  requestAnimationFrame(() =>
                    root.current
                      ?.querySelector<HTMLElement>("[data-goal-edit-heading]")
                      ?.focus(),
                  );
                }}
              >
                {g.currentPrimary ? register : null}
              </ProjectGoalSummary>
            ))}
          {canContribute && goal && goalEdit && sharedEdit === null && (
            <section aria-label={uiText("Scegli come modificare l’obiettivo")}>
              <h3>{uiText("Che cosa vuoi cambiare?")}</h3>
              <button onClick={() => setSharedEdit(true)}>
                {uiText("Modifica il testo dell’obiettivo")}
              </button>
              <button className="quiet" onClick={() => setSharedEdit(false)}>
                {uiText("Sostituisci, concludi o proponi un’altra modifica")}
              </button>
              <button className="quiet" onClick={() => setGoalEdit(null)}>
                {uiText("Chiudi")}
              </button>
            </section>
          )}
          {canContribute && goal && goalEdit && sharedEdit !== null && (
            <form
              key={goalEdit.id}
              onSubmit={(e) => {
                e.preventDefault();
                if (sharedEdit) {
                  void perform({
                    type: "goal.editShared",
                    goalId: goal.id,
                    expectedVersion: goalEdit.version,
                    content: goalEdit.proposed,
                  });
                  return;
                }
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
              <h3 data-goal-edit-heading tabIndex={-1}>
                {sharedEdit
                  ? uiText("Modifica obiettivo")
                  : uiText("Altre modifiche all’obiettivo")}
              </h3>

              {goal.version !== goalEdit.version && (
                <div role="alert">
                  <p>
                    {uiText(
                      "L’obiettivo è cambiato. Rileggi la versione attuale prima di inviare la bozza.",
                    )}
                  </p>
                  <p>
                    {uiText("Versione attuale v")}
                    {goal.version}: {goal.content}
                  </p>
                  {handoff ? (
                    <p>
                      {uiText(
                        "Esci dal percorso conversazionale per rivalutare una proposta sulla versione attuale.",
                      )}
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
                      {uiText("Ho confrontato i contenuti: preparo sulla v")}
                      {goal.version}
                    </button>
                  )}
                </div>
              )}
              {!sharedEdit && (
                <label>
                  {uiText("Tipo di cambiamento")}
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as GoalMode)}
                  >
                    {Object.entries(modes).map(([id, label]) => (
                      <option key={id} value={id}>
                        {uiText(label)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {(sharedEdit || !["complete", "abandon"].includes(mode)) && (
                <div>
                  <label htmlFor="goal-revision-content">
                    {sharedEdit
                      ? uiText("Obiettivo dello spazio")
                      : uiText("Contenuto proposto")}
                  </label>
                  <textarea
                    id="goal-revision-content"
                    name="content"
                    value={goalEdit.proposed}
                    onChange={(e) =>
                      setGoalEdit({ ...goalEdit, proposed: e.target.value })
                    }
                    required
                    maxLength={12000}
                  />
                </div>
              )}
              {!sharedEdit && (
                <>
                  {mode === "replace" && (
                    <label>
                      <input type="checkbox" name="subgoal" />
                      {uiText(
                        "Il Goal precedente resta come Sub-goal del nuovo Goal",
                      )}
                    </label>
                  )}
                  {people("people")}
                  <p>
                    {uiText(
                      "L’approvazione tiene conto delle persone rappresentate e delle adesioni alla versione interessata. Le adesioni non passano automaticamente alla versione successiva.",
                    )}
                  </p>
                  {effective.length > 0 && (
                    <fieldset>
                      <legend>
                        {uiText(
                          "Questa evoluzione richiede necessariamente modificare uno di questi atti?",
                        )}
                      </legend>
                      {effective.map((a) => (
                        <label key={a.actId}>
                          <input
                            type="checkbox"
                            name="blocking"
                            value={a.actId!}
                          />
                          {uiText(kinds[a.kind])}: {a.content}
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <p>
                    {uiText(
                      "Le decisioni e gli impegni già presi restano validi. Prima di cambiare l’obiettivo, ogni modifica agli atti selezionati va approvata separatamente da chi ne ha il permesso.",
                    )}
                  </p>
                  <label>
                    {uiText("Motivazione")}
                    <textarea name="reason" required maxLength={4000} />
                  </label>
                </>
              )}
              <button
                disabled={
                  busy ||
                  goal.version !== goalEdit.version ||
                  (sharedEdit && goalEdit.proposed.trim() === goalEdit.content)
                }
              >
                {sharedEdit
                  ? uiText("Salva obiettivo")
                  : uiText("Prepara proposta")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setGoalEdit(null)}
              >
                {uiText("Chiudi")}
              </button>
            </form>
          )}
          {view.goalProposals.map((p) => (
            <details key={p.id} data-prepared-id={p.id} tabIndex={-1}>
              <summary>
                {uiText(modes[p.mode])} · {p.status}
              </summary>
              <p>{p.content}</p>
              <p>
                {p.reason}
                {uiText(" · proposta da ")}
                {name(p.actor)}
              </p>
              {p.obligations.some((o) => o.blocking) && (
                <p>
                  {uiText(
                    "La proposta segnala modifiche necessarie ad atti governati: il Goal non le autorizza.",
                  )}
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
          <details
            className={styles.disclosure}
            open={handoff?.kind.startsWith("project.") || undefined}
          >
            <summary>
              <WorkspaceIcon name="context" />
              <span>{uiText("Decisioni, vincoli e impegni")}</span>
              <WorkspaceIcon name="chevron" />
            </summary>
            {view.acts.map((a) => (
              <article
                className="item"
                key={a.proposalId}
                data-prepared-id={a.proposalId}
                tabIndex={-1}
              >
                <strong>
                  {uiText(kinds[a.kind])} ·{" "}
                  {a.status === "effective"
                    ? uiText("efficace")
                    : a.status === "superseded"
                      ? uiText("sostituito")
                      : uiText("proposto")}
                </strong>
                <p>{a.content}</p>
                {a.replacesActId && (
                  <p>
                    {a.operation === "revoke"
                      ? uiText("Revoca")
                      : uiText("Sostituisce")}
                    :{" "}
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
                    {uiText("Proponi modifica di questo atto")}
                  </button>
                )}
                <small>
                  {uiText("Origine:")}{" "}
                  {a.sourceId
                    ? uiText("fonte {0}", String(a.sourceId))
                    : uiText("candidato {0}", String(a.candidateId))}
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
              <h3>
                {actId
                  ? uiText("Modifica proposta")
                  : uiText("Nuovo atto proposto")}
              </h3>
              {actId && (
                <label>
                  {uiText("Operazione")}
                  <select
                    value={operation}
                    onChange={(e) =>
                      setOperation(e.target.value as typeof operation)
                    }
                  >
                    <option value="replace">
                      {uiText("Sostituzione versionata")}
                    </option>
                    <option value="revoke">{uiText("Revoca esplicita")}</option>
                  </select>
                </label>
              )}
              {operation !== "revoke" && (
                <label>
                  {uiText("Tipo")}
                  <select
                    name="kind"
                    defaultValue={
                      effective.find((a) => a.actId === actId)?.kind ??
                      "decision"
                    }
                  >
                    {Object.entries(kinds).map(([id, label]) => (
                      <option key={id} value={id}>
                        {uiText(label)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                {uiText("Contenuto esatto")}
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
                {uiText("Goal pertinente")}
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
                  <option value="">{uiText("Nessun Goal specifico")}</option>
                  {actGoalStale && actGoal && (
                    <option value={`${actGoal.id}:${actGoal.version}`} disabled>
                      {actGoal.content}
                      {uiText(" · v")}
                      {actGoal.version}
                      {uiText(" — da riesaminare")}
                    </option>
                  )}
                  {view.goals
                    .filter((g) => g.status === "active")
                    .map((g) => (
                      <option
                        value={`${g.id}:${g.version}`}
                        key={`${g.id}:${g.version}`}
                      >
                        {g.content}
                        {uiText(" · v")}
                        {g.version}
                      </option>
                    ))}
                </select>
                {actGoalStale && (
                  <span role="alert">
                    {uiText(
                      "Il Goal selezionato è cambiato. Rileggi e seleziona esplicitamente il riferimento attuale, oppure rimuovi il collegamento.",
                    )}
                  </span>
                )}
              </label>
              {people("people", true)}
              {actId && (
                <p>
                  {uiText(
                    "Le persone rappresentate dall’atto precedente restano necessarie, anche se non selezionate qui.",
                  )}
                </p>
              )}
              <label>
                {uiText("Motivazione")}
                <input name="reason" required maxLength={4000} />
              </label>
              <button disabled={busy || actGoalStale}>
                {uiText("Registra proposta da approvare")}
              </button>
              {actId && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingAct("");
                    setOperation("establish");
                  }}
                >
                  {uiText("Torna a nuovo atto")}
                </button>
              )}
            </form>
          </details>
          <details className={styles.disclosure}>
            <summary>
              <WorkspaceIcon name="people" />
              <span>{uiText("Mandati di rappresentanza")}</span>
              <WorkspaceIcon name="chevron" />
            </summary>
            <p>
              {uiText(
                "Un mandato riguarda esclusivamente la rappresentanza del concedente per una capability e una identità/versione precise. Non delega l’accesso né consente di rappresentare altre persone.",
              )}
            </p>
            {view.mandates.map((m) => (
              <article key={m.id} className="item">
                <strong>
                  {name(m.grantorId)} → {name(m.holderId)}
                </strong>
                <p>
                  {uiText(capabilities[m.capability])} ·{" "}
                  {m.scope.kind === "goal"
                    ? view.goals.find((g) => g.id === m.scope.id)?.content
                    : view.acts.find((a) => a.actId === m.scope.id)
                        ?.content}{" "}
                  {uiText("· v")}
                  {m.scope.version}
                </p>
                <p>
                  {m.status}
                  {uiText(" · versione del mandato ")}
                  {m.version} ·{" "}
                  {m.available
                    ? uiText("esercitabile")
                    : uiText("non esercitabile")}
                </p>
                <p>{m.terms}</p>
                <p>
                  {m.reason}
                  {m.expiresAt
                    ? uiText(
                        " · fino a {0}",
                        String(new Date(m.expiresAt).toLocaleString()),
                      )
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
                        {uiText("Atto personale")}
                        <select name="response">
                          {m.holderId === actor && m.status === "offered" && (
                            <>
                              <option value="accept">
                                {uiText("Accetto questi termini")}
                              </option>
                              <option value="decline">
                                {uiText("Rifiuto")}
                              </option>
                            </>
                          )}
                          {m.grantorId === actor && (
                            <option value="revoke">
                              {uiText("Revoco il mio mandato")}
                            </option>
                          )}
                          {m.status === "accepted" && m.grantorId === actor && (
                            <option value="contest">
                              {uiText("Contesto: sospendi la rappresentanza")}
                            </option>
                          )}
                          {m.holderId === actor && m.status !== "offered" && (
                            <option value="relinquish">
                              {uiText("Rinuncio alla rappresentanza")}
                            </option>
                          )}
                          {m.grantorId === actor &&
                            m.status === "contested" && (
                              <option value="confirm">
                                {uiText(
                                  "Riconfermo esplicitamente il mio mandato",
                                )}
                              </option>
                            )}
                        </select>
                      </label>
                      <label>
                        {uiText("Motivazione")}
                        <input name="reason" required maxLength={4000} />
                      </label>
                      <button disabled={busy}>{uiText("Registra atto")}</button>
                    </form>
                  )}
                <details>
                  <summary>{uiText("Storia del mandato")}</summary>
                  {m.versions.map((v) => (
                    <p key={v.version}>
                      {uiText("v")}
                      {v.version} · {v.status} · {name(v.actor)} · {v.reason} ·{" "}
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
              <h3>{uiText("Offrire la mia rappresentanza")}</h3>
              <label>
                {uiText("Destinatario")}
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
                  <option value="">
                    {uiText("Seleziona a chi offrire il mandato")}
                  </option>
                  {mandateHolder && !holderEligible && (
                    <option value={mandateHolder.id} disabled>
                      {mandateHolder.name}
                      {uiText(" — non disponibile")}
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
                    {uiText(
                      "Il destinatario scelto non è più disponibile. Il mandato non viene offerto a un’altra persona: rivaluta la selezione.",
                    )}
                  </span>
                )}
              </label>
              <label>
                {uiText("Perimetro")}
                <select
                  value={scopeKind}
                  onChange={(e) => {
                    setScopeKind(e.target.value as typeof scopeKind);
                    setMandateScope(null);
                  }}
                >
                  <option value="goal">
                    {uiText("Goal e versione precisa")}
                  </option>
                  <option value="act">
                    {uiText("Atto esistente preciso")}
                  </option>
                </select>
              </label>
              <label>
                {uiText("Oggetto")}
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
                  <option value="">
                    {uiText("Seleziona il perimetro esatto")}
                  </option>
                  {mandateScopeStale && mandateScope && (
                    <option
                      value={`${mandateScope.id}:${mandateScope.version}`}
                      disabled
                    >
                      {mandateScope.label}
                      {uiText(" · v")}
                      {mandateScope.version}
                      {uiText(" — da riesaminare")}
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
                            {g.content}
                            {uiText(" · v")}
                            {g.version}
                          </option>
                        ))
                    : effective.map((a) => (
                        <option value={`${a.actId}:1`} key={a.actId}>
                          {uiText(kinds[a.kind])}: {a.content}
                        </option>
                      ))}
                </select>
                {mandateScopeStale && (
                  <span role="alert">
                    {uiText(
                      "Il perimetro è cambiato. Nessuna rappresentanza viene trasferita: riseleziona un perimetro attuale dopo averlo riletto.",
                    )}
                  </span>
                )}
              </label>
              <label>
                {uiText("Unico potere delegato")}
                <select name="capability" key={scopeKind}>
                  {Object.entries(capabilities)
                    .filter(([id]) =>
                      scopeKind === "act"
                        ? ["act.replace", "act.revoke"].includes(id)
                        : !["act.replace", "act.revoke"].includes(id),
                    )
                    .map(([id, label]) => (
                      <option value={id} key={id}>
                        {uiText(label)}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {uiText("Scadenza facoltativa")}
                <input name="expires" type="datetime-local" />
              </label>
              <label>
                {uiText("Motivazione")}
                <input name="reason" required maxLength={4000} />
              </label>
              <p>
                {uiText(
                  "Questa offerta resta limitata alle membership correnti ed eleggibili di entrambi, all’oggetto/versione e al potere indicati. Non consente successive deleghe. Il destinatario deve accettare.",
                )}
              </p>
              <button
                disabled={
                  busy || !mandateScope || mandateScopeStale || !holderEligible
                }
              >
                {uiText("Offri il mandato per la sola mia rappresentanza")}
              </button>
            </form>
          </details>
        </>
      )}
      <ProductHelp screen="goal" />
    </section>
  );
}
