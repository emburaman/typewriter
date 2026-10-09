import { Router } from "express";
import { getFontCatalog } from "../services/fonts.js";

export const fontsRouter = Router();

/** GET /api/fonts — available Google Font families. */
fontsRouter.get("/", async (_req, res) => {
  res.status(200).set("Cache-Control", "public, max-age=3600").json(await getFontCatalog());
});
