"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { releaseId, staleEvent } from "../shared/web-release";
import { finishAttachmentSaves } from "./attachment-draft-store";
import styles from "./web-release-notice.module.css";

type Phase = "checking" | "current" | "offline" | "update";
const marker = "__rimiam_release";
const pollMs = 30_000;
const retryMs = 8_000;

export function WebReleaseNotice({
  initialRelease,
  children,
}: {
  initialRelease: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  // Both legal notices are public reading material, including before sign-in and without JS.
  if (pathname === "/beta" || pathname === "/connessioni-e-dati")
    return children;
  return <ReleaseGate initialRelease={initialRelease}>{children}</ReleaseGate>;
}

function ReleaseGate({
  initialRelease,
  children,
}: {
  initialRelease: string;
  children: ReactNode;
}) {
  const { t: uiText } = useUiLanguage();
  const [phase, setPhase] = useState<Phase>("checking"),
    [opened, setOpened] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    surface = useRef<HTMLDivElement>(null);
  const retry = useRef<() => void>(() => {}),
    apply = useRef<() => void>(() => {});
  useEffect(() => {
    let live = true,
      phaseNow: Phase = "checking",
      controller: AbortController | null = null;
    let timer: number | undefined;
    let expected: string | null = null;
    const edited = new Set<HTMLElement>();
    function set(next: Phase) {
      if (!live) return;
      if (next !== phaseNow && (next === "offline" || next === "update"))
        window.dispatchEvent(
          new CustomEvent("miriam:microphone", { detail: "release" }),
        );
      phaseNow = next;
      document.documentElement.dataset.releaseGate =
        next === "current" ? "open" : "locked";
      if (surface.current) surface.current.inert = next !== "current";
      if (next === "current") setOpened(true);
      setPhase(next);
    }
    function later(ms: number) {
      window.clearTimeout(timer);
      if (document.visibilityState === "visible")
        timer = window.setTimeout(() => void check(), ms);
    }
    function stop() {
      controller?.abort();
      controller = null;
      window.clearTimeout(timer);
    }
    function navigate(force = false) {
      if (!expected || !navigator.onLine || !live) return;
      const url = new URL(window.location.href);
      if (url.searchParams.get(marker) === expected) {
        if (force) window.location.reload();
        return;
      }
      url.searchParams.set(marker, expected);
      window.location.replace(url.href);
    }
    function update(target: string) {
      if (!live || !releaseId(target) || target === initialRelease) return;
      expected = target;
      const changedForm =
        [...edited].some(
          (el) =>
            el.isConnected &&
            ("value" in el ? Boolean(el.value) : !!el.textContent),
        ) ||
        Number(document.documentElement.dataset.releaseWrites) > 0 ||
        !!document.querySelector(
          '[aria-label="Allegati in ordine di invio"], audio[src^="blob:"], [aria-busy="true"]',
        );
      set("update");
      if (!changedForm) navigate();
      later(pollMs);
    }
    async function check(block = false) {
      if (!live || document.visibilityState !== "visible") return;
      if (!navigator.onLine) {
        offline();
        return;
      }
      if (block && !expected) set("checking");
      if (controller) return;
      const read = new AbortController();
      controller = read;
      const timeout = window.setTimeout(() => read.abort(), 6000);
      try {
        const res = await fetch("/api/release", {
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          signal: read.signal,
        });
        if (!res.ok) throw new Error();
        const body: unknown = await res.json();
        const id =
          body && typeof body === "object" && "release" in body
            ? body.release
            : undefined;
        if (!releaseId(id)) throw new Error();
        if (!live || controller !== read || read.signal.aborted) return;
        if (id !== initialRelease) {
          update(id);
          return;
        }
        // A matching endpoint after a rollback is a fresh confirmation from this deployment.
        expected = null;
        const url = new URL(location.href);
        if (url.searchParams.has(marker)) {
          url.searchParams.delete(marker);
          history.replaceState(history.state, "", url.href);
        }
        set("current");
        later(pollMs);
      } catch {
        if (live && controller === read) {
          set("offline");
          later(retryMs);
        }
      } finally {
        window.clearTimeout(timeout);
        if (controller === read) controller = null;
      }
    }
    function offline() {
      stop();
      set("offline");
      later(retryMs);
    }
    function suspend() {
      stop();
      if (!expected) set("checking");
    }
    function resume() {
      if (document.visibilityState === "visible") void check(true);
      else suspend();
    }
    function focus() {
      if (document.visibilityState === "visible")
        void check(phaseNow !== "current");
    }
    function stale(e: Event) {
      const id = (e as CustomEvent<unknown>).detail;
      if (releaseId(id)) {
        stop();
        update(id);
      }
    }
    function edit(event: Event) {
      for (const old of edited) if (!old.isConnected) edited.delete(old);
      if (event.target instanceof HTMLElement) edited.add(event.target);
    }
    retry.current = () => void check(true);
    apply.current = async () => {
      if (expected && navigator.onLine) {
        await finishAttachmentSaves();
        navigate(true);
      } else void check(true);
    };
    window.addEventListener("online", focus);
    window.addEventListener("offline", offline);
    window.addEventListener("pageshow", focus);
    window.addEventListener("pagehide", suspend);
    window.addEventListener("focus", focus);
    window.addEventListener(staleEvent, stale);
    document.addEventListener("visibilitychange", resume);
    document.addEventListener("input", edit, true);
    document.addEventListener("change", edit, true);
    void check(true);
    return () => {
      live = false;
      stop();
      window.removeEventListener("online", focus);
      window.removeEventListener("offline", offline);
      window.removeEventListener("pageshow", focus);
      window.removeEventListener("pagehide", suspend);
      window.removeEventListener("focus", focus);
      window.removeEventListener(staleEvent, stale);
      document.removeEventListener("visibilitychange", resume);
      document.removeEventListener("input", edit, true);
      document.removeEventListener("change", edit, true);
      delete document.documentElement.dataset.releaseGate;
    };
  }, [initialRelease]);
  useEffect(() => {
    const element = dialog.current;
    if (phase === "current") {
      if (element?.open) element.close();
    } else if (element && !element.open) element.showModal();
  }, [phase]);
  return (
    <>
      {!opened && phase === "checking" && (
        <p className={styles.startup} role="status">
          {uiText("Verifica della versione di RIMIAM…")}
        </p>
      )}
      <div ref={surface} className={styles.surface} inert={phase !== "current"}>
        {opened ? children : null}
      </div>
      <dialog
        ref={dialog}
        className={styles.notice}
        aria-labelledby="release-title"
        onCancel={(e) => e.preventDefault()}
      >
        <h2 id="release-title" aria-live="polite">
          {phase === "offline"
            ? uiText("Connessione da verificare")
            : phase === "update"
              ? uiText("Aggiornamento necessario")
              : uiText("Verifica della versione…")}
        </h2>
        {phase === "offline" && (
          <>
            <p>
              {uiText(
                "RIMIAM riprenderà appena sarà possibile verificare la versione online.",
              )}
            </p>
            <button type="button" onClick={() => retry.current()}>
              {uiText("Riprova")}
            </button>
          </>
        )}
        {phase === "update" && (
          <>
            <p>
              {uiText(
                "Per continuare, apri la nuova versione. Le modifiche non ancora salvate possono andare perse.",
              )}
            </p>
            <button type="button" onClick={() => apply.current()}>
              {uiText("Aggiorna ora")}
            </button>
          </>
        )}
      </dialog>
      <noscript>
        {uiText(
          "Attiva JavaScript per verificare la versione e aprire RIMIAM.",
        )}
      </noscript>
    </>
  );
}
