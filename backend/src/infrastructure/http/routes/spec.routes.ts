import { Router } from "express";
import { SpecController } from "../controllers/spec.controller";

export function createSpecRouter(specController: SpecController): Router {
  const router = Router();

  router.post("/upload", specController.upload);
  router.get("/", specController.listSpecs);
  router.get("/:id/violations", specController.listViolations);
  router.get("/:id/versions", specController.listVersions);
  router.delete("/versions/:versionId", specController.deleteVersion);

  return router;
}
