import { createServer } from "node:http";
import next from "next";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { closePool, waitForDatabase } from "./db/pool.js";
import { runMigrations } from "./db/migrate.js";

/**
 * Single-process server: Express handles /api/*, everything else is delegated to
 * Next.js (App Router). Migrations run before the server starts accepting traffic.
 */
async function main() {
  const dev = !config.isProduction;

  await waitForDatabase();
  const applied = await runMigrations();
  if (applied.length) console.log(`[migrate] applied ${applied.join(", ")}`);

  const nextApp = next({ dev, dir: process.cwd() });
  await nextApp.prepare();
  const handle = nextApp.getRequestHandler();

  const app = createApp({ dev });
  app.use((req, res) => handle(req, res));

  const server = createServer(app);
  server.listen(config.port, () => {
    console.log(`[server] Typewriter ready on ${config.appUrl} (port ${config.port}, ${dev ? "dev" : "production"})`);
    if (!config.google.configured) {
      console.log("[server] Google Drive disabled — set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY to enable it.");
    }
  });

  const shutdown = (signal: string) => {
    console.log(`[server] ${signal} received, shutting down`);
    server.close(() => {
      closePool()
        .then(() => process.exit(0))
        .catch((err: unknown) => {
          console.error("[server] error while closing the database pool:", err);
          process.exit(1);
        });
    });
    // Force-exit if open connections keep the server alive.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});
