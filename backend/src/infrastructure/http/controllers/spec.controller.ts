import { Request, Response } from "express";
import { SpecService } from "../../../application/spec";
import { AnalysisService } from "../../../application/analysis";
import { UserRepository } from "../../../domain/user";
import { configService } from "../../../shared/config/config.service";
import { verifySessionToken } from "../../../shared/auth/session-token";
import { AppError } from "../../../shared/errors/app-error";

interface UploadSpecBody {
  content?: string;
  fileName?: string;
}

const SESSION_COOKIE_NAME = "api_sentinel_session";

export class SpecController {
  constructor(
    private readonly specService: SpecService,
    private readonly analysisService: AnalysisService,
    private readonly userRepository: UserRepository,
  ) {}

  upload = async (
    req: Request<unknown, unknown, UploadSpecBody>,
    res: Response,
  ): Promise<void> => {
    const content = req.body.content;
    const fileName = req.body.fileName;

    if (!content || content.trim().length === 0) {
      res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Spec content is required",
      });
      return;
    }

    const result = await this.specService.uploadSpec({ content, fileName });
    result.match(
      (version) => res.status(201).json({ version }),
      (error: AppError) => {
        if (error.code === "SPEC_PARSE_FAILED") {
          res.status(400).json(error.toJSON());
          return;
        }

        res.status(500).json(error.toJSON());
      },
    );
  };

  listSpecs = async (_req: Request, res: Response): Promise<void> => {
    const result = await this.specService.getSpecs();

    result.match(
      (specs) => res.json({ specs }),
      (error: AppError) => res.status(500).json(error.toJSON()),
    );
  };

  listVersions = async (
    req: Request<{ id: string }>,
    res: Response,
  ): Promise<void> => {
    const result = await this.specService.getVersionsBySpecId(req.params.id);

    result.match(
      (versions) => res.json({ versions }),
      (error: AppError) => res.status(500).json(error.toJSON()),
    );
  };

  listViolations = async (
    req: Request<{ id: string }, unknown, unknown, { repositoryId?: string }>,
    res: Response,
  ): Promise<void> => {
    const repositoryId =
      typeof req.query.repositoryId === "string" &&
      req.query.repositoryId.trim().length > 0
        ? req.query.repositoryId
        : undefined;

    if (!repositoryId) {
      res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "repositoryId query parameter is required",
      });
      return;
    }

    const sessionToken =
      typeof req.cookies[SESSION_COOKIE_NAME] === "string"
        ? req.cookies[SESSION_COOKIE_NAME]
        : undefined;
    const sessionUser =
      sessionToken &&
      verifySessionToken(sessionToken, configService.getSessionSecret());

    if (!sessionUser) {
      res.status(401).json({
        code: "UNAUTHORIZED",
        message: "No active session",
      });
      return;
    }

    const userResult = await this.userRepository.findById(sessionUser.id);
    if (userResult.isErr() || !userResult.value) {
      res.status(401).json({
        code: "UNAUTHORIZED",
        message: "Unable to resolve session user",
      });
      return;
    }

    const githubAccessToken = userResult.value.githubAccessToken || undefined;
    if (!githubAccessToken) {
      res.status(409).json({
        code: "GITHUB_NOT_LINKED",
        message: "Connect GitHub before running spec violations analysis",
      });
      return;
    }

    const result = await this.analysisService.getSpecViolations({
      specId: req.params.id,
      repositoryId,
      githubAccessToken,
    });

    result.match(
      (payload) => res.json(payload),
      (error: AppError) => {
        if (error.code === "SPEC_VERSION_NOT_FOUND") {
          res.status(404).json(error.toJSON());
          return;
        }

        if (
          error.code === "SPEC_VERSION_NOT_ANALYZABLE" ||
          error.code === "REPOSITORY_SNAPSHOT_EMPTY"
        ) {
          res.status(400).json(error.toJSON());
          return;
        }

        if (error.code === "GITHUB_RATE_LIMITED") {
          res.status(429).json(error.toJSON());
          return;
        }

        if (error.code === "GITHUB_AUTH_REQUIRED") {
          res.status(401).json(error.toJSON());
          return;
        }

        if (error.code === "GITHUB_FETCH_FAILED") {
          res.status(502).json(error.toJSON());
          return;
        }

        res.status(500).json(error.toJSON());
      },
    );
  };

  deleteVersion = async (
    req: Request<{ versionId: string }>,
    res: Response,
  ): Promise<void> => {
    const result = await this.specService.deleteVersion(req.params.versionId);

    result.match(
      () => res.status(204).send(),
      (error: AppError) => {
        if (error.code === "SPEC_VERSION_NOT_FOUND") {
          res.status(404).json(error.toJSON());
          return;
        }

        if (error.code === "SPEC_VERSION_IN_USE") {
          res.status(409).json(error.toJSON());
          return;
        }

        res.status(500).json(error.toJSON());
      },
    );
  };
}
