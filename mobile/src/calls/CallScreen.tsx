import { useUiLanguage } from "../i18n";
import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { recordingConsentWordingSchema } from "../../../src/contracts/calls";
import { type NativeRequest } from "../api";
import { Action, usePalette } from "../ui";
import { PendingStrip } from "../workspace/PendingStrip";
import { Body, Label, Section, confirm } from "../integrations/parts";
import { Recording } from "./Recording";
import { recordingState } from "./policy";
import { useHumanCall } from "./useHumanCall";

interface Props {
  request: NativeRequest;
  actorId: string;
  origin: string;
  workspaceId: string;
  name: string;
  onBack: () => void;
  canContribute: boolean;
}
export function CallScreen(props: Props) {
  return (
    <Call
      key={JSON.stringify([props.origin, props.actorId, props.workspaceId])}
      {...props}
    />
  );
}
function Call({
  request,
  actorId,
  origin,
  workspaceId,
  name,
  onBack,
  canContribute,
}: Props) {
  const { t: uiText, locale } = useUiLanguage();
  const p = usePalette();
  const phone = useHumanCall(request, origin, workspaceId, actorId);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [showOutputs, setShowOutputs] = useState(false);
  const current = phone.actorCall;
  const self = phone.self;
  const view = phone.view;
  const busy =
    phone.command.working || !!phone.command.pending || !phone.command.ready;
  const exiting =
    phone.exitCommand.working ||
    !!phone.exitCommand.pending ||
    !phone.exitCommand.ready;
  const wording = recordingConsentWordingSchema.safeParse(
    view?.currentConsentText ?? view?.consentText,
  );
  const base = "/api/v1/workspaces/" + workspaceId;
  return (
    <View style={{ flex: 1, backgroundColor: p.bg, padding: 14 }}>
      <Action label={uiText("Indietro · {0}", String(name))} onPress={onBack} />
      <Text
        accessibilityRole="header"
        style={{
          fontSize: 23,
          color: p.text,
          fontWeight: "600",
          marginVertical: 8,
        }}
      >
        {uiText("Chiamata audio")}
      </Text>
      <PendingStrip commands={phone.exitCommand} />
      <PendingStrip commands={phone.command} />
      <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 38 }}>
        {!view && !phone.error && (
          <Label>{uiText("Verifica disponibilità…")}</Label>
        )}
        {!!phone.error && <Label>{phone.error}</Label>}
        {phone.permissionBlocked && (
          <Action
            label={uiText("Apri impostazioni microfono")}
            onPress={phone.settings}
          />
        )}
        {view && !view.configured && (
          <Label>
            {uiText(
              "Il servizio chiamate deve essere configurato dal gestore di RIMIAM.",
            )}
          </Label>
        )}
        {!canContribute && (
          <Label>
            {uiText(
              "Per entrare serve il permesso di contribuire nello spazio.",
            )}
          </Label>
        )}
        {view?.configured && (
          <Label>
            {uiText(
              "Parli con le persone dello spazio. Per registrare serve il consenso personale di ogni partecipante. Se esci da questa schermata o metti l’app in background, il microfono si scollega.",
            )}
          </Label>
        )}
        {!!phone.status && <Label>{phone.status}</Label>}
        {view?.configured && !phone.wanted && (
          <Action
            primary
            label={uiText("Entra nella chiamata")}
            disabled={busy || exiting || phone.connecting || !canContribute}
            onPress={() => void phone.join()}
          />
        )}
        {(phone.wanted || phone.connected) && (
          <>
            <Action
              label={
                phone.muted
                  ? uiText("Riattiva microfono")
                  : uiText("Silenzia microfono")
              }
              disabled={!phone.connected}
              onPress={phone.mute}
            />
            {phone.outputs.length > 0 && phone.connected && (
              <Action
                label={uiText("Uscita audio")}
                onPress={() => setShowOutputs(!showOutputs)}
              />
            )}
            {phone.connected &&
              showOutputs &&
              phone.outputs.map((id) => (
                <Action
                  key={id}
                  label={id}
                  onPress={() => void phone.output(id)}
                />
              ))}
            <Action
              label={uiText("Lascia la chiamata")}
              onPress={() => phone.exit("call.leave", current?.id)}
            />
          </>
        )}
        {current && (
          <Section title={uiText("Partecipanti e registrazione")}>
            <Body>{uiText(recordingState(current, phone.known))}</Body>
            {current.participants
              .filter((p) => p.state !== "left")
              .map((p) => (
                <Label key={p.id}>
                  {p.name} ·{" "}
                  {p.state === "admitted"
                    ? uiText("in chiamata")
                    : p.state === "waiting"
                      ? uiText("in attesa")
                      : uiText("in uscita")}
                  {p.consented ? uiText(" · consenso espresso") : ""}
                </Label>
              ))}
            {current.errorCode && <Label>{current.errorCode}</Label>}
            {self &&
              phone.wanted &&
              !current.recordingRequested &&
              (view?.recordingConfigured ? (
                <Action
                  label={uiText("Chiedi di registrare")}
                  disabled={busy}
                  onPress={() =>
                    phone.act(
                      { type: "call.recording.request", callId: current.id },
                      "Richiedi registrazione",
                    )
                  }
                />
              ) : (
                <Label>
                  {uiText(
                    "La registrazione non è configurata per questa installazione.",
                  )}
                </Label>
              ))}
            {self &&
              phone.wanted &&
              current.recordingRequested &&
              !self.consented && (
                <>
                  <Body>
                    {wording.success
                      ? uiText(wording.data)
                      : (view?.currentConsentText ?? view?.consentText)}
                  </Body>
                  {locale === "en" && wording.success && (
                    <Action
                      label={uiText("Testo originale del consenso")}
                      onPress={() =>
                        Alert.alert(
                          uiText("Testo originale del consenso"),
                          wording.data,
                        )
                      }
                    />
                  )}
                  {wording.success ? (
                    <Action
                      label={uiText("Acconsento personalmente")}
                      disabled={
                        busy || self.state !== "admitted" || !phone.known
                      }
                      onPress={() =>
                        confirm(
                          uiText,
                          uiText("Vuoi acconsentire per il tuo audio?"),
                          uiText(wording.data),
                          uiText("Acconsento"),
                          () =>
                            phone.act(
                              {
                                type: "call.recording.consent",
                                callId: current.id,
                                epoch: current.epoch,
                                consentText: wording.data,
                              },
                              "Acconsenti alla registrazione",
                            ),
                        )
                      }
                    />
                  ) : (
                    <Label>
                      {uiText(
                        "Aggiorna l’app per controllare e accettare queste condizioni.",
                      )}
                    </Label>
                  )}
                </>
              )}
            {self && phone.wanted && current.recordingRequested && (
              <Action
                label={uiText("Ritira consenso e scollega il mio audio")}
                onPress={() =>
                  phone.exit("call.recording.withdraw", current.id)
                }
              />
            )}
          </Section>
        )}
        {!phone.wanted &&
          view?.calls
            .filter((c) => c.state === "ended" || c.recordings.length > 0)
            .map((call) => (
              <Section
                key={call.id}
                title={uiText(
                  "Chiamata · {0}",
                  String(call.state === "ended" ? "conclusa" : "in corso"),
                )}
              >
                <Action
                  label={uiText(
                    "{0} materiali e trascrizioni",
                    String(expanded === call.id ? "Chiudi" : "Apri"),
                  )}
                  onPress={() =>
                    setExpanded(expanded === call.id ? null : call.id)
                  }
                />
                {expanded === call.id && (
                  <>
                    {call.recordings.length === 0 && (
                      <Label>
                        {uiText("Nessuna registrazione autorizzata.")}
                      </Label>
                    )}
                    {call.recordings.map((r) => (
                      <View key={r.id} style={{ gap: 6 }}>
                        <Body>
                          {
                            call.participants.find(
                              (p) => p.id === r.participantId,
                            )?.name
                          }{" "}
                          · {new Date(r.createdAt).toLocaleString(locale)}
                        </Body>
                        <Label>
                          {r.state} ·{" "}
                          {r.transcriptionStatus ??
                            uiText("Trascrizione in attesa")}
                          {uiText(" · consenso #")}
                          {r.consentEpoch}
                          {r.consentEventVersion !== null
                            ? uiText(
                                " · evento v{0}",
                                String(r.consentEventVersion),
                              )
                            : ""}
                        </Label>
                        {r.errorCode && <Label>{r.errorCode}</Label>}
                        {r.state === "complete" && (
                          <Recording
                            request={request}
                            path={
                              base +
                              "/call-audio?id=" +
                              encodeURIComponent(r.id)
                            }
                          />
                        )}
                        {r.segments.map((s) => (
                          <View key={s.id}>
                            <Label>
                              {uiText("Fonte · ")}
                              {s.startSeconds}
                              {uiText(" s · ")}
                              {s.qualification}
                            </Label>
                            <Body>{s.content}</Body>
                          </View>
                        ))}
                      </View>
                    ))}
                    {call.recordings.some(
                      (r) =>
                        r.transcriptionStatus === "needs_configuration" ||
                        r.transcriptionStatus === "failed",
                    ) && (
                      <Action
                        label={uiText("Riprova trascrizione")}
                        disabled={busy || !canContribute}
                        onPress={() =>
                          phone.act(
                            {
                              type: "call.transcription.retry",
                              callId: call.id,
                            },
                            "Riprova trascrizione",
                          )
                        }
                      />
                    )}
                    {call.state === "ended" &&
                      call.recordings.some((r) => r.segments.length > 0) && (
                        <Action
                          label={
                            call.analysisRequested
                              ? uiText("Prosegui l’analisi richiesta")
                              : uiText("Richiedi analisi a Emme")
                          }
                          disabled={busy || !canContribute}
                          onPress={() =>
                            confirm(
                              uiText,
                              uiText(
                                "Richiedere l’analisi delle trascrizioni?",
                              ),
                              uiText(
                                "Emme potrà usare i segmenti autorizzati per preparare un risultato nello spazio.",
                              ),
                              uiText("Richiedi analisi"),
                              () =>
                                phone.act(
                                  { type: "call.analyze", callId: call.id },
                                  "Richiedi analisi della chiamata",
                                ),
                            )
                          }
                        />
                      )}
                    <Action
                      label={uiText("Storia dei consensi")}
                      onPress={() =>
                        setHistory(history === call.id ? null : call.id)
                      }
                    />
                    {history === call.id &&
                      call.events.map((e) => (
                        <View key={e.version}>
                          <Label>
                            {new Date(e.createdAt).toLocaleString(locale)} ·{" "}
                            {e.kind} {uiText("· v")}
                            {e.version}
                            {e.epoch !== null
                              ? uiText(" · consenso #{0}", String(e.epoch))
                              : ""}
                          </Label>
                          {e.actorId && (
                            <Label>
                              {call.participants.find(
                                (p) => p.userId === e.actorId,
                              )?.name ?? e.actorId}
                            </Label>
                          )}
                          {e.consentText && <Body>{e.consentText}</Body>}
                        </View>
                      ))}
                  </>
                )}
              </Section>
            ))}
        <Action label={uiText("Aggiorna stato")} onPress={phone.refresh} />
      </ScrollView>
    </View>
  );
}
