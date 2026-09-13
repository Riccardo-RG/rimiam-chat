"use client";
import { invitationDeliveryLabel } from "@/shared/invitation-delivery";
import { WorkspaceLinks } from "@/client/workspace-links";
import { addressMiriam } from "@/shared/miriam-address";
import { ConversationVoice, VoiceMessage } from "@/client/conversation-voice";
import { WorkspaceCall } from "@/client/workspace-call";
import { SpokenReply } from "@/client/spoken-reply";
import { WorkspaceAccess } from "@/client/workspace-access";
import { WorkspaceProject } from "@/client/workspace-project";
import { WorkspaceAttention } from "@/client/workspace-attention";
import { WorkspaceLayer } from "@/client/workspace-layer";
import { WorkspaceArtifacts } from "@/client/workspace-artifacts";
import { WorkspaceCalendar } from "@/client/workspace-calendar";
import { WorkspaceEmail } from "@/client/workspace-email";
import { WorkspaceTasks } from "@/client/workspace-tasks";
import { WorkspaceActiveWork } from "@/client/workspace-active-work";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { accountReturnFromSearch } from "@/shared/account-navigation";
import { createAuthClient } from "better-auth/react";
import {
  newCommand,
  newWorkspaceCommand,
  sendCommand,
} from "@/client/command-journal";
import { PendingCommands } from "@/client/pending-commands";
import { api, errors } from "@/client/api";
import type { Command } from "@/contracts/commands";
import type { Candidate, Snapshot } from "@/client/types";

import { WorkspaceQuestions } from "@/client/workspace-questions";
import { WorkspaceSources } from "@/client/workspace-sources";

const auth = createAuthClient();
function subscribeNavigation(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}
const readAccountReturn = () => accountReturnFromSearch(window.location.search);
const serverAccountReturn = () => "/";
const historyNotice =
  "Entrando potrai leggere tutti i contenuti condivisi conservati nello spazio, comprese conversazioni, fonti e versioni precedenti al tuo ingresso o ai periodi di assenza. Anche i futuri membri avranno questa visibilità. Uscire interrompe l’accesso successivo, ma non ritira quanto è già stato condiviso.";
