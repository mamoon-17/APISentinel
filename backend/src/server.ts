import "reflect-metadata";
import { configService } from "./shared/config/config.service";
import {
  appDataSource,
  UserOrmEntity,
  TypeOrmUserRepository,
  SpecVersionOrmEntity,
  TypeOrmSpecVersionRepository,
  RepoSpecLinkOrmEntity,
  TypeOrmRepoSpecLinkRepository,
  RequestLogOrmEntity,
  TypeOrmRequestLogRepository,
} from "./infrastructure/persistence/typeorm";
import { UserService } from "./application/user";
import { SpecService } from "./application/spec";
import { AnalysisService } from "./application/analysis";
import { MetricsService } from "./application/metrics";
import { UserController, createUserRouter } from "./infrastructure/http";
import { AuthController } from "./infrastructure/http/controllers/auth.controller";
import { createAuthRouter } from "./infrastructure/http/routes/auth.routes";
import { SpecController } from "./infrastructure/http/controllers/spec.controller";
import { createSpecRouter } from "./infrastructure/http/routes/spec.routes";
import { RepositoryAnalysisController } from "./infrastructure/http/controllers/repository-analysis.controller";
import { createRepositoryAnalysisRouter } from "./infrastructure/http/routes/repository-analysis.routes";
import { RepoLinkController } from "./infrastructure/http/controllers/repo-link.controller";
import { RepoLinkService } from "./application/spec/repo-link.service";
import { HealthCheckJobQueue } from "./infrastructure/health/health-check-job-queue";
import { HealthCheckController } from "./infrastructure/http/controllers/health-check.controller";
import { createHealthCheckRouter } from "./infrastructure/http/routes/health-check.routes";
import { MetricsController } from "./infrastructure/http/controllers/metrics.controller";
import { createMetricsRouter } from "./infrastructure/http/routes/metrics.routes";
import { createApp } from "./app";
import { DefaultOpenApiParser } from "./infrastructure/spec/openapi-parser";
import { PipelineRepositorySnapshotProvider } from "./infrastructure/analysis/pipeline-repository-snapshot.provider";
import { GithubRepositoryCodeProvider } from "./infrastructure/analysis/github-repository-code.provider";
import { RegexCodeScannerProvider } from "./infrastructure/analysis/regex-code-scanner.provider";
import { FixtureRepositorySnapshotProvider } from "./infrastructure/analysis/fixture-repository-snapshot.provider";
import { GithubModelsLlmViolationProvider } from "./infrastructure/llm/github-models-llm-violation.provider";
import { LlmSpecGeneratorProvider } from "./infrastructure/llm/llm-spec-generator.provider";
import { LlmFrontendDetectionProvider } from "./infrastructure/llm/llm-frontend-detection.provider";

/**
 * Composition Root - Wires all adapters to the application layer.
 *
 * This is the ONLY place that knows about concrete implementations.
 * The application and domain layers remain pure and testable.
 */
