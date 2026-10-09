import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { config } from "../config.js";

export const MIGRATIONS_DIR = path.resolve(process.cwd(), "db", "migrations");

/**
 * Applies every `db/migrations/*.sql` file not yet recorded in `schema_migrations`,
 * in filename order, each inside its own transaction where MySQL allows it.
 *
 * Uses a dedicated short-lived connection with `multipleStatements` enabled — the
 * shared pool deliberately keeps that option off.
 */
export async function runMigrations(dir = MIGRATIONS_DIR): Promise<string[]> {
  const conn = await mysql.createConnection({ ...config.db, multipleStatements: true });
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    const [rows] = await conn.query<RowDataPacket[]>("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map((r) => String(r.name)));

    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const newlyApplied: string[] = [];

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      console.log(`[migrate] applying ${file}`);
      // DDL auto-commits in MySQL, so the transaction mainly protects data statements.
      await conn.beginTransaction();
      try {
        await conn.query(sql);
        await conn.execute("INSERT INTO schema_migrations (name) VALUES (?)", [file]);
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      newlyApplied.push(file);
    }
    return newlyApplied;
  } finally {
    await conn.end();
  }
}
