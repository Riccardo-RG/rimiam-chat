import { configuredInterpreter } from "./server/interpretation.ts";
import { runWorker } from "./server/worker-runner.ts";
await runWorker(configuredInterpreter());