async function bootstrap() {
  // 1. Load & validate config
  const configResult = configService.init();
  if (configResult.isErr()) {
    console.error(
      "Missing environment variables:",
      configResult.error.join(", "),
    );
    process.exit(1);
  }

  // 2. Initialize persistence adapter
  const initResult = await appDataSource.initialize();
  if (initResult.isErr()) {
    console.error(`[${initResult.error.code}] ${initResult.error.message}`);
    process.exit(1);
  }

  // 3. Create repositories (adapters implementing ports)
  const userOrmRepoResult = appDataSource.getRepository(UserOrmEntity);
  if (userOrmRepoResult.isErr()) {
    console.error(
      `[${userOrmRepoResult.error.code}] ${userOrmRepoResult.error.message}`,
    );
    process.exit(1);
  }
  const userRepository = new TypeOrmUserRepository(userOrmRepoResult.value);

  const specOrmRepoResult = appDataSource.getRepository(SpecVersionOrmEntity);
  if (specOrmRepoResult.isErr()) {
    console.error(
      `[${specOrmRepoResult.error.code}] ${specOrmRepoResult.error.message}`,
    );
    process.exit(1);
  }
  const specVersionRepository = new TypeOrmSpecVersionRepository(
    specOrmRepoResult.value,
  );

  const repoSpecLinkOrmRepoResult = appDataSource.getRepository(RepoSpecLinkOrmEntity);
  if (repoSpecLinkOrmRepoResult.isErr()) {
    console.error(
      `[${repoSpecLinkOrmRepoResult.error.code}] ${repoSpecLinkOrmRepoResult.error.message}`,
    );
    process.exit(1);
  }
  const repoSpecLinkRepository = new TypeOrmRepoSpecLinkRepository(
    repoSpecLinkOrmRepoResult.value,
  );

  const requestLogOrmRepoResult = appDataSource.getRepository(RequestLogOrmEntity);
  if (requestLogOrmRepoResult.isErr()) {
    console.error(
      `[${requestLogOrmRepoResult.error.code}] ${requestLogOrmRepoResult.error.message}`,
    );
    process.exit(1);
  }
  const requestLogRepository = new TypeOrmRequestLogRepository(
    requestLogOrmRepoResult.value,
  );

  // 4. Create application services (inject ports)
  const userService = new UserService(userRepository);
  const specGeneratorToken = configService.getGithubModelsToken() ?? "";
  const specGenerator = configService.isLlmEnabled()
    ? new LlmSpecGeneratorProvider(specGeneratorToken)
    : undefined;

  const specService = new SpecService(
    specVersionRepository,
    new DefaultOpenApiParser(),
    specGenerator,
  );

  const repositorySnapshotProvider = configService.shouldUseFixtureSnapshots()
    ? new FixtureRepositorySnapshotProvider()
    : new PipelineRepositorySnapshotProvider(
      new GithubRepositoryCodeProvider(),
      new RegexCodeScannerProvider(),
    );

  // LLM violation adapter — uses the user's GitHub token at request time,
  // so we pass an empty string here; the controller swaps in the real token.
  // The adapter is only wired when LLM_ENABLED=true.
  const llmViolationProvider = configService.isLlmEnabled()
    ? new GithubModelsLlmViolationProvider(
      configService.getGithubModelsToken() ?? "",
      true,
    )
    : undefined;

  const analysisService = new AnalysisService(
    specVersionRepository,
    repositorySnapshotProvider,
    llmViolationProvider,
  );
  const metricsService = new MetricsService(requestLogRepository);

  // 5. Create HTTP adapters (controllers)
  const userController = new UserController(userService);
  const authController = new AuthController(userRepository);
  const specController = new SpecController(
    specService,
    analysisService,
    userRepository,
  );
  const repositoryAnalysisController = new RepositoryAnalysisController(
    analysisService,
    userRepository,
  );
  const metricsController = new MetricsController(metricsService);

  const repoLinkService = new RepoLinkService(
    repoSpecLinkRepository,
    specVersionRepository,
    new GithubRepositoryCodeProvider(),
    configService.isLlmEnabled() ? new LlmFrontendDetectionProvider() : undefined,
  );
  const repoLinkController = new RepoLinkController(
    repoLinkService,
    userRepository,
  );
  const healthCheckJobQueue = new HealthCheckJobQueue();
  const healthCheckController = new HealthCheckController(healthCheckJobQueue);
  const metricsRouter = createMetricsRouter(metricsController);

  // 6. Create routers
  const userRouter = createUserRouter(userController);
  const authRouter = createAuthRouter(authController);
  const specRouter = createSpecRouter(specController);
  const repositoryAnalysisRouter = createRepositoryAnalysisRouter(
    repositoryAnalysisController,
    repoLinkController,
  );
  const healthCheckRouter = createHealthCheckRouter(healthCheckController);

  // 7. Create and start app
  const app = createApp(
    [
      { path: "/users", router: userRouter },
      { path: "/auth", router: authRouter },
      { path: "/specs", router: specRouter },
      { path: "/repositories", router: repositoryAnalysisRouter },
      { path: "/health-checks", router: healthCheckRouter },
      { path: "/", router: metricsRouter },
    ],
    (application) => {
      application.get("/auth/repositories", (req, res) => {
        void authController.listGithubRepos(req, res);
      });
    },
  );

  const PORT = configService.getPort();
  app.listen(PORT, () => {
    const mode = configService.shouldUseFixtureSnapshots()
      ? "fixture"
      : "live-github";
    console.log(`Server listening on port ${PORT} (snapshot mode: ${mode})`);
  });
}

bootstrap().catch((err) => {
  console.error("Fatal error during bootstrap:", err);
  process.exit(1);
});
