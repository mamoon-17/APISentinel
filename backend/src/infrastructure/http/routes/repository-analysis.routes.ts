import { Router } from "express";
import { RepositoryAnalysisController } from "../controllers/repository-analysis.controller";

export function createRepositoryAnalysisRouter(
  repositoryAnalysisController: RepositoryAnalysisController,
): Router {
  const router = Router();

  router.get(
    "/:id/inconsistencies",
    repositoryAnalysisController.getInconsistencies,
  );

  return router;
}
