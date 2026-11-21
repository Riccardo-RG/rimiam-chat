import { useUiLanguage } from "../i18n";
import { useEffect, useState } from "react";
import { View } from "react-native";
import type {
  CalendarCommand,
  CalendarPayload,
  CalendarView,
} from "../../../src/contracts/calendar";
import { DateField } from "../DateField";
import { Action, Field } from "../ui";
import { Body, Label, Section, confirm } from "./parts";
import { eventPayload, localDay, localMoment } from "./inputs";

import { CalendarDetails, CommitmentTime } from "./CalendarDetails";
import type { NativeRequest } from "../api";
type Temporal = CalendarView["temporal"][number];
type Perform = (command: CalendarCommand, label: string) => void;
const statuses = {
  PROPOSED: "Da autorizzare",
  AUTHORIZED: "Autorizzato",
  EXECUTING: "In corso",
  SUCCEEDED: "Confermato dal calendario",
  FAILED: "Operazione non riuscita",
  OUTCOME_UNKNOWN: "Esito incerto",
  REJECTED: "Rifiutato",
} as const;
function period(
  payload: Pick<CalendarPayload, "start" | "end" | "timeZone">,
  locale: string,
) {
  const format = (v: string) =>
    new Date(v).toLocaleString(locale, { timeZone: payload.timeZone });
  return (
    format(payload.start) +
    " → " +
    format(payload.end) +
    " · " +
    payload.timeZone
  );
}
interface Editor {
  entry?: Temporal;
  revision: number;
}

