import { useUiLanguage } from "../i18n";
import React, { useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { Snapshot } from "../../../src/contracts/web-snapshot";
import type { ConversationReference } from "../../../src/contracts/activity";
import { Action, Field, usePalette } from "../ui";
import type { Commands } from "./useCommands";

type Props = {
  snapshot: Snapshot;
  commands: Commands;
  canWrite: boolean;
  onRef: (r: ConversationReference) => void;
};
export function Questions({
  snapshot,
  commands,
  canWrite,
  onRef,
  initialSource,
}: Props & { initialSource?: string }) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette();
  const [create, setCreate] = useState(!!initialSource);
  const [source, setSource] = useState(initialSource ?? "");
  const [query, setQuery] = useState("");
  const [content, setContent] = useState("");
  const [limit, setLimit] = useState(8);
  const sources = useMemo(
    () =>
      [
        ...snapshot.messages.map((m) => ({
          id: m.id,
          title: m.author_name + " · " + m.content,
          created: m.created_at,
        })),
        ...snapshot.sources
          .filter((s) => !s.withdrawn)
          .map((s) => ({ id: s.id, title: s.title, created: s.created_at })),
      ].sort((a, b) => b.created.localeCompare(a.created)),
    [snapshot.messages, snapshot.sources],
  );
  const chosen = sources.find((s) => s.id === source);
  const matches = sources.filter((s) =>
    s.title
      .toLocaleLowerCase("it")
      .includes(query.trim().toLocaleLowerCase("it")),
  );
  const busy = !commands.ready || commands.working || !!commands.pending;
  return (
    <>
      {canWrite && !create && (
        <Action
          label={uiText("Aggiungi una domanda")}
          onPress={() => setCreate(true)}
        />
      )}
      {canWrite && create && (
        <View style={{ gap: 8 }}>
          <Field
            label={uiText("Domanda da chiarire")}
            multiline
            maxLength={4000}
            value={content}
            onChangeText={setContent}
          />
          {chosen ? (
            <>
              <Text numberOfLines={3} style={{ color: p.muted }}>
                {uiText("Fonte · ")}
                {chosen.title}
              </Text>
              <Action
                label={uiText("Cambia fonte")}
                onPress={() => setSource("")}
              />
            </>
          ) : (
            <>
              <Field
                label={uiText("Cerca tra messaggi e fonti")}
                value={query}
                onChangeText={(s) => {
                  setQuery(s);
                  setLimit(8);
                }}
              />
              {matches.slice(0, limit).map((s) => (
                <Action
                  key={s.id}
                  label={s.title.slice(0, 110)}
                  onPress={() => setSource(s.id)}
                />
              ))}
              {matches.length > limit && (
                <Action
                  label={uiText("Altre fonti")}
                  onPress={() => setLimit(limit + 10)}
                />
              )}
              {!matches.length && (
                <Text style={{ color: p.muted }}>
                  {uiText("Nessuna fonte disponibile.")}
                </Text>
              )}
            </>
          )}
          <Action
            primary
            label={uiText("Registra domanda")}
            disabled={busy || !chosen || !content.trim()}
            onPress={async () => {
              if (
                chosen &&
                (await commands.send({
                  kind: "command",
                  label: "Registra domanda",
                  command: {
                    type: "question.open",
                    sourceId: chosen.id,
                    content: content.trim(),
                  },
                }))
              ) {
                setCreate(false);
                setContent("");
                setSource("");
                setQuery("");
              }
            }}
          />
          <Action label={uiText("Annulla")} onPress={() => setCreate(false)} />
        </View>
      )}
      {!snapshot.questions.length && (
        <Text style={{ color: p.muted }}>
          {uiText("Nessuna domanda registrata.")}
        </Text>
      )}
      {snapshot.questions.map((question) => (
        <Question
          key={question.id}
          {...{ snapshot, commands, onRef, canWrite, question }}
        />
      ))}
    </>
  );
}
function Question({
  snapshot,
  commands,
  onRef,
  canWrite,
  question: q,
}: Props & { question: Snapshot["questions"][number] }) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const p = usePalette();
  const [edit, setEdit] = useState<number | null>(null);
  const [history, setHistory] = useState(false);
  const [info, setInfo] = useState<{ id: string; version: number } | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(8);
  const person = (id: string) =>
    snapshot.members.find((m) => m.user_id === id)?.name ?? "Partecipante";
  const open = q.status === "open";
  const answer = snapshot.versions.find(
    (v) =>
      v.information_id === q.answer_information_id &&
      v.version === q.answer_information_version,
  );
  const current = snapshot.information.find(
    (v) => v.id === q.answer_information_id,
  );
  const valid =
    info &&
    snapshot.information.some(
      (v) => v.id === info.id && v.current_version === info.version,
    );
  const matches = snapshot.information.filter((v) =>
    v.subject
      .toLocaleLowerCase("it")
      .includes(query.trim().toLocaleLowerCase("it")),
  );
  const busy = !commands.ready || commands.working || !!commands.pending;
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderColor: p.line,
        paddingVertical: 10,
        gap: 7,
      }}
    >
      <Text style={{ color: p.text, fontSize: 18, fontWeight: "600" }}>
        {q.content}
      </Text>
      <Text style={{ color: p.muted }}>
        {open ? uiText("Da chiarire") : uiText("Risposta collegata")}
        {uiText(" · v")}
        {q.version} · {person(q.recorded_by)}
      </Text>
      <Action
        label={uiText("Fonte della domanda")}
        onPress={() => onRef({ kind: "source", id: q.source_id, version: 1 })}
      />
      {answer && (
        <>
          <Text selectable style={{ color: p.text }}>
            {answer.content}
          </Text>
          <Action
            label={uiText(
              "Riferimento accettato · v{0}",
              String(answer.version),
            )}
            onPress={() =>
              onRef({
                kind: "information",
                id: answer.information_id,
                version: answer.version,
              })
            }
          />
          {current && current.current_version > answer.version && (
            <Text style={{ color: p.muted }}>
              {uiText(
                "Il riferimento è stato aggiornato. La risposta rimanda ancora alla versione ",
              )}
              {answer.version}.
            </Text>
          )}
        </>
      )}
      {canWrite && edit === null && (
        <Action
          label={
            open ? uiText("Collega una risposta") : uiText("Riapri domanda")
          }
          onPress={() => {
            setEdit(q.version);
            setInfo(null);
            setReason("");
            setQuery("");
          }}
        />
      )}
      {canWrite && edit !== null && (
        <>
          {edit !== q.version && (
            <Text style={{ color: p.muted }}>
              {uiText(
                "La domanda è cambiata. Chiudi e ricontrolla la versione attuale.",
              )}
            </Text>
          )}
          {open && (
            <>
              <Field
                label={uiText("Cerca un riferimento accettato")}
                value={query}
                onChangeText={(s) => {
                  setQuery(s);
                  setLimit(8);
                }}
              />
              {matches.slice(0, limit).map((i) => (
                <Action
                  key={i.id}
                  primary={
                    i.id === info?.id && i.current_version === info.version
                  }
                  label={uiText(
                    "{0} · v{1}",
                    String(i.subject),
                    String(i.current_version),
                  )}
                  onPress={() =>
                    setInfo({ id: i.id, version: i.current_version })
                  }
                />
              ))}
              {matches.length > limit && (
                <Action
                  label={uiText("Altri riferimenti")}
                  onPress={() => setLimit(limit + 10)}
                />
              )}
              {!matches.length && (
                <Text style={{ color: p.muted }}>
                  {uiText("Nessun riferimento accettato corrispondente.")}
                </Text>
              )}
            </>
          )}
          <Field
            label={uiText("Motivo")}
            returnKeyType="done"
            submitBehavior="blurAndSubmit"
            value={reason}
            onChangeText={setReason}
            maxLength={4000}
          />
          <Action
            primary
            label={
              open
                ? uiText("Conferma collegamento")
                : uiText("Conferma riapertura")
            }
            disabled={
              busy || edit !== q.version || !reason.trim() || (open && !valid)
            }
            onPress={async () => {
              if (edit !== q.version || (open && (!info || !valid))) return;
              const base = {
                questionId: q.id,
                expectedVersion: edit,
                reason: reason.trim(),
              };
              const saved = await commands.send({
                kind: "command",
                label: "Aggiorna domanda",
                command:
                  open && info
                    ? {
                        type: "question.answer",
                        ...base,
                        informationId: info.id,
                        informationVersion: info.version,
                      }
                    : { type: "question.reopen", ...base },
              });
              if (saved) setEdit(null);
            }}
          />
          <Action label={uiText("Annulla")} onPress={() => setEdit(null)} />
        </>
      )}
      <Action
        label={
          history ? uiText("Chiudi storia") : uiText("Storia della domanda")
        }
        onPress={() => setHistory(!history)}
      />
      {history &&
        snapshot.questionHistory
          .filter((v) => v.question_id === q.id)
          .map((v) => (
            <View key={v.version} style={{ gap: 3 }}>
              <Text style={{ color: p.text }}>
                {uiText("v")}
                {v.version} ·{" "}
                {v.status === "open"
                  ? uiText("Aperta")
                  : uiText("Risposta collegata")}{" "}
                · {person(v.recorded_by)} ·{" "}
                {new Date(v.created_at).toLocaleDateString(locale)}
              </Text>
              {v.version > 1 && (
                <Text style={{ color: p.muted }}>{v.reason}</Text>
              )}
              {v.answer_information_id && v.answer_information_version && (
                <Action
                  label={uiText(
                    "Leggi il riferimento v{0}",
                    String(v.answer_information_version),
                  )}
                  onPress={() =>
                    onRef({
                      kind: "information",
                      id: v.answer_information_id!,
                      version: v.answer_information_version!,
                    })
                  }
                />
              )}
            </View>
          ))}
    </View>
  );
}
