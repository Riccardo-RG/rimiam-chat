import { useEffect, useState } from "react";
import { historySchema } from "../../../src/contracts/v1";
import type { Snapshot } from "../../../src/contracts/web-snapshot";
import type { AttentionView } from "../../../src/contracts/attention";
import { timelineMessage } from "../../../src/shared/history-presentation";
import { problem, type NativeRequest } from "../api";
export type ChatTopic = Pick<
  AttentionView["workstreams"][number],
  "id" | "version" | "title"
> & { state: string };
type Page = {
  messages: Snapshot["messages"];
  next: number;
  more: boolean;
  topic?: ChatTopic;
};
/** The filtered view reads the ordinary authorized timeline and never advances its global read cursor. */
export function useTopicReading(
  request: NativeRequest,
  path: string,
  focus: ChatTopic | null,
  through: number,
  revision: number,
) {
  const [cursor, move] = useState<{ id: string; before: number }>(),
    [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    page?: Page;
    error?: string;
  }>();
  const id = focus?.id,
    before = id && cursor?.id === id ? cursor.before : undefined;
  const key = JSON.stringify([path, id, before ?? null]);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController(),
      opts = { signal: controller.signal };
    const query = new URLSearchParams({
      workstreamId: id,
      through: String(through),
      limit: "50",
    });
    if (before !== undefined) query.set("before", String(before));
    void Promise.all([
      request<unknown>(path + "/history?" + query, opts),
      request<AttentionView>(path + "/attention", opts),
    ])
      .then(([raw, attention]) => {
        if (controller.signal.aborted) return;
        const page = historySchema.parse(raw);
        setResult({
          key,
          page: {
            messages: page.messages.map(timelineMessage),
            next: page.nextBefore,
            more: page.hasMore,
            topic: attention.workstreams.find((s) => s.id === id),
          },
        });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setResult({ key, error: problem(e) });
      });
    return () => controller.abort();
  }, [request, path, id, key, through, revision, before, attempt]);
  const current = result?.key === key ? result : undefined;
  const older = () => {
    if (id && current?.page?.more) move({ id, before: current.page.next });
  };
  return {
    page: current?.page,
    error: current?.error,
    loading: !!id && !current,
    older,
    historical: before !== undefined,
    recent: () => move(undefined),
    refresh: () => setAttempt((x) => x + 1),
  };
}
