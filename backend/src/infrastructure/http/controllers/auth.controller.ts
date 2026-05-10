import crypto from "crypto";
import { Request, Response } from "express";
import { configService } from "../../../shared/config/config.service";
import {
  AuthProvider,
  AuthUser,
  createSessionToken,
  verifySessionToken,
} from "../../../shared/auth/session-token";
import { hashPassword, verifyPassword } from "../../../shared/auth/password";
import { User, UserRepository } from "../../../domain/user";
import { TypeOrmUserLinkedPublicRepoRepository } from "../../persistence/typeorm/repositories/user-linked-public-repo.repository.impl";

interface GithubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GithubUserResponse {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}

interface GithubEmailResponse {
  email: string;
  verified: boolean;
  primary: boolean;
}

interface GithubRepoApiResponse {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  stargazers_count: number;
  updated_at: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserResponse {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

interface LocalSignupBody {
  email?: string;
  password?: string;
  name?: string;
}

interface LocalLoginBody {
  email?: string;
  password?: string;
}

interface RepoByUrlBody {
  url?: string;
}

interface SetLocalPasswordBody {
  password?: string;
  currentPassword?: string;
}

const GITHUB_STATE_COOKIE_NAME = "github_oauth_state";
const GOOGLE_STATE_COOKIE_NAME = "google_oauth_state";
const SESSION_COOKIE_NAME = "api_sentinel_session";
const STATE_MAX_AGE_MS = 10 * 60 * 1000;
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const GITHUB_REPO_CACHE_TTL_MS = 30 * 1000;

interface CachedGithubRepo {
  id: string;
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  isPrivate: boolean;
  isFork: boolean;
  stars: number;
  updatedAt: string;
}

const githubReposCache = new Map<
  string,
  { fetchedAt: number; repos: CachedGithubRepo[] }
>();



function buildFrontendUrl(path: string, query?: string): string {
  const base = configService.getFrontendBaseUrl();
  return `${base}${path}${query ? `?${query}` : ""}`;
}

export class AuthController {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly linkedPublicRepoRepository: TypeOrmUserLinkedPublicRepoRepository,
  ) {}

  startGithubAuth = (req: Request, res: Response): void => {
    const mode = req.query.mode === "link" ? "link" : "login";
    let linkUserId: string | null = null;

    if (mode === "link") {
      const token =
        typeof req.cookies[SESSION_COOKIE_NAME] === "string"
          ? req.cookies[SESSION_COOKIE_NAME]
          : undefined;
      const sessionUser =
        token && verifySessionToken(token, configService.getSessionSecret());

      if (!sessionUser) {
        res.redirect(buildFrontendUrl("/", "oauth=failed"));
        return;
      }

      linkUserId = sessionUser.id;
    }

    const state = crypto.randomBytes(24).toString("hex");
    const statePayload = JSON.stringify({
      nonce: state,
      mode,
      linkUserId,
    });

    const params = new URLSearchParams({
      client_id: configService.getGithubClientId(),
      redirect_uri: configService.getGithubCallbackUrl(),
      scope: "read:user user:email repo",
      state: Buffer.from(statePayload, "utf8").toString("base64url"),
    });

    res.cookie(GITHUB_STATE_COOKIE_NAME, statePayload, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: STATE_MAX_AGE_MS,
      path: "/",
    });

    res.redirect(
      `https://github.com/login/oauth/authorize?${params.toString()}`,
    );
  };

  startGoogleAuth = (_req: Request, res: Response): void => {
    if (!configService.isGoogleOAuthConfigured()) {
      res.redirect(buildFrontendUrl("/", "oauth=failed"));
      return;
    }

    const state = crypto.randomBytes(24).toString("hex");

    const params = new URLSearchParams({
      client_id: configService.getGoogleClientId(),
      redirect_uri: configService.getGoogleCallbackUrl(),
      response_type: "code",
      scope: "openid email profile",
      state,
    });

    res.cookie(GOOGLE_STATE_COOKIE_NAME, state, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: STATE_MAX_AGE_MS,
      path: "/",
    });

