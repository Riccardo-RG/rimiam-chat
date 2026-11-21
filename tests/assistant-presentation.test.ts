import { expect, it } from "vitest";
import {
  attentionReasonLabel,
  workspaceChangeLabel,
} from "../src/shared/workspace-labels";
import { translateUi } from "../src/shared/i18n";
import {
  workEventSummary,
  workstreamDescription,
} from "../src/shared/assistant-presentation";

it("updates generated labels while preserving the original objective, including a person's name", () => {
  const recorded = "Miriam prepara un'analisi: Valutare il lavoro di Miriam";
  expect(workEventSummary("started", recorded)).toBe(
    "Emme prepara un'analisi: Valutare il lavoro di Miriam",
  );
  expect(workEventSummary("input", recorded)).toBe(recorded);
  expect(
    workEventSummary(
      "working",
      "Miriam sta analizzando il materiale condiviso pertinente.",
    ),
  ).toBe("Emme sta analizzando il materiale condiviso pertinente.");
});

it("only updates the exact system workstream description for a model-generated stream", () => {
  const recorded =
    "Organizzazione semantica proposta da Miriam; non ancora un filone attivo.";
  expect(workstreamDescription("human", recorded)).toBe(recorded);
  expect(workstreamDescription("miriam", recorded)).toContain(
    "proposta da Emme",
  );
  expect(workstreamDescription("miriam", "Idea di Miriam, da verificare")).toBe(
    "Idea di Miriam, da verificare",
  );
});

it("labels workspace changes without claiming adoption or exposing unknown event codes", () => {
  expect(translateUi("en", workspaceChangeLabel("project.approve"))).toBe(
    "Proposal approval recorded",
  );
  expect(workspaceChangeLabel("work.completed")).toBe("Analisi completata");
  for (const kind of [
    "task.unknown_protocol_code",
    "future.event",
    "constructor",
  ]) {
    expect(workspaceChangeLabel(kind)).toBe("Aggiornamento dello spazio");
  }
});

it("translates built-in attention reasons, including the historical assistant label", () => {
  expect(
    translateUi(
      "en",
      attentionReasonLabel("Task senza responsabilità accettata"),
    ),
  ).toBe("No one has accepted the task yet");
  expect(
    translateUi(
      "en",
      attentionReasonLabel("Miriam ha bisogno di un chiarimento"),
    ),
  ).toBe("Needs clarification");
  expect(translateUi("en", attentionReasonLabel("future reason"))).toBe(
    "Needs attention",
  );
});
