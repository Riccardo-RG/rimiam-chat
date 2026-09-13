// Isolated process-crash verification only. No application entry imports this file.
import { runWorker } from "../../src/server/worker-runner";
import { fixtureInterpreter } from "./fixture-interpreter";
import { fixtureAnalysis } from "./fixture-analysis";
const database = new URL(process.env.DATABASE_URL!);
if (
  database.pathname !== "/miriam_active_work_verify" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)
)
  throw Error("Isolated local verification database required");
await runWorker(
  fixtureInterpreter,
  undefined,
  undefined,
  undefined,
  process.env.MIRIAM_TEST_HOLD === "true"
    ? {
        name: "held-process-verification",
        async analyze() {
          return await new Promise<never>(() => {});
        },
      }
    : fixtureAnalysis,
);
