import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ContextReadings } from "../src/client/context-readings";
import type { Snapshot } from "../src/client/types";

it("groups repeated limits behind one closed disclosure and preserves the affected source references", () => {
  const state = {
    interpretations: [1, 2, 3].map((n) => ({
      id: `reading-${n}`,
      source_id: `source-${n}`,
      status: "failed",
      error_code: "AI_USAGE_LIMIT_REACHED",
    })),
    messages: [],
    sources: [],
  };
  const html = renderToStaticMarkup(
    createElement(ContextReadings, {
      state: state as Pick<
        Snapshot,
        "interpretations" | "messages" | "sources"
      >,
      chatFailures: new Map([["source-2", "reading-2"]]),
      disabled: false,
      openSource: () => {},
      retry: () => {},
    }),
  );
  expect(html).toContain("<details><summary>Letture da verificare");
  expect(html.match(/Limite di utilizzo AI raggiunto/g)).toHaveLength(1);
  expect(html.match(/Apri fonte/g)).toHaveLength(3);
  expect(html.match(/Riprova lettura/g)).toHaveLength(2);
});