function EventEditor({
  editor,
  view,
  perform,
  busy,
  close,
}: {
  editor: Editor;
  view: CalendarView;
  perform: Perform;
  busy: boolean;
  close: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const entry = editor.entry;
  const [title, setTitle] = useState(entry?.payload.title ?? "");
  const [start, setStart] = useState(
    localMoment(
      entry ? new Date(entry.payload.start) : new Date(Date.now() + 3600000),
    ),
  );
  const [end, setEnd] = useState(
    localMoment(
      entry ? new Date(entry.payload.end) : new Date(Date.now() + 7200000),
    ),
  );
  const [audience, setAudience] = useState<NonNullable<Temporal["audience"]>>(
    entry?.audience ?? { kind: "calendar" },
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  function save() {
    const payload = eventPayload(title, start, end);
    if (!payload) {
      setError(
        uiText(
          "Inserisci un titolo e un intervallo valido in ora locale. La fine deve seguire l’inizio.",
        ),
      );
      return;
    }
    if (audience.kind === "people" && !audience.people.length) {
      setError(uiText("Scegli almeno una persona."));
      return;
    }
    const fields = {
      payload,
      audience,
      reason: reason.trim() || "Appuntamento impostato per me",
      representSelf: true as const,
      expectedContextRevision: editor.revision,
    };
    const command: CalendarCommand = entry
      ? {
          type: "temporal.revise",
          eventId: entry.id,
          expectedVersion: entry.version,
          ...fields,
        }
      : { type: "temporal.create", ...fields };
    confirm(
      uiText,
      uiText("Salvare l’appuntamento nello spazio?"),
      payload.title +
        "\n" +
        period(payload, locale) +
        "\nAgisci per te. Il tuo calendario esterno rimane separato.",
      uiText("Salva"),
      () => perform(command, "Salva appuntamento"),
    );
  }
  const people = audience.kind === "people" ? audience.people : [];
  return (
    <Section
      title={
        entry
          ? uiText("Modifica appuntamento · v{0}", String(entry.version))
          : uiText("Nuovo appuntamento")
      }
    >
      <Field
        label={uiText("Titolo")}
        value={title}
        onChangeText={setTitle}
        maxLength={200}
      />
      <DateField
        label={uiText("Inizio appuntamento")}
        value={new Date(start.replace(" ", "T"))}
        change={(d) => setStart(localMoment(d))}
      />
      <DateField
        label={uiText("Fine appuntamento")}
        value={new Date(end.replace(" ", "T"))}
        change={(d) => setEnd(localMoment(d))}
      />
      <Label>
        {uiText("Ora locale · ")}
        {Intl.DateTimeFormat().resolvedOptions().timeZone}
      </Label>
      {(["calendar", "all", "people"] as const).map((kind) => (
        <Action
          key={kind}
          primary={audience.kind === kind}
          label={
            kind === "calendar"
              ? uiText("Solo nel calendario dello spazio")
              : kind === "all"
                ? uiText("Tutto lo spazio")
                : uiText("Scegli persone")
          }
          onPress={() =>
            setAudience(kind === "people" ? { kind, people } : { kind })
          }
        />
      ))}
      {audience.kind === "people" &&
        view.members.map((m) => (
          <Action
            key={m.id}
            label={m.name}
            primary={people.includes(m.id)}
            onPress={() => {
              setAudience({
                kind: "people",
                people: people.includes(m.id)
                  ? people.filter((id) => id !== m.id)
                  : [...people, m.id],
              });
            }}
          />
        ))}
      <Field
        label={uiText("Nota (facoltativa)")}
        value={reason}
        maxLength={2000}
        onChangeText={setReason}
      />
      {!!error && <Label>{error}</Label>}
      <Action
        label={uiText("Salva nello spazio")}
        primary
        disabled={busy}
        onPress={save}
      />
      <Action label={uiText("Annulla")} disabled={busy} onPress={close} />
    </Section>
  );
}

export function CalendarPanel({
  view,
  base,
  request,
  page,
  onPage,
  actorId,
  canContribute,
  perform,
  busy,
  day,
  onDayChange,
  saved,
  personal,
}: {
  view: CalendarView;
  actorId: string;
  canContribute: boolean;
  perform: Perform;
  busy: boolean;
  day: string;
  onDayChange: (day: string) => void;
  saved: number;
  personal: boolean;
  base: string;
  request: NativeRequest;
  page: string | null;
  onPage: (cursor: string | null) => void;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const [edit, setEdit] = useState<Editor | null>(null);

  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => setEdit(null), [saved]);
  if (edit)
    return (
      <EventEditor
        editor={edit}
        view={view}
        perform={perform}
        busy={busy}
        close={() => setEdit(null)}
      />
    );
  const active = view.connections.filter((c) => c.active);
  return (
    <>
      <Section title={uiText("Periodo")}>
        <DateField
          dateOnly
          label={uiText("Mostra 30 giorni dal")}
          value={new Date(day + "T12:00:00")}
          change={(d) => onDayChange(localDay(d))}
        />
      </Section>
      {!personal && (
        <Section title={uiText("Appuntamenti dello spazio")}>
          {canContribute && (
            <Action
              primary
              label={uiText("Nuovo appuntamento")}
              onPress={() => setEdit({ revision: view.contextRevision })}
              disabled={busy}
            />
          )}
          {canContribute && (
            <CommitmentTime
              key={saved}
              view={view}
              perform={perform}
              busy={busy}
            />
          )}
          {!view.temporal.length && (
            <Label>{uiText("Nessun appuntamento in questo periodo.")}</Label>
          )}
          {view.temporal.map((t) => (
            <View key={t.kind + t.id} style={{ gap: 6 }}>
              <Action
                label={
                  t.payload.title +
                  " · " +
                  new Date(t.payload.start).toLocaleDateString(locale)
                }
                onPress={() => setExpanded(expanded === t.id ? null : t.id)}
              />
              {expanded === t.id && (
                <>
                  <Body>{period(t.payload, locale)}</Body>
                  <Label>
                    {t.reason}
                    {uiText(" · v")}
                    {t.version}
                  </Label>
                  {t.personId === actorId &&
                    canContribute &&
                    t.kind === "scheduled_event" && (
                      <Action
                        label={uiText("Modifica nello spazio")}
                        disabled={busy}
                        onPress={() =>
                          setEdit({ entry: t, revision: view.contextRevision })
                        }
                      />
                    )}
                  {t.personId === actorId &&
                    canContribute &&
                    active.flatMap((c) =>
                      c.resources
                        .filter((r) => r.canWriteSelf)
                        .map((r) => {
                          const link = view.publications.find(
                            (p) =>
                              p.connectionId === c.id &&
                              p.resourceId === r.id &&
                              p.temporal?.id === t.id &&
                              p.temporal.kind === t.kind,
                          );
                          const label =
                            (link
                              ? "Proponi aggiornamento su "
                              : "Proponi pubblicazione su ") + r.label;
                          return (
                            <Action
                              key={r.id}
                              disabled={busy}
                              label={label}
                              onPress={() =>
                                confirm(
                                  uiText,
                                  uiText(
                                    "Rendere visibile la proposta nello spazio?",
                                  ),
                                  t.payload.title +
                                    "\n" +
                                    period(t.payload, locale) +
                                    "\nDestinazione: " +
                                    r.label +
                                    ". La scrittura sul calendario richiederà la tua conferma.",
                                  uiText("Prepara proposta"),
                                  () =>
                                    perform(
                                      {
                                        type: "calendar.propose",
                                        connectionId: c.id,
                                        resourceId: r.id,
                                        operation: link ? "update" : "create",
                                        ...(link
                                          ? { publicationId: link.id }
                                          : {}),
                                        temporal: {
                                          kind: t.kind,
                                          id: t.id,
                                          version: t.version,
                                        },
                                        payload: t.payload,
                                        shareWithWorkspace: true,
                                        reason:
                                          "Proposta dall’appuntamento interno",
                                      },
                                      "Prepara pubblicazione calendario",
                                    ),
                                )
                              }
                            />
                          );
                        }),
                    )}
                </>
              )}
            </View>
          ))}
        </Section>
      )}
      {!personal && view.actions.length > 0 && (
        <Section title={uiText("Pubblicazioni")}>
          {view.actions.map((a) => (
            <View key={a.id} style={{ gap: 6 }}>
              <Action
                label={uiText(
                  "{0} · {1} · v{2}",
                  String(a.payload.title),
                  String(uiText(statuses[a.status])),
                  String(a.version),
                )}
                onPress={() => setExpanded(expanded === a.id ? null : a.id)}
              />
              {expanded === a.id && (
                <>
                  <Body>
                    {a.operation === "create"
                      ? uiText("Creazione")
                      : uiText("Aggiornamento")}{" "}
                    {uiText("su ")}
                    {a.target}
                  </Body>
                  <Body>{period(a.payload, locale)}</Body>
                  <Label>
                    {a.personName} · {a.reason}
                  </Label>
                  {a.status === "OUTCOME_UNKNOWN" && (
                    <Label>
                      {uiText(
                        "Il calendario potrebbe aver applicato la modifica. Verifica l’esito.",
                      )}
                    </Label>
                  )}
                  {a.error && <Label>{a.error}</Label>}
                  <CalendarDetails
                    key={a.id + a.version}
                    base={base}
                    request={request}
                    view={view}
                    action={a}
                    actorId={actorId}
                    busy={busy}
                    perform={perform}
                  />
                  {a.canAuthorize && (
                    <Action
                      primary
                      label={uiText("Autorizza v{0}", String(a.version))}
                      disabled={busy}
                      onPress={() =>
                        confirm(
                          uiText,
                          uiText("Confermare sul tuo calendario?"),
                          a.payload.title +
                            "\n" +
                            period(a.payload, locale) +
                            "\nDestinazione: " +
                            a.target +
                            "\nAgisci soltanto per te. Non verranno inviati inviti ai partecipanti.",
                          uiText("Autorizza"),
                          () =>
                            perform(
                              {
                                type: "calendar.authorize",
                                actionId: a.id,
                                version: a.version,
                                expectedAccessRevision: view.accessRevision,
                                expectedContextRevision: view.contextRevision,
                                representSelf: true,
                              },
                              "Autorizza pubblicazione",
                            ),
                        )
                      }
                    />
                  )}
                  {a.canReject && (
                    <Action
                      label={uiText("Rifiuta")}
                      disabled={busy}
                      onPress={() =>
                        perform(
                          {
                            type: "calendar.reject",
                            actionId: a.id,
                            version: a.version,
                            reason: "Rifiutata dalla persona rappresentata",
                          },
                          "Rifiuta pubblicazione",
                        )
                      }
                    />
                  )}
                  {a.canReconcile && (
                    <Action
                      label={uiText("Verifica esito")}
                      disabled={busy}
                      onPress={() =>
                        perform(
                          {
                            type: "calendar.reconcile",
                            actionId: a.id,
                            version: a.version,
                          },
                          "Verifica esito calendario",
                        )
                      }
                    />
                  )}
                  {a.canRetry && (
                    <Action
                      label={uiText("Riprova la stessa versione")}
                      disabled={busy}
                      onPress={() =>
                        confirm(
                          uiText,
                          uiText("Riprovare la pubblicazione?"),
                          a.payload.title,
                          uiText("Riprova"),
                          () =>
                            perform(
                              {
                                type: "calendar.retry",
                                actionId: a.id,
                                version: a.version,
                              },
                              "Riprova pubblicazione",
                            ),
                        )
                      }
                    />
                  )}
                </>
              )}
            </View>
          ))}
        </Section>
      )}
      {!personal && view.nextActions && (
        <Action
          label={uiText("Altre pubblicazioni")}
          onPress={() => onPage(view.nextActions)}
        />
      )}
      {!!page && (
        <Action
          label={uiText("Pubblicazioni recenti")}
          onPress={() => onPage(null)}
        />
      )}
      {active.map((c) => (
        <Section key={c.id} title={c.label}>
          {c.resources
            .filter((r) => r.canRead)
            .map((r) => (
              <View key={r.id} style={{ gap: 5 }}>
                <Body>{r.label}</Body>
                {(["events", "availability"] as const).map((mode) => (
                  <Action
                    key={mode}
                    label={
                      mode === "events"
                        ? uiText("Leggi eventi privati")
                        : uiText("Leggi disponibilità")
                    }
                    disabled={busy}
                    onPress={() =>
                      perform(
                        {
                          type: "calendar.read",
                          connectionId: c.id,
                          resourceId: r.id,
                          start: view.window.start,
                          end: view.window.end,
                          mode,
                        },
                        "Leggi calendario privato",
                      )
                    }
                  />
                ))}
              </View>
            ))}
          <Action
            label={uiText("Scollega calendario")}
            disabled={busy}
            onPress={() =>
              confirm(
                uiText,
                uiText("Scollegare il calendario?"),
                c.label +
                  ". Le letture già salvate restano nella loro cronologia.",
                uiText("Scollega"),
                () =>
                  perform(
                    {
                      type: "calendar.disconnect",
                      connectionId: c.id,
                      expectedVersion: c.version,
                    },
                    "Scollega calendario",
                  ),
              )
            }
          />
        </Section>
      ))}
      {view.reads
        .filter((r) => r.status !== "COMPLETED")
        .map((r) => (
          <Label key={r.id}>
            {uiText("Lettura · ")}
            {r.status}
            {r.error ? " · " + r.error : ""}
          </Label>
        ))}
      {view.observations.map((o) => (
        <Section
          key={o.id}
          title={uiText(
            "Lettura privata · {0}",
            String(new Date(o.observedAt).toLocaleString(locale)),
          )}
        >
          {!o.data.complete && (
            <Label>{uiText("Lettura parziale per questo periodo.")}</Label>
          )}
          {o.data.complete && !o.data.events.length && !o.data.busy.length && (
            <Label>{uiText("Nessun evento nel periodo richiesto.")}</Label>
          )}
          {o.data.events.map((e) => (
            <View key={e.id}>
              <Body>{e.payload.title}</Body>
              <Label>
                {period(e.payload, locale)}
                {e.deleted ? uiText(" · rimosso dal calendario") : ""}
              </Label>
            </View>
          ))}
          {o.data.busy.map((b) => (
            <Label key={b.start + "-" + b.end}>
              {uiText("Occupato · ")}
              {period(b, locale)}
            </Label>
          ))}
          {o.data.nextCursor && (
            <Action
              label={uiText("Altri risultati")}
              disabled={busy}
              onPress={() => {
                const c = active.find((c) =>
                  c.resources.some((r) => r.id === o.resourceId && r.canRead),
                );
                if (c && (o.mode === "events" || o.mode === "availability"))
                  perform(
                    {
                      type: "calendar.read",
                      connectionId: c.id,
                      resourceId: o.resourceId,
                      mode: o.mode,
                      start: o.start,
                      end: o.end,
                      cursor: o.data.nextCursor!,
                    },
                    "Continua lettura privata",
                  );
              }}
            />
          )}
        </Section>
      ))}
      {view.alerts.map((a, i) => (
        <Label key={a.first + a.second + i}>{a.detail}</Label>
      ))}
    </>
  );
}
