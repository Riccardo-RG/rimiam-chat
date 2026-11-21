import { useUiLanguage } from "../i18n";
import React, { useState } from "react";
import { Alert, Text, View } from "react-native";
import type {
  ProjectView,
  ProjectCommand,
} from "../../../src/contracts/project";
import type { Command } from "../../../src/contracts/commands";
import { ToolRow } from "./ToolLayout";
import { Action, Field, usePalette } from "../ui";
import type { NativeRequest } from "../api";
import { useResource } from "../useResource";

type Act = ProjectView["acts"][number];
type Goal = ProjectView["goals"][number];
type Mandate = ProjectView["mandates"][number];
type GoalChange = Extract<ProjectCommand, { type: "goal.propose" }>;
type Scope = Mandate["scope"];
type Response = Extract<
  ProjectCommand,
  { type: "mandate.respond" }
>["response"];
const modes: Record<GoalChange["mode"], string> = {
  revise: "Rivedi l’obiettivo",
  replace: "Sostituisci l’obiettivo",
  subgoal: "Crea sotto-obiettivo",
  complete: "Dichiara concluso",
  abandon: "Abbandona obiettivo",
};
const labels = {
  decision: "Decisione",
  constraint: "Vincolo",
  commitment: "Impegno",
};
const capabilities: Record<Mandate["capability"], string> = {
  "goal.change": "Cambiare l’obiettivo",
  "goal.conclude": "Concludere l’obiettivo",
  "goal.subgoal": "Creare un sotto-obiettivo",
  "act.create": "Proporre atti per l’obiettivo",
  "act.replace": "Sostituire l’atto",
  "act.revoke": "Revocare l’atto",
};
const responses: Record<Response, string> = {
  accept: "Accetta il mandato",
  decline: "Rifiuta",
  contest: "Contesta e sospendi",
  confirm: "Riconferma",
  revoke: "Revoca",
  relinquish: "Rinuncia",
};
type Form =
  | { kind: "goal"; goal: Goal }
  | { kind: "act"; previous?: Act; operation: Act["operation"] }
  | { kind: "mandate" }
  | { kind: "respond"; mandate: Mandate; response: Response };
type Send = (label: string, cmd: Command) => void;
function toggle<T>(items: T[], v: T) {
  return items.includes(v) ? items.filter((i) => i !== v) : [...items, v];
}
function confirm(
  uiText: (source: string) => string,
  label: string,
  summary: string,
  cmd: Command,
  send: Send,
) {
  Alert.alert(label, summary, [
    { text: uiText("Annulla"), style: "cancel" },
    { text: uiText("Conferma"), onPress: () => send(label, cmd) },
  ]);
}

