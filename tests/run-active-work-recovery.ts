// Milestone verification: fresh/existing migrations, actual worker crash/restart and compiled API.
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import pg from "pg";
const uri = new URL(process.env.DATABASE_URL!);
if (!["localhost", "127.0.0.1", "[::1]"].includes(uri.hostname))
  throw Error("Loopback database required");
const admin = new pg.Pool({ connectionString: uri.href });
try {
  if (
    !(
      await admin.query(
        "SELECT 1 FROM pg_database WHERE datname='miriam_active_work_verify'",
      )
    ).rowCount
  )
    await admin.query("CREATE DATABASE miriam_active_work_verify");
} finally {
  await admin.end();
}
uri.pathname = "/miriam_active_work_verify";
process.env.DATABASE_URL = uri.href;
process.env.AI_MODE = "unconfigured";
process.env.LOCAL_MAIL = "true";
process.env.API_PORT = "3114";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3114";
const children: ChildProcess[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function start(args: string[], hold = false) {
  const p = spawn(process.execPath, args, {
    env: { ...process.env, MIRIAM_TEST_HOLD: String(hold) },
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.push(p);
  return p;
}
async function stop(p: ChildProcess, kill = false) {
  if (p.exitCode !== null || p.signalCode !== null) return;
  const exited = once(p, "exit");
  p.kill(kill ? "SIGKILL" : "SIGINT");
  await exited;
}
async function until(fn: () => Promise<boolean>) {
  for (let i = 0; i < 150; i++) {
    if (await fn()) return;
    await sleep(250);
  }
  throw Error("Recovery verification timed out");
}
for (let i = 0; i < 2; i++) {
  const p = start(["--import", "tsx", "scripts/migrate.ts"]);
  const [code] = await once(p, "exit");
  assert.equal(code, 0, "migrations/checksum rerun");
}
const { pool } = await import("../src/server/db");
const { auth } = await import("../src/server/auth");
const { createWorkspace, execute } = await import("../src/server/commands");
try {
  const email = `recovery-${randomUUID()}@example.test`,
    password = "Recovery-test-only-2026!";
  const { user } = await auth.api.signUpEmail({
    body: { email, password, name: "Worker recovery verification" },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const login = await auth.api.signInEmail({ body: { email, password } }),
    session = (
      await pool.query("SELECT id FROM session WHERE token=$1", [login.token])
    ).rows[0].id;
  const w = (
    await createWorkspace(
      user.id,
      "Active Work restart verification",
      randomUUID(),
    )
  ).id;
  const command = (input: unknown, key = randomUUID()) =>
    execute(user.id, w, key, input, session);
  await command({
    type: "message.send",
    content:
      "I locali Milano e Roma costano 3000 euro al mese, fonte da verificare.",
  });
  const first = String(
    (await command({ type: "work.converse", text: "Analizza: Milano" })).workId,
  );
  const row = async (id: string) =>
    (
      await pool.query(
        "SELECT * FROM active_work WHERE workspace_id=$1 AND id=$2",
        [w, id],
      )
    ).rows[0];
  const control = async (id: string, text: string) =>
    command({
      type: "work.converse",
      workId: id,
      expectedRevision: (await row(id)).revision,
      text,
    });
  const crashed = start(
    ["--import", "tsx", "tests/support/active-work-recovery-worker.ts"],
    true,
  );
  await until(async () => (await row(first)).phase === "working");
  await stop(crashed, true);
  await control(first, "pausa");
  const second = String(
    (await command({ type: "work.converse", text: "Analizza: Roma" })).workId,
  );
  const restarted = start([
    "--import",
    "tsx",
    "tests/support/active-work-recovery-worker.ts",
  ]);
  await until(async () => (await row(second)).phase === "completed");
  assert.equal((await row(first)).phase, "paused");
  assert.equal(
    (
      await pool.query(
        "SELECT 1 FROM active_work_contribution WHERE work_id=$1",
        [first],
      )
    ).rowCount,
    0,
  );
  await control(first, "riprendi");
  await until(async () => (await row(first)).phase === "completed");
  await stop(restarted);
  const again = start([
    "--import",
    "tsx",
    "tests/support/active-work-recovery-worker.ts",
  ]);
  const api = start(["dist/backend/api.js"]);
  await until(async () => {
    try {
      return (await fetch("http://127.0.0.1:3114/api/v1/openapi.json")).ok;
    } catch {
      return false;
    }
  });
  const signed = await fetch("http://127.0.0.1:3114/api/v1/native/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(signed.status, 200);
  const headers = { authorization: `Bearer ${(await signed.json()).token}` };
  const response = await fetch(
    `http://127.0.0.1:3114/api/v1/workspaces/${w}/active-work`,
    { headers },
  );
  assert.equal(response.status, 200);
  const view = await response.json();
  assert.equal(view.works.length, 2);
  assert.ok(
    view.works.every(
      (a: { phase: string; contribution: unknown }) =>
        a.phase === "completed" && a.contribution,
    ),
  );
  const counts = (
    await pool.query(
      "SELECT work_id,count(*)::int AS n FROM active_work_contribution WHERE workspace_id=$1 GROUP BY work_id",
      [w],
    )
  ).rows;
  assert.ok(counts.every((c) => c.n === 1));
  await stop(api);
  await stop(again);
  console.log(
    "PASS: migrations applied/rerun, crashed worker cannot override pause, queued work resumes after restart, explicit resume completes once, second restart does not duplicate, compiled API recovers authenticated Work/Contribution state without Next.",
  );
} finally {
  for (const p of children) await stop(p);
  await pool.end();
}