    res.redirect(
      `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    );
  };

  githubCallback = async (req: Request, res: Response): Promise<void> => {
    const code =
      typeof req.query.code === "string" ? req.query.code : undefined;
    const state =
      typeof req.query.state === "string" ? req.query.state : undefined;
    const stateCookie =
      typeof req.cookies[GITHUB_STATE_COOKIE_NAME] === "string"
        ? req.cookies[GITHUB_STATE_COOKIE_NAME]
        : undefined;

    res.clearCookie(GITHUB_STATE_COOKIE_NAME, { path: "/" });

    if (!code || !state || !stateCookie) {
      res.redirect(buildFrontendUrl("/", "oauth=failed"));
      return;
    }

    try {
      const decodedState = JSON.parse(
        Buffer.from(state, "base64url").toString("utf8"),
      ) as {
        nonce?: string;
        mode?: "login" | "link";
        linkUserId?: string | null;
      };
      const cookieState = JSON.parse(stateCookie) as {
        nonce?: string;
        mode?: "login" | "link";
        linkUserId?: string | null;
      };

      if (
        !decodedState.nonce ||
        decodedState.nonce !== cookieState.nonce ||
        decodedState.mode !== cookieState.mode
      ) {
        res.redirect(buildFrontendUrl("/", "oauth=failed"));
        return;
      }

      const accessToken = await this.exchangeCodeForAccessToken(code);
      const githubUser = await this.fetchGithubUser(accessToken);
      const githubId = String(githubUser.id);

      if (decodedState.mode === "link") {
        if (!decodedState.linkUserId) {
          res.redirect(buildFrontendUrl("/dashboard", "github=link_failed"));
          return;
        }

        const token =
          typeof req.cookies[SESSION_COOKIE_NAME] === "string"
            ? req.cookies[SESSION_COOKIE_NAME]
            : undefined;
        const sessionUser =
          token && verifySessionToken(token, configService.getSessionSecret());

        if (!sessionUser || sessionUser.id !== decodedState.linkUserId) {
          res.redirect(buildFrontendUrl("/dashboard", "github=link_failed"));
          return;
        }

        const conflictUser = await this.userRepository
          .findByGithubId(githubId)
          .mapErr(() => null);
        if (
          conflictUser.isErr() ||
          (conflictUser.value && conflictUser.value.id !== sessionUser.id)
        ) {
          res.redirect(buildFrontendUrl("/dashboard", "github=already_linked"));
          return;
        }

        const userToLink = await this.userRepository
          .findById(sessionUser.id)
          .mapErr(() => null);
        if (userToLink.isErr() || !userToLink.value) {
          res.redirect(buildFrontendUrl("/dashboard", "github=link_failed"));
          return;
        }

        const linked = await this.userRepository
          .save(
            new User(
              userToLink.value.id,
              userToLink.value.username,
              userToLink.value.password,
              userToLink.value.email,
              userToLink.value.googleId,
              githubId,
              githubUser.login,
              accessToken,
              githubUser.name ?? userToLink.value.name,
              githubUser.avatar_url ?? userToLink.value.avatarUrl,
            ),
          )
          .mapErr(() => null);

        if (linked.isErr()) {
          res.redirect(buildFrontendUrl("/dashboard", "github=link_failed"));
          return;
        }

        const provider =
          sessionUser.authProvider ?? this.inferAuthProvider(linked.value);
        this.setSessionCookie(res, this.toAuthUser(linked.value, provider));
        res.redirect(buildFrontendUrl("/dashboard", "github=linked"));
        return;
      }

      let linkedUser = await this.userRepository
        .findByGithubId(githubId)
        .mapErr(() => null);
      if (linkedUser.isErr()) {
        res.redirect(buildFrontendUrl("/", "oauth=failed"));
        return;
      }

      if (!linkedUser.value) {
        const verifiedEmail = await this.fetchGithubVerifiedEmail(accessToken);
        if (!verifiedEmail) {
          res.redirect(buildFrontendUrl("/", "oauth=github_email_required"));
          return;
        }

        const normalizedEmail = normalizeEmail(verifiedEmail);
        if (!normalizedEmail) {
          res.redirect(buildFrontendUrl("/", "oauth=github_email_required"));
          return;
        }

        const byEmail = await this.userRepository
          .findByEmail(normalizedEmail)
          .mapErr(() => null);
        if (byEmail.isErr()) {
          res.redirect(buildFrontendUrl("/", "oauth=failed"));
          return;
        }

        if (byEmail.value) {
          if (byEmail.value.githubId && byEmail.value.githubId !== githubId) {
            res.redirect(buildFrontendUrl("/", "oauth=failed"));
            return;
          }

          linkedUser = await this.userRepository
            .save(
              new User(
                byEmail.value.id,
                byEmail.value.username,
                byEmail.value.password,
                normalizedEmail,
                byEmail.value.googleId,
                githubId,
                githubUser.login,
                accessToken,
                githubUser.name ?? byEmail.value.name,
                githubUser.avatar_url ?? byEmail.value.avatarUrl,
              ),
            )
            .mapErr(() => null);
        } else {
          linkedUser = await this.userRepository
            .save(
              User.create(
                normalizedEmail,
                "",
                normalizedEmail,
                null,
                githubId,
                githubUser.login,
                accessToken,
                githubUser.name ?? null,
                githubUser.avatar_url ?? null,
              ),
            )
            .mapErr(() => null);
        }

        if (linkedUser.isErr() || !linkedUser.value) {
          res.redirect(buildFrontendUrl("/", "oauth=failed"));
          return;
        }
      } else {
        linkedUser = await this.userRepository
          .save(
            new User(
              linkedUser.value.id,
              linkedUser.value.username,
              linkedUser.value.password,
              linkedUser.value.email,
              linkedUser.value.googleId,
              githubId,
              githubUser.login,
              accessToken,
              githubUser.name ?? linkedUser.value.name,
              githubUser.avatar_url ?? linkedUser.value.avatarUrl,
            ),
          )
          .mapErr(() => null);

        if (linkedUser.isErr() || !linkedUser.value) {
          res.redirect(buildFrontendUrl("/", "oauth=failed"));
          return;
        }
      }

      this.setSessionCookie(res, this.toAuthUser(linkedUser.value, "github"));
      res.redirect(buildFrontendUrl("/dashboard"));
    } catch {
      res.redirect(buildFrontendUrl("/", "oauth=failed"));
    }
  };

  googleCallback = async (req: Request, res: Response): Promise<void> => {
    const code =
      typeof req.query.code === "string" ? req.query.code : undefined;
    const state =
      typeof req.query.state === "string" ? req.query.state : undefined;
    const stateCookie =
      typeof req.cookies[GOOGLE_STATE_COOKIE_NAME] === "string"
        ? req.cookies[GOOGLE_STATE_COOKIE_NAME]
        : undefined;

    res.clearCookie(GOOGLE_STATE_COOKIE_NAME, { path: "/" });

    if (
      !configService.isGoogleOAuthConfigured() ||
      !code ||
      !state ||
      !stateCookie ||
      state !== stateCookie
    ) {
      res.redirect(buildFrontendUrl("/", "oauth=failed"));
      return;
    }

    try {
      const accessToken = await this.exchangeGoogleCodeForAccessToken(code);
      const googleUser = await this.fetchGoogleUser(accessToken);

      const normalizedEmail = normalizeEmail(googleUser.email);
      if (!normalizedEmail || googleUser.email_verified !== true) {
        res.redirect(buildFrontendUrl("/", "oauth=failed"));
        return;
      }

      let linkedUser = await this.userRepository
        .findByGoogleId(googleUser.sub)
        .mapErr(() => null);
      if (linkedUser.isErr()) {
        res.redirect(buildFrontendUrl("/", "oauth=failed"));
        return;
      }

      if (!linkedUser.value) {
        const byEmail = await this.userRepository
          .findByEmail(normalizedEmail)
          .mapErr(() => null);
        if (byEmail.isErr()) {
          res.redirect(buildFrontendUrl("/", "oauth=failed"));
          return;
        }

        if (byEmail.value) {
          if (
            byEmail.value.googleId &&
            byEmail.value.googleId !== googleUser.sub
          ) {
            res.redirect(buildFrontendUrl("/", "oauth=failed"));
            return;
          }

          linkedUser = await this.userRepository
            .save(
              new User(
                byEmail.value.id,
                byEmail.value.username,
                byEmail.value.password,
                normalizedEmail,
                googleUser.sub,
                byEmail.value.githubId,
                byEmail.value.githubLogin,
                byEmail.value.githubAccessToken,
                googleUser.name ?? byEmail.value.name,
                googleUser.picture ?? byEmail.value.avatarUrl,
              ),
            )
            .mapErr(() => null);

          if (linkedUser.isErr()) {
            res.redirect(buildFrontendUrl("/", "oauth=failed"));
            return;
          }
        } else {
          linkedUser = await this.userRepository
            .save(
              User.create(
                normalizedEmail,
                "",
                normalizedEmail,
                googleUser.sub,
                null,
                null,
                null,
                googleUser.name ?? null,
                googleUser.picture ?? null,
              ),
            )
            .mapErr(() => null);

          if (linkedUser.isErr()) {
            res.redirect(buildFrontendUrl("/", "oauth=failed"));
            return;
          }
        }
      }

      if (!linkedUser.value) {
        res.redirect(buildFrontendUrl("/", "oauth=failed"));
        return;
      }

      this.setSessionCookie(res, this.toAuthUser(linkedUser.value, "google"));

      res.redirect(buildFrontendUrl("/dashboard"));
    } catch {
      res.redirect(buildFrontendUrl("/", "oauth=failed"));
    }
  };

  localSignup = async (
    req: Request<unknown, unknown, LocalSignupBody>,
    res: Response,
  ): Promise<void> => {
    const normalizedEmail = normalizeEmail(req.body.email);
    const password = req.body.password;
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";

    if (!normalizedEmail || !password || password.length < 8) {
      res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Valid email and password (min 8 chars) are required",
      });
      return;
    }

    const existingUserResult = await this.userRepository
      .findByEmail(normalizedEmail)
      .mapErr(() => null);

    if (existingUserResult.isErr()) {
      res
        .status(500)
        .json({ code: "SIGNUP_FAILED", message: "Unable to sign up" });
      return;
    }

    if (existingUserResult.value) {
      res.status(409).json({
        code: "EMAIL_IN_USE",
        message: "An account with this email already exists",
      });
      return;
    }

    const newUser = User.create(
      normalizedEmail,
      hashPassword(password),
      normalizedEmail,
      null,
      null,
      null,
      null,
      name || null,
      null,
    );

    const savedUserResult = await this.userRepository
      .save(newUser)
      .mapErr(() => null);
    if (savedUserResult.isErr()) {
      res
        .status(500)
        .json({ code: "SIGNUP_FAILED", message: "Unable to sign up" });
      return;
    }

    this.setSessionCookie(res, this.toAuthUser(savedUserResult.value, "local"));
    res
      .status(201)
      .json({ user: this.toAuthUser(savedUserResult.value, "local") });
  };

  localLogin = async (
    req: Request<unknown, unknown, LocalLoginBody>,
    res: Response,
  ): Promise<void> => {
    const normalizedEmail = normalizeEmail(req.body.email);
    const password = req.body.password;

    if (!normalizedEmail || !password) {
      res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Email and password are required",
      });
      return;
    }

    const userResult = await this.userRepository
      .findAllByEmail(normalizedEmail)
      .mapErr(() => null);
    if (userResult.isErr()) {
      res
        .status(500)
        .json({ code: "LOGIN_FAILED", message: "Unable to login" });
      return;
    }

    const matchedUser = userResult.value.find(
      (user) => user.password && verifyPassword(password, user.password),
    );

    if (!matchedUser) {
      res
        .status(401)
        .json({ code: "UNAUTHORIZED", message: "Invalid credentials" });
      return;
    }

    this.setSessionCookie(res, this.toAuthUser(matchedUser, "local"));
    res.json({ user: this.toAuthUser(matchedUser, "local") });
  };

  setLocalPassword = async (
    req: Request<unknown, unknown, SetLocalPasswordBody>,
    res: Response,
  ): Promise<void> => {
    const token =
      typeof req.cookies[SESSION_COOKIE_NAME] === "string"
        ? req.cookies[SESSION_COOKIE_NAME]
        : undefined;
    const sessionUser = token
      ? verifySessionToken(token, configService.getSessionSecret())
      : null;

    if (!sessionUser) {
      res
        .status(401)
        .json({ code: "UNAUTHORIZED", message: "No active session" });
      return;
    }

    const password = req.body.password;
    const currentPassword = req.body.currentPassword;

    if (!password || password.length < 8) {
      res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Password must be at least 8 characters",
      });
      return;
    }

    const existingUserResult = await this.userRepository
      .findById(sessionUser.id)
      .mapErr(() => null);

    if (existingUserResult.isErr()) {
      res.status(500).json({
        code: "SET_PASSWORD_FAILED",
        message: "Unable to set password",
      });
      return;
    }

    const existingUser = existingUserResult.value;
    if (!existingUser) {
      res.status(404).json({ code: "NOT_FOUND", message: "User not found" });
      return;
    }

    const hasLocalPassword = Boolean(existingUser.password);
    if (
      hasLocalPassword &&
      (!currentPassword ||
        !verifyPassword(currentPassword, existingUser.password))
    ) {
      res.status(400).json({
        code: "VALIDATION_ERROR",
        message: "Current password is required to change password",
      });
      return;
    }

    const updatedUserResult = await this.userRepository
      .save(
        new User(
          existingUser.id,
          existingUser.username,
          hashPassword(password),
          existingUser.email,
          existingUser.googleId,
          existingUser.githubId,
          existingUser.githubLogin,
          existingUser.githubAccessToken,
          existingUser.name,
          existingUser.avatarUrl,
        ),
      )
      .mapErr(() => null);

    if (updatedUserResult.isErr()) {
      res.status(500).json({
        code: "SET_PASSWORD_FAILED",
        message: "Unable to set password",
      });
      return;
    }

    res.json({
      message: hasLocalPassword ? "Password updated" : "Password set",
    });
  };

  getSession = async (req: Request, res: Response): Promise<void> => {
    const token =
      typeof req.cookies[SESSION_COOKIE_NAME] === "string"
        ? req.cookies[SESSION_COOKIE_NAME]
        : undefined;

    if (!token) {
      res.status(401).json({ code: "UNAUTHORIZED", message: "No session" });
      return;
    }

    const sessionUser = verifySessionToken(
      token,
      configService.getSessionSecret(),
    );
    if (!sessionUser) {
      res
        .status(401)
        .json({ code: "UNAUTHORIZED", message: "Invalid session" });
      return;
    }

    const userResult = await this.userRepository
      .findById(sessionUser.id)
      .mapErr(() => null);

    if (userResult.isErr()) {
      res.status(500).json({
        code: "SESSION_READ_FAILED",
        message: "Unable to read session",
      });
      return;
    }

    const user = userResult.value;
    if (!user) {
      res
        .status(401)
        .json({ code: "UNAUTHORIZED", message: "Invalid session" });
      return;
    }

    const requiresLocalPassword = user.password.trim().length === 0;
    const authProvider =
      sessionUser.authProvider ?? this.inferAuthProvider(user);
    res.json({
      user: this.toAuthUser(user, authProvider),
      requiresLocalPassword,
      githubLinked: Boolean(user.githubId),
      authProvider,
    });
  };

  logout = (_req: Request, res: Response): void => {
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
    });
    res.status(204).send();
  };

  listGithubRepos = async (req: Request, res: Response): Promise<void> => {
    const sessionUser = this.readSessionUser(req);
    if (!sessionUser) {
      res.status(401).json({ code: "UNAUTHORIZED", message: "No session" });
      return;
    }

    const userResult = await this.userRepository
      .findById(sessionUser.id)
      .mapErr(() => null);

    if (userResult.isErr() || !userResult.value) {
      res.status(500).json({
        code: "USER_NOT_FOUND",
        message: "Unable to load user for this session",
      });
      return;
    }

    const user = userResult.value;
    const linkedReposResult = await this.linkedPublicRepoRepository
      .findByUserId(user.id)
      .mapErr(() => null);
    if (linkedReposResult.isErr()) {
      res.status(500).json({
        code: "LINKED_REPOS_READ_FAILED",
        message: "Unable to load linked repositories",
      });
      return;
    }

    const linkedRepos = linkedReposResult.value.map((repo) => ({
      id: repo.repoId,
      name: repo.name,
      fullName: repo.fullName,
      url: repo.url,
      description: repo.description,
      isPrivate: repo.isPrivate,
      isFork: repo.isFork,
      stars: repo.stars,
      updatedAt: repo.updatedAt,
    }));

    if (!user.githubAccessToken) {
      res.json({ repos: linkedRepos });
      return;
    }

    const cached = githubReposCache.get(user.id);
    if (cached && Date.now() - cached.fetchedAt < GITHUB_REPO_CACHE_TTL_MS) {
      res.json({
        repos: mergeReposByIdentity(cached.repos, linkedRepos),
        cached: true,
      });
      return;
    }

    try {
      const githubHeaders = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${user.githubAccessToken}`,
        "User-Agent": "APISentinel",
      };

