import { fixtureAnalysis } from "./support/fixture-analysis";
// Explicit automation-only process. Never used by npm run worker.
import { runWorker } from "../src/server/worker-runner";
import { fixtureInterpreter } from "./support/fixture-interpreter";
import { FixtureEmail } from "./support/fixture-email";
import { FixtureCalendar } from "./support/fixture-calendar";
await runWorker(
  fixtureInterpreter,
  {
    name: "deterministic-test-research",
    async search(query) {
      if (query.includes("E2E"))
        return [
          {
            title: "Licenza di prova",
            url: "https://example.test/licenza",
            excerpt: "La licenza costa circa €2.000 (fonte di test).",
          },
        ];
      return [];
    },
  },
  new FixtureCalendar(),
  new FixtureEmail(),
  fixtureAnalysis,
);
