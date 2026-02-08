import { Router } from "express";
import { UserController } from "../controllers/user.controller";

/**
 * Creates user routes with the provided controller.
 * Routes are wired up during bootstrap.
 */
export function createUserRouter(userController: UserController): Router {
  const router = Router();

  router.get("/", userController.getAllUsers);
  router.get("/:id", userController.getUserById);
  router.post("/", userController.createUser);
  router.delete("/:id", userController.deleteUser);

  return router;
}
