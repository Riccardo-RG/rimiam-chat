import { useUiLanguage } from "../i18n";
import React, { useEffect, useRef, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { post, type NativeRequest } from "../api";
import { Action, Field, usePalette } from "../ui";
import { useResource } from "../useResource";
import { Panel } from "./SharedFiles";
import type { Snapshot } from "../../../src/contracts/web-snapshot";
import { describe } from "./useCommands";
import type {
  ConsultationInput,
  ConsultationReceipt,
  ConsultationRef,
  ConsultationTurn,
  PrivateConsultation,
} from "../../../src/contracts/private-consultation";

type Props = {
  request: NativeRequest;
  path: string;
  actorId: string;
  anchor?: string;
  canShare: boolean;
  onReference: (r: ConsultationRef) => void;
  onMessage: (id: string) => void;
};
export function Consultation({
  request,
  path,
  actorId,
  anchor,
  canShare,
  onReference,
  onMessage,
}: Props) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const p = usePalette();
  const endpoint = path + "/consultation";
  const previous = useResource<ConsultationReceipt | null>(
    request,
    endpoint + "?kind=" + (anchor ? "recap" : "context"),
  );
  const [turns, setTurns] = useState<ConsultationTurn[]>([]),
    [text, setText] = useState(""),
    [issue, setIssue] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState<ConsultationInput | null>(null);
  const active = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => active.current?.abort(), []);
  async function run(input: ConsultationInput) {
    if (active.current) return;
    const ctrl = new AbortController();
    active.current = ctrl;
    setIssue("");
    setBusy(true);
    try {
      const v = await request<PrivateConsultation>(endpoint, {
        ...post(input),
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      if (input.action === "resume") setTurns([...(v.history ?? []), v]);
      else setTurns((current) => [...current.filter((t) => t.id !== v.id), v]);
      setRetry(null);
      if (input.action === "ask")
        setText((old) => (old.trim() === input.question ? "" : old));
      previous.refresh();
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setIssue(describe(e));
        setRetry(input);
      }
    } finally {
      if (!ctrl.signal.aborted) {
        active.current = undefined;
        setBusy(false);
      }
    }
  }
  function ask(question: string) {
    if (!question.trim()) return;
    void run({
      action: "ask",
      kind: "context",
      expectedActorId: actorId,
      id: randomUUID(),
      question: question.trim(),
      ...(turns.length ? { parentId: turns[turns.length - 1].id } : {}),
    });
  }
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: p.muted }}>
        {anchor
          ? uiText("Il riepilogo è visibile solo a te.")
          : uiText(
              "Fai una domanda sul contesto dello spazio. La risposta è visibile solo a te.",
            )}
      </Text>
      {!turns.length &&
        !anchor &&
        [
          uiText("Quali riferimenti abbiamo già accettato?"),
          uiText("Quali questioni sono ancora aperte?"),
        ].map((q) => (
          <Action key={q} disabled={busy} label={q} onPress={() => ask(q)} />
        ))}
      {!turns.length && anchor && (
        <Action
          disabled={busy}
          label={uiText("Prepara riepilogo personale")}
          onPress={() =>
            void run({
              action: "summarize",
              kind: "recap",
              id: randomUUID(),
              expectedActorId: actorId,
              anchorId: anchor,
            })
          }
        />
      )}
      {!turns.length && previous.value && (
        <Action
          disabled={busy}
          label={uiText(
            "Riprendi l’ultima consultazione · {0}",
            String(
              new Date(previous.value.createdAt).toLocaleDateString(locale),
            ),
          )}
          onPress={() =>
            void run({
              action: "resume",
              expectedActorId: actorId,
              id: previous.value!.id,
            })
          }
        />
      )}
      {(issue || previous.error) && (
        <Text accessibilityRole="alert" style={{ color: p.text }}>
          {issue || previous.error}
        </Text>
      )}
      {!!retry && (
        <Action
          disabled={busy}
          label={uiText("Riprova")}
          onPress={() => void run(retry)}
        />
      )}
      {busy && (
        <Text accessibilityLiveRegion="polite" style={{ color: p.muted }}>
          {uiText("Emme sta leggendo…")}
        </Text>
      )}
      {turns.map((t) => (
        <View
          key={t.id}
          style={{
            borderTopWidth: 1,
            borderColor: p.line,
            gap: 5,
            paddingVertical: 8,
          }}
        >
          <Text style={{ color: p.muted }}>
            {new Date(t.createdAt).toLocaleString(locale)}
          </Text>
          <Text style={{ color: p.text, fontWeight: "700" }}>{t.question}</Text>
          <Text
            selectable
            style={{ color: p.emme, fontSize: 17, lineHeight: 24 }}
          >
            {t.answer}
          </Text>
          {t.references.map((r) => (
            <Action
              key={r.kind + r.id + r.version}
              label={r.label}
              onPress={() => onReference(r)}
            />
          ))}
          {!!t.personalIds.length && (
            <>
              <Text style={{ color: p.text }}>{uiText("Ti riguarda")}</Text>
              {t.personalIds.map((id, i) => (
                <Action
                  key={id}
                  label={uiText("Vai al messaggio {0}", String(i + 1))}
                  onPress={() => onMessage(id)}
                />
              ))}
            </>
          )}
          {t.sharedMessageId ? (
            <Action
              label={uiText("Vedi in chat")}
              onPress={() => onMessage(t.sharedMessageId!)}
            />
          ) : (
            canShare && (
              <Action
                disabled={busy}
                label={uiText("Condividi in chat")}
                onPress={() =>
                  Alert.alert(
                    uiText("Condividere nella chat dello spazio?"),
                    t.answer,
                    [
                      { text: uiText("Annulla"), style: "cancel" },
                      {
                        text: uiText("Condividi"),
                        onPress: () =>
                          void run({
                            action: "share",
                            id: t.id,
                            expectedActorId: actorId,
                          }),
                      },
                    ],
                  )
                }
              />
            )
          )}
        </View>
      ))}
      {!anchor && (
        <>
          <Field
            multiline
            maxLength={2000}
            label={
              turns.length
                ? uiText("Continua la consultazione")
                : uiText("La tua domanda")
            }
            value={text}
            onChangeText={setText}
          />
          <Action
            label={uiText("Chiedi a Emme")}
            primary
            disabled={busy || !text.trim()}
            onPress={() => ask(text)}
          />
          {!!turns.length && (
            <Action
              label={uiText("Nuova consultazione")}
              disabled={busy}
              onPress={() => {
                setTurns([]);
                setText("");
                setRetry(null);
                setIssue("");
              }}
            />
          )}
        </>
      )}
    </View>
  );
}

