import { Router } from "express";
import { MetricsController } from "../controllers/metrics.controller";

export function createMetricsRouter(
    metricsController: MetricsController,
): Router {
    const router = Router();

    router.get("/dashboard/stats", metricsController.getDashboardStats);
    router.get("/request-logs", metricsController.listRequestLogs);
    router.post("/request-logs", metricsController.createRequestLog);

    return router;
}
