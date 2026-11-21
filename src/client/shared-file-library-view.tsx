"use client";
import { useUiLanguage } from "./ui-language";

import Image from "next/image";
import { FilePreviewBody } from "./file-preview";
import { useHiddenLibraryItems } from "./hidden-library-items";
import { FileVisibilityButton } from "./file-visibility-button";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Command } from "@/contracts/commands";
import type { PendingCommand } from "./command-journal";
import { createFileUploadCommand, type FileUploadRequest } from "./file-upload";
import {
  sharedFileType,
  isSharedPhoto,
  noteFilename,
} from "./shared-file-library";
import type { Snapshot } from "./types";
import {
  ConversationAttachment,
  type AttachmentPicker,
} from "./conversation-attachment";
import {
  libraryDay,
  libraryEntryKey,
  libraryPeriods,
  libraryTabs,
  libraryView,
  type LibraryTab,
} from "../shared/library-view";
import { LibraryLinks } from "./library-links";
import { api, errorText } from "./api";
import { personalSpaceResultSchema } from "../contracts/v1";
import { newCommand } from "./command-journal";
import { WorkspaceIcon } from "./workspace-icon";
import styles from "./shared-file-library.module.css";

type Props = {
  personal?: boolean;
  state: Snapshot;
  actor: string;
  busy: boolean;
  contributes: boolean;
  command: (
    command: Command,
    onReceipt?: () => void,
    replay?: PendingCommand,
  ) => Promise<unknown>;
  action: (fn: () => Promise<void>) => Promise<void>;
  openSource: (id: string) => void;
  documentActions?: ReactNode;
};

