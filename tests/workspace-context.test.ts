import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { Candidate, Snapshot } from "../src/client/types";
import type { ConversationHandoff } from "../src/contracts/conversation-handoff";
import {
  contextPeriodStart,
  inContextPeriod,
  WorkspaceContext,
} from "../src/client/workspace-context";

it("filters by calendar days of activity, including older records when all dates are selected", () => {
  const now = new Date(2026, 10, 19, 15, 30);
  const start = contextPeriodStart(now);
  expect(start).toBe(new Date(2026, 10, 13).getTime());
  const firstDay = new Date(start).toISOString();
  const previousDay = new Date(start - 1).toISOString();
  expect(inContextPeriod(firstDay, "week", start)).toBe(true);
  expect(inContextPeriod(firstDay, "earlier", start)).toBe(false);
  expect(inContextPeriod(previousDay, "week", start)).toBe(false);
  expect(inContextPeriod(previousDay, "earlier", start)).toBe(true);
  expect(inContextPeriod(previousDay, "all", start)).toBe(true);
});

const untouched: Candidate = {
  id: "candidate-a",
  subject: "Sede",
  content: "Roma",
  interpretation_id: "reading",
  source_id: "source",
  source_ids: ["source"],
  author_name: "Anna",
  source_content: "Possiamo incontrarci a Roma?",
  origin: "inferred",
  classification: "descriptive",
  context_revision: 1,
  created_at: "2026-04-10T13:30:00.000Z",
  qualification:
    "Affermazione umana attribuita, non verificata indipendentemente.",
  uses: { information: [], questions: [], proposals: [] },
};
const handoff = {
  candidateId: untouched.id,
  kind: "information.accept",
  id: "ref",
} as ConversationHandoff;
const accepted: Candidate = {
  ...untouched,
  id: "adopted",
  source_id: "budget-source",
  source_ids: ["budget-source"],
  source_content: "Il budget è di 400 euro.",
  subject: "Budget",
  content: "400 euro",
  uses: {
    ...untouched.uses,
    information: [{ id: "info", version: 1, current: true }],
  },
};
function panel(
  memberContributes: boolean,
  contextRevision: number,
  options: Partial<Omit<ComponentProps<typeof WorkspaceContext>, "state">> = {},
) {
  const state = {
    workspace: { context_revision: contextRevision },
    members: [
      {
        user_id: "anna",
        name: "Anna",
        active: true,
        contributes: memberContributes,
      },
    ],
    candidates: [untouched, accepted],
    information: [
      {
        id: "info",
        subject: accepted.subject,
        content: accepted.content,
        current_version: 1,
        accepted_by: "anna",
        candidate_id: accepted.id,
        qualification: accepted.qualification,
        created_at: accepted.created_at,
      },
    ],
    versions: [],
    questions: [],
    interpretations: [],
    messages: [],
    sources: [],
  } as unknown as Snapshot;
  return renderToStaticMarkup(
    createElement(WorkspaceContext, {
      state,
      actor: "anna",
      busy: false,
      handoff: null,
      aiUnavailable: false,
      chatFailures: new Map(),
      command: async () => {},
      action: async () => {},
      openSource: () => {},
      openConsulted: () => {},
      openDirection: () => {},
      correct: () => {},
      proposeCommitment: () => {},
      ...options,
    }),
  );
}

it("starts with two private consultation prompts and keeps references and proposals behind an explicit action", () => {
  const html = panel(true, 1);
  expect(html).toContain("Quali riferimenti abbiamo già accettato?");
  expect(html).toContain("Quali questioni sono ancora aperte?");
  expect(html).toContain("Consulta riferimenti e proposte");
  expect(html).not.toContain("400 euro");
  expect(html).not.toContain("Possiamo incontrarci a Roma?");
});

it("opens a conversational handoff on its inferred proposal while preserving the original human words separately", () => {
  const html = panel(true, 1, { handoff });
  expect(html).toMatch(/<details[^>]*id="candidate-candidate-a"[^>]*open=""/);
  expect(html).toContain("Deduzione di Emme");
  expect(html).toContain("Una delle fonti è un messaggio umano.");
  expect(html).toContain("<cite>Anna</cite>Possiamo incontrarci a Roma?");
  expect(html).toContain("Accetta come riferimento descrittivo");
  expect(html).not.toContain('id="candidate-adopted"');
});

it("read-only members cannot retry stale suggestions and stale content cannot be accepted", () => {
  const html = panel(false, 2, { handoff });
  expect(html).toMatch(
    /<button[^>]*disabled=""[^>]*>Rileggi alla luce degli aggiornamenti<\/button>/,
  );
  expect(html).not.toContain("Accetta come riferimento descrittivo");
});
