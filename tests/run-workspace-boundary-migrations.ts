// Milestone-only verification on two newly created loopback databases; never the development DB.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";

const root = process.cwd(),
  uri = new URL(process.env.DATABASE_URL!);
assert(
  ["localhost", "127.0.0.1", "[::1]"].includes(uri.hostname),
  "Loopback database required",
);
uri.pathname = "/postgres";
const admin = new pg.Pool({ connectionString: uri.href });
const suffix = `${Date.now()}_${process.pid}`,
  fresh = `miriam_boundary_fresh_${suffix}`,
  existing = `miriam_boundary_existing_${suffix}`;
const stage = await mkdtemp(join(tmpdir(), "miriam-migrations-030-"));
const names = (await readdir(join(root, "migrations")))
  .filter((n) => n.endsWith(".sql"))
  .sort();
assert.equal(names.length, 33, "Verification bound is migrations 001–033");
const checksum = (s: string) => createHash("sha256").update(s).digest("hex");
const files = new Map(
  await Promise.all(
    names.map(
      async (n) =>
        [n, await readFile(join(root, "migrations", n), "utf8")] as const,
    ),
  ),
);
await mkdir(join(stage, "migrations"));
for (const n of names.slice(0, 30))
  await writeFile(join(stage, "migrations", n), files.get(n)!);
