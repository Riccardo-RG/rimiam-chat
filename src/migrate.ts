import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { getMigrations } from "better-auth/db/migration";
import { makeWorkerUtils } from "graphile-worker";
import { auth } from "./server/auth.ts";
import { pool, transaction } from "./server/db.ts";

const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(91001)");
  const authMigrations = await getMigrations(auth.options);
  await authMigrations.runMigrations();
  const utils = await makeWorkerUtils({ pgPool: pool });
  await utils.migrate();
  await utils.release();
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migration(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(`migrations/${name}`, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await pool.query(
      "SELECT checksum FROM schema_migration WHERE name=$1",
      [name],
    );
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum)
        throw new Error(`Changed migration: ${name}`);
      continue;
    }
    await transaction(async (tx) => {
      await tx.query(sql);
      await tx.query(
        "INSERT INTO schema_migration(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
    });
    console.log(`Applied ${name}`);
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(91001)");
  client.release();
  await pool.end();
}
