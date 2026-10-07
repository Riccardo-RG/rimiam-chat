"use client";
import { useEffect, useState } from "react";
import { historySchema } from "@/contracts/v1";
import type { Snapshot } from "@/contracts/web-snapshot";
import { api, errorText } from "./api";

/** A reading window of the ordinary shared history, never a second conversation. */
export function useFocusedHistory(
  actor: string | undefined,
  workspace: string,
  focus: string | undefined,
  through: number,
  revision: number,
) {
  const scope = `${actor}:${workspace}:${focus}`;
  const [cursor, setCursor] = useState<{ scope: string; before: number }>();
  const [attempt, setAttempt] = useState(0);
  const before = cursor?.scope === scope ? cursor.before : undefined;
  const window = `${scope}:${before ?? "latest"}`;
  const [result, setResult] = useState<{
    window: string;
    messages: Snapshot["messages"];
    nextBefore: number;
    hasMore: boolean;
    error: string;
  }>();
  useEffect(() => {
    if (!actor || !workspace || !focus) return;
    let live = true;
    const query = new URLSearchParams({
      workstreamId: focus,
      through: String(through),
      limit: "50",
    });
    if (before !== undefined) query.set("before", String(before));
    void api<unknown>(`/api/v1/workspaces/${workspace}/history?${query}`)
      .then((payload) => {
        const page = historySchema.parse(payload);
        if (live)
          setResult({
            window,
            nextBefore: page.nextBefore,
            hasMore: page.hasMore,
            error: "",
            messages: page.messages.map((m) => ({
              id: m.id,
              sequence: m.sequence,
              content: m.content,
              author_id: m.authorId,
              actor_kind: m.actorKind,
              author_name: m.authorName,
              purpose: m.purpose,
              created_at: m.createdAt,
              citation_source_ids: m.citationSourceIds,
              reply_to_source_id: m.replyToSourceId,
              workstream_focus: m.workstreamFocus ?? null,
              reference: m.reference ?? null,
              assistanceContext: m.assistanceContext ?? null,
              operationResult: m.operationResult ?? null,
            })),
          });
      })
      .catch((error: unknown) => {
        if (live)
          setResult({
            window,
            messages: [],
            nextBefore: 0,
            hasMore: false,
            error: errorText(error),
          });
      });
    return () => {
      live = false;
    };
  }, [actor, workspace, focus, through, revision, before, window, attempt]);
  const page = result?.window === window ? result : undefined;
  return {
    messages: page?.messages ?? [],
    loading: !!focus && !page,
    error: page?.error,
    hasOlder: !!page?.hasMore,
    historical: before !== undefined,
    older: () => {
      if (page?.hasMore) setCursor({ scope, before: page.nextBefore });
    },
    recent: () => setCursor(undefined),
    retry: () => setAttempt((n) => n + 1),
  };
}
