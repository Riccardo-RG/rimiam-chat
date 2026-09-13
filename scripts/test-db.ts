import pg from "pg";
import { spawnSync } from "node:child_process";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const exists = await pool.query(
    "SELECT 1 FROM pg_database WHERE datname='miriam_test'",
  );
  if (!exists.rowCount) await pool.query("CREATE DATABASE miriam_test");
} finally {
  await pool.end();
}
const database = new URL(process.env.DATABASE_URL!);
database.pathname = "/miriam_test";
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "scripts/migrate.ts"],
  { env: { ...process.env, DATABASE_URL: database.href }, stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
