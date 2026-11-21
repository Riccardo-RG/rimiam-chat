import { useUiLanguage } from "../i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { randomUUID } from "expo-crypto";
import type { PrivateConsultation } from "../../../src/contracts/private-consultation";
import { post, problem, type NativeRequest } from "../api";
import { shareFile } from "../sharedFile";
import { Action, Field, usePalette } from "../ui";
import { workspacePath } from "./commands";
import { PendingStrip } from "./PendingStrip";
import { useCommands } from "./useCommands";

type Identity = { actorId: string; origin: string };
type Props = {
  request: NativeRequest;
  identity: Identity;
  workspaceId: string;
  destination?: string;
};
export function GeneratedDocument({
  request,
  identity,
  workspaceId,
  destination,
}: Props) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette();
  const [question, setQuestion] = useState(""),
    [result, setResult] = useState<PrivateConsultation | null>(null),
    [error, setError] = useState(""),
    [running, setRunning] = useState(false);
  const call = useRef<{ id: string; question: string } | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
    },
    [],
  );
  async function generate() {
    const text = question.trim();
    if (!text || active.current) return;
    if (call.current?.question !== text)
      call.current = { id: randomUUID(), question: text };
    const controller = new AbortController();
    active.current = controller;
    setRunning(true);
    setError("");
    try {
      const doc = await request<PrivateConsultation>(
        workspacePath(workspaceId) + "/consultation",
        {
          ...post({
            action: "document",
            kind: "document",
            expectedActorId: identity.actorId,
            ...call.current,
          }),
          signal: controller.signal,
        },
      );
      if (!controller.signal.aborted) setResult(doc);
    } catch (e) {
      if (!controller.signal.aborted) setError(problem(e));
    } finally {
      if (!controller.signal.aborted) setRunning(false);
      active.current = null;
    }
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 10, paddingBottom: 20 }}
    >
      {result ? (
        <>
          <Text style={{ color: p.muted }}>
            {uiText("Salvato nei Documenti personali · Solo tu")}
          </Text>
          <Text
            selectable
            style={{ color: p.text, fontSize: 16, lineHeight: 23 }}
          >
            {result.answer}
          </Text>
          {result.documentWorkspaceId && result.documentSourceId && (
            <DocumentActions
              request={request}
              identity={identity}
              archive={result.documentWorkspaceId}
              source={result.documentSourceId}
              destinationId={workspaceId}
              destination={destination}
            />
          )}
        </>
      ) : (
        <>
          <Field
            multiline
            maxLength={2000}
            label={uiText("Che documento ti serve?")}
            value={question}
            onChangeText={setQuestion}
            editable={!running}
          />
          <Text style={{ color: p.muted }}>
            {uiText(
              "Emme prepara un file Markdown nei tuoi Documenti personali. Puoi condividerlo dopo averlo letto.",
            )}
          </Text>
          <Action
            primary
            label={
              running
                ? uiText("Emme sta scrivendo…")
                : error
                  ? uiText("Riprova")
                  : uiText("Prepara anteprima")
            }
            disabled={running || !question.trim()}
            onPress={() => void generate()}
          />
        </>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: p.text }}>
          {error}
        </Text>
      )}
    </ScrollView>
  );
}

function DocumentActions({
  request,
  identity,
  archive,
  source,
  destinationId,
  destination,
}: {
  request: NativeRequest;
  identity: Identity;
  archive: string;
  source: string;
  destinationId: string;
  destination?: string;
}) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette(),
    [shared, setShared] = useState(false),
    [error, setError] = useState("");
  const scope = useMemo(
    () => ({
      origin: identity.origin,
      actorId: identity.actorId,
      workspaceId: archive,
    }),
    [identity.origin, identity.actorId, archive],
  );
  const cmd = useCommands(request, scope, (p) => {
    const op = p.intent;
    if (
      op.kind === "command" &&
      op.command.type === "library.copy" &&
      op.command.sourceId === source &&
      op.command.destinationId === destinationId
    )
      setShared(true);
  });
  return (
    <View style={{ gap: 6 }}>
      <Action
        variant="quiet"
        label={uiText("Scarica Markdown")}
        onPress={() => {
          setError("");
          void shareFile(
            request,
            workspacePath(archive) +
              "/source-file?id=" +
              encodeURIComponent(source),
            "Documento.md",
            "text/markdown",
          ).catch((e) => setError(problem(e)));
        }}
      />
      {destination &&
        (shared ? (
          <Text style={{ color: c.muted }}>
            {uiText("Condiviso in ")}
            {destination}
          </Text>
        ) : (
          <Action
            primary
            label={uiText("Condividi in {0}", String(destination))}
            disabled={!cmd.ready || !!cmd.pending || cmd.working}
            onPress={() =>
              void cmd.send({
                kind: "command",
                label: "Condividi documento",
                command: {
                  type: "library.copy",
                  sourceId: source,
                  destinationId,
                },
              })
            }
          />
        ))}
      <PendingStrip commands={cmd} />
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: c.text }}>
          {error}
        </Text>
      )}
    </View>
  );
}
