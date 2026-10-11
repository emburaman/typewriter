import { Router } from "express";
import { settingsUpdateSchema } from "../../lib/shared/schemas.js";
import * as settingsRepo from "../repositories/settingsRepository.js";
import { currentUser } from "../services/auth.js";
import * as driveSync from "../services/driveSync.js";

/** The signed-in user's settings (mounted behind requireAuth). */
export const settingsRouter = Router();

/** GET /api/settings */
settingsRouter.get("/", async (req, res) => {
  res.status(200).json(await settingsRepo.getSettings(currentUser(req).id));
});

/** PUT /api/settings — partial update; unknown keys are rejected. */
settingsRouter.put("/", async (req, res) => {
  const user = currentUser(req);
  const update = settingsUpdateSchema.strict().parse(req.body);
  const before = await settingsRepo.getSettings(user.id);
  const after = await settingsRepo.updateSettings(user.id, update);
  if (update.driveFolderName !== undefined && update.driveFolderName !== before.driveFolderName) {
    // Rename the existing Drive folder (failures are repaired by the next upload).
    await driveSync.followUp(user.id, () => driveSync.syncRoot(user.id));
  }
  res.status(200).json(after);
});
