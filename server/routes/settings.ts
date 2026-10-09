import { Router } from "express";
import { settingsUpdateSchema } from "../../lib/shared/schemas.js";
import * as settingsRepo from "../repositories/settingsRepository.js";
import * as drive from "../services/googleDrive.js";

export const settingsRouter = Router();

/** GET /api/settings */
settingsRouter.get("/", async (_req, res) => {
  res.status(200).json(await settingsRepo.getSettings());
});

/** PUT /api/settings — partial update; unknown keys are rejected. */
settingsRouter.put("/", async (req, res) => {
  const update = settingsUpdateSchema.strict().parse(req.body);
  const before = await settingsRepo.getSettings();
  const after = await settingsRepo.updateSettings(update);
  if (update.driveFolderName !== undefined && update.driveFolderName !== before.driveFolderName) {
    await drive.resetFolder();
  }
  res.status(200).json(after);
});
