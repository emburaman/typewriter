import { Router, type Request } from "express";
import { documentIdSchema, inviteSchema } from "../../lib/shared/schemas.js";
import { badRequest, HttpError, notFound } from "../errors.js";
import * as usersRepo from "../repositories/usersRepository.js";
import { currentUser } from "../services/auth.js";

/** Account administration (mounted behind requireAuth + requireAdmin). */
export const usersRouter = Router();

const parseId = (req: Request<{ id: string }>) => documentIdSchema.parse(req.params.id);

/** GET /api/users */
usersRouter.get("/", async (_req, res) => {
  res.status(200).json(await usersRepo.listUsers());
});

/** POST /api/users — invite an email address (it can sign in with that Google account). */
usersRouter.post("/", async (req, res) => {
  const { email, role } = inviteSchema.parse(req.body);
  try {
    res.status(201).json(await usersRepo.inviteUser(email, role, currentUser(req).id));
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "ER_DUP_ENTRY") {
      throw new HttpError(409, "already_exists", `${email} already has an account or an invite.`);
    }
    throw err;
  }
});

/** DELETE /api/users/:id — remove an account and all of its writing (Drive copies are kept). */
usersRouter.delete("/:id", async (req, res) => {
  const id = parseId(req);
  if (id === currentUser(req).id) throw badRequest("You can't remove your own account.");
  if (!(await usersRepo.deleteUserAndData(id))) throw notFound("User not found");
  res.status(204).end();
});
