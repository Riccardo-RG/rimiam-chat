// Run from the repository root after tests/run-native-server.ts has seeded miriam_native.
// Only this extra API uses the deterministic loopback document provider.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { consultationProvider } from "../../tests/support/consultation-provider.ts";

const db = new URL(process.env.DATABASE_URL!);
if (!["localhost", "127.0.0.1", "[::1]"].includes(db.hostname)) {
  throw new Error("A local test database is required");
}
db.pathname = "/miriam_native";
const model = await consultationProvider();
const api = spawn(process.execPath, ["dist/backend/api.js"], {
  stdio: "inherit",
  env: {
    PATH: process.env.PATH,
    NODE_ENV: "test",
    DATABASE_URL: db.href,
    API_HOST: "127.0.0.1",
    API_PORT: "3197",
    BETTER_AUTH_URL: "http://127.0.0.1:3197",
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    LOCAL_MAIL: "true",
    MAIL_PROVIDER: "unconfigured",
    AI_MODE: "ollama",
    OLLAMA_BASE_URL: model.url,
    OLLAMA_MODEL: "fixture",
    RIMIAM_ASSISTANT_CONNECTIONS: "[]",
    RESEARCH_PROVIDER: "unconfigured",
    TRANSCRIPTION_PROVIDER: "unconfigured",
    WEB_PUSH_ENABLED: "false",
    NATIVE_PUSH_ENABLED: "false",
  },
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => api.kill("SIGTERM"));
api.once("exit", (code) => {
  model.close();
  process.exitCode = code ?? 0;
});
