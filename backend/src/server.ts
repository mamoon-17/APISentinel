import "reflect-metadata";
import { configService } from "./shared/config/config.service";
import {
  appDataSource,
  UserOrmEntity,
  TypeOrmUserRepository,
} from "./infrastructure/persistence/typeorm";
import { UserService } from "./application/user";
import { UserController, createUserRouter } from "./infrastructure/http";
import { AuthController } from "./infrastructure/http/controllers/auth.controller";
import { createAuthRouter } from "./infrastructure/http/routes/auth.routes";
import { HealthCheckJobQueue } from "./infrastructure/health/health-check-job-queue";
import { HealthCheckController } from "./infrastructure/http/controllers/health-check.controller";
import { createHealthCheckRouter } from "./infrastructure/http/routes/health-check.routes";
import { createApp } from "./app";

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

  // 4. Create application services (inject ports)
  const userService = new UserService(userRepository);

  // 5. Create HTTP adapters (controllers)
  const userController = new UserController(userService);
  const authController = new AuthController(userRepository);
  const healthCheckJobQueue = new HealthCheckJobQueue();
  const healthCheckController = new HealthCheckController(healthCheckJobQueue);

  // 6. Create routers
  const userRouter = createUserRouter(userController);
  const authRouter = createAuthRouter(authController);
  const healthCheckRouter = createHealthCheckRouter(healthCheckController);

  // 7. Create and start app
  const app = createApp(
    [
      { path: "/users", router: userRouter },
      { path: "/auth", router: authRouter },
      { path: "/health-checks", router: healthCheckRouter },
    ],
    (application) => {
      application.get("/auth/repositories", (req, res) => {
        void authController.listGithubRepos(req, res);
      });
    },
  );

  const PORT = configService.getPort();
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error("Fatal error during bootstrap:", err);
  process.exit(1);
});
