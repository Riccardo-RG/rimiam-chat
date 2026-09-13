// Isolated real PostgreSQL + real auth/HTTP/worker flow. Doubles only at provider ports.
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import pg from "pg";

const database = new URL(process.env.DATABASE_URL!);
const admin = new pg.Pool({ connectionString: database.href });
try {
  if (
    !(await admin.query("SELECT 1 FROM pg_database WHERE datname='miriam_e2e'"))
      .rowCount
  )
    await admin.query("CREATE DATABASE miriam_e2e");
} finally {
  await admin.end();
}
database.pathname = "/miriam_e2e";
const base = "http://127.0.0.1:3100";
const env = {
  ...process.env,
  DATABASE_URL: database.href,
  BETTER_AUTH_URL: base,
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  LOCAL_MAIL: "true",
  AI_MODE: "unconfigured",
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
  web = launch([
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
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
}
