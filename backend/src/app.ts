import express, { Application, Request, Response, NextFunction, Router } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { AppError } from "./shared/errors/app-error";
import { configService } from "./shared/config/config.service";

/**
 * Creates the Express app with the provided routers.
 * This is infrastructure code - Express-specific setup.
 */
export function createApp(
  routers: { path: string; router: Router }[],
  beforeRouters?: (app: Application) => void,
) {
  const app = express();

  app.use(
    cors({
      origin: configService.getFrontendBaseUrl(),
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  // Explicit routes (e.g. /auth/repositories) must be registered on the app
  // before `app.use("/auth", router)` so they always match in all Express versions.
  beforeRouters?.(app);

  // Simple health endpoint for uptime/keep-alive pings.
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, ts: new Date().toISOString() });
  });

  // Mount all routers
  for (const { path, router } of routers) {
    app.use(path, router);
  }

  // Error-handling middleware
  app.use(
    (
      err: AppError | Error,
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      if (err instanceof AppError) {
        console.error(`[${err.code}] ${err.message}`);
        res.status(500).json(err.toJSON());
      } else {
        console.error(err.message);
        res.status(500).json({ code: "UNKNOWN_ERROR", message: err.message });
      }
    },
  );

  return app;
}
