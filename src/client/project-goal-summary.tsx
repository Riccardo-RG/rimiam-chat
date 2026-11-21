"use client";
import { useUiLanguage } from "./ui-language";
import type { ReactNode } from "react";
import type { ProjectView } from "@/contracts/project";
import { WorkspaceIcon } from "./workspace-icon";
import styles from "./workspace-project.module.css";

type Goal = ProjectView["goals"][number];
const statusText: Record<Goal["status"], string> = {
  active: "Attivo",
  completed: "Concluso",
  abandoned: "Abbandonato",
  replaced: "Sostituito",
};

export function ProjectGoalSummary({
  goal,
  children,
  canContribute,
  view,
  actor,
  busy,
  name,
  adhere,
  propose,
}: {
  goal: Goal;
  canContribute: boolean;
  children?: ReactNode;
  view: ProjectView;
  actor: string;
  busy: boolean;
  name: (id: string) => string;
  adhere: () => void;
  propose: (shared: boolean) => void;
}) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const adherences = goal.adherences.filter(
    (entry) => entry.version === goal.version,
  );
  const isActive = goal.status === "active";
  const parent = view.goals.find((item) => item.id === goal.parentGoalId);
  const kind = goal.currentPrimary
    ? "Obiettivo dello spazio"
    : goal.parentGoalId
      ? "Sub-goal"
      : isActive
        ? "Goal"
        : "Obiettivo precedente";
  const titleId = `goal-title-${goal.id}`;
  return (
    <article aria-labelledby={titleId} className={styles.goal}>
      <div className={styles.meta}>
        <span className={styles.kind}>
          <WorkspaceIcon name="goal" />
          {kind}
        </span>
        <span>{statusText[goal.status]}</span>
      </div>
      <h3 className={styles.statement} id={titleId}>
        {goal.content}
      </h3>
      {children}
      {goal.parentGoalId && (
        <p className="hint">
          {uiText("Parte di ")}
          {parent?.content ?? uiText("un altro obiettivo")}
          {uiText(" · v")}
          {goal.parentGoalVersion}
        </p>
      )}
      {canContribute && isActive && goal.currentPrimary && (
        <button
          type="button"
          className={styles.secondary}
          disabled={busy}
          onClick={() => propose(true)}
        >
          {uiText("Modifica obiettivo")}
        </button>
      )}
      <details className={styles.disclosure}>
        <summary>
          <WorkspaceIcon name="history" />
          <span>{uiText("Storia e adesioni")}</span>
          <WorkspaceIcon name="chevron" />
        </summary>
        <dl className={styles.people}>
          <div>
            <dt>{uiText("Intento di")}</dt>
            <dd>
              {goal.participants.map(name).join(", ") ||
                uiText("Nessuno in questa versione")}
            </dd>
          </div>
          <div>
            <dt>
              {uiText("Adesioni (v")}
              {goal.version})
            </dt>
            <dd>
              {adherences.map((a) => name(a.personId)).join(", ") ||
                uiText("Nessuna adesione")}
            </dd>
          </div>
        </dl>
        {canContribute && isActive && (
          <div className={styles.actions}>
            {!adherences.some((a) => a.personId === actor) && (
              <button
                type="button"
                disabled={busy}
                onClick={adhere}
                aria-label={uiText(
                  "Aderisco personalmente a questo Goal v{0}",
                  String(goal.version),
                )}
              >
                {uiText("Aderisco personalmente")}
              </button>
            )}
            <button
              type="button"
              className={styles.secondary}
              disabled={busy}
              onClick={() => propose(false)}
            >
              {uiText("Altre modifiche all’obiettivo")}
            </button>
          </div>
        )}
        {goal.versions.map((v) => (
          <article className={styles.version} key={v.version}>
            <strong>
              {uiText("v")}
              {v.version} · {v.content}
            </strong>
            <p>
              {name(v.actor)} · {new Date(v.createdAt).toLocaleString(uiLocale)}{" "}
              · {v.reason}
            </p>
            {v.sourceId && (
              <small>
                {uiText("Fonte conservata · ")}
                {v.sourceId}
              </small>
            )}
          </article>
        ))}
        <p>
          {uiText("Adesioni storiche ·")}{" "}
          {goal.adherences
            .map((a) => `${name(a.personId)} → v${a.version}`)
            .join(", ") || uiText("Nessuna")}
        </p>
        {view.relations
          .filter((r) => r.fromGoalId === goal.id || r.toGoalId === goal.id)
          .map((r) => (
            <p key={r.id}>
              {r.kind === "replaces"
                ? uiText("Sostituzione")
                : uiText("Relazione Sub-goal")}{" "}
              · {view.goals.find((g) => g.id === r.fromGoalId)?.content}
              {uiText(" v")}
              {r.fromVersion} →{" "}
              {view.goals.find((g) => g.id === r.toGoalId)?.content}
              {uiText(" v")}
              {r.toVersion}
            </p>
          ))}
      </details>
    </article>
  );
}