export function EvidencePanel({
  request,
  path,
  snapshot,
  candidates = snapshot?.candidates,
  entry,
  onClose,
  onSource,
}: {
  request: NativeRequest;
  path: string;
  snapshot?: Snapshot;
  candidates?: Snapshot["candidates"];
  entry: ConsultationRef;
  onClose: () => void;
  onSource: (id: string) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette();
  const candidate =
    entry.kind === "candidate" && entry.version === 1
      ? candidates?.find((i) => i.id === entry.id)
      : null;
  return (
    <Panel title={entry.label} onClose={onClose}>
      <ScrollView contentContainerStyle={{ gap: 8 }}>
        {candidate ? (
          <>
            <Text selectable style={{ color: c.text }}>
              {candidate.content}
            </Text>
            <Text style={{ color: c.muted }}>{candidate.qualification}</Text>
            {candidate.source_ids.map((id, i) => (
              <Action
                key={id}
                label={uiText("Fonte {0}", String(i + 1))}
                onPress={() => onSource(id)}
              />
            ))}
          </>
        ) : entry.kind === "temporal_commitment" ? (
          <TemporalEvidence request={request} path={path} entry={entry} />
        ) : (
          <Text style={{ color: c.muted }}>
            {uiText("La versione citata non è disponibile in questa vista.")}
          </Text>
        )}
      </ScrollView>
    </Panel>
  );
}
function TemporalEvidence({
  entry,
  request,
  path,
}: {
  entry: ConsultationRef;
  request: NativeRequest;
  path: string;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const c = usePalette(),
    history = useResource<{
      versions: {
        version: number;
        starts_at: string;
        ends_at: string;
        reason: string;
      }[];
    }>(
      request,
      path +
        "/calendar-history?kind=commitment&id=" +
        encodeURIComponent(entry.id),
    );
  const v = history.value?.versions.find((i) => i.version === entry.version);
  return (
    <Text selectable style={{ color: c.text }}>
      {v
        ? new Date(v.starts_at).toLocaleString(locale) +
          " – " +
          new Date(v.ends_at).toLocaleString(locale) +
          "\n" +
          v.reason
        : history.error ||
          (history.value
            ? uiText("La versione citata non è disponibile.")
            : uiText("Caricamento…"))}
    </Text>
  );
}
