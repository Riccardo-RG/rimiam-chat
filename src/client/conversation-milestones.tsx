"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useState } from "react";
import {
  type ConversationMilestone,
  conversationMilestonesSchema,
} from "../contracts/conversation-milestones";
import { api } from "./api";
import { WorkspaceIcon } from "./workspace-icon";

export function useConversationMilestones(
  actor: string | undefined,
  workspace: string | undefined,
  first: string | undefined,
  last: string | undefined,
  revision: number,
) {
  const key = JSON.stringify([actor, workspace, first, last]);
  const [state, setState] = useState<{
    key: string;
    byMessage: Map<string, ConversationMilestone[]>;
  } | null>(null);
  useEffect(() => {
    if (!workspace || !actor || !first || !last) return;
    const abort = new AbortController();
    void api(
      "/api/v1/workspaces/" +
        workspace +
        "/milestones?" +
        new URLSearchParams({ first, last }),
      undefined,
      abort.signal,
    )
      .then((input) => {
        const items = conversationMilestonesSchema.parse(input).items;
        const byMessage = new Map<string, ConversationMilestone[]>();
        for (const item of items) {
          const group = byMessage.get(item.anchor) ?? [];
          group.push(item);
          byMessage.set(item.anchor, group);
        }
        if (!abort.signal.aborted) setState({ key, byMessage });
      })
      .catch(() => {
        if (!abort.signal.aborted) setState(null);
      });
    return () => abort.abort();
  }, [actor, workspace, first, last, key, revision]);
  return state?.key === key ? state.byMessage : null;
}
export function ConversationMilestones({
  items,
  open,
}: {
  items?: ConversationMilestone[];
  open: (item: ConversationMilestone) => void;
}) {
  const { t: uiText } = useUiLanguage();
  if (!items?.length) return null;
  return (
    <div className="timeline-milestones">
      {items.map((item) => (
        <div key={item.id} className="timeline-milestone">
          {
            <button type="button" onClick={() => open(item)}>
              <WorkspaceIcon
                name={item.kind === "decision" ? "check" : "work"}
              />
              <strong>
                {item.kind === "decision"
                  ? uiText("Decisione adottata")
                  : uiText("Leggi il confronto completo")}
              </strong>
              <span>
                {item.kind === "completed" ? item.conclusion : item.label}
              </span>
              <WorkspaceIcon name="chevron" />
            </button>
          }
        </div>
      ))}
    </div>
  );
}