      const buildReposUrls = (page: number): string[] => [
        `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&direction=desc&affiliation=owner,collaborator,organization_member`,
        `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&direction=desc&type=all`,
        `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&direction=desc`,
      ];

      const fetchReposPage = async (
        page: number,
      ): Promise<{ response: globalThis.Response; url: string }> => {
        let lastFallbackResponse: globalThis.Response | null = null;
        let lastFallbackUrl = "";

        for (const url of buildReposUrls(page)) {
          const candidateResponse = await fetch(url, {
            headers: githubHeaders,
          });

          if (candidateResponse.ok) {
            return { response: candidateResponse, url };
          }

          // These statuses can indicate permission/rate/session issues and should
          // be returned immediately rather than trying alternative query shapes.
          if (
            candidateResponse.status === 401 ||
            candidateResponse.status === 403 ||
            candidateResponse.status === 429
          ) {
            return { response: candidateResponse, url };
          }

          // Query-parameter incompatibilities (e.g. 422) are retried with the
          // next query variant before we give up.
          lastFallbackResponse = candidateResponse;
          lastFallbackUrl = url;
        }

        if (lastFallbackResponse) {
          return { response: lastFallbackResponse, url: lastFallbackUrl };
        }

        // This should be unreachable, but keeps the function total.
        const unreachableUrl =
          buildReposUrls(page)[0] ??
          `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&direction=desc`;
        const unreachableResponse = await fetch(unreachableUrl, {
          headers: githubHeaders,
        });
        return { response: unreachableResponse, url: unreachableUrl };
      };

