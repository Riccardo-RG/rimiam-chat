import { useUiLanguage } from "../i18n";
import React, { useEffect, useState } from "react";
import { Alert, View, Text } from "react-native";
import type {
  ActiveWorkHistory,
  ActiveWorkItem,
  ActiveWorkView,
} from "../../../src/contracts/active-work";
import {
  conversationReferenceSchema,
  type ConversationReference,
} from "../../../src/contracts/activity";
import type { Command } from "../../../src/contracts/commands";
import type { NativeRequest } from "../api";
import { useResource } from "../useResource";
import { Action, Field, usePalette } from "../ui";

export function Work({
  actor,
  saved,
  request,
  path,
  disabled,
  send,
  onRef,
  refreshKey,
}: {
  actor: string;
  saved: string[];
  request: NativeRequest;
  path: string;
  disabled: boolean;
  send: (label: string, c: Command) => void;
  onRef: (r: ConversationReference) => void;
  refreshKey: number;
}) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette();
  const view = useResource<ActiveWorkView>(
    request,
    path + "/active-work",
    6500,
  );
  const [text, setText] = useState("");
  const [target, setTarget] = useState<{ id: string; revision: number } | null>(
    null,
  );
  const id = target?.id;
  const stale =
    !!target &&
    !view.value?.works.some(
      (w) => w.id === target.id && w.revision === target.revision,
    );
  const [instruction, setInstruction] = useState<
    "input" | "assumption" | "objection" | "redirect" | "format"
  >("input");
  const [history, setHistory] = useState<string | null>(null);
  const control = (label: string, w: ActiveWorkItem, text: string) =>
    send(label, {
      type: "work.converse",
      workId: w.id,
      expectedRevision: w.revision,
      text,
    });
  const refreshData = view.refresh;
  useEffect(() => {
    refreshData();
    setText("");
    setTarget(null);
  }, [refreshKey, refreshData]);
  return (
    <View style={{ gap: 10 }}>
      {!!view.error && (
        <>
          <Text style={{ color: p.text }}>{view.error}</Text>
          <Action label={uiText("Riprova")} onPress={view.refresh} />
        </>
      )}
      {view.value?.canControl && (
        <>
          <Field
            label={
              id
                ? uiText("Indicazione per questo lavoro")
                : uiText("Cosa vuoi analizzare nello spazio?")
            }
            value={text}
            onChangeText={setText}
            multiline
            maxLength={3900}
          />
          {id && (
            <View style={{ flexDirection: "row", gap: 5, flexWrap: "wrap" }}>
              {(
                [
                  ["input", "Materiale"],
                  ["assumption", "Ipotesi"],
                  ["objection", "Obiezione"],
                  ["redirect", "Nuova direzione"],
                  ["format", "Formato"],
                ] as const
              ).map(([v, label]) => (
                <Action
                  key={v}
                  label={uiText(label)}
                  primary={v === instruction}
                  onPress={() => setInstruction(v)}
                />
              ))}
            </View>
          )}
          {stale && (
            <Text style={{ color: p.muted }}>
              {uiText(
                "Il lavoro è cambiato. Rileggi l’ultima versione e selezionala di nuovo.",
              )}
            </Text>
          )}
          <Action
            label={
              id ? uiText("Fornisci indicazione") : uiText("Avvia analisi")
            }
            primary
            disabled={disabled || stale || !text.trim()}
            onPress={() => {
              const w = view.value?.works.find((w) => w.id === id);
              send(
                "Attività di Emme",
                w
                  ? {
                      type: "work.converse",
                      workId: w.id,
                      expectedRevision: target!.revision,
                      text: text.trim(),
                      instruction,
                    }
                  : { type: "work.converse", text: "Analizza " + text.trim() },
              );
            }}
          />
          {id && (
            <Action
              label={uiText("Annulla indicazione")}
              onPress={() => setTarget(null)}
            />
          )}
        </>
      )}
      {view.value?.works.map((w) => (
        <View
          key={w.id}
          style={{
            gap: 6,
            borderTopWidth: 1,
            borderTopColor: p.line,
            paddingVertical: 8,
          }}
        >
          <Text style={{ color: p.text, fontSize: 17, fontWeight: "600" }}>
            {w.contract.objective}
          </Text>
          <Text style={{ color: p.muted }}>
            {uiText(
              {
                queued: "In coda",
                working: "In corso",
                needs_input: "Serve un chiarimento",
                paused: "In pausa",
                stopped: "Fermato",
                completed: "Completato",
              }[w.phase],
            )}{" "}
            {uiText("· v")}
            {w.contract.version}
          </Text>
          <Text style={{ color: p.text }}>
            {w.contract.scope} · {w.contract.expectedOutput}
          </Text>
          {w.contract.anchors.map((a, i) => (
            <Text key={i} style={{ color: p.muted }}>
              {a}
            </Text>
          ))}
          {!!w.error && (
            <Text style={{ color: p.muted }}>
              {uiText(
                "L’analisi richiede attenzione. Verifica il materiale e le indicazioni prima di riprendere.",
              )}
            </Text>
          )}
          {view.value?.suggestions
            .filter((s) => s.workId === w.id && s.status !== "applied")
            .map((s) => (
              <View key={s.id} style={{ gap: 3 }}>
                <Text style={{ color: p.text }}>
                  {uiText("Indicazione suggerita · ")}
                  {s.text}
                </Text>
                {view.value?.canControl && s.status === "pending" && (
                  <Action
                    label={uiText("Applica questa istruzione")}
                    disabled={disabled}
                    onPress={() =>
                      Alert.alert(
                        uiText("Applicare questa istruzione?"),
                        s.text,
                        [
                          { text: uiText("Annulla"), style: "cancel" },
                          {
                            text: uiText("Applica"),
                            onPress: () =>
                              send("Applica indicazione", {
                                type: "work.apply_suggestion",
                                suggestionId: s.id,
                                confirmExactInstruction: true,
                              }),
                          },
                        ],
                      )
                    }
                  />
                )}
              </View>
            ))}
          {w.issues.map((issue) => (
            <View key={issue.id} style={{ gap: 4 }}>
              <Text style={{ color: p.text }}>{issue.content}</Text>
              {view.value?.canControl &&
                issue.kind === "revision" &&
                issue.requiredPeople.includes(actor) &&
                !issue.acknowledgedBy.includes(actor) && (
                  <Action
                    disabled={disabled}
                    label={uiText("Conferma questa direzione")}
                    onPress={() =>
                      control("Conferma direzione", w, "confermo: " + issue.id)
                    }
                  />
                )}
              {view.value?.canControl && issue.actor === actor && (
                <Action
                  disabled={disabled}
                  label={uiText("Ritira la tua richiesta")}
                  onPress={() =>
                    control("Ritira richiesta", w, "ritiro: " + issue.id)
                  }
                />
              )}
              {view.value?.canControl && issue.kind === "context" && (
                <Action
                  disabled={disabled}
                  label={uiText("Usa il contesto aggiornato")}
                  onPress={() =>
                    control("Aggiorna basi", w, "usa contesto aggiornato")
                  }
                />
              )}
            </View>
          ))}
          {w.contribution && (
            <>
              <Text style={{ color: p.muted }}>
                {uiText("Contributo non adottato")}
                {w.validity === "potentially_outdated"
                  ? uiText(" · Potenzialmente superato")
                  : ""}
              </Text>
              <Text selectable style={{ color: p.text }}>
                {w.contribution.body}
              </Text>
              <Text style={{ color: p.muted }}>
                {w.contribution.qualification}
              </Text>
              {view.value?.canControl && (
                <Action
                  label={
                    saved.includes(w.contribution.id)
                      ? uiText("Salvato in Condivisi")
                      : uiText("Salva in Condivisi")
                  }
                  disabled={disabled || saved.includes(w.contribution.id)}
                  onPress={() =>
                    send("Salva contributo", {
                      type: "artifact.from_contribution",
                      contributionId: w.contribution!.id,
                      title: (
                        w.contribution!.objective ?? w.contract.objective
                      ).slice(0, 160),
                      purpose: "Valutare e sviluppare il contributo di Emme",
                      nonOperative: true,
                      saveToLibrary: true,
                    })
                  }
                />
              )}
              {w.contribution.sources?.map((s) =>
                s.reference ? (
                  <Action
                    key={s.key}
                    label={s.label}
                    onPress={() => onRef(s.reference!)}
                  />
                ) : null,
              )}
            </>
          )}
          {view.value!.canControl &&
            w.phase !== "completed" &&
            w.phase !== "stopped" && (
              <View style={{ gap: 4, flexDirection: "row", flexWrap: "wrap" }}>
                <Action
                  label={uiText("Fornisci indicazione")}
                  disabled={disabled}
                  onPress={() => {
                    setTarget({ id: w.id, revision: w.revision });
                    setInstruction("input");
                    setText("");
                  }}
                />
                {(
                  [
                    ["Pausa", "pausa"],
                    ["Riprendi", "riprendi"],
                    ["Ferma", "ferma"],
                  ] as const
                )
                  .filter(
                    (entry) =>
                      entry[1] !== "riprendi" ||
                      (w.phase === "paused" && !w.issues.length),
                  )
                  .map(([label, text]) => (
                    <Action
                      key={text}
                      label={uiText(label)}
                      disabled={disabled}
                      onPress={() =>
                        send(label, {
                          type: "work.converse",
                          workId: w.id,
                          expectedRevision: w.revision,
                          text,
                        })
                      }
                    />
                  ))}
              </View>
            )}
          <Action
            label={
              history === w.id
                ? uiText("Chiudi storia")
                : uiText("Cronologia e basi utilizzate")
            }
            onPress={() => setHistory(history === w.id ? null : w.id)}
          />
          {history === w.id && (
            <History
              request={request}
              path={path}
              workId={w.id}
              onRef={onRef}
            />
          )}
          {view
            .value!.events.filter((e) => e.workId === w.id)
            .slice(-3)
            .map((e) => (
              <Text key={e.id} style={{ color: p.muted, fontSize: 13 }}>
                {e.content}
              </Text>
            ))}
        </View>
      ))}
    </View>
  );
}

