import { useUiLanguage } from "../i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import type {
  CalendarView,
  CalendarCommand,
} from "../../../src/contracts/calendar";
import type { EmailView, EmailCommand } from "../../../src/contracts/email";
import type { NativeRequest } from "../api";
import { problem } from "../api";
import { ToolHeader } from "../workspace/ToolLayout";
import { Action, usePalette } from "../ui";
import { useCommands } from "../workspace/useCommands";
import { workspacePath } from "../workspace/commands";
import { PendingStrip } from "../workspace/PendingStrip";
import { CalendarPanel } from "./CalendarPanel";
import { EmailPanel } from "./EmailPanel";
import { Connections } from "./Connections";
import { Label } from "./parts";
import { localDay, monthFrom } from "./inputs";

export interface IntegrationProps {
  request: NativeRequest;
  actorId: string;
  origin: string;
  workspaceId: string;
  name: string;
  email?: string;
  canContribute?: boolean;
  personal?: boolean;
  onBack: () => void;
  headerActions?: React.ReactNode;
  kind: "email" | "calendar";
}
type Result =
  { kind: "email"; view: EmailView } | { kind: "calendar"; view: CalendarView };

export function IntegrationsScreen(props: IntegrationProps) {
  return (
    <Integration
      key={JSON.stringify([
        props.origin,
        props.actorId,
        props.workspaceId,
        props.kind,
      ])}
      {...props}
    />
  );
}

function Integration({
  request,
  origin,
  actorId,
  workspaceId,
  kind,
  onBack,
  headerActions,
  email,
  canContribute = false,
  personal = false,
}: IntegrationProps) {
  const { t: uiText } = useUiLanguage();
  const p = usePalette();
  const [day, setDay] = useState(() => localDay(new Date()));
  const [page, setPage] = useState<string | null>(null);
  const [saved, setSaved] = useState(0);
  const [emailAddress, setEmailAddress] = useState(email ?? "");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  const scope = useMemo(
    () => ({ origin, actorId, workspaceId }),
    [origin, actorId, workspaceId],
  );
  const commands = useCommands(request, scope, (committed) => {
    if (
      committed.intent.kind === "command" &&
      [
        "email.draft.create",
        "email.draft.revise",
        "temporal.create",
        "temporal.revise",
        "commitment.time.set",
      ].includes(committed.intent.command.type)
    ) {
      setSaved((n) => n + 1);
    }
    refresh();
  });
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const latest = useRef(true);
  const range = useMemo(() => monthFrom(day), [day]);
  const base = workspacePath(workspaceId);
  const path =
    kind === "email"
      ? base + "/email" + (page ? "?before=" + encodeURIComponent(page) : "")
      : base +
        "/calendar?start=" +
        encodeURIComponent(range!.start) +
        "&end=" +
        encodeURIComponent(range!.end) +
        (page ? "&afterAction=" + encodeURIComponent(page) : "");
  const [viewPath, setViewPath] = useState("");
  useEffect(() => {
    latest.current = true;
    return () => {
      latest.current = false;
    };
  }, []);
  useEffect(() => {
    if (kind !== "email" || email) return;
    const abort = new AbortController();
    void request<{ user: { id: string; email: string } }>(
      "/api/v1/native/session",
      { signal: abort.signal },
    )
      .then((session) => {
        if (!abort.signal.aborted && session.user.id === actorId)
          setEmailAddress(session.user.email);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(problem(e));
      });
    return () => abort.abort();
  }, [request, email, kind, actorId]);
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      try {
        const options = { signal: abort.signal };
        const next: Result =
          kind === "email"
            ? { kind, view: await request<EmailView>(path, options) }
            : { kind, view: await request<CalendarView>(path, options) };
        if (abort.signal.aborted) return;
        if (next.view.workspaceId !== workspaceId)
          throw new Error("Spazio non corrispondente.");
        setData(next);
        setViewPath(path);
        setError("");
      } catch (e) {
        if (!abort.signal.aborted) {
          setData(null);
          setError(problem(e));
        }
      }
    }
    void load();
    return () => abort.abort();
  }, [request, path, kind, workspaceId, revision]);
  const current = viewPath === path ? data : null;
  const pending =
    !!current &&
    (current.view.reads.some(
      (r) => r.status === "QUEUED" || r.status === "READING",
    ) ||
      current.view.actions.some(
        (a) => a.status === "AUTHORIZED" || a.status === "EXECUTING",
      ));
  useEffect(() => {
    const foreground = AppState.addEventListener("change", (s) => {
      if (s === "active") refresh();
    });
    const timer = pending
      ? setInterval(() => {
          if (AppState.currentState === "active") refresh();
        }, 4000)
      : undefined;
    return () => {
      foreground.remove();
      clearInterval(timer);
    };
  }, [pending, refresh]);
  const blocked = !commands.ready || commands.working || !!commands.pending;
  function perform(command: CalendarCommand | EmailCommand, label: string) {
    if (latest.current && !blocked)
      void commands.send({ kind: "command", command, label });
  }
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: p.bg }}
    >
      <ToolHeader
        title={
          kind === "email"
            ? uiText("Email")
            : personal
              ? uiText("Calendari personali")
              : uiText("Calendario")
        }
        onClose={onBack}
        headerActions={headerActions}
      />
      <PendingStrip commands={commands} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ gap: 12, padding: 16, paddingBottom: 38 }}
      >
        {kind === "email" && (
          <Label>{uiText("Solo tu vedi la tua posta e le tue bozze.")}</Label>
        )}
        {error ? (
          <>
            <Label>{error}</Label>
            <Action label={uiText("Riprova")} onPress={refresh} />
          </>
        ) : (
          !current && <Label>{uiText("Caricamento…")}</Label>
        )}

        {current && (
          <Connections
            request={request}
            origin={origin}
            workspaceId={workspaceId}
            kind={kind}
            canContribute={canContribute}
            connections={
              current.kind === "email"
                ? current.view.connections.map((c) => ({
                    ...c,
                    label: c.sender,
                  }))
                : current.view.connections
            }
            onReturn={refresh}
          />
        )}
        {current?.kind === "email" &&
          !current.view.connections.some((c) => c.active && c.canSend) && (
            <Label>
              {uiText(
                "Puoi già salvare una bozza. Per inviarla serve una casella collegata con il permesso di invio.",
              )}
            </Label>
          )}
        {current?.kind === "email" && (
          <EmailPanel
            base={base + "/email"}
            request={request}
            view={current.view}
            busy={blocked}
            email={email ?? emailAddress}
            canContribute={canContribute}
            perform={perform}
            saved={saved}
            page={page}
            onPage={setPage}
          />
        )}
        {current?.kind === "calendar" && (
          <CalendarPanel
            base={base + "/calendar"}
            request={request}
            page={page}
            onPage={setPage}
            view={current.view}
            actorId={actorId}
            canContribute={canContribute}
            busy={blocked}
            perform={perform}
            day={day}
            onDayChange={(selected) => {
              setPage(null);
              setDay(selected);
            }}
            saved={saved}
            personal={personal}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
