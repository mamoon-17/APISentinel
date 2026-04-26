import { Request, Response } from "express";
import { RepoLinkService } from "../../../application/spec/repo-link.service";
import { UserRepository } from "../../../domain/user";
import { configService } from "../../../shared/config/config.service";
import { verifySessionToken } from "../../../shared/auth/session-token";
import { AppError } from "../../../shared/errors/app-error";
const SESSION_COOKIE_NAME = "api_sentinel_session";

export class RepoLinkController {
  constructor(
    private readonly repoLinkService: RepoLinkService,
    private readonly userRepository: UserRepository,
  ) {}

  private async resolveSession(req: Request): Promise<{ githubAccessToken?: string } | null> {
    const sessionToken =
      typeof req.cookies[SESSION_COOKIE_NAME] === "string"
        ? req.cookies[SESSION_COOKIE_NAME]
        : undefined;
    const sessionUser =
      sessionToken && verifySessionToken(sessionToken, configService.getSessionSecret());
    if (!sessionUser) return null;

    const userResult = await this.userRepository.findById(sessionUser.id);
    if (userResult.isErr() || !userResult.value) return null;

    return { githubAccessToken: userResult.value.githubAccessToken || undefined };
  }

  /** POST /repositories/:id/spec-links  body: { specId } */
  linkSpec = async (
    req: Request<{ id: string }, unknown, { specId?: string }>,
    res: Response,
  ): Promise<void> => {
    const session = await this.resolveSession(req);
    if (!session) { res.status(401).json({ code: "UNAUTHORIZED", message: "No active session" }); return; }

    const specId = req.body.specId;
    if (!specId) { res.status(400).json({ code: "VALIDATION_ERROR", message: "specId is required" }); return; }

    const result = await this.repoLinkService.linkSpec({
      repositoryId: req.params.id,
      specId,
      githubAccessToken: session.githubAccessToken,
    });

    result.match(
      (link) => res.status(201).json(link),
      (error: AppError) => {
        if (error.code === "SPEC_VERSION_NOT_FOUND") { res.status(404).json(error.toJSON()); return; }
        res.status(500).json(error.toJSON());
      },
    );
  };

  /** DELETE /repositories/:id/spec-links/:specId */
  unlinkSpec = async (
    req: Request<{ id: string; specId: string }>,
    res: Response,
  ): Promise<void> => {
    const session = await this.resolveSession(req);
    if (!session) { res.status(401).json({ code: "UNAUTHORIZED", message: "No active session" }); return; }

    const result = await this.repoLinkService.unlinkSpec({
      repositoryId: req.params.id,
      specId: req.params.specId,
    });

    result.match(
      () => res.status(204).send(),
      (error: AppError) => {
        if (error.code === "SPEC_VERSION_NOT_FOUND") { res.status(404).json(error.toJSON()); return; }
        res.status(500).json(error.toJSON());
      },
    );
  };

  /** GET /repositories/:id/spec-links */
  getLinks = async (
    req: Request<{ id: string }>,
    res: Response,
  ): Promise<void> => {
    const session = await this.resolveSession(req);
    if (!session) { res.status(401).json({ code: "UNAUTHORIZED", message: "No active session" }); return; }

    const result = await this.repoLinkService.getLinksForRepository(req.params.id);

    result.match(
      (links) => res.json(links),
      (error: AppError) => res.status(500).json(error.toJSON()),
    );
  };

  /** GET /repositories/:id/detect-spec */
  detectSpec = async (
    req: Request<{ id: string }>,
    res: Response,
  ): Promise<void> => {
    const session = await this.resolveSession(req);
    if (!session) { res.status(401).json({ code: "UNAUTHORIZED", message: "No active session" }); return; }

    if (!session.githubAccessToken) {
      res.status(409).json({ code: "GITHUB_NOT_LINKED", message: "Connect GitHub before detecting a spec" });
      return;
    }

    const result = await this.repoLinkService.detectSpecInRepo({
      repositoryId: req.params.id,
      githubAccessToken: session.githubAccessToken,
    });

    result.match(
      (detected) => res.json(detected),
      (error: AppError) => {
        if (error.code === "SPEC_VERSION_NOT_FOUND") { res.status(404).json(error.toJSON()); return; }
        if (error.code === "GITHUB_RATE_LIMITED") { res.status(429).json(error.toJSON()); return; }
        if (error.code === "GITHUB_AUTH_REQUIRED") { res.status(401).json(error.toJSON()); return; }
        res.status(500).json(error.toJSON());
      },
    );
  };

  /** GET /repositories/:id/detect-frontend */
  detectFrontend = async (
    req: Request<{ id: string }>,
    res: Response,
  ): Promise<void> => {
    const session = await this.resolveSession(req);
    if (!session) {
      res.status(401).json({ code: "UNAUTHORIZED", message: "No active session" });
      return;
    }

    if (!session.githubAccessToken) {
      res.status(409).json({
        code: "GITHUB_NOT_LINKED",
        message: "Connect GitHub before detecting frontend",
      });
      return;
    }

    const result = await this.repoLinkService.detectFrontendInRepo({
      repositoryId: req.params.id,
      githubAccessToken: session.githubAccessToken,
    });

    result.match(
      (detected) => res.json(detected),
      (error: AppError) => {
        if (error.code === "GITHUB_RATE_LIMITED") {
          res.status(429).json(error.toJSON());
          return;
        }
        if (error.code === "GITHUB_AUTH_REQUIRED") {
          res.status(401).json(error.toJSON());
          return;
        }
        res.status(500).json(error.toJSON());
      },
    );
  };
}
