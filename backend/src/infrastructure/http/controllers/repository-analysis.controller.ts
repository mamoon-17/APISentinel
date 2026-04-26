import { Request, Response } from "express";
import { AnalysisService } from "../../../application/analysis";
import { UserRepository } from "../../../domain/user";
import { configService } from "../../../shared/config/config.service";
import { verifySessionToken } from "../../../shared/auth/session-token";
import { AppError } from "../../../shared/errors/app-error";
import { GithubRepositoryCodeProvider } from "../../analysis/github-repository-code.provider";

const SESSION_COOKIE_NAME = "api_sentinel_session";

export class RepositoryAnalysisController {
  constructor(
    private readonly analysisService: AnalysisService,
    private readonly userRepository: UserRepository,
  ) {}

  getInconsistencies = async (
    req: Request<{ id: string }, unknown, unknown, { specId?: string }>,
    res: Response,
  ): Promise<void> => {
    const repositoryId = req.params.id;
    const specId =
      typeof req.query.specId === "string" && req.query.specId.length > 0
        ? req.query.specId
        : undefined;

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
        message: "Connect GitHub before running repository analysis",
      });
      return;
    }

    const result = await this.analysisService.getRepositoryInconsistencies({
      repositoryId,
      specId,
      githubAccessToken,
    });

    result.match(
      (payload) => res.json(payload),
      (error: AppError) => {
        if (
          error.code === "REPOSITORY_SNAPSHOT_NOT_FOUND" ||
          error.code === "SPEC_VERSION_NOT_FOUND"
        ) {
          res.status(404).json(error.toJSON());
          return;
        }

        if (error.code === "SPEC_VERSION_NOT_ANALYZABLE") {
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

        if (error.code === "SPEC_SELECTION_REQUIRED") {
          res.status(400).json(error.toJSON());
          return;
        }

        if (error.code === "REPOSITORY_SNAPSHOT_EMPTY") {
          res.status(400).json(error.toJSON());
          return;
        }

        res.status(500).json(error.toJSON());
      },
    );
  };

  getLlmFrontendBackendViolations = async (
    req: Request<{ id: string }>,
    res: Response,
  ): Promise<void> => {
    const repositoryId = req.params.id;

    const sessionToken =
      typeof req.cookies[SESSION_COOKIE_NAME] === "string"
        ? req.cookies[SESSION_COOKIE_NAME]
        : undefined;
    const sessionUser =
      sessionToken &&
      verifySessionToken(sessionToken, configService.getSessionSecret());

    if (!sessionUser) {
      res.status(401).json({ code: "UNAUTHORIZED", message: "No active session" });
      return;
    }

    const userResult = await this.userRepository.findById(sessionUser.id);
    if (userResult.isErr() || !userResult.value) {
      res.status(401).json({ code: "UNAUTHORIZED", message: "Unable to resolve session user" });
      return;
    }

    const githubAccessToken = userResult.value.githubAccessToken || undefined;
    if (!githubAccessToken) {
      res.status(409).json({
        code: "GITHUB_NOT_LINKED",
        message: "Connect GitHub before running AI analysis",
      });
      return;
    }

    // Fetch repo files for the LLM to inspect.
    const codeProvider = new GithubRepositoryCodeProvider();
    const filesResult = await codeProvider.fetchFiles(repositoryId, githubAccessToken);
    if (filesResult.isErr()) {
      const error = filesResult.error;
      const statusMap: Record<string, number> = {
        GITHUB_RATE_LIMITED: 429,
        GITHUB_AUTH_REQUIRED: 401,
        GITHUB_FETCH_FAILED: 502,
      };
      res.status(statusMap[error.code] ?? 500).json(error.toJSON());
      return;
    }

    const result = await this.analysisService.getLlmFrontendBackendViolations({
      repositoryId,
      files: filesResult.value,
      githubToken: githubAccessToken,
    });

    result.match(
      (payload) => res.json(payload),
      (error: AppError) => {
        const statusMap: Record<string, number> = {
          REPOSITORY_SNAPSHOT_NOT_FOUND: 404,
          REPOSITORY_SNAPSHOT_EMPTY: 400,
          GITHUB_RATE_LIMITED: 429,
          GITHUB_AUTH_REQUIRED: 401,
          GITHUB_FETCH_FAILED: 502,
        };
        res.status(statusMap[error.code] ?? 500).json(error.toJSON());
      },
    );
  };
}