function time(value: string) {
  return new Date(value).toLocaleString("it-IT", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function Home() {
  const { data: session, isPending } = auth.useSession();
  const [panel, setPanel] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [spaces, setSpaces] = useState<{ id: string; name: string }[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [snapshotData, setSnapshot] = useState<Snapshot | null>(null);
  const [inviteToken, setInviteToken] = useState("");
  const snapshot =
    snapshotData?.workspace.id === workspaceId ? snapshotData : null;
  const [invitation, setInvitation] = useState<{
    name: string;
    recipient_email: string;
  } | null>(null);
  const [inviteLink, setInviteLink] = useState("");
  const [peopleFor, setPeopleFor] = useState<Candidate | null>(null);
  const [correctionFor, setCorrectionFor] = useState<Candidate | null>(null);
  const revision = useRef(-1);
  const selected = useRef("");
  const actor = session?.user.id;
  const [mode, setMode] = useState("");
  const [localMail, setLocalMail] = useState(false);
  const accountReturn = useSyncExternalStore(
    subscribeNavigation,
    readAccountReturn,
    serverAccountReturn,
  );
  useEffect(() => {
    void api<{ interpretationMode: string; localMail: boolean }>("/api/config")
      .then((c) => {
        setMode(c.interpretationMode);
        setLocalMail(c.localMail);
      })
      .catch(() => {});
  }, []);
  const report = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : "REQUEST_FAILED";
    setError(errors[message] ?? message);
  }, []);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  const load = useCallback(
    async (w: string) => {
      try {
        const next = await api<Snapshot>(`/api/workspaces/${w}`);
        if (
          selected.current === w &&
          next.workspace.revision >= revision.current
        ) {
          revision.current = next.workspace.revision;
          setSnapshot(next);
        }
      } catch (error) {
        if (selected.current === w) {
          setSnapshot(null);
          report(error);
        }
        throw error;
      }
    },
    [report],
  );
  useEffect(() => {
    if (!actor) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get("invite");
    void api<{ id: string; name: string }[]>("/api/workspaces")
      .then((items) => {
        setSpaces(items);
        const w = params.get("workspace") ?? "";
        setWorkspaceId(w);
      })
      .catch(report);
    if (token) {
      void api<{ name: string; recipient_email: string }>(
        `/api/invitations/${token}`,
      )
        .then((value) => {
          setInviteToken(token);
          setInvitation(value);
        })
        .catch(report);
    }
  }, [actor, report]);
  useEffect(() => {
    selected.current = workspaceId;
    revision.current = -1;
    if (!actor || !workspaceId) return;
    let active = true;
    const events = new EventSource(`/api/workspaces/${workspaceId}/events`);
    const refresh = () => {
      if (active) void load(workspaceId).catch(() => {});
    };
    refresh();
    events.onmessage = refresh;
    events.onerror = refresh;
    return () => {
      active = false;
      events.close();
    };
  }, [workspaceId, actor, load]);
  async function command(c: Command) {
    const result = await sendCommand(newCommand(actor!, workspaceId, c));
    if (c.type !== "member.leave") await load(workspaceId);
    return result;
  }
  function choose(w: string) {
    setWorkspaceId(w);
    setPanel("");
    setInviteLink("");
    setError("");
    window.history.replaceState(null, "", w ? `/?workspace=${w}` : "/");
  }
  const name = (id: string) =>
    snapshot?.members.find((m) => m.user_id === id)?.name ?? "Membro";
  const access = snapshot?.access.find(
    (a) => a.holder_id === actor && a.active,
  );
  const goal = snapshot?.goals.find((g) => g.current_primary);
  const canContribute = snapshot?.members.some(
    (m) => m.user_id === actor && m.active && m.contributes,
  );
  if (isPending && !busy)
    return (
      <main className="welcome">
        <p>Caricamento…</p>
      </main>
    );
  if (!session)
    return (
      <main className="welcome">
        <button
          className="wordmark brand-home"
          onClick={() => choose("")}
          aria-label="Miriam — Home"
        >
          miriam<span>●</span>
        </button>
        <p className="eyebrow">UNO SPAZIO PER COSTRUIRE INSIEME</p>
        <h1>
          Dall’idea,
          <br />
          al prossimo passo.
        </h1>
        <p>
          Conversa con il tuo gruppo. Miriam aiuta a raccogliere ciò che emerge,
          conservando fonti, scelte e responsabilità.
        </p>
        <AuthForm
          busy={busy}
          onSubmit={(data, signup) =>
            action(async () => {
              const result = signup
                ? await auth.signUp.email({
                    ...data,
                    callbackURL: accountReturn,
                  })
                : await auth.signIn.email({
                    email: data.email,
                    password: data.password,
                    callbackURL: accountReturn,
                  });
              if (result.error)
                throw new Error(
                  result.error.code === "EMAIL_NOT_VERIFIED"
                    ? "Verifica il tuo indirizzo prima di entrare. Puoi reinviare la verifica dal link qui sotto."
                    : result.error.code === "INVALID_EMAIL_OR_PASSWORD"
                      ? "Email o password non corrette."
                      : (result.error.message ?? "Accesso non riuscito"),
                );
              if (signup)
                setNotice(
                  localMail
                    ? "Controlla la tua email per verificare l’account. In locale usa la casella di sviluppo."
                    : "Controlla la tua email per verificare l’account. La richiesta di consegna è stata registrata.",
                );
            })
          }
        />
        {accountReturn.includes("invite=") && (
          <p className="hint">
            Stai seguendo un invito. Accedi o registrati con l’indirizzo
            destinatario: l’ingresso nello spazio richiederà poi la tua
            accettazione esplicita.
          </p>
        )}
        <p>
          <a
            href={`/account/recovery?returnTo=${encodeURIComponent(accountReturn)}`}
          >
            Password dimenticata?
          </a>
        </p>
        <p>
          <a
            href={`/account/recovery?verify=1&returnTo=${encodeURIComponent(accountReturn)}`}
          >
            Reinvia verifica email
          </a>
        </p>
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
        {localMail && (
          <a href="/local-mail" className="muted">
            Casella email locale di sviluppo
          </a>
        )}
      </main>
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="wordmark brand-home"
          onClick={() => choose("")}
          aria-label="Miriam — Home"
        >
          miriam<span>●</span>
        </button>
        <button
          className={workspaceId ? "space" : "space selected"}
          onClick={() => choose("")}
        >
          ⌂ Home
        </button>
        <p className="eyebrow">I TUOI SPAZI</p>
        <nav>
          {spaces.map((w) => (
            <button
              className={w.id === workspaceId ? "space selected" : "space"}
              key={w.id}
              onClick={() => choose(w.id)}
            >
              {w.name}
            </button>
          ))}
        </nav>
        <button
          className="quiet create-space"
          onClick={() => {
            choose("");
            requestAnimationFrame(() => {
              const input = document.getElementById("new-workspace-name");
              const details = input?.closest("details");
              if (details) details.open = true;
              input?.focus();
            });
          }}
        >
          ＋ Nuovo spazio
        </button>
        <div className="account">
          <strong>{session.user.name}</strong>
          <button
            className="quiet"
            onClick={() =>
              void auth.signOut().then(() => window.location.reload())
            }
          >
            Esci dall’account
          </button>
        </div>
      </aside>
      <main
        className="workspace"
        data-view={workspaceId ? "conversation" : "home"}
      >
        <header>
          <div>
            <p className="eyebrow">
              {workspaceId ? "WORKSPACE CONDIVISO" : "IL TUO PUNTO DI PARTENZA"}
            </p>
            <h1>
              {snapshot?.workspace.name ?? "Bentornato, " + session.user.name}
            </h1>
          </div>
          {workspaceId && <span className="live">● Spazio condiviso</span>}
        </header>
        {error && (
          <div className="banner error" role="alert">
            {error}
            <button className="quiet" onClick={() => setError("")}>
              Chiudi
            </button>
          </div>
        )}
        {notice && (
          <div className="banner" role="status">
            {notice}
          </div>
        )}
        <PendingCommands
          actor={actor!}
          action={action}
          refreshed={async () => {
            const available =
              await api<{ id: string; name: string }[]>("/api/workspaces");
            setSpaces(available);
            if (workspaceId && available.some((w) => w.id === workspaceId))
              await load(workspaceId);
            else if (available[0]) choose(available[0].id);
          }}
        />
        {invitation && (
          <section className="card admission">
            <p className="eyebrow">INVITO PER {invitation.recipient_email}</p>
            <h2>Entra in {invitation.name}</h2>
            <p>{historyNotice}</p>
            <p>
              Partecipare non significa aderire al Goal, accettare decisioni o
              ricevere autorità.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  const r = await api<{ workspaceId: string }>(
                    `/api/invitations/${inviteToken}`,
                    { fullHistoryAccepted: true },
                  );
                  setInvitation(null);
                  setSpaces(await api("/api/workspaces"));
                  choose(r.workspaceId);
                });
              }}
            >
              <label className="check">
                <input type="checkbox" required />
                Accetto esplicitamente di entrare con questa visibilità della
                storia.
              </label>
              <button disabled={busy}>Accetta invito ed entra</button>
            </form>
          </section>
        )}
        {!workspaceId && !invitation && (
          <section className="product-home">
            <div className="home-intro">
              <p className="eyebrow">PERSONE, IDEE, CONTINUITÀ</p>
              <h2>
                Uno spazio per
                <br />
                farle crescere insieme.
              </h2>
              <p>
                Conversa con le tue persone e con Miriam. Ritrovate ciò che
                conta, costruite una comprensione comune e portate avanti il
                vostro intento.
              </p>
            </div>
            <div className="mental-model" aria-label="Come funziona Miriam">
              <span>
                <b>01</b> Conversate
              </span>
              <span>
                <b>02</b> Ritrovate il contesto
              </span>
              <span>
                <b>03</b> Fate un passo avanti
              </span>
            </div>
            <div className="home-spaces">
              <div className="section-title">
                <h2>I tuoi spazi</h2>
                <span>
                  {spaces.length} {spaces.length === 1 ? "spazio" : "spazi"}
                </span>
              </div>
              <div className="space-grid">
                {spaces.map((w) => (
                  <button
                    className="workspace-tile"
                    key={w.id}
                    onClick={() => choose(w.id)}
                  >
                    <span className="tile-symbol" aria-hidden="true">
                      {w.name.slice(0, 1).toUpperCase()}
                    </span>
                    <strong>{w.name}</strong>
                    <small>
                      Apri la conversazione <span aria-hidden="true">↗</span>
                    </small>
                  </button>
                ))}
              </div>
              {spaces.length === 0 && (
                <p className="muted">
                  Il tuo primo spazio può nascere da un’idea, una domanda o
                  qualcosa da costruire insieme.
                </p>
              )}
            </div>
            <details className="home-create" open={spaces.length === 0}>
              <summary>Crea un nuovo spazio</summary>{" "}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const value = new FormData(form).get("name") as string;
                  void action(async () => {
                    const w = (await sendCommand(
                      newWorkspaceCommand(actor!, value),
                    )) as { id: string };
                    setSpaces(await api("/api/workspaces"));
                    choose(w.id);
                    form.reset();
                  });
                }}
              >
                <label>
                  Nuovo spazio
                  <input
                    id="new-workspace-name"
                    name="name"
                    required
                    maxLength={120}
                    placeholder="Il nostro cocktail bar"
                  />
                </label>
                <p className="hint">
                  La creazione avvia la gestione degli inviti. Non attribuisce
                  consenso o autorità di progetto.
                </p>
                <button disabled={busy}>Crea spazio</button>
              </form>
            </details>
            <p className="hint">
              Hai ricevuto un invito? Apri il link con l’account a cui è
              destinato.
            </p>
          </section>
        )}
        {workspaceId && !snapshot && !invitation && (
          <section className="empty" aria-busy="true">
            <p>Sto aprendo lo spazio…</p>
          </section>
        )}
        {snapshot && (
          <>
            <div className="goal-compass">
              <div>
                <span className="eyebrow">IL NOSTRO INTENTO</span>
                <h2>{goal?.content ?? "Da dove volete partire?"}</h2>
              </div>
              <button className="quiet" onClick={() => setPanel("context")}>
                {goal ? "Goal e adesioni ↗" : "Definisci il Goal"}
              </button>
            </div>
            <WorkspaceAttention
              workspace={workspaceId}
              actor={actor!}
              compact
              open={setPanel}
              command={command}
              action={action}
              busy={busy}
              canContribute={!!canContribute}
              name={name}
            />
            <nav className="workspace-tools" aria-label="Esplora lo spazio">
              {[
                ["context", "Contesto"],
                ["work", "Lavoro"],
                ["materials", "Materiali"],
                ["tools", "Strumenti"],
                ["people", "Persone"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={panel === id ? "tool selected" : "tool"}
                  aria-pressed={panel === id}
                  onClick={() => setPanel(panel === id ? "" : id)}
                >
                  {label}
                </button>
              ))}
            </nav>
            <div
              className={
                panel ? "workspace-stage with-layer" : "workspace-stage"
              }
            >
              <section className="card conversation">
                <div className="section-title">
                  <h2>Conversazione</h2>
                  <span>
                    {snapshot.messages.length}{" "}
                    {snapshot.messages.length === 1 ? "messaggio" : "messaggi"}
                  </span>
                </div>
                {mode === "unconfigured" ? (
                  <p className="miriam-live-state" role="status">
                    Le risposte AI non sono disponibili: il modello non è ancora
                    collegato. La conversazione tra le persone rimane attiva.
                  </p>
                ) : snapshot.interpretations.some(
                    (i) => i.status === "queued" || i.status === "running",
                  ) ? (
                  <p className="miriam-live-state" role="status">
                    Miriam sta leggendo il contesto pertinente…
                  </p>
                ) : snapshot.interpretations.some(
                    (i) => i.status === "failed" || i.status === "stale",
                  ) ? (
                  <button className="quiet" onClick={() => setPanel("context")}>
                    Una lettura di Miriam richiede attenzione ↗
                  </button>
                ) : null}
                <WorkspaceActiveWork
                  key={`${session.user.id}:${snapshot.workspace.id}`}
                  workspace={snapshot.workspace.id}
                  actor={session.user.id}
                  name={name}
                  command={command}
                  action={action}
                  busy={busy}
                />
                <WorkspaceCall
                  key={`call:${actor}:${workspaceId}`}
                  workspace={workspaceId}
                  actor={actor!}
                  disabled={!canContribute}
                  command={command}
                />
                <ConversationVoice
                  key={`voice:${actor}:${workspaceId}`}
                  workspace={workspaceId}
                  actor={actor!}
                  disabled={!canContribute}
                  command={command}
                  messages={snapshot.messages}
                >
                  <div className="messages">
                    {snapshot.messages.length === 0 && (
                      <p className="muted">Racconta da dove state partendo.</p>
                    )}
                    {snapshot.messages.map((m) => (
                      <article
                        key={m.id}
                        id={`source-${m.id}`}
                        className={
                          m.actor_kind === "miriam"
                            ? "message miriam-message"
                            : m.author_id === actor
                              ? "message own"
                              : "message"
                        }
                      >
                        <div>
                          <strong>
                            {m.author_name}{" "}
                            <span className="author-kind">
                              {m.actor_kind === "miriam" ? "AI" : "persona"}
                            </span>
                          </strong>
                          <time>{time(m.created_at)}</time>
                        </div>
                        <p>{m.content}</p>
                        <VoiceMessage id={m.id} />
                        {m.actor_kind === "miriam" && (
                          <SpokenReply
                            id={`${actor}:${snapshot.workspace.id}:${m.id}`}
                            text={m.content}
                          />
                        )}
                        <details>
                          <summary>
                            {m.actor_kind === "miriam"
                              ? "Fonti e origine"
                              : "Fonte originale"}
                          </summary>
                          <small>
                            Messaggio {m.sequence} ·{" "}
                            {m.actor_kind === "miriam"
                              ? "Contributo AI, non stato adottato"
                              : "Atto umano originale"}
                            <br />
                            Conservato senza riscritture.
                            {m.citation_source_ids?.map((id) => {
                              const source = snapshot.sources.find(
                                  (s) => s.id === id,
                                ),
                                message = snapshot.messages.find(
                                  (s) => s.id === id,
                                );
                              return (
                                <span className="citation" key={id}>
                                  <strong>
                                    {source?.title ??
                                      message?.author_name ??
                                      "Fonte"}
                                  </strong>
                                  <span>
                                    {source?.qualification ??
                                      "Messaggio umano originale"}
                                  </span>
                                  <span>
                                    {source?.content ?? message?.content}
                                  </span>
                                  {message && (
                                    <a href={`#source-${id}`}>
                                      Vai al messaggio ↗
                                    </a>
                                  )}
                                </span>
                              );
                            })}
                          </small>
                        </details>
                      </article>
                    ))}
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const raw = new FormData(form).get("message") as string;
                      const addressed =
                        (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
                          "data-target",
                        ) === "miriam";
                      const content = addressed ? addressMiriam(raw) : raw;
                      void action(async () => {
                        await command({ type: "message.send", content });
                        form.reset();
                      });
                    }}
                  >
                    <label className="sr-only" htmlFor="message">
                      Messaggio
                    </label>
                    <textarea
                      id="message"
                      name="message"
                      placeholder="Scrivi al gruppo o chiedi a Miriam…"
                      required
                      maxLength={12000}
                      rows={3}
                    />
                    <button disabled={busy || !canContribute}>
                      Invia messaggio
                    </button>
                    <button
                      data-target="miriam"
                      disabled={busy || !canContribute}
                    >
                      Chiedi a Miriam
                    </button>
                  </form>
                </ConversationVoice>
              </section>
              {panel && (
                <WorkspaceLayer
                  title={
                    {
                      attention: "Il punto adesso",
                      context: "Contesto condiviso",
                      work: "Lavoro e follow-up",
                      materials: "Materiali dello spazio",
                      tools: "Strumenti",
                      people: "Persone e accesso",
                      calendar: "Calendario",
                      email: "Email",
                      sources: "Fonti e ricerca",
                      artifacts: "Documenti e risultati",
                    }[panel] ?? "Dettagli"
                  }
                  close={() => setPanel("")}
                >
                  {panel === "attention" && (
                    <WorkspaceAttention
                      workspace={workspaceId}
                      actor={actor!}
                      open={setPanel}
                      command={command}
                      action={action}
                      busy={busy}
                      canContribute={!!canContribute}
                      name={name}
                    />
                  )}
                  {panel === "context" && (
                    <>
                      <WorkspaceProject
                        workspace={workspaceId}
                        actor={actor!}
                        revision={snapshot.workspace.revision}
                        command={command}
                        action={action}
                        busy={busy}
                      />
                      <div className="context-column">
                        <section className="card">
                          <p className="eyebrow">SHARED CONTEXT</p>
                          <h2>Riferimenti accettati</h2>
                          <p className="hint">
                            Informazioni descrittive adottate come riferimento
                            di lavoro. Non sono verità garantite o impegni del
                            gruppo.
                          </p>
                          {snapshot.information.length === 0 && (
                            <p className="muted">
                              Nessun riferimento accettato. Le proposte di
                              Miriam restano separate.
                            </p>
                          )}
                          {snapshot.information.map((info) => (
                            <article className="information" key={info.id}>
                              <span className="tag">
                                Accettata · v{info.current_version}
                              </span>
                              <h3>{info.subject}</h3>
                              <p>{info.content}</p>
                              <p className="hint">{info.qualification}</p>
                              <small>
                                Accettata da {name(info.accepted_by)}
                              </small>
                              <details>
                                <summary>
                                  Fonti e storia delle correzioni
                                </summary>
                                {snapshot.versions
                                  .filter((v) => v.information_id === info.id)
                                  .map((v) => (
                                    <div className="version" key={v.version}>
                                      <strong>
                                        Versione {v.version} ·{" "}
                                        {v.accepted_by_name}
                                      </strong>
                                      <p>{v.content}</p>
                                      <small>
                                        {v.reason} · {time(v.created_at)}
                                      </small>
                                      <Provenance
                                        candidate={snapshot.candidates.find(
                                          (c) => c.id === v.candidate_id,
                                        )}
                                      />
                                    </div>
                                  ))}
                              </details>
                            </article>
                          ))}
                        </section>
                        <section className="card">
                          <div className="section-title">
                            <h2>Miriam propone</h2>
                            <span className="tag">Da valutare</span>
                          </div>
                          <p className="hint">
                            Interpretazioni attribuite alle fonti. Nessuna
                            accettazione o autorità automatica.
                          </p>
                          {mode === "unconfigured" && (
                            <p className="processing">
                              Il modello AI non è ancora collegato.
                              Conversazione e fonti restano disponibili; la
                              lettura AI richiede il collegamento del servizio e
                              un nuovo tentativo.
                            </p>
                          )}
                          {snapshot.interpretations
                            .filter((i) => i.status !== "completed")
                            .map((i) => (
                              <div className="processing" key={i.id}>
                                {i.status === "queued" || i.status === "running"
                                  ? "Miriam sta leggendo una nuova fonte…"
                                  : i.status === "stale"
                                    ? "Il contesto è cambiato durante la lettura."
                                    : (errors[i.error_code ?? ""] ??
                                      "Lettura non completata: serve un nuovo tentativo o più contesto.")}
                                {["failed", "stale"].includes(i.status) && (
                                  <button
                                    className="quiet"
                                    disabled={busy}
                                    onClick={() =>
                                      void action(async () => {
                                        await command({
                                          type: "interpretation.retry",
                                          interpretationId: i.id,
                                        });
                                      })
                                    }
                                  >
                                    Riprova lettura
                                  </button>
                                )}
                              </div>
                            ))}
                          {snapshot.candidates
                            .filter(
                              (c) =>
                                !snapshot.questions.some(
                                  (q) => q.candidate_id === c.id,
                                ) &&
                                !snapshot.versions.some(
                                  (v) => v.candidate_id === c.id,
                                ) &&
                                !snapshot.commitments.some(
                                  (p) =>
                                    p.candidate_id === c.id && p.adopted_at,
                                ),
                            )
                            .map((c) => (
                              <article className="proposal" key={c.id}>
                                <span className="tag">
                                  {c.classification === "descriptive"
                                    ? "Informazione proposta"
                                    : c.classification === "question"
                                      ? "Domanda proposta"
                                      : c.classification === "normative"
                                        ? "Possibile impegno"
                                        : "Da chiarire"}
                                </span>
                                <h3>{c.subject}</h3>
                                <p>{c.content}</p>
                                <p className="hint">{c.qualification}</p>
                                {snapshot.information.some(
                                  (i) =>
                                    i.subject === c.subject &&
                                    i.content !== c.content,
                                ) && (
                                  <p className="processing">
                                    Esiste un riferimento diverso per questo
                                    argomento. La nuova affermazione non lo
                                    sostituisce automaticamente.
                                  </p>
                                )}
                                <Provenance candidate={c} />
                                {c.context_revision !==
                                snapshot.workspace.context_revision ? (
                                  <button
                                    className="quiet"
                                    disabled={busy}
                                    onClick={() =>
                                      void action(async () => {
                                        await command({
                                          type: "interpretation.retry",
                                          interpretationId: c.interpretation_id,
                                        });
                                      })
                                    }
                                  >
                                    Rileggi alla luce degli aggiornamenti
                                  </button>
                                ) : (
                                  <div className="actions">
                                    {c.classification === "question" && (
                                      <button
                                        disabled={busy || !canContribute}
                                        onClick={() =>
                                          void action(async () => {
                                            await command({
                                              type: "question.open",
                                              sourceId: c.source_id,
                                              candidateId: c.id,
                                              content: c.content,
                                            });
                                          })
                                        }
                                      >
                                        Conserva come domanda aperta
                                      </button>
                                    )}
                                    {c.classification === "descriptive" &&
                                      (snapshot.information.some(
                                        (i) => i.subject === c.subject,
                                      ) ? (
                                        <button
                                          disabled={busy || !canContribute}
                                          onClick={() => setCorrectionFor(c)}
                                        >
                                          Valuta come correzione
                                        </button>
                                      ) : (
                                        <button
                                          disabled={busy || !canContribute}
                                          onClick={() =>
                                            void action(async () => {
                                              await command({
                                                type: "information.accept",
                                                candidateId: c.id,
                                                descriptiveOnly: true,
                                              });
                                            })
                                          }
                                        >
                                          Accetta come riferimento descrittivo
                                        </button>
                                      ))}
                                    {["normative", "uncertain"].includes(
                                      c.classification,
                                    ) && (
                                      <p className="hint">
                                        Se intendi descrivere un dato,
                                        chiariscilo in un nuovo messaggio. Per
                                        un impegno preciso, raccogli gli atti
                                        delle persone interessate.
                                      </p>
                                    )}
                                    <button
                                      className="quiet"
                                      disabled={busy || !canContribute}
                                      onClick={() => setPeopleFor(c)}
                                    >
                                      Proponi come impegno esplicito
                                    </button>
                                  </div>
                                )}
                              </article>
                            ))}
                        </section>
                      </div>
                      <WorkspaceQuestions
                        state={snapshot}
                        command={command}
                        action={action}
                        busy={busy}
                        actor={actor!}
                      />
                    </>
                  )}
                  {panel === "work" && (
                    <>
                      <WorkspaceTasks
                        key={`tasks:${session.user.id}:${snapshot.workspace.id}`}
                        workspace={snapshot.workspace.id}
                        actor={session.user.id}
                        command={command}
                        action={action}
                        busy={busy}
                      />
                    </>
                  )}
                  {panel === "materials" && (
                    <div className="destination-list">
                      <p>
                        Le fonti da comprendere e ciò che state costruendo,
                        nello stesso spazio.
                      </p>
                      <button
                        className="destination"
                        onClick={() => setPanel("sources")}
                      >
                        <strong>Fonti e ricerca ↗</strong>
                        <span>
                          File condivisi, riferimenti e ricerche sul web.
                        </span>
                      </button>
                      <button
                        className="destination"
                        onClick={() => setPanel("artifacts")}
                      >
                        <strong>Documenti e risultati ↗</strong>
                        <span>Bozze, versioni e contenuti adottati.</span>
                      </button>
                    </div>
                  )}
                  {panel === "tools" && (
                    <div className="destination-list">
                      <p>
                        Collega i tuoi strumenti quando servono. Ogni azione
                        mantiene i propri confini.
                      </p>
                      <button
                        className="destination"
                        onClick={() => setPanel("calendar")}
                      >
                        <strong>Calendario ↗</strong>
                        <span>
                          Tempi condivisi e il tuo calendario personale.
                        </span>
                      </button>
                      <button
                        className="destination"
                        onClick={() => setPanel("email")}
                      >
                        <strong>Email ↗</strong>
                        <span>La tua posta, bozze e invii espliciti.</span>
                      </button>
                    </div>
                  )}
                  {panel === "sources" && (
                    <>
                      <WorkspaceSources
                        key={`${actor}:${workspaceId}`}
                        state={snapshot}
                        actor={actor!}
                        command={command}
                        action={action}
                        reload={() => load(workspaceId)}
                        busy={busy}
                      />
                    </>
                  )}
                  {panel === "artifacts" && (
                    <>
                      <WorkspaceArtifacts
                        state={snapshot}
                        actor={actor!}
                        busy={busy}
                        command={command}
                        action={action}
                      />
                    </>
                  )}
                  {panel === "calendar" && (
                    <>
                      <WorkspaceCalendar
                        key={`${session.user.id}:${snapshot.workspace.id}`}
                        workspace={snapshot.workspace.id}
                        revision={snapshot.workspace.revision}
                        actor={session.user.id}
                        command={command}
                        action={action}
                        busy={busy}
                      />
                    </>
                  )}
                  {panel === "email" && (
                    <>
                      <WorkspaceEmail
                        key={`email:${session.user.id}:${snapshot.workspace.id}`}
                        workspace={snapshot.workspace.id}
                        actor={session.user.id}
                        email={session.user.email}
                        command={command}
                        action={action}
                        busy={busy}
                      />
                    </>
                  )}
                  {panel === "people" && (
                    <>
                      <WorkspaceLinks
                        key={workspaceId}
                        id={workspaceId}
                        spaces={spaces}
                        links={snapshot.links ?? []}
                        open={choose}
                        busy={busy}
                        change={(c) => {
                          void action(async () => {
                            await command(c);
                          });
                        }}
                      />
                      <WorkspaceAccess
                        workspace={workspaceId}
                        actor={actor!}
                        revision={snapshot.workspace.revision}
                        command={command}
                        action={action}
                        busy={busy}
                      />
                      <details className="card">
                        <summary>Partecipanti e accesso</summary>
                        <p className="hint">
                          Partecipazione, adesione al Goal e poteri di gestione
                          degli accessi sono distinti.
                        </p>
                        {snapshot.members.map((m) => (
                          <div className="member" key={m.user_id}>
                            <span>
                              {m.name} ·{" "}
                              {m.active ? "Partecipante" : "Non ha più accesso"}
                              {snapshot.access.some(
                                (a) => a.holder_id === m.user_id && a.active,
                              )
                                ? " · Gestione accessi esplicitamente attribuita"
                                : ""}
                            </span>
                            {access?.remove_members &&
                              m.active &&
                              m.user_id !== actor &&
                              !snapshot.access.some(
                                (a) => a.holder_id === m.user_id && a.active,
                              ) && (
                                <button
                                  className="quiet"
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `Rimuovere l’accesso di ${m.name}? Storia e impegni restano conservati.`,
                                      )
                                    )
                                      void action(async () => {
                                        await command({
                                          type: "member.remove",
                                          personId: m.user_id,
                                          expectedAccessRevision:
                                            snapshot.workspace.access_revision,
                                          confirmed: true,
                                        });
                                      });
                                  }}
                                >
                                  Rimuovi accesso
                                </button>
                              )}
                          </div>
                        ))}
                        {access?.invitations && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const data = new FormData(e.currentTarget);
                              const email = data.get("email") as string;
                              void action(async () => {
                                const r = await command({
                                  type: "invitation.create",
                                  email,
                                  fullHistoryDisclosed: true,
                                  sendEmail: data.get("sendEmail") === "on",
                                });
                                setInviteLink(
                                  `${window.location.origin}/?invite=${r.token}`,
                                );
                              });
                            }}
                          >
                            <h3>Invita una persona</h3>
                            <p>{historyNotice}</p>
                            <label>
                              Email del destinatario
                              <input name="email" type="email" required />
                            </label>
                            <label className="check">
                              <input type="checkbox" required />
                              Confermo che l’invito concede accesso all’intera
                              storia condivisa conservata.
                            </label>
                            <label className="check">
                              <input type="checkbox" name="sendEmail" />
                              Invia anche un’email al destinatario
                            </label>
                            <button disabled={busy}>
                              Crea invito personale
                            </button>
                            {inviteLink && (
                              <label>
                                Condividi questo link solo con il destinatario
                                <input
                                  readOnly
                                  value={inviteLink}
                                  aria-label="Link invito"
                                />
                              </label>
                            )}
                          </form>
                        )}
                        {snapshot.invitations
                          .filter((i) => !i.accepted_at && !i.revoked_at)
                          .map((i) => (
                            <div className="member" key={i.id}>
                              <span>
                                Invito a {i.recipient_email} · scade{" "}
                                {time(i.expires_at)} ·{" "}
                                {invitationDeliveryLabel(i.delivery_status)}
                              </span>
                              <button
                                className="quiet"
                                disabled={busy}
                                onClick={() =>
                                  void action(async () => {
                                    await command({
                                      type: "invitation.revoke",
                                      invitationId: i.id,
                                    });
                                  })
                                }
                              >
                                Revoca invito
                              </button>
                            </div>
                          ))}
                        <div className="actions">
                          {access && (
                            <button
                              className="quiet"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Rinunciare alla tua gestione degli accessi? Lo spazio può restare senza chi possa gestirlo. La partecipazione continua e non viene nominato un successore.",
                                  )
                                )
                                  void action(async () => {
                                    await command({
                                      type: "access.relinquish",
                                      confirmed: true,
                                    });
                                  });
                              }}
                            >
                              Rinuncia alla gestione degli accessi
                            </button>
                          )}
                          <button
                            className="quiet danger"
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Uscire dallo spazio? Perderai accesso e partecipazione al governo degli accessi. Storia e impegni restano. Non occorre un successore.",
                                )
                              )
                                void action(async () => {
                                  await command({
                                    type: "member.leave",
                                    confirmed: true,
                                  });
                                  setSpaces(await api("/api/workspaces"));
                                  choose("");
                                });
                            }}
                          >
                            Lascia lo spazio
                          </button>
                        </div>
                      </details>
                    </>
                  )}
                </WorkspaceLayer>
              )}
            </div>
            {peopleFor && (
              <div className="modal-backdrop">
                <section
                  className="card modal"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Proponi impegno"
                >
                  <h2>Chi riguarda questo impegno?</h2>
                  <p>{peopleFor.content}</p>
                  <p>
                    Il tuo atto proporrà il testo. Ciascuna persona nominata
                    dovrà approvarlo per sé; nessuno sarà rappresentato per
                    silenzio.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const people = new FormData(e.currentTarget).getAll(
                        "people",
                      ) as string[];
                      void action(async () => {
                        await command({
                          type: "commitment.propose",
                          candidateId: peopleFor.id,
                          people: [...new Set([...people, actor!])],
                        });
                        setPeopleFor(null);
                      });
                    }}
                  >
                    {snapshot.members
                      .filter((m) => m.active)
                      .map((m) => (
                        <label className="check" key={m.user_id}>
                          <input
                            type="checkbox"
                            name="people"
                            value={m.user_id}
                            defaultChecked={m.user_id === actor}
                            disabled={m.user_id === actor}
                          />
                          {m.name}
                          {m.user_id === actor ? " (tu)" : ""}
                        </label>
                      ))}
                    <button disabled={busy}>
                      Proponi il testo a queste persone
                    </button>
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => setPeopleFor(null)}
                    >
                      Annulla
                    </button>
                  </form>
                </section>
              </div>
            )}
            {correctionFor && (
              <div className="modal-backdrop">
                <section
                  className="card modal"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Correzione"
                >
                  <h2>Correggi il riferimento di lavoro</h2>
                  <p>
                    Prima:{" "}
                    {
                      snapshot.information.find(
                        (i) => i.subject === correctionFor.subject,
                      )?.content
                    }
                  </p>
                  <p>Nuova versione: {correctionFor.content}</p>
                  <p>
                    Le versioni e le fonti precedenti resteranno consultabili.
                    La correzione non modifica impegni, vincoli o permessi.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const reason = new FormData(e.currentTarget).get(
                        "reason",
                      ) as string;
                      const info = snapshot.information.find(
                        (i) => i.subject === correctionFor.subject,
                      )!;
                      void action(async () => {
                        await command({
                          type: "information.correct",
                          informationId: info.id,
                          expectedVersion: info.current_version,
                          candidateId: correctionFor.id,
                          reason,
                          descriptiveOnly: true,
                        });
                        setCorrectionFor(null);
                      });
                    }}
                  >
                    <label>
                      Motivo della correzione
                      <input name="reason" required maxLength={12000} />
                    </label>
                    <button disabled={busy}>
                      Accetta la nuova versione descrittiva
                    </button>
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => setCorrectionFor(null)}
                    >
                      Annulla
                    </button>
                  </form>
                </section>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Provenance({ candidate }: { candidate?: Candidate }) {
  if (!candidate) return null;
  return (
    <details>
      <summary>Fonte e attribuzione</summary>
      <p>
        {candidate.origin === "inferred"
          ? "Deduzione proposta da Miriam, non dichiarazione esplicita."
          : `Interpretazione attribuita a ${candidate.author_name}.`}
      </p>
      <blockquote>{candidate.source_content}</blockquote>
      {candidate.source_ids.map((id) => (
        <a className="source-link" href={`#source-${id}`} key={id}>
          Apri la fonte originale
        </a>
      ))}
      <small>{candidate.qualification}</small>
    </details>
  );
}
function AuthForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (
    data: { name: string; email: string; password: string },
    signup: boolean,
  ) => void;
}) {
  const [signup, setSignup] = useState(false);
  return (
    <form
      className="auth-form"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        onSubmit(
          {
            name: (data.get("name") as string) ?? "",
            email: data.get("email") as string,
            password: data.get("password") as string,
          },
          signup,
        );
      }}
    >
      <h2>{signup ? "Crea il tuo account" : "Accedi"}</h2>
      {signup && (
        <label>
          Nome
          <input name="name" autoComplete="name" required maxLength={100} />
        </label>
      )}
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete={signup ? "new-password" : "current-password"}
          minLength={12}
          maxLength={128}
          required
        />
      </label>
      <button disabled={busy}>{signup ? "Registrati" : "Accedi"}</button>
      <button
        type="button"
        className="quiet"
        onClick={() => setSignup(!signup)}
      >
        {signup ? "Ho già un account" : "Crea un account"}
      </button>
    </form>
  );
}
