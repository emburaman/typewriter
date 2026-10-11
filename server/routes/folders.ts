import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { documentIdSchema, folderCreateSchema, folderUpdateSchema } from "../../lib/shared/schemas.js";
import { badRequest, notFound } from "../errors.js";
import * as foldersRepo from "../repositories/foldersRepository.js";
import { currentUser } from "../services/auth.js";
import * as driveSync from "../services/driveSync.js";

/** All routes act on the signed-in user's folders only (mounted behind requireAuth). */
export const foldersRouter = Router();

const parseId = (req: Request<{ id: string }>) => documentIdSchema.parse(req.params.id);

async function requireParent(userId: string, parentId: string | null): Promise<void> {
  if (parentId && !(await foldersRepo.findFolder(userId, parentId))) {
    throw badRequest(`Parent folder ${parentId} does not exist`);
  }
}

/** GET /api/folders — flat list; the client builds the tree from `parentId`. */
foldersRouter.get("/", async (req, res) => {
  res.status(200).json(await foldersRepo.listFolders(currentUser(req).id));
});

/** POST /api/folders */
foldersRouter.post("/", async (req, res) => {
  const user = currentUser(req);
  const body = folderCreateSchema.parse(req.body);
  await requireParent(user.id, body.parentId);
  const id = randomUUID();
  await foldersRepo.createFolder(user.id, id, body.name, body.parentId);
  const driveWarning = await driveSync.followUp(user.id, () => driveSync.syncFolder(user.id, id));
  res.status(201).location(`/api/folders/${id}`).json({ ...(await foldersRepo.findFolder(user.id, id)), driveWarning });
});

/** PATCH /api/folders/:id — rename and/or move. Moving into itself or a descendant is rejected. */
foldersRouter.patch("/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req);
  const body = folderUpdateSchema.parse(req.body);
  if (!(await foldersRepo.findFolder(user.id, id))) throw notFound(`Folder ${id} not found`);
  if (body.parentId) {
    await requireParent(user.id, body.parentId);
    if (await foldersRepo.wouldCreateCycle(id, body.parentId)) {
      throw badRequest("A folder can't be moved into itself or one of its sub-folders");
    }
  }
  await foldersRepo.updateFolder(user.id, id, body);
  const driveWarning = await driveSync.followUp(user.id, () => driveSync.syncFolder(user.id, id));
  res.status(200).json({ ...(await foldersRepo.findFolder(user.id, id)), driveWarning });
});

/**
 * DELETE /api/folders/:id — contents move up to the parent folder (in Drive too, where the
 * emptied folder goes to the trash). 204, or 200 `{ driveWarning }` if Drive couldn't be updated.
 */
foldersRouter.delete("/:id", async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req);
  const before = await foldersRepo.findFolderForDrive(user.id, id);
  if (!before || !(await foldersRepo.deleteFolder(user.id, id))) throw notFound();
  const driveFolderId = before.driveFolderId;
  const driveWarning = driveFolderId
    ? await driveSync.followUp(user.id, () => driveSync.removeFolder(user.id, driveFolderId, before.parentId))
    : undefined;
  if (driveWarning) res.status(200).json({ driveWarning });
  else res.status(204).end();
});