const database = (name: string) => {
  const u = new URL(uri);
  u.pathname = `/${name}`;
  return u.href;
};
function migrate(name: string, cwd = root) {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      resolve(root, "scripts/migrate.ts"),
    ],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: database(name),
        LOCAL_MAIL: "true",
        BETTER_AUTH_URL: "http://127.0.0.1:3199",
        AI_MODE: "unconfigured",
      },
    },
  );
  assert.equal(
    result.status,
    0,
    `Migration failed: ${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}
const created: string[] = [];
let runtimePool: pg.Pool | undefined;
try {
  for (const name of [fresh, existing]) {
    await admin.query(`CREATE DATABASE "${name}"`);
    created.push(name);
  }
  migrate(fresh);
  const freshPool = new pg.Pool({ connectionString: database(fresh) });
  try {
    const first = (
      await freshPool.query(
        "SELECT name,checksum,applied_at FROM schema_migration ORDER BY name",
      )
    ).rows;
    assert.equal(first.length, 33);
    for (const row of first)
      assert.equal(row.checksum, checksum(files.get(row.name)!));
    assert(
      !migrate(fresh).includes("Applied"),
      "Rerun must not reapply migrations",
    );
    assert.deepEqual(
      (
        await freshPool.query(
          "SELECT name,checksum,applied_at FROM schema_migration ORDER BY name",
        )
      ).rows,
      first,
    );
  } finally {
    await freshPool.end();
  }
  migrate(existing, stage);
  process.env.DATABASE_URL = database(existing);
  process.env.LOCAL_MAIL = "true";
  process.env.BETTER_AUTH_URL = "http://127.0.0.1:3199";
  process.env.AI_MODE = "unconfigured";
  const { pool } = await import("../src/server/db");
  runtimePool = pool;
  const { auth } = await import("../src/server/auth");
  const { createWorkspace, execute } = await import("../src/server/commands");
  const email = `migration-${randomUUID()}@example.test`,
    password = "Migration-fixture-only-2026!";
  const { user } = await auth.api.signUpEmail({
    body: { email, password, name: "Migration continuity" },
  });
  await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
    user.id,
  ]);
  const login = await auth.api.signInEmail({ body: { email, password } });
  const session = (
    await pool.query("SELECT id FROM session WHERE token=$1", [login.token])
  ).rows[0].id;
  const w = (
    await createWorkspace(
      user.id,
      "RIMIAM existing state",
      randomUUID(),
      "Due persone preparano RIMIAM",
    )
  ).id;
  const cmd = (c: unknown) => execute(user.id, w, randomUUID(), c, session);
  const goal = await cmd({
    type: "goal.establish",
    content: "Validare RIMIAM",
  });
  await cmd({ type: "goal.adhere", goalId: goal.goalId, version: 1 });
  const request = await cmd({
    type: "message.send",
    content: "Storia precedente alla nuova UI",
  });
  const stream = await cmd({
    type: "workstream.save",
    title: "Ricerca utenti",
    description: "Beta RIMIAM",
  });
  await cmd({
    type: "workstream.link",
    workstreamId: stream.id,
    sourceId: request.messageId,
    expectedVersion: 0,
    included: true,
  });
  const transition = await cmd({
    type: "goal.propose",
    goalId: goal.goalId,
    expectedVersion: 1,
    mode: "revise",
    content: "Validare RIMIAM con tre gruppi",
    reason: "Versione esplicita",
    preserveExistingObligations: true,
  });
  const access = (
    await pool.query("SELECT access_revision FROM workspace WHERE id=$1", [w])
  ).rows[0].access_revision;
  await cmd({
    type: "goal.approve",
    transitionId: transition.transitionId,
    expectedAccessRevision: access,
    representedPersonId: user.id,
    confirmExactContent: true,
  });
  const tables = [
    "workspace",
    "membership",
    "access_relationship",
    "goal",
    "goal_version",
    "goal_adherence",
    "goal_transition",
    "goal_transition_adoption",
    "message",
    "source_identity",
    "workstream",
    "workstream_version",
    "workstream_source",
    "interpretation",
    "command_receipt",
  ];
  async function snapshot() {
    const result: Record<string, unknown> = {};
    for (const table of tables)
      result[table] = (
        await pool.query(
          `SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
        )
      ).rows;
    return result;
  }
  const before = await snapshot(),
    beforeMigrations = (
      await pool.query(
        "SELECT name,checksum,applied_at FROM schema_migration ORDER BY name",
      )
    ).rows;
  assert.equal(beforeMigrations.length, 30);
  const upgrade = migrate(existing);
  assert.equal((upgrade.match(/Applied /g) ?? []).length, 3);
  assert.deepEqual(
    await snapshot(),
    before,
    "Upgrade must preserve identities, versions, history, provenance, pending processing and receipts exactly",
  );
  const applied = (
    await pool.query(
      "SELECT name,checksum,applied_at FROM schema_migration ORDER BY name",
    )
  ).rows;
  assert.deepEqual(
    applied.slice(0, 30),
    beforeMigrations,
    "Older checksums and application times remain unchanged",
  );
  for (const row of applied)
    assert.equal(row.checksum, checksum(files.get(row.name)!));
  assert(!migrate(existing).includes("Applied"));
  assert.deepEqual(await snapshot(), before);
  const sent = await cmd({
    type: "message.send",
    content: "Miriam, esamina la vecchia versione",
    workstreamFocus: { workstreamId: stream.id, version: 1 },
    reference: { kind: "goal", id: goal.goalId, version: 1 },
  });
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM message_workstream_focus WHERE workspace_id=$1 AND message_id=$2",
        [w, sent.messageId],
      )
    ).rows[0].count,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT reference_version FROM message_context_reference WHERE workspace_id=$1 AND message_id=$2",
        [w, sent.messageId],
      )
    ).rows[0].reference_version,
    1,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT current_version FROM goal WHERE workspace_id=$1 AND id=$2",
        [w, goal.goalId],
      )
    ).rows[0].current_version,
    2,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS count FROM message_workstream_focus WHERE workspace_id=$1 AND message_id=$2",
        [w, request.messageId],
      )
    ).rows[0].count,
    0,
    "Old messages remain unfocused, never backfilled",
  );
  for (const table of [
    "message_workstream_focus",
    "message_context_reference",
  ]) {
    await assert.rejects(
      pool.query(`DELETE FROM ${table} WHERE workspace_id=$1`, [w]),
    );
  }
  console.log(
    `PASS: fresh 001–033; rerun checksums/application times unchanged; seeded 030→033 preserves ${tables.length} domain/history/source/receipt tables exactly; 3 additive migrations; old messages unchanged; new focus + historical reference usable and immutable.`,
  );
} finally {
  await runtimePool?.end();
  for (const name of created) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
  await rm(stage, { recursive: true, force: true });
}
