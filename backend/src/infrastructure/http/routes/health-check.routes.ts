import { Router } from "express";
import { HealthCheckController } from "../controllers/health-check.controller";

export function createHealthCheckRouter(
  healthCheckController: HealthCheckController,
): Router {
  const router = Router();

  router.post("/jobs", healthCheckController.createJob);
  router.get("/jobs/:jobId", healthCheckController.getJobStatus);
  router.post("/jobs/:jobId/retry", healthCheckController.retryJob);
  router.post(
    "/repositories/:repositoryId/spec-link",
    healthCheckController.linkSpec,
  );
  router.get(
    "/repositories/:repositoryId/state",
    healthCheckController.getRepositoryState,
  );

  return router;
}