export function Project({
  request,
  path,
  actor,
  canWrite,
  busy,
  send,
}: {
  request: NativeRequest;
  path: string;
  actor: string;
  canWrite: boolean;
  busy: boolean;
  send: Send;
}) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette(),
    data = useResource<ProjectView>(request, path + "/project", 7000);
  const [open, setOpen] = useState(false),
    [form, setForm] = useState<Form | null>(null),
    [focus, setFocus] = useState("");
  const view = data.value,
    name = (id: string) =>
      view?.members.find((m) => m.id === id)?.name ?? "Partecipante storico";
  const [registerFocus, setRegisterFocus] = useState<string | null>(null);
  const [showAddressed, setShowAddressed] = useState(false);
  const addressed =
    view?.acts.filter(
      (a) =>
        a.status === "proposed" &&
        a.people.includes(actor) &&
        !a.approvals.some((ap) => ap.personId === actor),
    ) ?? [];
  const caption = (s: string) => <Text style={{ color: p.muted }}>{s}</Text>;
  function approval(
    ids: string[],
    approved: Act["approvals"],
    scope: Scope,
    capability: Mandate["capability"],
    content: string,
    base:
      | { type: "goal.approve"; transitionId: string }
      | { type: "project.approve"; proposalId: string },
    pending: boolean,
  ) {
    return ids.map((id) => {
      const record = approved.find((a) => a.personId === id);
      const mandate = view?.mandates.find(
        (m) =>
          m.available &&
          m.holderId === actor &&
          m.grantorId === id &&
          m.capability === capability &&
          m.scope.kind === scope.kind &&
          m.scope.id === scope.id &&
          m.scope.version === scope.version,
      );
      return (
        <View key={id} style={{ gap: 3 }}>
          {caption(
            name(id) +
              (record
                ? " · approvato da " + name(record.actorId)
                : " · in attesa"),
          )}
          {view &&
            canWrite &&
            pending &&
            !record &&
            (id === actor || mandate) && (
              <Action
                label={
                  id === actor
                    ? uiText("Approva per te")
                    : uiText("Approva per {0} con mandato", String(name(id)))
                }
                disabled={busy}
                onPress={() =>
                  confirm(
                    uiText,
                    uiText("Approvazione personale"),
                    content +
                      "\n\nRappresenti " +
                      name(id) +
                      (id === actor
                        ? ""
                        : " · " + uiText(capabilities[capability])),
                    {
                      ...base,
                      representedPersonId: id,
                      expectedAccessRevision: view.accessRevision,
                      confirmExactContent: true,
                      ...(id === actor ? {} : { mandateId: mandate!.id }),
                    },
                    send,
                  )
                }
              />
            )}
        </View>
      );
    });
  }
  return (
    <View style={{ gap: 8 }}>
      <Text
        accessibilityRole="header"
        style={{ color: p.text, fontWeight: "600", fontSize: 18 }}
      >
        {uiText("Decisioni già prese")}
      </Text>
      {!view && !data.error && caption("Caricamento della direzione…")}
      {data.error && !open && (
        <>
          <Text accessibilityRole="alert" style={{ color: p.text }}>
            {data.error}
          </Text>
          <Action label={uiText("Riprova")} onPress={data.refresh} />
        </>
      )}
      {view &&
        !view.acts.some(
          (a) =>
            a.status === "effective" &&
            a.kind === "decision" &&
            a.operation !== "revoke",
        ) &&
        caption("Ancora nessuna decisione adottata.")}
      {view?.acts
        .filter(
          (a) =>
            a.status === "effective" &&
            a.kind === "decision" &&
            a.operation !== "revoke",
        )
        .map((a) => (
          <ToolRow
            key={a.proposalId}
            label={a.content}
            onPress={() => {
              setOpen(true);
              setFocus(a.proposalId);
              setRegisterFocus(a.proposalId);
            }}
          />
        ))}
      {view && addressed.length > 0 && (
        <>
          <ToolRow
            label={uiText("In attesa di te · {0}", String(addressed.length))}
            expanded={showAddressed}
            onPress={() => setShowAddressed(!showAddressed)}
          />
          {showAddressed &&
            addressed.map((a) => (
              <ToolRow
                key={a.proposalId}
                label={a.content}
                onPress={() => {
                  setOpen(true);
                  setFocus(a.proposalId);
                  setRegisterFocus(a.proposalId);
                }}
              />
            ))}
        </>
      )}
      <Action
        label={
          open
            ? uiText("Chiudi decisioni, mandati e storia")
            : uiText("Decisioni, mandati e storia")
        }
        onPress={() => {
          setRegisterFocus(null);
          setOpen(!open);
        }}
      />
      {open && (
        <>
          {data.error && (
            <>
              <Text style={{ color: p.text }}>{data.error}</Text>
              <Action label={uiText("Riprova")} onPress={data.refresh} />
            </>
          )}
          {!view && !data.error && caption("Caricamento…")}
          {view && (
            <>
              {registerFocus && (
                <Action
                  variant="quiet"
                  label={uiText("Mostra tutte le decisioni e la storia")}
                  onPress={() => setRegisterFocus(null)}
                />
              )}
              {!registerFocus &&
                view.goals.map((g) => (
                  <View key={g.id} style={{ gap: 4 }}>
                    <Action
                      label={uiText(
                        "{0} · v{1}",
                        String(g.content),
                        String(g.version),
                      )}
                      onPress={() => setFocus(g.id === focus ? "" : g.id)}
                    />
                    {focus === g.id && (
                      <>
                        {caption(
                          g.currentPrimary
                            ? "Obiettivo principale"
                            : "Obiettivo storico o collegato",
                        )}
                        {g.versions.map((v) => (
                          <Text
                            key={v.version}
                            selectable
                            style={{ color: p.text }}
                          >
                            {uiText("v")}
                            {v.version} · {name(v.actor)} · {v.content}
                          </Text>
                        ))}
                        {caption(
                          "Adesioni alla versione · " +
                            (g.adherences
                              .filter((a) => a.version === g.version)
                              .map((a) => name(a.personId))
                              .join(", ") || "Nessuna"),
                        )}
                        {g.status === "active" && canWrite && (
                          <>
                            {!g.adherences.some(
                              (a) =>
                                a.personId === actor && a.version === g.version,
                            ) && (
                              <Action
                                label={uiText("Aderisci personalmente")}
                                disabled={busy}
                                onPress={() =>
                                  confirm(
                                    uiText,
                                    uiText(
                                      "Adesione all’obiettivo v{0}",
                                      String(g.version),
                                    ),
                                    g.content,
                                    {
                                      type: "goal.adhere",
                                      goalId: g.id,
                                      version: g.version,
                                    },
                                    send,
                                  )
                                }
                              />
                            )}
                            <Action
                              label={uiText("Proponi un’evoluzione")}
                              onPress={() => setForm({ kind: "goal", goal: g })}
                            />
                          </>
                        )}
                      </>
                    )}
                  </View>
                ))}
              {view.goalProposals.map((g) => (
                <View key={g.id} style={{ gap: 4 }}>
                  <Action
                    label={uiText(modes[g.mode]) + " · " + g.content}
                    onPress={() => setFocus(g.id === focus ? "" : g.id)}
                  />
                  {focus === g.id && (
                    <>
                      {caption(g.reason + " · " + name(g.actor))}
                      {g.obligations.some((o) => o.blocking) &&
                        caption(
                          "Questa proposta dipende da modifiche ad atti esistenti.",
                        )}
                      {approval(
                        g.people,
                        g.approvals,
                        { kind: "goal", id: g.goalId, version: g.goalVersion },
                        g.mode === "subgoal"
                          ? "goal.subgoal"
                          : g.mode === "complete" || g.mode === "abandon"
                            ? "goal.conclude"
                            : "goal.change",
                        g.content,
                        { type: "goal.approve", transitionId: g.id },
                        g.status === "pending",
                      )}
                    </>
                  )}
                </View>
              ))}
              {view.acts
                .filter((a) => !registerFocus || a.proposalId === registerFocus)
                .map((a) => (
                  <View key={a.proposalId} style={{ gap: 4 }}>
                    <Action
                      label={uiText(labels[a.kind]) + " · " + a.content}
                      onPress={() =>
                        setFocus(focus === a.proposalId ? "" : a.proposalId)
                      }
                    />
                    {focus === a.proposalId && (
                      <>
                        {caption(
                          a.status === "effective"
                            ? "In vigore"
                            : a.status === "proposed"
                              ? "Proposta"
                              : "Superato",
                        )}
                        {!!a.replacesActId &&
                          caption(
                            "Atto precedente · " +
                              (view.acts.find(
                                (prev) => prev.actId === a.replacesActId,
                              )?.content ?? "Storico"),
                          )}
                        {approval(
                          a.people,
                          a.approvals,
                          {
                            kind: a.replacesActId ? "act" : "goal",
                            id: a.replacesActId ?? a.goalId ?? "",
                            version: a.replacesActId ? 1 : (a.goalVersion ?? 1),
                          },
                          a.operation === "revoke"
                            ? "act.revoke"
                            : a.operation === "replace"
                              ? "act.replace"
                              : "act.create",
                          a.content,
                          { type: "project.approve", proposalId: a.proposalId },
                          a.status === "proposed",
                        )}
                        {a.actId &&
                          a.status === "effective" &&
                          a.operation !== "revoke" &&
                          canWrite && (
                            <>
                              <Action
                                label={uiText("Proponi sostituzione")}
                                onPress={() =>
                                  setForm({
                                    kind: "act",
                                    previous: a,
                                    operation: "replace",
                                  })
                                }
                              />
                              <Action
                                label={uiText("Proponi revoca")}
                                onPress={() =>
                                  setForm({
                                    kind: "act",
                                    previous: a,
                                    operation: "revoke",
                                  })
                                }
                              />
                            </>
                          )}
                      </>
                    )}
                  </View>
                ))}
              {canWrite && (
                <Action
                  label={uiText("Nuova proposta")}
                  onPress={() =>
                    setForm({ kind: "act", operation: "establish" })
                  }
                />
              )}
              {!registerFocus &&
                view.mandates.map((m) => (
                  <View key={m.id} style={{ gap: 3 }}>
                    <Action
                      label={
                        name(m.grantorId) +
                        " → " +
                        name(m.holderId) +
                        " · " +
                        uiText(capabilities[m.capability])
                      }
                      onPress={() => setFocus(focus === m.id ? "" : m.id)}
                    />
                    {focus === m.id && (
                      <>
                        {caption(m.terms + " · " + m.reason)}
                        {m.versions.map((v) => (
                          <Text key={v.version} style={{ color: p.muted }}>
                            {uiText("v")}
                            {v.version} · {name(v.actor)} · {v.reason}
                          </Text>
                        ))}
                        {mandateResponses(m, actor).map((response) => (
                          <Action
                            key={response}
                            label={responses[response]}
                            disabled={busy}
                            onPress={() =>
                              setForm({ kind: "respond", mandate: m, response })
                            }
                          />
                        ))}
                      </>
                    )}
                  </View>
                ))}
              {canWrite && (
                <Action
                  label={uiText("Offri la tua rappresentanza")}
                  onPress={() => setForm({ kind: "mandate" })}
                />
              )}
              {form && (
                <ProjectForm
                  key={JSON.stringify(form)}
                  {...{ form, view, actor, busy, send }}
                  close={() => setForm(null)}
                />
              )}
            </>
          )}
        </>
      )}
    </View>
  );
}
function mandateResponses(m: Mandate, actor: string): Response[] {
  const out: Response[] = [];
  if (!["offered", "accepted", "contested"].includes(m.status)) return out;
  if (m.holderId === actor) {
    if (m.status === "offered") out.push("accept", "decline");
    else out.push("relinquish");
  }
  if (m.grantorId === actor) {
    out.push("revoke");
    if (m.status === "accepted") out.push("contest");
    if (m.status === "contested") out.push("confirm");
  }
  return out;
}
export function ProjectForm({
  form,
  view,
  actor,
  busy,
  send,
  close,
  initial,
}: {
  form: Form;
  initial?: { content: string; reason: string };
  view: ProjectView;
  actor: string;
  busy: boolean;
  send: Send;
  close: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette(),
    [reason, setReason] = useState(initial?.reason ?? ""),
    [content, setContent] = useState(
      initial?.content ??
        (form.kind === "goal"
          ? form.goal.content
          : form.kind === "act"
            ? (form.previous?.content ?? "")
            : ""),
    );
  const [people, setPeople] = useState<string[]>(
      form.kind === "act" ? (form.previous?.people ?? [actor]) : [],
    ),
    [kind, setKind] = useState<Act["kind"]>("decision"),
    [mode, setMode] = useState<GoalChange["mode"]>("revise");
  const [scope, setScope] = useState<Scope | null>(null),
    [holder, setHolder] = useState(""),
    [cap, setCap] = useState<Mandate["capability"]>("goal.change"),
    [expires, setExpires] = useState("");
  const [blockIds, setBlockIds] = useState<string[]>([]),
    [subgoal, setSubgoal] = useState(false);
  const eligible = view.members.filter((m) => m.active && m.eligible);
  const goalList = view.goals.filter((g) => g.status === "active"),
    effective = view.acts.filter(
      (a) => a.status === "effective" && a.actId && a.operation !== "revoke",
    );
  const stale =
    (form.kind === "goal" &&
      !goalList.some(
        (g) => g.id === form.goal.id && g.version === form.goal.version,
      )) ||
    (form.kind === "act" &&
      !!form.previous &&
      !effective.some((a) => a.actId === form.previous?.actId)) ||
    (form.kind === "respond" &&
      !view.mandates.some(
        (m) => m.id === form.mandate.id && m.version === form.mandate.version,
      )) ||
    (scope?.kind === "goal" &&
      !goalList.some(
        (g) => g.id === scope.id && g.version === scope.version,
      )) ||
    (scope?.kind === "act" && !effective.some((a) => a.actId === scope.id));
  const scopeChoices: { scope: Scope; label: string }[] = [
    ...goalList.map((g) => ({
      scope: { kind: "goal" as const, id: g.id, version: g.version },
      label: g.content + " · v" + g.version,
    })),
    ...(form.kind === "mandate"
      ? effective.map((a) => ({
          scope: { kind: "act" as const, id: a.actId!, version: 1 },
          label: uiText(labels[a.kind]) + " · " + a.content,
        }))
      : []),
  ];
  const allowedCapabilities = (
    Object.keys(capabilities) as Mandate["capability"][]
  ).filter((c) =>
    scope?.kind === "act"
      ? c === "act.revoke" || c === "act.replace"
      : c !== "act.revoke" && c !== "act.replace",
  );
  function command(): ProjectCommand | null {
    if (!reason.trim() || stale) return null;
    if (form.kind === "respond")
      return {
        type: "mandate.respond",
        mandateId: form.mandate.id,
        expectedVersion: form.mandate.version,
        response: form.response,
        reason: reason.trim(),
      };
    if (form.kind === "mandate") {
      const date = expires ? new Date(expires) : null;
      if (
        !scope ||
        !eligible.some((m) => m.id === holder && m.id !== actor) ||
        !allowedCapabilities.includes(cap) ||
        (date &&
          (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()))
      )
        return null;
      return {
        type: "mandate.offer",
        scope,
        holderId: holder,
        capability: cap,
        expiresAt: date?.toISOString() ?? null,
        representSelf: true,
        reason: reason.trim(),
      };
    }
    const text =
      form.kind === "goal" && ["complete", "abandon"].includes(mode)
        ? form.goal.content
        : content.trim();
    if (!text || people.some((id) => !eligible.some((m) => m.id === id)))
      return null;
    if (form.kind === "goal")
      return {
        type: "goal.propose",
        mode,
        expectedVersion: form.goal.version,
        goalId: form.goal.id,
        content: text,
        reason: reason.trim(),
        preserveExistingObligations: true,
        previousBecomesSubgoal: mode === "replace" && subgoal,
        affectedPeople: people,
        blockingActIds: blockIds,
      };
    if (!people.length) return null;
    return {
      type: "project.propose",
      operation: form.operation,
      ...(form.previous ? { replacesActId: form.previous.actId! } : {}),
      kind: form.previous?.kind ?? kind,
      content: text,
      people,
      goal: scope ? { id: scope.id, version: scope.version } : null,
      reason: reason.trim(),
    };
  }
  const cmd = command();
  return (
    <View
      style={{
        gap: 7,
        borderTopWidth: 1,
        borderTopColor: p.line,
        paddingTop: 10,
      }}
    >
      <Action label={uiText("Chiudi preparazione")} onPress={close} />
      {form.kind === "goal" && (
        <>
          {(Object.keys(modes) as GoalChange["mode"][]).map((m) => (
            <Action
              key={m}
              label={uiText(modes[m])}
              primary={mode === m}
              onPress={() => setMode(m)}
            />
          ))}
          {mode === "replace" && (
            <Action
              label={uiText("Conserva il precedente come sotto-obiettivo")}
              primary={subgoal}
              onPress={() => setSubgoal(!subgoal)}
            />
          )}
        </>
      )}
      {form.kind === "act" &&
        !form.previous &&
        (Object.keys(labels) as Act["kind"][]).map((k) => (
          <Action
            key={k}
            label={uiText(labels[k])}
            primary={k === kind}
            onPress={() => setKind(k)}
          />
        ))}
      {(form.kind === "act" ||
        (form.kind === "goal" && !["complete", "abandon"].includes(mode))) && (
        <Field
          label={uiText("Testo della proposta")}
          multiline
          value={content}
          onChangeText={setContent}
          maxLength={12000}
        />
      )}
      {(form.kind === "act" || form.kind === "goal") && (
        <>
          <Text style={{ color: p.muted }}>
            {uiText("Persone interessate")}
          </Text>
          {eligible.map((m) => (
            <Action
              key={m.id}
              label={m.name}
              primary={people.includes(m.id)}
              onPress={() => setPeople(toggle(people, m.id))}
            />
          ))}
        </>
      )}
      {form.kind === "goal" && effective.length > 0 && (
        <>
          <Text style={{ color: p.muted }}>
            {uiText("Atti da modificare separatamente prima dell’evoluzione")}
          </Text>
          {effective.map((a) => (
            <Action
              key={a.actId}
              label={a.content}
              primary={blockIds.includes(a.actId!)}
              onPress={() => setBlockIds(toggle(blockIds, a.actId!))}
            />
          ))}
        </>
      )}
      {(form.kind === "act" || form.kind === "mandate") && (
        <>
          <Text style={{ color: p.muted }}>
            {form.kind === "act"
              ? uiText("Obiettivo pertinente (facoltativo)")
              : uiText("Ambito esatto del mandato")}
          </Text>
          {scopeChoices.map((c) => (
            <Action
              key={c.scope.kind + c.scope.id}
              label={c.label}
              primary={scope?.id === c.scope.id}
              onPress={() => {
                setScope(c.scope);
                setCap(c.scope.kind === "act" ? "act.replace" : "goal.change");
              }}
            />
          ))}
          {form.kind === "act" && scope && (
            <Action
              label={uiText("Nessun obiettivo specifico")}
              onPress={() => setScope(null)}
            />
          )}
        </>
      )}
      {form.kind === "mandate" && (
        <>
          <Text style={{ color: p.muted }}>
            {uiText("Chi ti rappresenterà?")}
          </Text>
          {eligible
            .filter((m) => m.id !== actor)
            .map((m) => (
              <Action
                key={m.id}
                label={m.name}
                primary={holder === m.id}
                onPress={() => setHolder(m.id)}
              />
            ))}
          {scope &&
            allowedCapabilities.map((c) => (
              <Action
                key={c}
                label={uiText(capabilities[c])}
                primary={c === cap}
                onPress={() => setCap(c)}
              />
            ))}
          <Field
            label={uiText("Scadenza facoltativa (AAAA-MM-GG)")}
            value={expires}
            onChangeText={setExpires}
          />
        </>
      )}
      {form.kind === "respond" && (
        <Text style={{ color: p.text }}>
          {responses[form.response]} · {form.mandate.terms}
        </Text>
      )}
      <Field
        label={uiText("Motivazione")}
        value={reason}
        onChangeText={setReason}
        multiline
        maxLength={4000}
      />
      {stale && (
        <Text style={{ color: p.text }}>
          {uiText(
            "Il riferimento è cambiato. Rileggi la versione aggiornata prima di preparare questo atto.",
          )}
        </Text>
      )}
      <Action
        label={
          form.kind === "respond"
            ? responses[form.response]
            : form.kind === "mandate"
              ? uiText("Offri il mandato")
              : uiText("Registra proposta")
        }
        disabled={busy || !cmd}
        onPress={() => {
          if (cmd)
            confirm(
              uiText,
              uiText("Conferma il contenuto selezionato"),
              ("content" in cmd ? cmd.content + "\n\n" : "") + reason,
              cmd,
              send,
            );
        }}
      />
    </View>
  );
}
