import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { documentIdSchema, folderCreateSchema, folderUpdateSchema } from "../../lib/shared/schemas.js";
import { badRequest, notFound } from "../errors.js";
import * as foldersRepo from "../repositories/foldersRepository.js";

export const foldersRouter = Router();

const parseId = (req: Request<{ id: string }>) => documentIdSchema.parse(req.params.id);

async function requireParent(parentId: string | null): Promise<void> {
  if (parentId && !(await foldersRepo.findFolder(parentId))) {
    throw badRequest(`Parent folder ${parentId} does not exist`);
  }
}

/** GET /api/folders — flat list; the client builds the tree from `parentId`. */
foldersRouter.get("/", async (_req, res) => {
  res.status(200).json(await foldersRepo.listFolders());
});

/** POST /api/folders */
foldersRouter.post("/", async (req, res) => {
  const body = folderCreateSchema.parse(req.body);
  await requireParent(body.parentId);
  const id = randomUUID();
  await foldersRepo.createFolder(id, body.name, body.parentId);
  res.status(201).location(`/api/folders/${id}`).json(await foldersRepo.findFolder(id));
});

/** PATCH /api/folders/:id — rename and/or move. Moving into itself or a descendant is rejected. */
foldersRouter.patch("/:id", async (req, res) => {
  const id = parseId(req);
  const body = folderUpdateSchema.parse(req.body);
  if (!(await foldersRepo.findFolder(id))) throw notFound(`Folder ${id} not found`);
  if (body.parentId) {
    await requireParent(body.parentId);
    if (await foldersRepo.wouldCreateCycle(id, body.parentId)) {
      throw badRequest("A folder can't be moved into itself or one of its sub-folders");
    }
  }
  await foldersRepo.updateFolder(id, body);
  res.status(200).json(await foldersRepo.findFolder(id));
});

/** DELETE /api/folders/:id — contents move up to the parent folder. */
foldersRouter.delete("/:id", async (req, res) => {
  if (!(await foldersRepo.deleteFolder(parseId(req)))) throw notFound();
  res.status(204).end();
});
