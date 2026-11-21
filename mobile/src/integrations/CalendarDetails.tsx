import { useUiLanguage } from "../i18n";
import { useState } from "react";
import { View } from "react-native";
import type {
  CalendarView,
  CalendarCommand,
} from "../../../src/contracts/calendar";
import type { NativeRequest } from "../api";
import { problem } from "../api";
import { Field, Action } from "../ui";
import { Body, Label, confirm } from "./parts";
import { eventPayload, localMoment } from "./inputs";

type Perform = (command: CalendarCommand, label: string) => void;
type CalendarHistory = {
  versions: {
    version: number;
    target_label: string;
    payload: { title: string; start: string; end: string };
    reason: string;
    created_at: string;
  }[];
  transitions: { action_version: number; status: string; created_at: string }[];
  approvals: { action_version: number; created_at: string }[];
};
export function CalendarDetails({
  request,
  base,
  view,
  action,
  actorId,
  busy,
  perform,
}: {
  request: NativeRequest;
  base: string;
  view: CalendarView;
  action: CalendarView["actions"][number];
  actorId: string;
  busy: boolean;
  perform: Perform;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const [history, setHistory] = useState<CalendarHistory | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const temporal = view.temporal.find(
    (t) => t.kind === action.temporal?.kind && t.id === action.temporal?.id,
  );
  const publication =
    temporal &&
    view.publications.find(
      (p) =>
        p.connectionId === action.connectionId &&
        p.resourceId === action.resourceId &&
        p.temporal?.id === temporal.id &&
        p.temporal?.kind === temporal.kind,
    );
  async function openHistory() {
    if (history) {
      setHistory(null);
      return;
    }
    setError("");
    setLoading(true);
    try {
      setHistory(
        await request<CalendarHistory>(
          base + "-history?kind=action&id=" + action.id,
        ),
      );
    } catch (e) {
      setError(problem(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <View style={{ gap: 6 }}>
      <Action
        label={
          history
            ? uiText("Chiudi cronologia")
            : uiText("Cronologia pubblicazione")
        }
        disabled={loading}
        onPress={() => void openHistory()}
      />
      {history && (
        <>
          {history.versions.map((v) => (
            <View key={v.version}>
              <Body>
                {uiText("v")}
                {v.version} · {v.payload.title} · {v.target_label}
              </Body>
              <Label>
                {new Date(v.payload.start).toLocaleString(locale)} —{" "}
                {new Date(v.payload.end).toLocaleString(locale)} · {v.reason}
              </Label>
            </View>
          ))}
          {history.approvals.map((a, i) => (
            <Label key={"a" + i}>
              {uiText("Autorizzazione v")}
              {a.action_version} ·{" "}
              {new Date(a.created_at).toLocaleString(locale)}
            </Label>
          ))}
          {history.transitions.map((t, i) => (
            <Label key={"t" + i}>
              {uiText("v")}
              {t.action_version} · {t.status} ·{" "}
              {new Date(t.created_at).toLocaleString(locale)}
            </Label>
          ))}
        </>
      )}
      {!!error && <Label>{error}</Label>}
      {temporal &&
        action.proposedBy === actorId &&
        action.personId === actorId &&
        ["PROPOSED", "AUTHORIZED", "FAILED"].includes(action.status) &&
        (action.operation !== "update" || publication) && (
          <Action
            label={uiText("Aggiorna la proposta dal calendario dello spazio")}
            disabled={busy}
            onPress={() =>
              confirm(
                uiText,
                uiText("Creare una nuova versione?"),
                temporal.payload.title +
                  " · " +
                  new Date(temporal.payload.start).toLocaleString(locale) +
                  ". La nuova proposta richiederà la tua autorizzazione prima della pubblicazione.",
                uiText("Crea versione"),
                () =>
                  perform(
                    {
                      type: "calendar.revise",
                      actionId: action.id,
                      expectedVersion: action.version,
                      connectionId: action.connectionId,
                      resourceId: action.resourceId,
                      operation: action.operation,
                      ...(action.operation === "update"
                        ? { publicationId: publication!.id }
                        : {}),
                      temporal: {
                        id: temporal.id,
                        kind: temporal.kind,
                        version: temporal.version,
                      },
                      payload: temporal.payload,
                      reason:
                        "Riallineamento esplicito alla versione interna corrente",
                      shareWithWorkspace: true,
                    },
                    "Aggiorna proposta calendario",
                  ),
              )
            }
          />
        )}
    </View>
  );
}

type Own = CalendarView["ownCommitments"][number];
export function CommitmentTime({
  view,
  busy,
  perform,
}: {
  view: CalendarView;
  busy: boolean;
  perform: Perform;
}) {
  const { t: uiText } = useUiLanguage();
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState<{ c: Own; revision: number } | null>(
      null,
    );
  const [start, setStart] = useState(() => localMoment(new Date())),
    [end, setEnd] = useState(() => localMoment(new Date(Date.now() + 3600000))),
    [reason, setReason] = useState("");
  if (!view.ownCommitments.length) return null;
  const payload = eventPayload(selected?.c.content || "", start, end);
  return (
    <View style={{ gap: 8 }}>
      <Action
        label={
          open
            ? uiText("Chiudi data impegno")
            : uiText("Imposta una data per un mio impegno")
        }
        onPress={() => setOpen(!open)}
      />
      {open && (
        <>
          {view.ownCommitments.map((c) => (
            <Action
              key={c.id}
              label={c.content}
              primary={c.id === selected?.c.id}
              onPress={() => setSelected({ c, revision: view.contextRevision })}
            />
          ))}
          {selected && (
            <>
              <Field
                label={uiText("Inizio · AAAA-MM-GG HH:MM")}
                value={start}
                onChangeText={setStart}
              />
              <Field
                label={uiText("Fine · AAAA-MM-GG HH:MM")}
                value={end}
                onChangeText={setEnd}
              />
              <Field
                label={uiText("Motivo della data")}
                maxLength={2000}
                value={reason}
                onChangeText={setReason}
              />
              <Action
                label={uiText("Stabilisci la data per me")}
                disabled={busy || !payload || !reason.trim()}
                onPress={() => {
                  if (!payload) return;
                  confirm(
                    uiText,
                    uiText("Stabilire la data?"),
                    selected.c.content +
                      "\n" +
                      start +
                      " — " +
                      end +
                      "\nLa data vale soltanto per te. Il calendario esterno e il contenuto dell’impegno restano separati.",
                    uiText("Conferma"),
                    () =>
                      perform(
                        {
                          type: "commitment.time.set",
                          commitmentId: selected.c.id,
                          expectedVersion: selected.c.version,
                          expectedContextRevision: selected.revision,
                          representSelf: true,
                          time: {
                            start: payload.start,
                            end: payload.end,
                            timeZone: payload.timeZone,
                          },
                          reason: reason.trim(),
                        },
                        "Stabilisci la data dell’impegno",
                      ),
                  );
                }}
              />
            </>
          )}
        </>
      )}
    </View>
  );
}
