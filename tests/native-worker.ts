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
await runWorker(
  configuredInterpreter(),
  undefined,
  new FixtureCalendar(),
  new FixtureEmail(),
  fixtureAnalysis,
);
