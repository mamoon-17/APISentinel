import express, { Request, Response, NextFunction, Router } from "express";
import cookieParser from "cookie-parser";
import { AppError } from "./shared/errors/app-error";

/**
 * Creates the Express app with the provided routers.
 * This is infrastructure code - Express-specific setup.
 */
export function createApp(routers: { path: string; router: Router }[]) {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());

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
