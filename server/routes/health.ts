import { Router } from "express";
import { getPool } from "../db/pool.js";

export const healthRouter = Router();

/** GET /api/health — liveness + database reachability (used by Docker healthchecks). */
healthRouter.get("/", async (_req, res) => {
  try {
    await getPool().query("SELECT 1");
    res.status(200).json({ status: "ok", database: "up" });
  } catch (err) {
    console.error("[health] database check failed:", err);
    res.status(503).json({ status: "degraded", database: "down" });
  }
});