function QuickNote({
  personal,
  state,
  actor,
  busy,
  command,
  action,
}: Omit<Props, "contributes" | "openSource">) {
  const { t: uiText } = useUiLanguage();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [saved, setSaved] = useState("");
  const [retry, setRetry] = useState<FileUploadRequest | null>(null);
  const inFlight = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const formId = "library-quick-note";

  async function save() {
    if (inFlight.current || !body.trim()) return;
    inFlight.current = true;
    try {
      await action(async () => {
        if (body.includes("\0")) throw new Error("INVALID_DOCUMENT_TEXT");
        const request =
          retry ??
          (await createFileUploadCommand(
            actor,
            state.workspace.id,
            new File([body], noteFilename(body), { type: "text/plain" }),
            { conversationShare: {} },
          ));
        try {
          await command(request.command, undefined, request);
        } catch (error) {
          setRetry(request);
          throw error;
        }
        setSaved(request.command.filename);
        setRetry(null);
        setBody("");
        setOpen(false);
        trigger.current?.focus();
      });
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <>
      <button
        type="button"
        ref={trigger}
        aria-expanded={open}
        aria-controls={formId}
        className={`quiet ${styles.noteButton}`}
        onClick={() => {
          setOpen(true);
          setSaved("");
          requestAnimationFrame(() => field.current?.focus());
        }}
      >
        <WorkspaceIcon name="plus" />
        {uiText(" Nuova nota")}
      </button>
      {open && (
        <form
          id={formId}
          className={styles.noteForm}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor="library-note-body">
            {uiText("Testo della nota")}
          </label>
          <textarea
            id="library-note-body"
            ref={field}
            required
            rows={5}
            maxLength={200000}
            readOnly={!!retry || busy}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            aria-describedby="library-note-hint"
          />
          <small id="library-note-hint" className="hint">
            {retry
              ? uiText(
                  "L’esito è da verificare. Riprova lo stesso invio per evitare duplicati.",
                )
              : personal
                ? uiText("Visibile solo a te nella chat personale.")
                : uiText(
                    "Visibile in chat ai membri attuali e futuri dello spazio.",
                  )}
          </small>
          <div className={styles.noteActions}>
            <button disabled={busy || !body.trim()}>
              {retry
                ? uiText("Riprova invio")
                : personal
                  ? uiText("Salva nota")
                  : uiText("Condividi nota")}
            </button>
            {!retry && (
              <button
                type="button"
                className="quiet"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                {uiText("Chiudi")}
              </button>
            )}
          </div>
        </form>
      )}
      {saved && (
        <span className={styles.noteStatus} role="status">
          {personal ? uiText("Nota salvata") : uiText("Nota condivisa")}:{" "}
          {saved}
        </span>
      )}
    </>
  );
}

type SharedFile = Snapshot["sources"][number];

function CopyDocument({
  state,
  actor,
  file,
  personal,
  busy,
  command,
}: Pick<Props, "state" | "actor" | "personal" | "busy" | "command"> & {
  file: SharedFile;
}) {
  const { t: uiText } = useUiLanguage();
  const destinations = state.libraryDestinations ?? [];
  const [selected, select] = useState(
    destinations.find((d) => d.id === file.origin_workspace_id)?.id ?? "",
  );
  const destination = destinations.find((d) => d.id === selected);
  const [ack, setAck] = useState(""),
    [error, setError] = useState(""),
    [sending, setSending] = useState(false);
  const [retry, setRetry] = useState<ReturnType<typeof newCommand> | null>(
    null,
  );
  const locked = useRef(false);
  async function copy() {
    if (locked.current || busy || (personal && !destination)) return;
    locked.current = true;
    setSending(true);
    setError("");
    try {
      let request = retry;
      if (!request) {
        const target = personal
          ? selected
          : personalSpaceResultSchema.parse(
              await api("/api/v1/personal-space", { expectedActorId: actor }),
            ).id;
        request = newCommand(actor, state.workspace.id, {
          type: "library.copy",
          destinationId: target,
          sourceId: file.id,
        });
        setRetry(request);
      }
      await command(request.command as Command, undefined, request);
      setRetry(null);
      setAck(
        personal
          ? "Condiviso in " + destination?.name
          : "Copia salvata nei tuoi Documenti personali.",
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      locked.current = false;
      setSending(false);
    }
  }
  return (
    <div className={styles.copyControls}>
      {personal ? (
        <label>
          {uiText("Condividi una copia in")}
          <select
            value={selected}
            disabled={sending || !!retry}
            onChange={(e) => {
              select(e.target.value);
              setAck("");
            }}
          >
            <option value="">{uiText("Scegli uno spazio")}</option>
            {destinations.map((d) => (
              <option value={d.id} key={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <small>
          {uiText(
            "La copia resta tua anche se lasci questo spazio. Le fonti collegate richiedono ancora l’accesso.",
          )}
        </small>
      )}
      <button
        type="button"
        className="quiet"
        disabled={busy || sending || !!ack || (personal && !destination)}
        onClick={() => void copy()}
      >
        {personal
          ? destination
            ? uiText("Condividi in {0}", String(destination.name))
            : uiText("Condividi nello spazio")
          : uiText("Salva nei Documenti personali")}
      </button>
      {ack && <span role="status">{ack}</span>}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}

export function SharedFileLibrary(props: Props) {
  const { locale: uiLocale } = useUiLanguage();
  const { t: uiText } = useUiLanguage();
  const { state, contributes, openSource, personal } = props;
  const { hidden, setHidden } = useHiddenLibraryItems(
    props.actor,
    state.workspace.id,
  );
  const [showHidden, setShowHidden] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const results = useRef<HTMLUListElement>(null);
  const picker = useRef<AttachmentPicker>(null);
  const attachButton = useRef<HTMLButtonElement>(null);
  const [dropError, setDropError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState<LibraryTab>("Recenti");
  const [term, setTerm] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterId = useId();
  const [period, setPeriod] = useState("all");
  const [day, setDay] = useState(""),
    [until, setUntil] = useState("");
  const [type, setType] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const preview = state.sources.find((source) => source.id === previewId);
  const availablePreviewId = preview?.id;
  const dialog = useRef<HTMLDialogElement>(null);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  function dismissPreview() {
    dialog.current?.close();
    setPreviewId(null);
    previewTrigger.current?.focus({ preventScroll: true });
  }
  useEffect(() => {
    const node = dialog.current;
    if (!node || !availablePreviewId) return;
    node.showModal();
    return () => {
      if (node.open) node.close();
    };
  }, [availablePreviewId]);
  const { list, messagesById, links, all, emptySharedLibrary } = libraryView(
    state,
    { tab, term, type, period, day, until, personal },
  );
  function star(file: SharedFile) {
    void props.action(async () => {
      await props.command({
        type: "library.favorite",
        sourceId: file.id,
        starred: !file.favorite,
      });
    });
  }
  const hiddenView = showHidden && hidden.size > 0;
  const visibleList = list.filter(
    (entry) => hidden.has(libraryEntryKey(entry)) === hiddenView,
  );

  function toggleHidden(key: string, hide: boolean) {
    if (!setHidden(key, hide)) {
      setNotice(uiText("Il browser non ha salvato la preferenza. Riprova."));
      return;
    }
    setRemoving(null);
    requestAnimationFrame(() =>
      results.current?.focus({ preventScroll: true }),
    );
    if (!hide && hidden.size === 1) setShowHidden(false);
    setNotice(
      uiText(
        hide
          ? "Elemento nascosto su questo dispositivo."
          : "Elemento di nuovo visibile.",
      ),
    );
  }

  function removalControl(key: string, name: string) {
    if (hiddenView)
      return (
        <button
          type="button"
          className="quiet"
          onClick={() => toggleHidden(key, false)}
        >
          {uiText("Mostra di nuovo")}
        </button>
      );
    return (
      <button
        type="button"
        className="quiet"
        aria-expanded={removing === key}
        aria-label={uiText("Rimuovi {0}", name)}
        onClick={() => setRemoving((current) => (current === key ? null : key))}
      >
        {uiText("Rimuovi")}
      </button>
    );
  }

  function removalOptions(key: string, file?: SharedFile) {
    if (removing !== key || hiddenView) return null;
    return (
      <div
        className={styles.removeOptions}
        role="group"
        aria-label={uiText("Opzioni di rimozione")}
      >
        <button
          type="button"
          className="quiet"
          onClick={() => toggleHidden(key, true)}
        >
          {uiText("Nascondi su questo dispositivo")}
        </button>
        {file && (
          <FileVisibilityButton
            {...props}
            file={file}
            libraryAudience={personal ? "personal" : "group"}
          />
        )}
        <button
          type="button"
          className="quiet"
          onClick={() => setRemoving(null)}
        >
          {uiText("Annulla")}
        </button>
      </div>
    );
  }
  const fileBase = `/api/workspaces/${state.workspace.id}/sources/`;

  return (
    <>
      <section
        className={styles.intake}
        data-dragging={dragging || undefined}
        aria-labelledby="shared-file-library-title"
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect =
            contributes && !props.busy ? "copy" : "none";
          setDragging(contributes && !props.busy);
        }}
        onDragLeave={(event) => {
          if (
            !(event.relatedTarget instanceof Node) ||
            !event.currentTarget.contains(event.relatedTarget)
          )
            setDragging(false);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragging(false);
          if (!contributes || props.busy || !attachButton.current) return;
          if (event.dataTransfer.files.length !== 1) {
            setDropError("Scegli un solo file alla volta.");
            return;
          }
          setDropError("");
          picker.current?.choose(
            event.dataTransfer.files[0],
            attachButton.current,
          );
        }}
      >
        <h2 className="sr-only" id="shared-file-library-title">
          {personal ? uiText("I tuoi file") : uiText("File condivisi")}
        </h2>
        <p className="hint">
          {personal
            ? uiText("File, foto, link e note visibili solo a te.")
            : uiText("File, foto e link dalla chat dello spazio.")}
        </p>
        {contributes && (
          <div className={styles.collectionHeader}>
            <button
              ref={attachButton}
              className={styles.attach}
              type="button"
              disabled={props.busy}
              onClick={(event) => {
                setDropError("");
                picker.current?.open(event.currentTarget);
              }}
            >
              <WorkspaceIcon name="attach" />
              {uiText(" Allega file")}
            </button>
            <QuickNote {...props} />
            <LibraryLinks {...props} />
            {props.documentActions}
            <small className={styles.dropHint}>
              {uiText("Puoi anche trascinare un file qui.")}
            </small>
            <ConversationAttachment
              ref={picker}
              personal={personal}
              actor={props.actor}
              workspace={state.workspace.id}
              disabled={props.busy}
              submit={(request) =>
                props.command(request.command, undefined, request)
              }
            />
          </div>
        )}
        {dropError && <p role="alert">{dropError}</p>}
      </section>
      <nav className={styles.tabs} aria-label={uiText("Raccoglitore")}>
        {libraryTabs.map((label) => (
          <button
            type="button"
            className="quiet"
            key={label}
            aria-pressed={label === tab}
            onClick={() => setTab(label)}
          >
            {uiText(label)}
          </button>
        ))}
      </nav>
      {
        <>
          <div className={styles.filters}>
            <label>
              {uiText("Cerca")}
              <input
                type="search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder={uiText("Nome o parola chiave")}
              />
            </label>
            <button
              className={`quiet ${styles.filterToggle}`}
              type="button"
              aria-controls={filterId}
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              {uiText("Filtri")}
              {period !== "all" || type
                ? ` · ${Number(period !== "all") + Number(Boolean(type))}`
                : ""}
            </button>
            <div
              id={filterId}
              className={styles.dateAndType}
              data-expanded={filtersOpen}
            >
              <label>
                {uiText("Data di condivisione")}
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                >
                  {Object.entries(libraryPeriods).map(([value, label]) => (
                    <option key={value} value={value}>
                      {uiText(label)}
                    </option>
                  ))}
                </select>
              </label>
              {period === "range" && (
                <>
                  <label>
                    {uiText("Dal")}
                    <input
                      type="date"
                      max={until || undefined}
                      value={day}
                      onChange={(e) => setDay(e.target.value)}
                    />
                  </label>
                  <label>
                    {uiText("Al")}
                    <input
                      type="date"
                      min={day || undefined}
                      value={until}
                      onChange={(e) => setUntil(e.target.value)}
                    />
                  </label>
                </>
              )}
              <label>
                {uiText("Tipo")}
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="">{uiText("Tutti")}</option>
                  {Array.from(
                    new Set([
                      ...all.map((f) =>
                        sharedFileType(f.media_type, f.filename ?? f.title),
                      ),
                      "Collegamento",
                    ]),
                  )
                    .sort()
                    .map((t) => (
                      <option key={t} value={t}>
                        {uiText(t)}
                      </option>
                    ))}
                </select>
              </label>
              {(period !== "all" || term || type) && (
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    setDay("");
                    setUntil("");
                    setPeriod("all");
                    setTerm("");
                    setType("");
                  }}
                >
                  {uiText("Azzera filtri")}
                </button>
              )}
            </div>
          </div>
          {notice && (
            <p role="status" className={styles.notice}>
              {notice}
            </p>
          )}
          {emptySharedLibrary && (
            <p className={styles.emptyCollection} role="status">
              <WorkspaceIcon name="files" />
              {uiText("Nessun elemento condiviso")}
            </p>
          )}
          {!emptySharedLibrary && !visibleList.length && (
            <p className="hint" role="status">
              {hiddenView
                ? uiText("Nessun elemento nascosto per questi filtri.")
                : !all.length && !links.length
                  ? uiText("Nessun elemento da mostrare.")
                  : tab === "Preferiti"
                    ? uiText("Nessun preferito per questi filtri.")
                    : uiText("Nessun elemento per questi filtri.")}
            </p>
          )}
          <ul
            ref={results}
            tabIndex={-1}
            className={tab === "Media" ? styles.gallery : styles.list}
            aria-label={
              tab === "Media"
                ? uiText("Foto condivise")
                : uiText("File condivisi")
            }
          >
            {visibleList.map((entry, index) => {
              const { file, link } = entry;
              const key = libraryEntryKey(entry);
              if (link) {
                const message = messagesById.get(link.id)!;
                return (
                  <li key={key} className={styles.row}>
                    <div className={styles.linkEntry}>
                      <span className={styles.glyph}>
                        <WorkspaceIcon name="link" />
                      </span>
                      <div className={styles.item}>
                        {link.url ? (
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={link.url}
                            aria-label={link.url}
                          >
                            <strong>{new URL(link.url).hostname}</strong>
                            <span className={styles.linkPath}>{link.url}</span>
                          </a>
                        ) : (
                          <strong>{link.title}</strong>
                        )}
                        <small>
                          {uiText("Collegamento")} ·{" "}
                          {new Date(message.created_at).toLocaleDateString(
                            uiLocale,
                          )}{" "}
                          · {message.author_name}
                        </small>
                      </div>
                    </div>
                    <div className={styles.rowActions}>
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => openSource(link.id)}
                      >
                        {uiText("Vai al messaggio")}
                      </button>
                      {removalControl(key, link.title)}
                    </div>
                    {removalOptions(key)}
                  </li>
                );
              }
              if (!file) return null;
              const name = file.filename ?? file.title;
              const origin = state.messages.find(
                (m) => m.id === file.shared_message_id,
              );
              const date = new Date(file.created_at).toLocaleDateString(
                uiLocale,
                { day: "numeric", month: "short", year: "numeric" },
              );
              return (
                <li
                  key={file.id}
                  className={tab === "Media" ? styles.mediaTile : styles.row}
                >
                  {tab === "Media" &&
                    (index === 0 ||
                      libraryDay(visibleList[index - 1].date) !==
                        libraryDay(file.created_at)) && <small>{date}</small>}
                  <button
                    className={styles.previewButton}
                    type="button"
                    aria-label={uiText("Apri {0}", String(name))}
                    title={name}
                    onClick={(event) => {
                      previewTrigger.current = event.currentTarget;
                      setPreviewId(file.id);
                    }}
                  >
                    {isSharedPhoto(file.media_type) ? (
                      <Image
                        unoptimized
                        src={fileBase + file.id + "?preview=1"}
                        alt={name}
                        width={tab === "Media" ? 240 : 54}
                        height={tab === "Media" ? 165 : 44}
                      />
                    ) : (
                      <span className={styles.glyph}>
                        <WorkspaceIcon name="files" />
                      </span>
                    )}
                    <span>
                      <strong>{name}</strong>
                      <small>
                        {uiText(sharedFileType(file.media_type, name))} · {date}
                        {origin?.author_name && " · " + origin.author_name}
                      </small>
                    </span>
                  </button>
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className="quiet"
                      aria-pressed={!!file.favorite}
                      disabled={props.busy}
                      aria-label={uiText(
                        file.favorite
                          ? "Rimuovi dai preferiti {0}"
                          : "Aggiungi ai preferiti {0}",
                        name,
                      )}
                      onClick={() => star(file)}
                    >
                      {file.favorite ? "★" : "☆"}
                    </button>
                    {removalControl(key, name)}
                  </div>
                  {removalOptions(key, file)}
                </li>
              );
            })}
          </ul>
        </>
      }
      {hidden.size > 0 && (
        <button
          type="button"
          className={`quiet ${styles.hiddenToggle}`}
          aria-pressed={hiddenView}
          onClick={() => {
            setShowHidden(!hiddenView);
            setRemoving(null);
            setNotice("");
            if (!hiddenView) {
              setTab("Recenti");
              setTerm("");
              setType("");
              setPeriod("all");
              setDay("");
              setUntil("");
            }
          }}
        >
          {uiText(
            hiddenView
              ? "Torna agli elementi visibili"
              : "Mostra elementi nascosti",
          )}
        </button>
      )}
      {state.sources.some((f) => f.withdrawn && f.can_manage_visibility) && (
        <details className="source-removed">
          <summary>{uiText("File ritirati")}</summary>
          {state.sources
            .filter((f) => f.withdrawn && f.can_manage_visibility)
            .map((f) => (
              <div className="source-file-actions" key={f.id}>
                <span>{f.filename ?? f.title}</span>
                <FileVisibilityButton
                  {...props}
                  file={f}
                  libraryAudience={personal ? "personal" : "group"}
                />
              </div>
            ))}
        </details>
      )}
      {preview && (
        <dialog
          className={styles.previewDialog}
          ref={dialog}
          aria-label={preview.filename ?? preview.title}
          onCancel={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dismissPreview();
          }}
          onClose={(e) => e.stopPropagation()}
        >
          <header>
            <strong>{preview.filename ?? preview.title}</strong>
            <button type="button" onClick={dismissPreview}>
              {uiText("Chiudi")}
            </button>
          </header>
          {preview.withdrawn ? (
            <p>{uiText("File ritirato")}</p>
          ) : (
            <FilePreviewBody
              path={`/api/v1/workspaces/${state.workspace.id}/source-file?id=${preview.id}`}
              original={fileBase + preview.id + "?preview=1"}
            />
          )}
          {!preview.withdrawn && (
            <CopyDocument key={preview.id} {...props} file={preview} />
          )}
          <footer>
            <FileVisibilityButton
              {...props}
              file={preview}
              libraryAudience={personal ? "personal" : "group"}
            />
            {!preview.withdrawn && (
              <a
                href={fileBase + preview.id}
                download={preview.filename ?? preview.title}
              >
                {uiText("Scarica originale")}
              </a>
            )}
            {preview.shared_message_id && (
              <button
                type="button"
                onClick={() => {
                  const id = preview.shared_message_id!;
                  setPreviewId(null);
                  openSource(id);
                }}
              >
                {uiText("Vai al messaggio")}
              </button>
            )}
          </footer>
        </dialog>
      )}
    </>
  );
}
