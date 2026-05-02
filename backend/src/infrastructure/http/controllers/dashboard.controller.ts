import { Request, Response } from "express";
import { configService } from "../../../shared/config/config.service";
import {
  AuthUser,
  verifySessionToken,
} from "../../../shared/auth/session-token";
import { DashboardService } from "../../../application/dashboard";

const SESSION_COOKIE_NAME = "api_sentinel_session";

/**
 * HTTP adapter — Dashboard endpoints.
 *
 * Translates HTTP requests into application-service calls and formats
 * the result as JSON responses. All business logic stays in the service.
 */
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  getStats = async (_req: Request, res: Response): Promise<void> => {
    const sessionUser = this.readSessionUser(_req);
    if (!sessionUser) {
      res.status(401).json({ code: "UNAUTHORIZED", message: "No session" });
      return;
    }

    const stats = this.dashboardService.getStats(sessionUser.id);
    res.json(stats);
  };

  getRequestLogs = async (req: Request, res: Response): Promise<void> => {
    const sessionUser = this.readSessionUser(req);
    if (!sessionUser) {
      res.status(401).json({ code: "UNAUTHORIZED", message: "No session" });
      return;
    }

    const limitParam = req.query.limit;
    const limit =
      typeof limitParam === "string" ? parseInt(limitParam, 10) || 20 : 20;

    const logs = this.dashboardService.getRequestLogs(
      sessionUser.id,
      Math.min(limit, 100),
    );
    res.json(logs);
  };

  private readSessionUser(req: Request): AuthUser | null {
    const token =
      typeof req.cookies[SESSION_COOKIE_NAME] === "string"
        ? req.cookies[SESSION_COOKIE_NAME]
        : undefined;
    if (!token) {
      return null;
    }
    return verifySessionToken(token, configService.getSessionSecret());
  }
}
