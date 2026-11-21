import { useEffect, useMemo, useState } from "react";
import {
  conversationHandoffsSchema,
  type ConversationHandoff,
} from "../../../src/contracts/conversation-handoff";
import {
  conversationMilestonesSchema,
  type ConversationMilestone,
} from "../../../src/contracts/conversation-milestones";
import { problem, type NativeRequest } from "../api";

export function useTimelineExtras(
  request: NativeRequest,
  path: string,
  first: string | undefined,
  last: string | undefined,
  revision: number,
) {
  const [milestones, setMilestones] = useState<ConversationMilestone[]>([]);
  const [suggestions, setSuggestions] = useState<ConversationHandoff[]>([]);
  const [source, setSource] = useState<string | null>(null),
    [loaded, setLoaded] = useState<string | null>(null);
  const [error, setError] = useState(""),
    [historyError, setHistoryError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!first || !last) return;
    const ac = new AbortController();
    void request(path + "/milestones?" + new URLSearchParams({ first, last }), {
      signal: ac.signal,
    })
      .then((body) => {
        const items = conversationMilestonesSchema.parse(body).items;
        if (!ac.signal.aborted) {
          setMilestones(items);
          setError("");
        }
      })
      .catch((cause) => {
        if (!ac.signal.aborted) setError(problem(cause));
      });
    return () => ac.abort();
  }, [request, path, first, last, revision, retry]);
  useEffect(() => {
    if (!last) return;
    const ac = new AbortController();
    void Promise.all([
      request(path + "/handoffs", { signal: ac.signal }),
      ...(source
        ? [
            request(path + "/handoffs?sourceId=" + encodeURIComponent(source), {
              signal: ac.signal,
            }),
          ]
        : []),
    ])
      .then((results) => {
        const rank = { applied: 3, stale: 2, ready: 1, navigation: 0 };
        const map = new Map<string, ConversationHandoff>();
        for (const data of results)
          for (const h of conversationHandoffsSchema.parse(data).handoffs) {
            const old = map.get(h.id);
            if (!old || rank[h.status] >= rank[old.status]) map.set(h.id, h);
          }
        if (!ac.signal.aborted) {
          setSuggestions([...map.values()]);
          setLoaded(source);
          setHistoryError("");
        }
      })
      .catch((cause) => {
        if (!ac.signal.aborted) setHistoryError(problem(cause));
      });
    return () => ac.abort();
  }, [last, request, path, source, revision, retry]);
  const anchored = useMemo(() => {
    const map = new Map<string, ConversationMilestone[]>();
    for (const item of milestones) {
      const entries = map.get(item.anchor) ?? [];
      entries.push(item);
      map.set(item.anchor, entries);
    }
    return map;
  }, [milestones]);
  const suggested = useMemo(() => {
    const map = new Map<string, ConversationHandoff[]>();
    for (const h of suggestions) {
      const entries = map.get(h.sourceMessageId) ?? [];
      entries.push(h);
      map.set(h.sourceMessageId, entries);
    }
    return map;
  }, [suggestions]);
  return {
    anchored,
    suggested,
    source: loaded,
    error: error || historyError,
    load: (id: string) => {
      setSource(id);
      if (id === source) setRetry((v) => v + 1);
    },
    retry: () => setRetry((v) => v + 1),
  };
}