function History({
  request,
  path,
  workId,
  onRef,
}: {
  request: NativeRequest;
  path: string;
  workId: string;
  onRef: (ref: ConversationReference) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const p = usePalette(),
    [before, setBefore] = useState<number>(),
    data = useResource<ActiveWorkHistory>(
      request,
      path +
        "/active-work-history?id=" +
        encodeURIComponent(workId) +
        (before ? "&before=" + before : ""),
    );
  return (
    <View style={{ gap: 5 }}>
      {data.error && (
        <>
          <Text style={{ color: p.muted }}>{data.error}</Text>
          <Action label={uiText("Riprova")} onPress={data.refresh} />
        </>
      )}
      {data.value?.contracts.map((c) => (
        <Text key={c.version} style={{ color: p.text }}>
          {uiText("Contratto v")}
          {c.version} · {c.objective} · {c.scope} · {c.expectedOutput} ·{" "}
          {c.reason}
        </Text>
      ))}
      {data.value?.events.map((e) => (
        <Text key={e.id} style={{ color: p.muted }}>
          {new Date(e.createdAt).toLocaleString(locale)} · {e.content}
        </Text>
      ))}
      {data.value?.inputs.map((i) => {
        const r = conversationReferenceSchema.safeParse(i.provenance.reference);
        return (
          <View key={i.key + i.generation} style={{ gap: 3 }}>
            <Text style={{ color: p.text }}>{i.content}</Text>
            <Text style={{ color: p.muted }}>{i.qualification}</Text>
            {r.success && (
              <Action
                label={uiText("Apri fonte v{0}", String(r.data.version))}
                onPress={() => onRef(r.data)}
              />
            )}
          </View>
        );
      })}
      {data.value?.contributions.map((c) => (
        <Text selectable key={c.id} style={{ color: p.muted }}>
          {uiText("Contributo al contratto v")}
          {c.contractVersion} · {c.body}
        </Text>
      ))}
      {data.value?.nextBefore && (
        <Action
          label={uiText("Cronologia precedente")}
          onPress={() => setBefore(data.value?.nextBefore ?? undefined)}
        />
      )}
    </View>
  );
}
