import { Router } from "express";
import { RepositoryAnalysisController } from "../controllers/repository-analysis.controller";
import { RepoLinkController } from "../controllers/repo-link.controller";

export function createRepositoryAnalysisRouter(
  repositoryAnalysisController: RepositoryAnalysisController,
  repoLinkController: RepoLinkController,
): Router {
  const router = Router();

  router.get("/:id/inconsistencies", repositoryAnalysisController.getInconsistencies);

  // Spec linking
  router.get("/:id/spec-links", repoLinkController.getLinks);
  router.post("/:id/spec-links", repoLinkController.linkSpec);
  router.delete("/:id/spec-links/:specId", repoLinkController.unlinkSpec);

  // Auto-detect spec in repo
  router.get("/:id/detect-spec", repoLinkController.detectSpec);

  return router;
}
