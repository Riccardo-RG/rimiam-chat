import { useUiLanguage } from "../i18n";
import React, { useState } from "react";
import { Text, View } from "react-native";
import type { Snapshot } from "../../../src/contracts/web-snapshot";
import { Action, Field, usePalette } from "../ui";
import type { Commands } from "./useCommands";

type VersionRef = { id: string; version: number };
type Doc = Snapshot["artifactVersions"][number];
const matches = (q: VersionRef | null, id: string, version: number) =>
  q?.id === id && q.version === version;

export function Brief({
  state,
  commands,
  base,
  onClose,
}: {
  state: Snapshot;
  commands: Commands;
  base?: Doc;
  onClose: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette();
  const [title, setTitle] = useState(base?.title ?? ""),
    [notes, setNotes] = useState(base?.notes ?? ""),
    [reason, setReason] = useState("");
  const [q, setQ] = useState<VersionRef | null>(
    base?.question_id && base.question_version
      ? { id: base.question_id, version: base.question_version }
      : null,
  );
  const [info, setInfo] = useState<VersionRef[]>(() =>
    state.artifactInformation
      .filter(
        (v) =>
          v.artifact_id === base?.artifact_id &&
          v.artifact_version === base?.version,
      )
      .map((v) => ({ id: v.information_id, version: v.information_version })),
  );
  const [ids, setIds] = useState<string[]>(() =>
    state.artifactSources
      .filter(
        (v) =>
          v.artifact_id === base?.artifact_id &&
          v.artifact_version === base?.version &&
          v.explicitly_selected,
      )
      .map((v) => v.source_id),
  );
  const [showSources, setSources] = useState(false);
  const staleBase =
    !!base &&
    state.artifacts.find((a) => a.id === base.artifact_id)
      ?.current_draft_version !== base.version;
  const staleQuestion =
    !!q && !state.questions.some((item) => matches(q, item.id, item.version));
  const staleInfos = info.filter(
    (ref) =>
      !state.information.some((i) => matches(ref, i.id, i.current_version)),
  );
  const latestDocVersions = new Map<string, number>();
  for (const s of state.sources)
    if (s.document_id && s.document_version)
      latestDocVersions.set(
        s.document_id,
        Math.max(latestDocVersions.get(s.document_id) ?? 0, s.document_version),
      );
  const staleSources = ids.filter((id) => {
    const s = state.sources.find((s) => s.id === id);
    return (
      s?.withdrawn ||
      (!!s?.document_id &&
        s.document_version !== latestDocVersions.get(s.document_id))
    );
  });
  const blocked =
    commands.working ||
    !!commands.pending ||
    !commands.ready ||
    staleBase ||
    staleQuestion ||
    !!staleInfos.length ||
    !!staleSources.length ||
    !q ||
    !info.length ||
    !title.trim() ||
    (!!base && !reason.trim());
  function sourceChoice(id: string, label: string) {
    return (
      <Action
        key={id}
        label={label}
        primary={ids.includes(id)}
        disabled={!ids.includes(id) && ids.length >= 20}
        onPress={() =>
          setIds((prior) =>
            prior.includes(id) ? prior.filter((x) => x !== id) : [...prior, id],
          )
        }
      />
    );
  }
  return (
    <View style={{ gap: 7 }}>
      <Text style={{ color: p.text, fontSize: 18, fontWeight: "600" }}>
        {base ? uiText("Nuova versione del brief") : uiText("Prepara un brief")}
      </Text>
      <Field
        label={uiText("Titolo del brief")}
        value={title}
        maxLength={160}
        onChangeText={setTitle}
      />
      <Text style={{ color: p.muted }}>{uiText("Domanda di partenza")}</Text>
      {state.questions.map((item) => (
        <Action
          key={item.id}
          label={uiText(
            "{0} · v{1}",
            String(item.content),
            String(item.version),
          )}
          primary={matches(q, item.id, item.version)}
          onPress={() => setQ({ id: item.id, version: item.version })}
        />
      ))}
      {!state.questions.length && (
        <Text style={{ color: p.muted }}>
          {uiText("Registra prima una domanda in Strumenti › Domande.")}
        </Text>
      )}
      <Text style={{ color: p.muted }}>
        {uiText("Riferimenti accettati · scegli almeno uno")}
      </Text>
      {state.information.map((i) => {
        const selected = info.some((ref) =>
          matches(ref, i.id, i.current_version),
        );
        return (
          <Action
            key={i.id}
            label={uiText(
              "{0} · v{1}",
              String(i.subject),
              String(i.current_version),
            )}
            primary={selected}
            disabled={
              !selected &&
              info.length >= 20 &&
              !info.some((ref) => ref.id === i.id)
            }
            onPress={() =>
              setInfo((prior) => {
                const rest = prior.filter((ref) => ref.id !== i.id);
                return selected
                  ? rest
                  : [...rest, { id: i.id, version: i.current_version }];
              })
            }
          />
        );
      })}
      {!state.information.length && (
        <Text style={{ color: p.muted }}>
          {uiText(
            "Il brief richiede almeno un riferimento accettato dal gruppo.",
          )}
        </Text>
      )}
      {staleInfos.map((i) => (
        <Action
          key={i.id}
          label={uiText(
            "Rimuovi riferimento superato · v{0}",
            String(i.version),
          )}
          onPress={() =>
            setInfo((refs) => refs.filter((ref) => ref.id !== i.id))
          }
        />
      ))}
      <Action
        label={
          showSources
            ? uiText("Chiudi fonti aggiuntive")
            : uiText("Fonti aggiuntive · {0}", String(ids.length))
        }
        onPress={() => setSources(!showSources)}
      />
      {showSources && (
        <>
          {state.sources
            .filter(
              (s) =>
                !s.withdrawn &&
                (!s.document_id ||
                  s.document_version === latestDocVersions.get(s.document_id)),
            )
            .map((s) => sourceChoice(s.id, s.title))}
          {ids
            .filter(
              (id) =>
                !state.sources.some((s) => s.id === id) ||
                staleSources.includes(id),
            )
            .map((id, i) =>
              sourceChoice(id, "Rimuovi fonte storica " + (i + 1)),
            )}
        </>
      )}
      <Field
        label={uiText("Note")}
        multiline
        value={notes}
        maxLength={12000}
        onChangeText={setNotes}
      />
      {base && (
        <Field
          label={uiText("Motivo della nuova versione")}
          value={reason}
          maxLength={4000}
          onChangeText={setReason}
        />
      )}
      {(staleBase ||
        staleQuestion ||
        staleInfos.length > 0 ||
        staleSources.length > 0) && (
        <Text style={{ color: p.muted }}>
          {staleBase
            ? uiText("Il brief è cambiato. Riapri la versione attuale.")
            : uiText(
                "Riesamina i riferimenti cambiati e seleziona le versioni attuali.",
              )}
        </Text>
      )}
      <Action
        primary
        label={
          base ? uiText("Salva nuova versione") : uiText("Crea bozza del brief")
        }
        disabled={!!blocked}
        onPress={async () => {
          if (!q || blocked) return;
          const selection = {
            title: title.trim(),
            notes: notes.trim(),
            questionId: q.id,
            questionVersion: q.version,
            information: info,
            sourceIds: ids,
          };
          if (
            await commands.send({
              kind: "command",
              label: "Salva brief",
              command: base
                ? {
                    type: "artifact.revise",
                    artifactId: base.artifact_id,
                    expectedVersion: base.version,
                    reason: reason.trim(),
                    ...selection,
                  }
                : { type: "artifact.draft", ...selection },
            })
          )
            onClose();
        }}
      />
      <Action label={uiText("Annulla")} onPress={onClose} />
    </View>
  );
}
