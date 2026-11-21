import { useUiLanguage } from "../i18n";
import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { ConversationHandoff } from "../../../src/contracts/conversation-handoff";
import type { Snapshot } from "../../../src/contracts/web-snapshot";
import type { ConversationReference } from "../../../src/contracts/activity";
import type { Command } from "../../../src/contracts/commands";
import type { ProjectView } from "../../../src/contracts/project";
import type {
  TaskItem,
  TasksView,
  TaskContent,
} from "../../../src/contracts/tasks";
import { Action, Field, usePalette } from "../ui";
import type { NativeRequest } from "../api";
import { useResource } from "../useResource";
import type { Commands } from "./useCommands";
import { Panel } from "./SharedFiles";
import { PendingStrip } from "./PendingStrip";
import { Composer as DocumentComposer } from "./Artifacts";
import { CandidateActions } from "./CandidateActions";
import { ProjectForm } from "./Project";
import type { Tool } from "./WorkspaceTools";
type Props = {
  h: ConversationHandoff;
  snapshot: Snapshot;
  request: NativeRequest;
  path: string;
  actor: string;
  commands: Commands;
  canWrite: boolean;
  onClose: () => void;
  onRef: (r: ConversationReference) => void;
  onIntegration: (kind: "email" | "calendar") => void;
  onTool: (name: Tool) => void;
};
type Perform = (label: string, command: Command) => void;
const titleOf = (h: ConversationHandoff) =>
  h.status === "applied"
    ? "Passaggio registrato"
    : h.status === "stale"
      ? "Suggerimento superato"
      : "Suggerimento di Emme";
