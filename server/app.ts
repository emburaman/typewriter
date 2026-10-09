import express, { type Express } from "express";
import helmet from "helmet";
import { apiErrorHandler, apiNotFoundHandler } from "./errors.js";
import { documentsRouter } from "./routes/documents.js";
import { fontsRouter } from "./routes/fonts.js";
import { googleRouter } from "./routes/google.js";
import { healthRouter } from "./routes/health.js";
import { settingsRouter } from "./routes/settings.js";

/** Router containing every REST endpoint, mounted at /api. */
export function createApiRouter(): express.Router {
  const api = express.Router();
  api.use(express.json({ limit: "5mb" }));
  api.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  api.use("/health", healthRouter);
  api.use("/settings", settingsRouter);
  api.use("/documents", documentsRouter);
  api.use("/google", googleRouter);
  api.use("/fonts", fontsRouter);

  api.use(apiNotFoundHandler);
  api.use(apiErrorHandler);
  return api;
}

/**
 * Base Express app with security headers and the API. The Next.js page handler is
 * attached by server/index.ts so the API can be tested without booting Next.
 */
export function createApp({ dev }: { dev: boolean }): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "default-src": ["'self'"],
          // Next.js injects inline bootstrap scripts; dev mode additionally needs eval for HMR.
          "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])],
          "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
          "img-src": ["'self'", "data:", "blob:"],
          "connect-src": ["'self'", ...(dev ? ["ws:", "wss:"] : [])],
          "form-action": ["'self'", "https://accounts.google.com"],
          "upgrade-insecure-requests": null,
        },
      },
      // The OAuth redirect to Google is a top-level navigation; keep referrer to origin only.
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  );

  app.use("/api", createApiRouter());
  return app;
}
