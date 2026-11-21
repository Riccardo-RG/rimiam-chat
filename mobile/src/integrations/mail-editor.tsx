import { useUiLanguage } from "../i18n";
import { useState } from "react";
import { View } from "react-native";
import type {
  EmailCommand,
  EmailEnvelope,
  EmailView,
} from "../../../src/contracts/email";
import { Action, Field } from "../ui";
import { addresses } from "./inputs";
import { Label, Section } from "./parts";

export type MailEditorInput = {
  envelope: EmailEnvelope;
  connectionId: string | null;
  compositionId?: string;
  existing?: Pick<EmailView["drafts"][number], "id" | "version">;
};
export type MailPerform = (command: EmailCommand, label: string) => void;

export function MailEditor({
  editor,
  view,
  email,
  busy,
  perform,
  onClose,
}: {
  editor: MailEditorInput;
  view: EmailView;
  email: string;
  busy: boolean;
  perform: MailPerform;
  onClose: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const [envelope, setEnvelope] = useState(editor.envelope);
  const [connection, setConnection] = useState(editor.connectionId);
  const [to, setTo] = useState(envelope.to.join(", "));
  const [cc, setCc] = useState(envelope.cc.join(", "));
  const [bcc, setBcc] = useState(envelope.bcc.join(", "));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [attachments, setAttachments] = useState(false);
  function save() {
    const lists = { to: addresses(to), cc: addresses(cc), bcc: addresses(bcc) };
    if (
      Object.values(lists).some(
        (list) =>
          list.length > 20 ||
          list.some((address) => !/^\S+@[^\s@]+\.[^\s@]+$/.test(address)),
      )
    ) {
      setError(
        uiText(
          "Controlla gli indirizzi. Separa ciascun destinatario con una virgola.",
        ),
      );
      return;
    }
    const fields = {
      connectionId: connection,
      envelope: { ...envelope, ...lists },
      reason:
        reason.trim() ||
        (editor.existing
          ? "Revisione privata della bozza"
          : "Preparazione della bozza privata"),
    };
    const command: EmailCommand = editor.existing
      ? {
          type: "email.draft.revise",
          draftId: editor.existing.id,
          expectedVersion: editor.existing.version,
          compositionId: editor.compositionId,
          ...fields,
        }
      : { type: "email.draft.create", ...fields };
    setError("");
    perform(command, "Salva bozza");
  }
  const selected = view.connections.find((c) => c.id === connection);
  const files = [...view.workspaceAttachments, ...view.attachments];
  return (
    <Section
      title={
        editor.existing
          ? uiText("Modifica la bozza · v{0}", String(editor.existing.version))
          : uiText("Scrivi una bozza privata")
      }
    >
      <Label>
        {uiText("Da ")}
        {envelope.sender} ·{" "}
        {connection
          ? (selected?.label ?? uiText("Casella scollegata"))
          : uiText("Solo bozza")}
      </Label>
      {!editor.envelope.target && (
        <View style={{ gap: 6 }}>
          {view.connections
            .filter((c) => c.active && c.id !== connection && c.canSend)
            .map((c) => (
              <Action
                key={c.id}
                label={uiText("Usa {0}", String(c.sender))}
                disabled={busy}
                onPress={() => {
                  setConnection(c.id);
                  setEnvelope({ ...envelope, sender: c.sender });
                }}
              />
            ))}
          {connection && (
            <Action
              label={uiText("Salva senza collegare una casella")}
              disabled={busy}
              onPress={() => {
                setConnection(null);
                setEnvelope({ ...envelope, sender: email });
              }}
            />
          )}
        </View>
      )}
      <Field
        label={uiText("A")}
        autoCapitalize="none"
        keyboardType="email-address"
        value={to}
        onChangeText={setTo}
      />
      <Field
        label={uiText("Cc")}
        autoCapitalize="none"
        keyboardType="email-address"
        value={cc}
        onChangeText={setCc}
      />
      <Field
        label={uiText("Ccn")}
        autoCapitalize="none"
        keyboardType="email-address"
        value={bcc}
        onChangeText={setBcc}
      />
      <Field
        label={uiText("Oggetto")}
        value={envelope.subject}
        maxLength={500}
        onChangeText={(subject) => setEnvelope({ ...envelope, subject })}
      />
      <Field
        label={uiText("Messaggio")}
        multiline
        maxLength={24000}
        value={envelope.body}
        onChangeText={(body) => setEnvelope({ ...envelope, body })}
      />
      {files.length > 0 && (
        <Action
          label={
            attachments
              ? uiText("Chiudi allegati")
              : uiText(
                  "Scegli allegati ({0})",
                  String(envelope.attachments.length),
                )
          }
          onPress={() => setAttachments(!attachments)}
        />
      )}
      {attachments &&
        files.map((file) => {
          const included = envelope.attachments.some(
            (a) => a.id === file.id && a.kind === file.kind,
          );
          return (
            <Action
              key={file.kind + file.id}
              label={uiText(
                "{0}{1} · v{2}",
                String(included ? "Togli " : "Aggiungi "),
                String(file.filename),
                String(file.version),
              )}
              disabled={
                busy || (!included && envelope.attachments.length >= 10)
              }
              onPress={() => {
                const ref = {
                  id: file.id,
                  version: file.version,
                  hash: file.hash,
                  kind: file.kind,
                  filename: file.filename,
                };
                setEnvelope({
                  ...envelope,
                  attachments: included
                    ? envelope.attachments.filter(
                        (a) => a.id !== file.id || a.kind !== file.kind,
                      )
                    : [...envelope.attachments, ref],
                });
              }}
            />
          );
        })}
      <Field
        label={uiText("Nota sulla versione (facoltativa)")}
        value={reason}
        maxLength={2000}
        onChangeText={setReason}
      />
      {!!error && <Label>{error}</Label>}
      <Action
        primary
        label={uiText("Salva bozza")}
        disabled={busy || !envelope.sender}
        onPress={save}
      />
      <Action
        label={uiText("Chiudi editor")}
        disabled={busy}
        onPress={onClose}
      />
    </Section>
  );
}
