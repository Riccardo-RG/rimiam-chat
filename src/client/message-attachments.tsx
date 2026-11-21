"use client";
import { useUiLanguage } from "./ui-language";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  acceptedFiles,
  encodeAttachment,
  optionalMediaReading,
  validateAttachment,
} from "./file-upload";
import { prepareCameraPhoto } from "./camera-photo";
import { errorText } from "./api";
import { WorkspaceIcon } from "./workspace-icon";

import {
  readFiles,
  storeFiles,
  type Item,
  type Collection,
} from "./attachment-draft-store";
const empty: Item[] = [];

export function useMessageAttachments(scope: string) {
  const { t: uiText } = useUiLanguage();
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [preparingScope, setPreparingScope] = useState<string | null>(null);
  const [collection, setCollection] = useState<Collection>({
    scope: "",
    items: empty,
  });
  const [error, setError] = useState("");
  const [readyScope, setReadyScope] = useState("");
  const current = useRef(collection);
  const items = collection.scope === scope ? collection.items : empty;
  useEffect(() => {
    let cancelled = false;
    readFiles(scope)
      .then((saved) => {
        if (!cancelled) {
          setError("");
          current.current = { scope, items: saved };
          setCollection(current.current);
        }
      })
      .catch(() => {
        if (!cancelled) {
          current.current = { scope, items: empty };
          setCollection(current.current);
        }
      })
      .finally(() => {
        if (!cancelled) setReadyScope(scope);
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);
  function update(next: Item[]) {
    if (readyScope !== scope || current.current.scope !== scope) return;
    const draft = { scope, items: next };
    current.current = draft;
    // The chosen files belong to this draft immediately, even if browser
    // storage is slow or unavailable. A Send now includes what was selected.
    setCollection(draft);
    const metadataKey = "rimiam:file-order:" + scope;
    const order = JSON.stringify(
      next.map(({ id, allowReading }) => ({ id, allowReading })),
    );
    try {
      sessionStorage.setItem(metadataKey, order);
    } catch {
      /* Browser storage is optional. */
    }
    setError("");
    void storeFiles(draft)
      .then(() => {
        if (current.current !== draft) return;
        try {
          if (sessionStorage.getItem(metadataKey) === order)
            sessionStorage.removeItem(metadataKey);
        } catch {
          /* Optional. */
        }
      })
      .catch(() => {
        if (current.current === draft) {
          setError(
            uiText(
              "Il browser conserva questi allegati solo fino alla chiusura della pagina.",
            ),
          );
        }
      });
  }
  function add(files: File[]) {
    if (
      !files.length ||
      current.current.scope !== scope ||
      readyScope !== scope
    )
      return false;
    try {
      const next = [
        ...current.current.items,
        ...files.map((file) => {
          validateAttachment(file);
          return { id: crypto.randomUUID(), file, allowReading: false };
        }),
      ];
      if (
        next.length > 10 ||
        next.reduce((sum, item) => sum + item.file.size, 0) > 8388608
      )
        throw new Error(
          "Puoi allegare fino a 10 file, per un totale di 8 MiB.",
        );
      update(next);
      return true;
    } catch (cause) {
      setError(errorText(cause));
      return false;
    }
  }
  async function encode() {
    return Promise.all(
      items.map(async (item) => ({
        ...(await encodeAttachment(item.file)),
        ...(item.allowReading && optionalMediaReading(item.file.name)
          ? { allowModelProcessing: true as const }
          : {}),
      })),
    );
  }
  function clearSent(sent: Item[]) {
    if (current.current.scope !== scope) return;
    const ids = new Set(sent.map((item) => item.id));
    update(current.current.items.filter((item) => !ids.has(item.id)));
  }
  const attachInput = useCallback((node: HTMLInputElement | null) => {
    input.current = node;
  }, []);
  const attachCameraInput = useCallback((node: HTMLInputElement | null) => {
    camera.current = node;
  }, []);
  async function addCapture(file: File) {
    setPreparingScope(scope);
    try {
      const photo = await prepareCameraPhoto(file);
      add([photo]);
    } catch (cause) {
      if (current.current.scope === scope) setError(errorText(cause));
    } finally {
      setPreparingScope((previous) => (previous === scope ? null : previous));
    }
  }
  function openPicker(useCamera = false) {
    const picker = useCamera ? camera.current : input.current;
    if (!picker || picker.disabled) return;
    // Dispatch directly inside the trusted tap. WebKit can expose showPicker
    // without opening an iOS file chooser for a programmatic file input.
    try {
      picker.click();
    } catch {
      setError(
        useCamera
          ? uiText(
              "Fotocamera non disponibile. Puoi scegliere una foto dalla galleria con la graffetta.",
            )
          : uiText(
              "Il browser non ha aperto gli allegati. Riprova dalla graffetta.",
            ),
      );
    }
  }
  return {
    attachInput,
    attachCameraInput,
    addCapture,
    preparing: preparingScope === scope,
    openPicker,
    items,
    error,
    ready: readyScope === scope,
    add,
    update,
    encode,
    clearSent,
  };
}
export function MessageAttachmentQueue({
  queue,
  disabled,
  privateExchange = false,
}: {
  queue: ReturnType<typeof useMessageAttachments>;
  disabled: boolean;
  privateExchange?: boolean;
}) {
  const { t: uiText } = useUiLanguage();
  const {
    items,
    update,
    attachInput,
    attachCameraInput,
    ready,
    preparing,
    add,
    addCapture,
    error,
  } = queue;
  return (
    <>
      <input
        hidden
        ref={attachInput}
        type="file"
        multiple
        accept={acceptedFiles}
        aria-label={uiText("Scegli file e foto")}
        disabled={disabled || !ready}
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
          add(files);
        }}
      />
      {!privateExchange && (
        <input
          type="file"
          ref={attachCameraInput}
          hidden
          capture="environment"
          accept="image/*"
          aria-label={uiText("Scatto della fotocamera")}
          disabled={disabled || !ready || preparing}
          onChange={(event) => {
            const chosen = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (chosen) void addCapture(chosen);
          }}
        />
      )}
      {preparing && <p role="status">{uiText("Preparo la foto…")}</p>}
      {!!items.length && (
        <ol
          className="message-attachments-queue"
          aria-label={uiText("Allegati in ordine di invio")}
        >
          {items.map((item, index) => (
            <li key={item.id}>
              <span>
                {item.file.type.startsWith("image/") &&
                /\.(png|webp|jpe?g)$/i.test(item.file.name) ? (
                  <DraftPhoto file={item.file} />
                ) : (
                  <WorkspaceIcon name="attach" />
                )}{" "}
                {item.file.name}
              </span>
              {!privateExchange && optionalMediaReading(item.file.name) && (
                <label>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={item.allowReading}
                    onChange={(e) =>
                      update(
                        items.map((v) =>
                          v.id === item.id
                            ? { ...v, allowReading: e.target.checked }
                            : v,
                        ),
                      )
                    }
                  />
                  {uiText("Consenti lettura AI di questo file")}
                </label>
              )}
              {index > 0 && (
                <button
                  type="button"
                  disabled={disabled}
                  className="quiet"
                  aria-label={uiText(
                    "Sposta prima {0}",
                    String(item.file.name),
                  )}
                  onClick={() => {
                    const next = items.slice();
                    [next[index - 1], next[index]] = [
                      next[index],
                      next[index - 1],
                    ];
                    update(next);
                  }}
                >
                  {uiText("Sposta prima")}
                </button>
              )}
              <button
                type="button"
                disabled={disabled}
                className="quiet"
                aria-label={uiText("Rimuovi {0}", String(item.file.name))}
                onClick={() => update(items.filter((v) => v.id !== item.id))}
              >
                {uiText("Rimuovi")}
              </button>
            </li>
          ))}
        </ol>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}

function DraftPhoto({ file }: { file: File }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (image.current) image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- The preview is an unsent, browser-local object URL.
    <img ref={image} className="draft-photo" alt="" width={44} height={44} />
  );
}
