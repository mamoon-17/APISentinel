import { Request, Response } from "express";
import { SpecService } from "../../../application/spec";
import { AnalysisService } from "../../../application/analysis";
import { UserRepository } from "../../../domain/user";
import { configService } from "../../../shared/config/config.service";
import { verifySessionToken } from "../../../shared/auth/session-token";
import { AppError } from "../../../shared/errors/app-error";
import { GithubRepositoryCodeProvider } from "../../analysis/github-repository-code.provider";
import { filterBackendOnlyFiles } from "../../analysis/backend-only-files";

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

  generateFromRepo = async (
    req: Request<unknown, unknown, unknown, { repositoryId?: string }>,
    res: Response,
  ): Promise<void> => {
    const repositoryId =
      typeof req.query.repositoryId === "string" && req.query.repositoryId.trim().length > 0
        ? req.query.repositoryId
        : undefined;

    if (!repositoryId) {
      res.status(400).json({ code: "VALIDATION_ERROR", message: "repositoryId query parameter is required" });
      return;
    }

    const sessionToken =
      typeof req.cookies[SESSION_COOKIE_NAME] === "string"
        ? req.cookies[SESSION_COOKIE_NAME]
        : undefined;
    const sessionUser =
      sessionToken && verifySessionToken(sessionToken, configService.getSessionSecret());

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
      res.status(409).json({ code: "GITHUB_NOT_LINKED", message: "Connect GitHub before generating a spec" });
      return;
    }

    // Fetch repo files
    const codeProvider = new GithubRepositoryCodeProvider();
    const filesResult = await codeProvider.fetchFiles(repositoryId, githubAccessToken);
    if (filesResult.isErr()) {
      const error = filesResult.error;
      const statusMap: Record<string, number> = { GITHUB_RATE_LIMITED: 429, GITHUB_AUTH_REQUIRED: 401, GITHUB_FETCH_FAILED: 502 };
      res.status(statusMap[error.code] ?? 500).json(error.toJSON());
      return;
    }

    // Extract repo name from first file path or fall back to repo ID
    const repoName = filesResult.value[0]?.path.split("/")[0] ?? `repo-${repositoryId}`;

    const result = await this.specService.generateFromRepository({
      files: filesResult.value,
      repoName,
    });

    result.match(
      (payload) => res.json(payload),
      (error: AppError) => res.status(500).json(error.toJSON()),
    );
  };

  listLlmViolations = async (
    req: Request<{ id: string }, unknown, unknown, { repositoryId?: string }>,
    res: Response,
  ): Promise<void> => {
    const repositoryId =
      typeof req.query.repositoryId === "string" && req.query.repositoryId.trim().length > 0
        ? req.query.repositoryId
        : undefined;

    if (!repositoryId) {
      res.status(400).json({ code: "VALIDATION_ERROR", message: "repositoryId query parameter is required" });
      return;
    }

    const sessionToken =
      typeof req.cookies[SESSION_COOKIE_NAME] === "string"
        ? req.cookies[SESSION_COOKIE_NAME]
        : undefined;
    const sessionUser =
      sessionToken && verifySessionToken(sessionToken, configService.getSessionSecret());

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
      res.status(409).json({ code: "GITHUB_NOT_LINKED", message: "Connect GitHub before running LLM analysis" });
      return;
    }

    // Fetch repo files directly using the GitHub code provider
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

    const result = await this.analysisService.getLlmSchemaViolations({
      specId: req.params.id,
      repositoryId,
      files: filterBackendOnlyFiles(filesResult.value),
      githubToken: githubAccessToken,
    });

    result.match(
      (payload) => res.json(payload),
      (error: AppError) => {
        const statusMap: Record<string, number> = {
          SPEC_VERSION_NOT_FOUND: 404,
          GITHUB_RATE_LIMITED: 429,
          GITHUB_AUTH_REQUIRED: 401,
          GITHUB_FETCH_FAILED: 502,
        };
        res.status(statusMap[error.code] ?? 500).json(error.toJSON());
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
