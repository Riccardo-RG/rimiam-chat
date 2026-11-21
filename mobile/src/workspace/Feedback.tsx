import { useUiLanguage } from "../i18n";
import React, { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { BetaFeedbackView } from "../../../src/contracts/beta-feedback";
import type { AIUsageView } from "../../../src/contracts/ai-usage";
import { betaFeedbackMarkdown } from "../../../src/shared/beta-feedback";
import { type NativeRequest, problem } from "../api";
import { shareBytes } from "../sharedFile";
import { useResource } from "../useResource";
import { Action, Field, usePalette } from "../ui";
import type { Commands } from "./useCommands";

export function Feedback({
  request,
  path,
  canWrite,
  commands,
  revision,
}: {
  request: NativeRequest;
  path: string;
  canWrite: boolean;
  commands: Commands;
  revision: number;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const p = usePalette();
  const url = path + "/beta-feedback";
  const notes = useResource<BetaFeedbackView>(request, url);
  const refresh = notes.refresh;
  const previousRevision = useRef(revision);
  useEffect(() => {
    if (previousRevision.current !== revision) {
      previousRevision.current = revision;
      refresh();
    }
  }, [revision, refresh]);
  const [draft, setDraft] = useState("");
  const [days, setDays] = useState<7 | 30 | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const exportRequest = useRef<AbortController | null>(null);
  useEffect(() => () => exportRequest.current?.abort(), [request, path]);

  async function exportReport() {
    if (exportRequest.current) return;
    const controller = new AbortController();
    exportRequest.current = controller;
    setExporting(true);
    setError("");
    try {
      // Verify current access before handing a file to the system share sheet.
      const view = await request<BetaFeedbackView>(url, {
        signal: controller.signal,
      });
      const usage = days
        ? await request<AIUsageView>(path + "/ai-usage?days=" + days, {
            signal: controller.signal,
          })
        : undefined;
      if (!controller.signal.aborted) {
        await shareBytes(
          new TextEncoder().encode(betaFeedbackMarkdown(view, usage)),
          "RIMIAM-feedback-" + view.generatedAt.slice(0, 10) + ".md",
          "text/markdown",
        );
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(problem(cause));
    } finally {
      exportRequest.current = null;
      if (!controller.signal.aborted) setExporting(false);
    }
  }
  return (
    <View style={{ gap: 10 }}>
      {canWrite && (
        <>
          <Field
            label={uiText("Cosa hai notato?")}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={6000}
          />
          <Action
            label={uiText("Salva feedback per lo spazio")}
            disabled={
              !draft.trim() ||
              !commands.ready ||
              commands.working ||
              !!commands.pending
            }
            onPress={async () => {
              const submitted = draft;
              if (
                await commands.send({
                  kind: "command",
                  label: "Feedback beta",
                  command: {
                    type: "beta.feedback.add",
                    content: submitted.trim(),
                  },
                })
              ) {
                setDraft((current) => (current === submitted ? "" : current));
              }
            }}
          />
        </>
      )}
      {notes.error ? (
        <>
          <Text style={{ color: p.text }}>{notes.error}</Text>
          <Action label={uiText("Riprova")} onPress={refresh} />
        </>
      ) : !notes.value ? (
        <Text style={{ color: p.muted }}>{uiText("Lettura feedback…")}</Text>
      ) : notes.value.entries.length === 0 ? (
        <Text style={{ color: p.muted }}>
          {uiText("Nessun feedback registrato.")}
        </Text>
      ) : (
        notes.value.entries.map((entry) => (
          <View key={entry.id} style={{ gap: 3 }}>
            <Text style={{ color: p.muted }}>
              {entry.authorName} ·{" "}
              {new Date(entry.createdAt).toLocaleDateString(locale)}
            </Text>
            <Text selectable style={{ color: p.text }}>
              {entry.content}
            </Text>
            {entry.message && (
              <Text selectable style={{ color: p.muted }}>
                {uiText("Messaggio citato · ")}
                {entry.message.content}
              </Text>
            )}
          </View>
        ))
      )}
      <Action
        label={
          days
            ? uiText("Nascondi utilizzo e costi")
            : uiText("Mostra utilizzo e costi stimati")
        }
        onPress={() => setDays(days ? null : 30)}
      />
      {days && (
        <Usage request={request} path={path} days={days} onChange={setDays} />
      )}
      <Text style={{ color: p.muted }}>
        {uiText(
          "Il report include le note del gruppo, i messaggi citati e i consumi se visibili. Puoi scegliere dove salvarlo o con chi condividerlo.",
        )}
      </Text>
      <Action
        label={
          exporting ? uiText("Preparazione…") : uiText("Esporta report (.md)")
        }
        onPress={exportReport}
        disabled={exporting || !notes.value}
      />
      {!!error && <Text style={{ color: p.text }}>{error}</Text>}
    </View>
  );
}

function Usage({
  request,
  path,
  days,
  onChange,
}: {
  request: NativeRequest;
  path: string;
  days: 7 | 30;
  onChange: (value: 7 | 30) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette();
  const usage = useResource<AIUsageView>(
    request,
    path + "/ai-usage?days=" + days,
  );
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: p.text }}>
        {uiText("Ultimi ")}
        {days}
        {uiText(" giorni")}
      </Text>
      <Action
        label={
          days === 7 ? uiText("Mostra 30 giorni") : uiText("Mostra 7 giorni")
        }
        onPress={() => onChange(days === 7 ? 30 : 7)}
      />
      {usage.error ? (
        <>
          <Text style={{ color: p.text }}>{usage.error}</Text>
          <Action label={uiText("Riprova lettura")} onPress={usage.refresh} />
        </>
      ) : !usage.value ? (
        <Text style={{ color: p.muted }}>{uiText("Lettura consumi…")}</Text>
      ) : usage.value.groups.length === 0 ? (
        <Text style={{ color: p.muted }}>
          {uiText("Nessun tentativo AI misurato nel periodo.")}
        </Text>
      ) : (
        usage.value.groups.map((group) => (
          <View
            key={JSON.stringify([
              group.provider,
              group.model,
              group.operation,
              group.rates,
            ])}
          >
            <Text style={{ color: p.text }}>
              {group.operation === "conversation"
                ? uiText("Chat")
                : uiText("Analisi")}{" "}
              · {group.model} · {group.attempts}
              {uiText(" tentativi")}
            </Text>
            <Text style={{ color: p.muted }}>
              {group.estimatedSubtotalUsd === null
                ? uiText("Stima non disponibile")
                : uiText(
                    "{0} USD stimati",
                    String(group.estimatedSubtotalUsd.toFixed(6)),
                  )}{" "}
              · {group.pricedAttempts}/{group.attempts}
              {uiText(" con stima")}
            </Text>
          </View>
        ))
      )}
      <Text style={{ color: p.muted }}>
        {uiText(
          "Stima parziale per chat e analisi. I tentativi senza tariffa o conteggio hanno costo sconosciuto.",
        )}
      </Text>
    </View>
  );
}
