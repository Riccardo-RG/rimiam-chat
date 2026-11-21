import { consultationProvider } from "./support/consultation-provider";
import { mkdir, writeFile } from "node:fs/promises";
// Isolated real PostgreSQL + real auth/HTTP/worker flow. Doubles only at provider ports.
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import pg from "pg";

const port = Number(process.env.MIRIAM_E2E_PORT ?? 3100);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid local E2E port");
const dbName = port === 3100 ? "miriam_e2e" : `miriam_e2e_${port}`;
const server = process.env.MIRIAM_E2E_SERVER ?? "dev";
if (!["dev", "build", "start"].includes(server))
  throw new Error("Invalid E2E server mode");
// Keep Next's generated config and type files per server as well as its DB and report.
const generated = `.next-e2e/${port}`;
await mkdir(generated, { recursive: true });
await writeFile(
  generated + "/tsconfig.json",
  JSON.stringify(
    {
      extends: "../../tsconfig.json",
      compilerOptions: { incremental: false },
      include: [
        "../../next-env.d.ts",
        "../../src/**/*.ts",
        "../../src/**/*.tsx",
        "../../scripts/**/*.ts",
        "../../tests/**/*.ts",
        "../../next.config.ts",
        "app/types/**/*.ts",
        "app/dev/types/**/*.ts",
      ],
      exclude: ["../../node_modules", "../../dist"],
    },
    null,
    2,
  ),
);
const database = new URL(process.env.DATABASE_URL!);
const admin = new pg.Pool({ connectionString: database.href });
try {
  if (
    !(await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [dbName]))
      .rowCount
  )
    await admin.query(`CREATE DATABASE ${dbName}`);
} finally {
  await admin.end();
}
database.pathname = "/" + dbName;
const base = `http://127.0.0.1:${port}`;
const model =
  process.env.MIRIAM_E2E_CONSULTATION_MODEL === "true"
    ? await consultationProvider()
    : undefined;
const env = {
  ...process.env,
  DATABASE_URL: database.href,
  BETTER_AUTH_URL: base,
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  LOCAL_MAIL: server === "dev" ? "true" : "false",
  RESEND_API_KEY: "",
  MAIL_PROVIDER: "",
  OPENAI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  // Identity-only launches stop at a locally intercepted authorization screen.
  GOOGLE_AUTH_CLIENT_ID:
    process.env.MIRIAM_E2E_SIGN_IN === "true" ? "test-signin-google" : "",
  GOOGLE_AUTH_CLIENT_SECRET:
    process.env.MIRIAM_E2E_SIGN_IN === "true" ? "fixture-only" : "",
  MICROSOFT_AUTH_CLIENT_ID:
    process.env.MIRIAM_E2E_SIGN_IN === "true" ? "test-signin-microsoft" : "",
  MICROSOFT_AUTH_CLIENT_SECRET:
    process.env.MIRIAM_E2E_SIGN_IN === "true" ? "fixture-only" : "",
  // Browser mailbox handoffs use inert clients and capture provider navigation in Playwright.
  GOOGLE_OAUTH_CAPABILITIES:
    process.env.MIRIAM_E2E_GOOGLE_CAPABILITIES ?? "calendar,email",
  GOOGLE_OAUTH_CLIENT_ID:
    process.env.MIRIAM_E2E_MAILBOX_OAUTH === "true" ? "rimiam-test-google" : "",
  GOOGLE_OAUTH_CLIENT_SECRET:
    process.env.MIRIAM_E2E_MAILBOX_OAUTH === "true" ? "fixture-only" : "",
  GOOGLE_OAUTH_REDIRECT_URI: base + "/api/v1/integrations/google/callback",
  MICROSOFT_MAIL_CLIENT_ID:
    process.env.MIRIAM_E2E_MAILBOX_OAUTH === "true"
      ? "rimiam-test-microsoft"
      : "",
  MICROSOFT_MAIL_CLIENT_SECRET:
    process.env.MIRIAM_E2E_MAILBOX_OAUTH === "true" ? "fixture-only" : "",
  MICROSOFT_MAIL_REDIRECT_URI: base + "/api/v1/integrations/microsoft/callback",
  AI_MODE: model ? "ollama" : "unconfigured",
  OLLAMA_MODEL: model ? "fixture" : "",
  OLLAMA_BASE_URL: model?.url ?? "",
  // No deployment catalog or credential may be reached from browser tests.
  RIMIAM_ASSISTANT_CONNECTIONS: JSON.stringify([
    {
      id: "test-agent",
      kind: "agent",
      label: "Agente di prova",
      url: base + "/unused-test-agent",
      readOnly: true,
    },
    {
      id: "test-model",
      kind: "model",
      label: "Modello senza chiave",
      provider: "openai",
      model: "test-only",
    },
  ]),
  WEB_PUSH_ENABLED: "false",
  MIRIAM_TEST_BASE_URL: base,
  MIRIAM_E2E: "true",
};
function launch(args: string[]) {
  return spawn(process.execPath, args, { env, stdio: "inherit" });
}
function completed(child: ChildProcess) {
  return new Promise<number>((resolve) =>
    child.once("exit", (code) => resolve(code ?? 1)),
  );
}
const migrated = await completed(
  launch(["--import", "tsx", "scripts/migrate.ts"]),
);
if (migrated) process.exit(migrated);
let web: ChildProcess | undefined, worker: ChildProcess | undefined;
async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null) return;
  const exit = completed(child);
  child.kill("SIGTERM");
  const timer = setTimeout(() => child?.kill("SIGKILL"), 5000);
  await exit;
  clearTimeout(timer);
}
try {
  // Never attach this test worker to the user's development database.
  if (server === "build") {
    const built = await completed(
      launch(["node_modules/next/dist/bin/next", "build"]),
    );
    if (built) throw new Error("E2E production build failed");
  }
  web = launch([
    "node_modules/next/dist/bin/next",
    server === "dev" ? "dev" : "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ]);
  worker = launch(["--import", "tsx", "tests/worker.ts"]);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (web.exitCode !== null || worker.exitCode !== null)
      throw new Error("E2E service stopped");
    try {
      ready = (await fetch(`${base}/api/config`)).ok;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("E2E server not ready");
  process.exitCode = await completed(
    launch([
      "node_modules/@playwright/test/cli.js",
      "test",
      ...process.argv.slice(2),
    ]),
  );
} finally {
  await stop(worker);
  await stop(web);
  model?.close();
}
