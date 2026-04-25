import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";

export function createAuthRouter(authController: AuthController): Router {
  const router = Router();

  router.get("/github/login", authController.startGithubAuth);
  router.get("/github/callback", authController.githubCallback);
  router.get("/google/login", authController.startGoogleAuth);
  router.get("/google/callback", authController.googleCallback);
  router.post("/local/signup", authController.localSignup);
  router.post("/local/login", authController.localLogin);
  router.post("/local/set-password", authController.setLocalPassword);
  router.get("/me", authController.getSession);
  router.post("/logout", authController.logout);

  return router;
}
