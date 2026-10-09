import mysql, { type Pool } from "mysql2/promise";
import { config } from "../config.js";

/**
 * Singleton connection pool. Every query in the app goes through this pool, so
 * connections are reused and released automatically by `pool.execute`/`pool.query`.
 */
let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = mysql.createPool({
      ...config.db,
      waitForConnections: true,
      queueLimit: 0,
      charset: "utf8mb4",
      // Store and read TIMESTAMPs as UTC regardless of the container's timezone.
      timezone: "Z",
      dateStrings: false,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

/** Waits for MySQL to accept connections (the DB container may still be starting). */
export async function waitForDatabase(retries = 30, delayMs = 2_000): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await getPool().query("SELECT 1");
      return;
    } catch (err) {
      if (attempt >= retries) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[db] not ready (attempt ${attempt}/${retries}): ${reason}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
