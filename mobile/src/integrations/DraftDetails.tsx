import { useUiLanguage } from "../i18n";
import { useRef, useState } from "react";
import { View } from "react-native";
import type {
  EmailView,
  EmailEnvelope,
  EmailComposition,
} from "../../../src/contracts/email";
import { type NativeRequest, post, problem } from "../api";
import { Action, Field } from "../ui";
import { Body, Label } from "./parts";
import type { MailEditorInput } from "./mail-editor";

type History = {
  versions: {
    version: number;
    envelope: EmailEnvelope;
    reason: string;
    created_at: string;
  }[];
  transitions: { status: string; created_at: string }[];
  compositions: {
    id: string;
    draft_version: number;
    instruction: string;
    created_at: string;
  }[];
};
export function DraftDetails({
  draft,
  base,
  request,
  disabled,
  canContribute,
  edit,
}: {
  draft: EmailView["drafts"][number];
  base: string;
  request: NativeRequest;
  disabled: boolean;
  canContribute: boolean;
  edit: (input: MailEditorInput) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const gate = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [history, setHistory] = useState<History | null>(null);
  const [instruction, setInstruction] = useState(""),
    [ask, setAsk] = useState(false),
    [result, setResult] = useState<EmailComposition | null>(null);
  async function run(fn: () => Promise<void>) {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(problem(e));
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 8 }}>
      <Action
        disabled={busy}
        label={
          history
            ? uiText("Nascondi cronologia")
            : uiText("Cronologia della bozza")
        }
        onPress={() => {
          if (history) setHistory(null);
          else
            void run(async () =>
              setHistory(
                await request<History>(base + "-history?draftId=" + draft.id),
              ),
            );
        }}
      />
      {history && (
        <View style={{ gap: 6 }}>
          {history.versions.map((v) => (
            <View key={v.version}>
              <Body>
                {uiText("v")}
                {v.version} · {v.envelope.subject || uiText("Senza oggetto")}
              </Body>
              <Label>
                {new Date(v.created_at).toLocaleString(locale)} · {v.reason}
              </Label>
              <Body>{v.envelope.body}</Body>
            </View>
          ))}
          {history.transitions.map((t, index) => (
            <Label key={index}>
              {new Date(t.created_at).toLocaleString(locale)} · {t.status}
            </Label>
          ))}
          {history.compositions.map((c) => (
            <Label key={c.id}>
              {uiText("Richiesta a Emme · v")}
              {c.draft_version} · {c.instruction}
            </Label>
          ))}
        </View>
      )}
      {canContribute && (
        <Action
          label={
            ask ? uiText("Chiudi suggerimento") : uiText("Scrivi con Emme")
          }
          disabled={disabled || busy}
          onPress={() => setAsk(!ask)}
        />
      )}
      {ask && canContribute && (
        <>
          <Label>
            {uiText(
              "Il modello riceve oggetto, testo della bozza e istruzione. Tu scegli se usare il suggerimento.",
            )}
          </Label>
          <Field
            label={uiText("Istruzione per Emme")}
            value={instruction}
            onChangeText={setInstruction}
            maxLength={4000}
          />
          <Action
            label={uiText("Chiedi un suggerimento")}
            disabled={disabled || busy || !instruction.trim()}
            onPress={() =>
              void run(async () => {
                setResult(null);
                setResult(
                  await request<EmailComposition>(
                    base + "-compose",
                    post({
                      draftId: draft.id,
                      version: draft.version,
                      instruction: instruction.trim(),
                    }),
                  ),
                );
              })
            }
          />
          {result?.suggestion.needsClarification ? (
            <Body>{result.suggestion.needsClarification}</Body>
          ) : (
            result &&
            result.draftId === draft.id &&
            result.version === draft.version && (
              <>
                <Body>{result.suggestion.subject}</Body>
                <Body>{result.suggestion.body}</Body>
                <Action
                  label={uiText("Usa il suggerimento nella bozza")}
                  disabled={disabled || busy}
                  onPress={() =>
                    edit({
                      existing: draft,
                      connectionId: draft.connectionId,
                      compositionId: result.id,
                      envelope: {
                        ...draft.envelope,
                        subject: result.suggestion.subject,
                        body: result.suggestion.body,
                      },
                    })
                  }
                />
              </>
            )
          )}
        </>
      )}
      {busy && <Label>{uiText("Caricamento…")}</Label>}
      {!!error && <Label>{error}</Label>}
    </View>
  );
}
