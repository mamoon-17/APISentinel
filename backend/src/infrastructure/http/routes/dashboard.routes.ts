import { Router } from "express";
import { DashboardController } from "../controllers/dashboard.controller";

export function createDashboardRouter(
  dashboardController: DashboardController,
): Router {
  const router = Router();

  router.get("/stats", dashboardController.getStats);
  router.get("/request-logs", dashboardController.getRequestLogs);

  return router;
}
