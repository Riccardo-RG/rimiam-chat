import { fixtureAnalysis } from "./support/fixture-analysis";
// Native verification uses the real job registry/recovery; doubles stay at external ports.
import { runWorker } from "../src/server/worker-runner";
import { configuredInterpreter } from "../src/server/interpretation";
import { FixtureCalendar } from "./support/fixture-calendar";
import { FixtureEmail } from "./support/fixture-email";
const database = new URL(process.env.DATABASE_URL!);
if (
  database.pathname !== "/miriam_native" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)
)
  throw new Error("Native worker requires isolated loopback test database");
const fallbackInterpreter = configuredInterpreter();
// A deliberately explicit fixture trigger. Production interpreters never import this file.
await runWorker(
  {
    async interpret(context) {
      const prefix = "@Miriam Native handoff goal ";
      if (!context.trigger.content.startsWith(prefix))
        return fallbackInterpreter.interpret(context);
      return {
        proposals: [],
        needsMore: [],
        response: {
          mode: "respond",
          text: "Puoi preparare l’intento nel modulo del Workspace. Nessun Goal è stato stabilito.",
          sourceIds: [context.trigger.id],
        },
        handoffs: [
          {
            kind: "goal.establish",
            summary: "Prepara l’intento del test nativo",
            suggestedText: `Validare RIMIAM ${context.trigger.content.slice(prefix.length)}`,
            target: null,
            candidateIndex: null,
            sourceIds: [context.trigger.id],
          },
        ],
      };
    },
  },
  undefined,
  new FixtureCalendar(),
  new FixtureEmail(),
  fixtureAnalysis,
);
