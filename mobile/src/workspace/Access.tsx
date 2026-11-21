import { useUiLanguage } from "../i18n";
import React, { useState } from "react";
import { Alert, Text, View } from "react-native";
import type {
  AccessView,
  accessHistorySchema,
} from "../../../src/contracts/access";
import type { Command } from "../../../src/contracts/commands";
import type { z } from "zod";
import { Action, Field, usePalette } from "../ui";
import { type NativeRequest } from "../api";
import { accessEffects, canProposeAccess } from "./access-controls";
import { ToolRow } from "./ToolLayout";
import { useResource } from "../useResource";

type Props = {
  request: NativeRequest;
  path: string;
  actor: string;
  busy: boolean;
  send: (label: string, c: Command) => void;
};
type Change = Extract<Command, { type: "access.propose" }>["change"];

function confirm(
  uiText: (source: string) => string,
  label: string,
  explanation: string,
  action: () => void,
  destructive = false,
) {
  Alert.alert(label, explanation, [
    { text: uiText("Annulla"), style: "cancel" },
    {
      text: uiText("Conferma"),
      style: destructive ? "destructive" : "default",
      onPress: action,
    },
  ]);
}
function History({
  view,
  path,
  request,
  onClose,
}: {
  path: string;
  view: AccessView;
  request: NativeRequest;
  onClose: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const { locale } = useUiLanguage();
  const c = usePalette(),
    [before, setBefore] = useState<number>();
  const history = useResource<z.infer<typeof accessHistorySchema>>(
    request,
    path + (before ? "&before=" + before : ""),
  );
  const name = (id?: string) =>
    view.members.find((m) => m.id === id)?.name ?? "Partecipante storico";
  return (
    <View style={{ gap: 5 }}>
      <Action label={uiText("Chiudi cronologia")} onPress={onClose} />
      {history.value?.versions.map((v) => (
        <Text key={v.version} style={{ color: c.text }}>
          {uiText("v")}
          {v.version} · {new Date(v.createdAt).toLocaleString(locale)} ·{" "}
          {v.active ? uiText("Attiva") : uiText("Terminata")} · {name(v.actor)}{" "}
          · {v.basis}
          {v.protected ? uiText(" · Accordo protetto") : ""}
          {v.requiredParticipations.length
            ? uiText(
                "\nModifiche con {0}",
                String(
                  v.requiredParticipations
                    .map((id) =>
                      name(
                        view.relationships.find((r) => r.id === id)?.holderId,
                      ),
                    )
                    .join(" + "),
                ),
              )
            : ""}
        </Text>
      ))}
      {!!history.value?.nextBefore && (
        <Action
          label={uiText("Versioni precedenti")}
          onPress={() => setBefore(history.value?.nextBefore ?? undefined)}
        />
      )}
      {before !== undefined && (
        <Action
          label={uiText("Versioni recenti")}
          onPress={() => setBefore(undefined)}
        />
      )}
      {history.error && (
        <Action
          label={uiText("Riprova a leggere la cronologia")}
          onPress={history.refresh}
        />
      )}
    </View>
  );
}
function Terms({
  proposal,
  view,
  actor,
  busy,
  send,
}: Pick<Props, "actor" | "busy" | "send"> & {
  proposal: AccessView["proposals"][number];
  view: AccessView;
}) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette(),
    [open, setOpen] = useState(false);
  const name = (id: string) =>
    view.members.find((m) => m.id === id)?.name ?? "Partecipante storico";
  const p = proposal;
  const effect = accessEffects(p, name).join("\n");
  return (
    <View style={{ gap: 5 }}>
      <Action
        label={
          p.reason +
          " · " +
          uiText(
            { pending: "In attesa", stale: "Superata", adopted: "Approvata" }[
              p.status
            ],
          )
        }
        onPress={() => setOpen(!open)}
      />
      {open && (
        <>
          <Text style={{ color: c.text }}>
            {uiText("Proposta da ")}
            {name(p.proposedBy)}
            {uiText(" · v")}
            {p.baseAccessRevision}
            {"\n"}
            {effect}
          </Text>
          {p.terms.map((term, i) => (
            <Text key={i} style={{ color: c.text }}>
              {term}
            </Text>
          ))}
          {p.required.map((r) => {
            const accepted = p.approvals.some(
              (a) => a.role === r.role && a.personId === r.personId,
            );
            const action =
              r.role === "holder"
                ? uiText("Accetta i termini per te")
                : uiText("Autorizza questa modifica");
            return (
              <View key={r.role + r.personId}>
                <Text style={{ color: c.muted }}>
                  {name(r.personId)} ·{" "}
                  {r.role === "holder"
                    ? uiText("adesione")
                    : uiText("autorizzazione")}{" "}
                  · {accepted ? uiText("registrata") : uiText("in attesa")}
                </Text>
                {p.status === "pending" &&
                  p.baseAccessRevision === view.accessRevision &&
                  !accepted &&
                  r.personId === actor && (
                    <Action
                      label={action}
                      disabled={busy}
                      onPress={() =>
                        confirm(
                          uiText,
                          action,
                          [effect, ...p.terms].join("\n"),
                          () =>
                            send(action, {
                              type: "access.approve",
                              proposalId: p.id,
                              role: r.role,
                              expectedAccessRevision: p.baseAccessRevision,
                              acceptTerms: true,
                            }),
                        )
                      }
                    />
                  )}
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}
function AccessDetails({ request, path, actor, busy, send }: Props) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette(),
    [before, setBefore] = useState<string>(),
    [inspect, setInspect] = useState<string>();
  const result = useResource<AccessView>(
    request,
    path + "/access" + (before ? "?before=" + encodeURIComponent(before) : ""),
    10000,
  );
  const [change, setChange] = useState<Change>(),
    [reason, setReason] = useState(""),
    [base, setBase] = useState(0);
  const view = result.value;
  if (!view)
    return (
      <View>
        <Text style={{ color: c.text }}>
          {result.error || uiText("Caricamento degli accessi…")}
        </Text>
        {!!result.error && (
          <Action label={uiText("Riprova")} onPress={result.refresh} />
        )}
      </View>
    );
  const active = view.relationships.filter((r) => r.active);
  const people = view.members.filter((m) => m.active);
  const name = (id: string) =>
    view.members.find((m) => m.id === id)?.name ?? "Partecipante storico";
  const edit = (next: Change) => {
    setChange(next);
    setReason("");
    setBase(view.accessRevision);
  };
  const mayPropose = canProposeAccess(active, actor);
  const changeLabel =
    change?.kind === "stewardship"
      ? "Gestori: " + change.people.map(name).join(", ")
      : change?.kind === "delegation"
        ? "Inviti: " + name(change.personId)
        : "Fine della delega di " +
          (active.find((r) => r.id === change?.relationshipId)?.holderName ??
            "questo membro");
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: c.muted }}>
        {uiText("Chi può invitare persone o cambiare accessi allo spazio.")}
      </Text>
      {active.map((r) => (
        <View key={r.id}>
          <Text style={{ color: c.text }}>
            {r.holderName} ·{" "}
            {r.kind === "stewardship"
              ? uiText("Gestione accessi")
              : uiText("Solo inviti")}
            {uiText(" · v")}
            {r.version}
          </Text>
          <Text style={{ color: c.muted }}>
            {r.available ? uiText("Disponibile") : uiText("Indisponibile")}
            {r.protected ? uiText(" · Accordo protetto") : ""}
          </Text>
          {r.conditions.map((condition) => (
            <Text style={{ color: c.muted }} key={condition.participationId}>
              {name(condition.holderId)} ·{" "}
              {condition.available
                ? uiText("disponibile")
                : uiText("indisponibile")}
            </Text>
          ))}
          <Action
            label={uiText("Cronologia dell’accordo")}
            onPress={() => setInspect(inspect === r.id ? undefined : r.id)}
          />
          {inspect === r.id && (
            <History
              key={r.id}
              view={view}
              path={path + "/access-history?id=" + r.id}
              request={request}
              onClose={() => setInspect(undefined)}
            />
          )}
          {mayPropose && r.kind === "invitation_delegate" && !r.protected && (
            <Action
              label={uiText("Proponi fine delega di {0}", String(r.holderName))}
              onPress={() => edit({ kind: "revoke", relationshipId: r.id })}
            />
          )}
        </View>
      ))}
      {view.proposals.map((p) => (
        <Terms
          key={p.id}
          proposal={p}
          view={view}
          actor={actor}
          busy={busy}
          send={send}
        />
      ))}
      {view.next && (
        <Action
          label={uiText("Proposte precedenti")}
          onPress={() => setBefore(view.next ?? undefined)}
        />
      )}
      {before && (
        <Action
          label={uiText("Torna alle più recenti")}
          onPress={() => setBefore(undefined)}
        />
      )}
      {mayPropose && !change && (
        <>
          <Action
            label={uiText("Proponi nuovi gestori")}
            onPress={() => edit({ kind: "stewardship", people: [] })}
          />
          <Action
            label={uiText("Proponi una delega per gli inviti")}
            onPress={() => edit({ kind: "delegation", personId: "" })}
          />
        </>
      )}
      {change && (
        <>
          {change.kind === "stewardship" && (
            <Text style={{ color: c.text }}>
              {uiText(
                "Scegli l’insieme completo dei gestori. Più gestori richiedono la loro approvazione congiunta.",
              )}
            </Text>
          )}
          {change.kind !== "revoke" &&
            people
              .filter(
                (m) =>
                  change.kind !== "delegation" ||
                  !active.some((r) => r.holderId === m.id),
              )
              .map((m) => (
                <Action
                  key={m.id}
                  label={m.name}
                  primary={
                    change.kind === "delegation"
                      ? change.personId === m.id
                      : change.people.includes(m.id)
                  }
                  onPress={() =>
                    setChange(
                      change.kind === "delegation"
                        ? { ...change, personId: m.id }
                        : {
                            ...change,
                            people: change.people.includes(m.id)
                              ? change.people.filter((id) => id !== m.id)
                              : [...change.people, m.id],
                          },
                    )
                  }
                />
              ))}
          <Field
            label={uiText("Motivazione")}
            value={reason}
            onChangeText={setReason}
            maxLength={4000}
            multiline
          />
          {base !== view.accessRevision && (
            <Text style={{ color: c.text }}>
              {uiText(
                "Gli accessi sono cambiati. Chiudi e prepara una proposta aggiornata.",
              )}
            </Text>
          )}
          <Action
            label={uiText("Presenta la proposta")}
            disabled={
              busy ||
              !reason.trim() ||
              !mayPropose ||
              base !== view.accessRevision ||
              (change.kind === "stewardship" &&
                (!change.people.length || change.people.length > 20)) ||
              (change.kind === "delegation" && !change.personId)
            }
            onPress={() =>
              confirm(
                uiText,
                uiText("Presenta proposta"),
                changeLabel + "\n" + reason.trim(),
                () =>
                  send("Proposta di accesso", {
                    type: "access.propose",
                    expectedAccessRevision: base,
                    change,
                    reason: reason.trim(),
                  }),
              )
            }
          />
          <Action
            label={uiText("Chiudi proposta")}
            onPress={() => setChange(undefined)}
          />
        </>
      )}
    </View>
  );
}
export function Access(props: Props) {
  const { t: uiText } = useUiLanguage();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <ToolRow
        label={uiText("Accordi e deleghe di accesso")}
        expanded={open}
        onPress={() => setOpen(!open)}
      />
      {open && <AccessDetails {...props} />}
    </View>
  );
}