export function HandoffReview({
  h,
  snapshot,
  request,
  path,
  actor,
  commands,
  canWrite,
  onClose,
  onRef,
  onIntegration,
  onTool,
}: Props) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette(),
    [text, setText] = useState(h.suggestedText);
  const candidate = snapshot.candidates.find((c) => c.id === h.candidateId);
  const busy =
    !commands.ready || !!commands.pending || commands.working || !canWrite;
  const execute: Perform = (label, command) => {
    if (h.status !== "ready" || busy) return;
    void commands
      .send({
        kind: "command",
        label,
        command: {
          ...command,
          conversationOrigin: { handoffId: h.id },
        } as Command,
      })
      .then((saved) => {
        if (saved) onClose();
      });
  };
  return (
    <Panel title={titleOf(h)} onClose={onClose}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 9 }}
      >
        <Text style={{ color: p.text, fontSize: 18, fontWeight: "600" }}>
          {h.summary}
        </Text>
        <Text selectable style={{ color: p.text }}>
          {h.suggestedText}
        </Text>
        {h.sourceIds.map((id, i) => (
          <Action
            key={id}
            label={uiText("Fonte {0}", String(i + 1))}
            onPress={() => onRef({ kind: "source", id, version: 1 })}
          />
        ))}
        {h.target && (
          <Action
            label={uiText("Riferimento · v{0}", String(h.target.version))}
            onPress={() => onRef(h.target!)}
          />
        )}
        <PendingStrip commands={commands} />
        {h.status === "stale" && (
          <Text style={{ color: p.muted }}>
            {uiText(
              "Il riferimento è cambiato. Rivedi la versione prima di prendere una decisione.",
            )}
          </Text>
        )}
        {h.status === "applied" && (
          <>
            <Text style={{ color: p.muted }}>
              {uiText("Registrato da")}{" "}
              {snapshot.members.find((m) => m.user_id === h.application?.actor)
                ?.name ?? uiText("un partecipante")}
              .
            </Text>
            {h.application?.resultReference && (
              <Action
                label={uiText("Apri risultato")}
                onPress={() => onRef(h.application!.resultReference!)}
              />
            )}
            {h.application?.prepared && (
              <Action
                label={uiText("Esamina la proposta registrata")}
                onPress={() =>
                  onTool(
                    h.application?.prepared?.kind === "task_revision_proposal"
                      ? "In programma"
                      : "Direzione",
                  )
                }
              />
            )}
          </>
        )}
        {h.status === "navigation" && (
          <Action
            label={
              h.kind === "email.prepare"
                ? uiText("Apri Posta privata")
                : uiText("Apri Calendario")
            }
            onPress={() =>
              onIntegration(h.kind === "email.prepare" ? "email" : "calendar")
            }
          />
        )}
        {h.status === "ready" && canWrite && (
          <>
            {(h.kind === "goal.establish" || h.kind === "goal.change") && (
              <View style={{ gap: 5 }}>
                <Field
                  label={uiText("Testo dell’obiettivo condiviso")}
                  multiline
                  value={text}
                  onChangeText={setText}
                  maxLength={2000}
                />
                <Action
                  label={uiText("Salva obiettivo dello spazio")}
                  primary
                  disabled={
                    busy ||
                    !text.trim() ||
                    (h.kind === "goal.change" && !h.target)
                  }
                  onPress={() => {
                    if (h.kind === "goal.establish")
                      execute("Definisci obiettivo", {
                        type: "goal.establish",
                        content: text.trim(),
                      });
                    else if (h.target)
                      execute("Modifica obiettivo condiviso", {
                        type: "goal.editShared",
                        goalId: h.target.id,
                        expectedVersion: h.target.version,
                        content: text.trim(),
                      });
                  }}
                />
              </View>
            )}
            {(h.kind === "information.accept" ||
              h.kind === "information.correct") &&
              (candidate ? (
                <>
                  <Text selectable style={{ color: p.text }}>
                    {candidate.content}
                  </Text>
                  <Action
                    label={uiText("Fonte della proposta")}
                    onPress={() =>
                      onRef({
                        kind: "source",
                        id: candidate.source_id,
                        version: 1,
                      })
                    }
                  />
                  <CandidateActions
                    candidate={candidate}
                    snapshot={snapshot}
                    actorId={actor}
                    commands={commands}
                    disabled={busy}
                    handoff={h}
                  />
                </>
              ) : (
                <Text style={{ color: p.muted }}>
                  {uiText("La proposta associata non è più disponibile.")}
                </Text>
              ))}
            {h.kind === "artifact.prepare" && (
              <DocumentComposer
                state={snapshot}
                commands={commands}
                handoff={h}
                onClose={onClose}
              />
            )}
            {(h.kind === "goal.change" || h.kind.startsWith("project.")) && (
              <ProjectStep
                {...{ h, request, path, actor, busy, execute, onClose }}
              />
            )}
            {(h.kind === "task.create" || h.kind === "task.change") && (
              <TaskStep {...{ h, request, path, busy, execute }} />
            )}
          </>
        )}
      </ScrollView>
    </Panel>
  );
}
function ProjectStep({
  h,
  request,
  path,
  actor,
  busy,
  execute,
  onClose,
}: {
  h: ConversationHandoff;
  request: NativeRequest;
  path: string;
  actor: string;
  busy: boolean;
  execute: Perform;
  onClose: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette(),
    data = useResource<ProjectView>(request, path + "/project", 7000);
  const [advanced, setAdvanced] = useState(false);
  if (!data.value)
    return (
      <>
        <Text style={{ color: p.muted }}>
          {data.error ?? uiText("Apertura Direzione…")}
        </Text>
        {data.error && (
          <Action label={uiText("Riprova")} onPress={data.refresh} />
        )}
      </>
    );
  const view = data.value,
    goal = view.goals.find(
      (g) =>
        g.id === h.target?.id &&
        g.version === h.target?.version &&
        g.status === "active",
    ),
    previous = view.acts.find(
      (a) =>
        a.proposalId === h.target?.id && a.status === "effective" && a.actId,
    );
  if (h.kind === "goal.change" && !advanced)
    return (
      <Action
        label={uiText("Prepara invece una proposta sul ciclo di vita")}
        onPress={() => setAdvanced(true)}
      />
    );
  const form =
    h.kind === "goal.change" && goal
      ? { kind: "goal" as const, goal }
      : h.kind === "project.propose"
        ? { kind: "act" as const, operation: "establish" as const }
        : previous &&
            (h.kind === "project.replace" || h.kind === "project.revoke")
          ? {
              kind: "act" as const,
              previous,
              operation:
                h.kind === "project.replace"
                  ? ("replace" as const)
                  : ("revoke" as const),
            }
          : null;
  if (!form)
    return (
      <Text style={{ color: p.muted }}>
        {uiText("La versione interessata non è più attuale.")}
      </Text>
    );
  return (
    <ProjectForm
      form={form}
      initial={{ content: h.suggestedText, reason: h.summary }}
      view={view}
      actor={actor}
      busy={busy}
      send={execute}
      close={onClose}
    />
  );
}
function TaskStep({
  h,
  request,
  path,
  busy,
  execute,
}: {
  h: ConversationHandoff;
  request: NativeRequest;
  path: string;
  busy: boolean;
  execute: Perform;
}) {
  const { t: uiText } = useUiLanguage();
  const [page, setPage] = useState<string | null>(null);
  const p = usePalette(),
    view = useResource<TasksView>(
      request,
      path + "/tasks" + (page ? "?before=" + encodeURIComponent(page) : ""),
    );
  const item = view.value?.tasks.find((t) => t.id === h.target?.id);
  const next = view.value?.next;
  useEffect(() => {
    if (h.kind === "task.change" && !item && next) setPage(next);
  }, [item, next, h.kind]);
  if (!view.value)
    return (
      <>
        <Text style={{ color: p.muted }}>
          {view.error ?? uiText("Apertura attività…")}
        </Text>
        {view.error && (
          <Action label={uiText("Riprova")} onPress={view.refresh} />
        )}
      </>
    );
  if (h.kind === "task.change" && (!item || item.version !== h.target?.version))
    return (
      <Text style={{ color: p.muted }}>
        {next
          ? uiText("Ricerca attività…")
          : uiText("L’attività non è disponibile a questa versione.")}
      </Text>
    );
  return (
    <TaskForm
      h={h}
      item={item}
      members={view.value.members}
      busy={busy}
      execute={execute}
    />
  );
}
function TaskForm({
  h,
  item,
  members,
  busy,
  execute,
}: {
  h: ConversationHandoff;
  item?: TaskItem;
  members: TasksView["members"];
  busy: boolean;
  execute: Perform;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const p = usePalette();
  const [title, setTitle] = useState(
      item?.title ?? h.suggestedText.slice(0, 160),
    ),
    [description, setDescription] = useState(h.suggestedText),
    [reason, setReason] = useState(h.summary);
  const [person, setPerson] = useState<string | null>(
      item?.suggestedPerson ?? null,
    ),
    [choose, setChoose] = useState(false);
  return (
    <View style={{ gap: 5 }}>
      <Field
        label={uiText("Attività")}
        value={title}
        onChangeText={setTitle}
        maxLength={160}
      />
      <Field
        label={uiText("Descrizione")}
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={8000}
      />
      {item && (
        <Field
          label={uiText("Motivo della modifica")}
          value={reason}
          onChangeText={setReason}
          maxLength={2000}
        />
      )}
      <Action
        label={uiText(
          "Proponi a · {0}",
          String(members.find((m) => m.id === person)?.name ?? "Nessuno"),
        )}
        onPress={() => setChoose(!choose)}
      />
      {choose && (
        <>
          <Action
            label={uiText("Nessuno")}
            onPress={() => {
              setPerson(null);
              setChoose(false);
            }}
          />
          {members.map((m) => (
            <Action
              key={m.id}
              label={m.name}
              onPress={() => {
                setPerson(m.id);
                setChoose(false);
              }}
            />
          ))}
        </>
      )}
      {item?.dueAt && (
        <Text style={{ color: p.muted }}>
          {uiText("Scadenza · ")}
          {new Date(item.dueAt).toLocaleString(locale)}
        </Text>
      )}
      <Action
        primary
        label={
          item?.responsible
            ? uiText("Proponi modifica")
            : item
              ? uiText("Salva modifica")
              : uiText("Crea attività")
        }
        disabled={busy || !title.trim() || (!!item && !reason.trim())}
        onPress={() => {
          const content: TaskContent = {
            title: title.trim(),
            description: description.trim(),
            timeZone:
              item?.timeZone ??
              Intl.DateTimeFormat().resolvedOptions().timeZone,
            dueAt: item?.dueAt ?? null,
            suggestedPerson: person,
            references: item?.references ?? [
              { kind: "message", id: h.sourceMessageId, version: 1 },
            ],
          };
          if (item)
            execute("Modifica attività", {
              type: item.responsible ? "task.propose_revision" : "task.revise",
              taskId: item.id,
              expectedVersion: item.version,
              reason: reason.trim(),
              content,
            });
          else
            execute("Crea attività", {
              type: "task.create",
              content,
              ...(h.candidateId ? { candidateId: h.candidateId } : {}),
            });
        }}
      />
    </View>
  );
}
