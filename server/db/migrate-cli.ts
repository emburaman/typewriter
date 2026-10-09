import { closePool, waitForDatabase } from "./pool.js";
import { runMigrations } from "./migrate.js";

/** `npm run migrate` — apply pending migrations and exit. */
async function main() {
  await waitForDatabase();
  const applied = await runMigrations();
  console.log(applied.length ? `[migrate] applied: ${applied.join(", ")}` : "[migrate] database is up to date");
  await closePool();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
