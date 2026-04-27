import { ok, err, Result } from "neverthrow";
import { DataSource, Repository, ObjectLiteral, EntityTarget } from "typeorm";
import { configService } from "../../../shared/config/config.service";
import { AppError } from "../../../shared/errors/app-error";
import { UserOrmEntity } from "./entities/user.orm-entity";
import { SpecVersionOrmEntity } from "./entities/spec-version.orm-entity";
import { RepoSpecLinkOrmEntity } from "./entities/repo-spec-link.orm-entity";
import { RequestLogOrmEntity } from "./entities/request-log.orm-entity";

/**
 * TypeORM DataSource - Infrastructure adapter for database connection.
 */
class AppDataSource {
  private datasource: DataSource | null = null;
  private initialized = false;
  private initPromise: Promise<Result<void, AppError>> | null = null;

  initialize(): Promise<Result<void, AppError>> {
    if (this.initialized) {
      return Promise.resolve(ok(undefined));
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<Result<void, AppError>> {
    if (!configService.isInitialized()) {
      this.initPromise = null;
      return err(
        new AppError(
          "CONFIG_NOT_INITIALIZED",
          "Config not initialized. Call configService.init() before initializing AppDataSource",
        ),
      );
    }

    this.datasource = new DataSource({
      type: "mongodb",
      url: configService.getDatabaseUri(),
      synchronize: true,
      entities: [
        UserOrmEntity,
        SpecVersionOrmEntity,
        RepoSpecLinkOrmEntity,
        RequestLogOrmEntity,
      ],
    });

    try {
      await this.datasource.initialize();
      this.initialized = true;
      return ok(undefined);
    } catch (error) {
      this.datasource = null;
      this.initPromise = null;
      return err(AppError.fromUnknown("DATASOURCE_INIT_FAILED", error));
    }
  }

  getRepository<T extends ObjectLiteral>(
    entity: EntityTarget<T>,
  ): Result<Repository<T>, AppError> {
    if (!this.datasource || !this.initialized) {
      return err(
        new AppError(
          "DATASOURCE_NOT_INITIALIZED",
          "DataSource is not initialized. Call initialize() first",
        ),
      );
    }

    return ok(this.datasource.getRepository(entity));
  }
}

export const appDataSource = new AppDataSource();
