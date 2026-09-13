import pg, { type PoolClient } from "pg";
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});
pool.on("error", () => console.error("PostgreSQL pool connection failed"));
pool.on("connect", (client) =>
  client.on("error", () =>
    console.error("PostgreSQL active connection failed"),
  ),
);
export type Tx = PoolClient;
export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const result = await fn(tx);
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}
