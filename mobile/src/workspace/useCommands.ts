import { explicitCreationRejection } from "../../../src/shared/workspace-creation-errors";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { ApiError, problem, type NativeRequest } from "../api";
import {
  checkReceipt,
  clearPending,
  clearSubmittedDraft,
  loadPending,
  savePending,
  transmit,
  type Intent,
  type Scope,
  type Pending,
} from "./commands";

export function describe(error: unknown) {
  return error instanceof Error &&
    !(error instanceof ApiError) &&
    !/network|fetch|abort/i.test(error.message)
    ? error.message
    : problem(error);
}

export function useCommands(
  request: NativeRequest,
  scope: Scope,
  onCommit: (pending: Pending) => void,
) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [loadedScope, setLoadedScope] = useState<Scope | null>(null);
  const ready = loadedScope === scope;
  const selectedScope = useRef(scope);
  selectedScope.current = scope;
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const lock = useRef<Scope | null>(null);
  const committed = useRef(onCommit);
  committed.current = onCommit;
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    setPending(null);
    setWorking(false);
    setNotice("");
    setLoadedScope(null);
    let current = true;
    async function restore() {
      try {
        const p = await loadPending(scope);
        if (current) {
          setPending(p);
          setLoadedScope(scope);
        }
      } catch (e) {
        if (current) setNotice(describe(e));
      }
    }
    void restore();
    return () => {
      current = false;
      active.current = false;
    };
  }, [scope]);
  const settle = useCallback(
    async (p: Pending) => {
      if (p.intent.draftToken)
        await clearSubmittedDraft(scope, p.intent.draftToken, p.intent.files);
      await clearPending(scope, p);
      if (active.current && selectedScope.current === scope) {
        setPending(null);
        setNotice("");
        committed.current(p);
      }
    },
    [scope],
  );
  async function run(action: () => Promise<void>) {
    if (
      lock.current === scope ||
      !ready ||
      selectedScope.current !== scope ||
      (!active.current && scope.lane !== "call-exit")
    )
      return;
    lock.current = scope;
    setWorking(true);
    setNotice("");
    try {
      await action();
    } catch (e) {
      if (active.current && selectedScope.current === scope)
        setNotice(describe(e));
    } finally {
      if (lock.current === scope) lock.current = null;
      if (active.current && selectedScope.current === scope) setWorking(false);
    }
  }
  async function deliver(p: Pending) {
    try {
      return await transmit(request, scope, p);
    } catch (error) {
      const reason =
        p.intent.kind === "create" &&
        error instanceof ApiError &&
        (error.status === 400 || error.status === 409) &&
        explicitCreationRejection(error.code);
      if (!reason) throw error;
      await clearPending(scope, p);
      if (active.current && selectedScope.current === scope) setPending(null);
      throw new Error(reason);
    }
  }
  async function send(
    intent: Intent,
    onImmediateReceipt?: (result: Record<string, unknown>) => void,
  ) {
    let completed = false;
    await run(async () => {
      if (pending) return;
      const p = await savePending(scope, intent);
      if (active.current && selectedScope.current === scope) setPending(p);
      const result = await deliver(p);
      await settle(p);
      if (result && active.current && selectedScope.current === scope)
        onImmediateReceipt?.(result);
      completed = true;
    });
    return completed;
  }
  function retry(resend: boolean) {
    return run(async () => {
      if (!pending) return;
      if (await checkReceipt(request, scope, pending)) {
        await settle(pending);
        return;
      }
      if (!resend) {
        if (active.current && selectedScope.current === scope)
          setNotice("La conferma non è ancora disponibile.");
        return;
      }
      await deliver(pending);
      await settle(pending);
    });
  }
  function discard() {
    if (!pending || lock.current === scope || !ready) return;
    Alert.alert(
      "Rimuovere l’invio dal dispositivo?",
      "Un invio già ricevuto dal server resta valido. Controlla prima l’esito per evitare duplicati.",
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Rimuovi",
          style: "destructive",
          onPress: () =>
            void run(async () => {
              if (await checkReceipt(request, scope, pending)) {
                await settle(pending);
                return;
              }
              await clearPending(scope, pending);
              if (active.current && selectedScope.current === scope)
                setPending(null);
            }),
        },
      ],
    );
  }
  return {
    pending: ready ? pending : null,
    ready,
    working: ready && working,
    notice,
    send,
    retry,
    discard,
  };
}
export type Commands = ReturnType<typeof useCommands>;