      const { response, url: firstPageUrl } = await fetchReposPage(1);

      if (response.status === 401) {
        res.status(401).json({
          code: "GITHUB_TOKEN_INVALID",
          message: "GitHub token is invalid or expired",
        });
        return;
      }

      if (!response.ok) {
        const githubError = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;

        if (cached) {
          res.json({
            repos: mergeReposByIdentity(cached.repos, linkedRepos),
            cached: true,
            stale: true,
            warning:
              githubError?.message ??
              "GitHub request failed. Showing cached repositories.",
          });
          return;
        }

        if (response.status === 403 || response.status === 429) {
          res.status(429).json({
            code: "GITHUB_RATE_LIMITED",
            message:
              githubError?.message ??
              "GitHub API rate limit reached. Please wait a moment and try again.",
          });
          return;
        }

        console.error("GitHub /user/repos first-page request failed", {
          status: response.status,
          url: firstPageUrl,
          message: githubError?.message ?? null,
          userId: user.id,
        });

        res.status(502).json({
          code: "GITHUB_REQUEST_FAILED",
          message:
            githubError?.message ?? "Failed to fetch GitHub repositories",
        });
        return;
      }

      const oauthScopes = (response.headers.get("x-oauth-scopes") ?? "")
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean);
      const hasRepoScope = oauthScopes.some(
        (scope) => scope === "repo" || scope.startsWith("repo:"),
      );
      if (!hasRepoScope) {
        res.status(403).json({
          code: "GITHUB_SCOPE_INSUFFICIENT",
          message:
            "Reconnect GitHub to grant repository access required for private repositories.",
        });
        return;
      }

      const firstPagePayload =
        (await response.json()) as GithubRepoApiResponse[];
      const allReposRaw: GithubRepoApiResponse[] = Array.isArray(
        firstPagePayload,
      )
        ? [...firstPagePayload]
        : [];
      let partial = false;

      const linkHeader = response.headers.get("link") ?? "";
      const hasNextPage = /<[^>]+[?&]page=\d+[^>]*>;\s*rel="next"/.test(
        linkHeader,
      );

      if (hasNextPage) {
        // Keep requests bounded while still covering users with large repo counts.
        for (let page = 2; page <= 20; page += 1) {
          const { response: pageResponse, url: pageUrl } =
            await fetchReposPage(page);

          if (pageResponse.status === 401) {
            res.status(401).json({
              code: "GITHUB_TOKEN_INVALID",
              message: "GitHub token is invalid or expired",
            });
            return;
          }

          if (!pageResponse.ok) {
            // Do not fail the whole endpoint for later-page errors.
            console.warn("GitHub /user/repos pagination request failed", {
              status: pageResponse.status,
              url: pageUrl,
              page,
              userId: user.id,
            });
            partial = true;
            break;
          }

          const pagePayload =
            (await pageResponse.json()) as GithubRepoApiResponse[];
          if (!Array.isArray(pagePayload) || pagePayload.length === 0) {
            break;
          }

          allReposRaw.push(...pagePayload);

          const pageLinkHeader = pageResponse.headers.get("link") ?? "";
          const pageHasNext = /<[^>]+[?&]page=\d+[^>]*>;\s*rel="next"/.test(
            pageLinkHeader,
          );
          if (!pageHasNext) {
            break;
          }
        }
      }

      const uniqueRepos = allReposRaw.filter(
        (repo, index, self) =>
          self.findIndex((item) => item.id === repo.id) === index,
      );

      const repos = uniqueRepos.map(mapGithubApiRepoToCachedRepo);

      githubReposCache.set(user.id, { fetchedAt: Date.now(), repos });
      res.json({ repos: mergeReposByIdentity(repos, linkedRepos), partial });
    } catch (error) {
      if (cached) {
        res.json({
          repos: mergeReposByIdentity(cached.repos, linkedRepos),
          cached: true,
          stale: true,
          warning: "GitHub request failed. Showing cached repositories.",
        });
        return;
      }

      const message =
        error instanceof Error && error.message
          ? error.message
          : "Failed to fetch GitHub repositories";
      console.error("GitHub /user/repos request threw", {
        userId: user.id,
        message,
      });
      res.status(502).json({
        code: "GITHUB_REQUEST_FAILED",
        message,
      });
    }
  };

  /**
   * Resolve a GitHub repository by URL and return the same repo shape used by listGithubRepos.
   * POST /auth/repositories/by-url  body: { url: "https://github.com/owner/name" }
   */
  getGithubRepoByUrl = async (req: Request, res: Response): Promise<void> => {
    const sessionUser = this.readSessionUser(req);
    if (!sessionUser) {
      res.status(401).json({ code: "UNAUTHORIZED", message: "No session" });
      return;
    }

    const userResult = await this.userRepository
      .findById(sessionUser.id)
      .mapErr(() => null);
    if (userResult.isErr() || !userResult.value) {
      res.status(500).json({
        code: "USER_NOT_FOUND",
        message: "Unable to load user for this session",
      });
      return;
    }

    const user = userResult.value;

    const body = (req.body ?? {}) as RepoByUrlBody;
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const parsed = parseGithubRepoUrl(url);
    if (!parsed) {
      res.status(400).json({
        code: "VALIDATION_ERROR",
        message:
          "Enter a valid GitHub repository URL like https://github.com/owner/repo",
      });
      return;
    }

    try {
      const response = await fetch(
        `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            ...(user.githubAccessToken
              ? { Authorization: `Bearer ${user.githubAccessToken}` }
              : {}),
            "User-Agent": "APISentinel",
          },
        },
      );

      if (response.status === 401) {
        res.status(401).json({
          code: "GITHUB_TOKEN_INVALID",
          message: "GitHub token is invalid or expired",
        });
        return;
      }

      if (response.status === 404) {
        res.status(404).json({
          code: "REPO_NOT_FOUND",
          message:
            "Repository not found (or you don't have access to it with your current GitHub connection).",
        });
        return;
      }

      if (!response.ok) {
        res.status(502).json({
          code: "GITHUB_REQUEST_FAILED",
          message: "Failed to fetch repository metadata from GitHub",
        });
        return;
      }

      const repo = (await response.json()) as GithubRepoApiResponse;
      const mappedRepo = mapGithubApiRepoToCachedRepo(repo);

      if (mappedRepo.isPrivate) {
        res.status(400).json({
          code: "PUBLIC_REPO_REQUIRED",
          message:
            "Only public repositories can be linked by URL without explicit private-repo access.",
        });
        return;
      }

      const saveResult = await this.linkedPublicRepoRepository
        .saveOrUpdate({
          userId: user.id,
          repoId: mappedRepo.id,
          name: mappedRepo.name,
          fullName: mappedRepo.fullName,
          url: mappedRepo.url,
          description: mappedRepo.description,
          isPrivate: mappedRepo.isPrivate,
          isFork: mappedRepo.isFork,
          stars: mappedRepo.stars,
          updatedAt: mappedRepo.updatedAt,
        })
        .mapErr(() => null);

      if (saveResult.isErr()) {
        res.status(500).json({
          code: "LINKED_REPO_SAVE_FAILED",
          message: "Unable to save linked repository",
        });
        return;
      }

      githubReposCache.delete(user.id);
      res.json({
        repo: mappedRepo,
      });
    } catch {
      res.status(502).json({
        code: "GITHUB_REQUEST_FAILED",
        message: "Failed to fetch GitHub repository",
      });
    }
  };

  unlinkGithub = async (req: Request, res: Response): Promise<void> => {
    const sessionUser = this.readSessionUser(req);
    if (!sessionUser) {
      res.status(401).json({ code: "UNAUTHORIZED", message: "No session" });
      return;
    }

    const userResult = await this.userRepository
      .findById(sessionUser.id)
      .mapErr(() => null);

    if (userResult.isErr() || !userResult.value) {
      res
        .status(404)
        .json({ code: "USER_NOT_FOUND", message: "User not found" });
      return;
    }

    const user = userResult.value;
    const hasOtherAuth = Boolean(user.password) || Boolean(user.googleId);
    if (!hasOtherAuth) {
      res.status(400).json({
        code: "CANNOT_UNLINK_LAST_PROVIDER",
        message:
          "Set a password or link Google before disconnecting GitHub so you can still sign in.",
      });
      return;
    }

    const updated = await this.userRepository
      .save(
        new User(
          user.id,
          user.username,
          user.password,
          user.email,
          user.googleId,
          null,
          null,
          null,
          user.name,
          user.avatarUrl,
        ),
      )
      .mapErr(() => null);

    if (updated.isErr()) {
      res.status(500).json({
        code: "UNLINK_FAILED",
        message: "Unable to unlink GitHub",
      });
      return;
    }

    const provider =
      sessionUser.authProvider ?? this.inferAuthProvider(updated.value);
    this.setSessionCookie(res, this.toAuthUser(updated.value, provider));
    res.json({ githubLinked: false });
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

  private toAuthUser(user: User, authProvider?: AuthProvider): AuthUser {
    return {
      id: user.id,
      login: user.email ?? user.username,
      name: user.name,
      avatarUrl: user.avatarUrl ?? "",
      authProvider: authProvider ?? this.inferAuthProvider(user),
    };
  }

  private inferAuthProvider(user: User): AuthProvider {
    if (user.googleId && !user.githubId) return "google";
    if (user.githubId && !user.googleId) return "github";
    if (user.googleId) return "google";
    if (user.githubId) return "github";
    return "local";
  }

  private setSessionCookie(res: Response, user: AuthUser): void {
    const sessionToken = createSessionToken(
      user,
      configService.getSessionSecret(),
      SESSION_MAX_AGE_MS,
    );

    res.cookie(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: SESSION_MAX_AGE_MS,
      path: "/",
    });
  }

  private async exchangeCodeForAccessToken(code: string): Promise<string> {
    const response = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "APISentinel",
        },
        body: new URLSearchParams({
          client_id: configService.getGithubClientId(),
          client_secret: configService.getGithubClientSecret(),
          code,
          redirect_uri: configService.getGithubCallbackUrl(),
        }),
      },
    );

    if (!response.ok) {
      throw new Error("Failed to exchange OAuth code for token");
    }

    const payload = (await response.json()) as GithubTokenResponse;
    if (!payload.access_token) {
      throw new Error(
        payload.error_description ?? payload.error ?? "Token missing",
      );
    }

    return payload.access_token;
  }

  private async fetchGithubUser(
    accessToken: string,
  ): Promise<GithubUserResponse> {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "APISentinel",
      },
    });

    if (!response.ok) {
      throw new Error("Failed to fetch GitHub user");
    }

    const payload = (await response.json()) as GithubUserResponse;
    if (
      typeof payload.id !== "number" ||
      typeof payload.login !== "string" ||
      typeof payload.avatar_url !== "string"
    ) {
      throw new Error("Invalid GitHub user payload");
    }

    return payload;
  }

  private async fetchGithubVerifiedEmail(
    accessToken: string,
  ): Promise<string | null> {
    const response = await fetch("https://api.github.com/user/emails", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "APISentinel",
      },
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as GithubEmailResponse[];
    if (!Array.isArray(payload)) {
      return null;
    }

    const verifiedPrimary = payload.find(
      (item) => item.verified === true && item.primary === true,
    );
    if (verifiedPrimary?.email) {
      return verifiedPrimary.email;
    }

    const verifiedAny = payload.find((item) => item.verified === true);
    return verifiedAny?.email ?? null;
  }

  private async exchangeGoogleCodeForAccessToken(
    code: string,
  ): Promise<string> {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: configService.getGoogleClientId(),
        client_secret: configService.getGoogleClientSecret(),
        code,
        grant_type: "authorization_code",
        redirect_uri: configService.getGoogleCallbackUrl(),
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to exchange Google OAuth code for token");
    }

    const payload = (await response.json()) as GoogleTokenResponse;
    if (!payload.access_token) {
      throw new Error(
        payload.error_description ?? payload.error ?? "Google token missing",
      );
    }

    return payload.access_token;
  }

  private async fetchGoogleUser(
    accessToken: string,
  ): Promise<GoogleUserResponse> {
    const response = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error("Failed to fetch Google user");
    }

    const payload = (await response.json()) as GoogleUserResponse;
    if (typeof payload.sub !== "string") {
      throw new Error("Invalid Google user payload");
    }

    return payload;
  }
}

function normalizeEmail(email: string | undefined): string | null {
  if (typeof email !== "string") {
    return null;
  }

  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function mapGithubApiRepoToCachedRepo(
  repo: GithubRepoApiResponse,
): CachedGithubRepo {
  return {
    id: String(repo.id),
    name: repo.name,
    fullName: repo.full_name,
    url: repo.html_url,
    description: repo.description,
    isPrivate: repo.private,
    isFork: repo.fork,
    stars: repo.stargazers_count,
    updatedAt: repo.updated_at,
  };
}

function mergeReposByIdentity(
  primary: CachedGithubRepo[],
  secondary: CachedGithubRepo[],
): CachedGithubRepo[] {
  const byId = new Map<string, CachedGithubRepo>();

  for (const repo of primary) {
    byId.set(repo.id, repo);
  }

  for (const repo of secondary) {
    if (byId.has(repo.id)) {
      continue;
    }
    byId.set(repo.id, repo);
  }

  return Array.from(byId.values());
}

function parseGithubRepoUrl(
  url: string,
): { owner: string; repo: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.toLowerCase() !== "github.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0]!;
    let repo = parts[1]!;
    if (repo.endsWith(".git")) repo = repo.slice(0, -4);
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}
