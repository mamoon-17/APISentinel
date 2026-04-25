import { Repository } from "typeorm";
import { ObjectId } from "mongodb";
import { ResultAsync } from "neverthrow";
import { User, UserRepository } from "../../../../domain/user";
import { AppError } from "../../../../shared/errors/app-error";
import { UserOrmEntity } from "../entities/user.orm-entity";
import { UserMapper } from "../mappers/user.mapper";

/**
 * Adapter - Implements the UserRepository port using TypeORM.
 * The application layer doesn't know this exists.
 */
export class TypeOrmUserRepository implements UserRepository {
  constructor(private readonly ormRepo: Repository<UserOrmEntity>) {}

  findAll(): ResultAsync<User[], AppError> {
    return ResultAsync.fromPromise(this.ormRepo.find(), (error) =>
      AppError.fromUnknown("DB_QUERY_FAILED", error),
    ).map((entities) => entities.map(UserMapper.toDomain));
  }

  findById(id: string): ResultAsync<User | null, AppError> {
    return ResultAsync.fromPromise(this.findByIdInternal(id), (error) =>
      AppError.fromUnknown("DB_QUERY_FAILED", error),
    ).map((entity) => (entity ? UserMapper.toDomain(entity) : null));
  }

  findByUsername(username: string): ResultAsync<User | null, AppError> {
    return ResultAsync.fromPromise(
      this.ormRepo.findOneBy({ username }),
      (error) => AppError.fromUnknown("DB_QUERY_FAILED", error),
    ).map((entity) => (entity ? UserMapper.toDomain(entity) : null));
  }

  findByEmail(email: string): ResultAsync<User | null, AppError> {
    return ResultAsync.fromPromise(this.ormRepo.findBy({ email }), (error) =>
      AppError.fromUnknown("DB_QUERY_FAILED", error),
    ).map((entities) => {
      const entity = this.pickPreferredEntity(entities);
      return entity ? UserMapper.toDomain(entity) : null;
    });
  }

  findAllByEmail(email: string): ResultAsync<User[], AppError> {
    return ResultAsync.fromPromise(this.ormRepo.findBy({ email }), (error) =>
      AppError.fromUnknown("DB_QUERY_FAILED", error),
    ).map((entities) => entities.map(UserMapper.toDomain));
  }

  findByGoogleId(googleId: string): ResultAsync<User | null, AppError> {
    return ResultAsync.fromPromise(this.ormRepo.findBy({ googleId }), (error) =>
      AppError.fromUnknown("DB_QUERY_FAILED", error),
    ).map((entities) => {
      const entity = this.pickPreferredEntity(entities);
      return entity ? UserMapper.toDomain(entity) : null;
    });
  }

  save(user: User): ResultAsync<User, AppError> {
    return ResultAsync.fromPromise(this.saveInternal(user), (error) =>
      AppError.fromUnknown("DB_QUERY_FAILED", error),
    ).map(UserMapper.toDomain);
  }

  delete(id: string): ResultAsync<void, AppError> {
    return ResultAsync.fromPromise(this.deleteByIdInternal(id), (error) =>
      AppError.fromUnknown("DB_QUERY_FAILED", error),
    ).map(() => undefined);
  }

  private async findByIdInternal(id: string): Promise<UserOrmEntity | null> {
    const entities = await this.findAllByIdInternal(id);
    return this.pickPreferredEntity(entities);
  }

  private async findAllByIdInternal(id: string): Promise<UserOrmEntity[]> {
    const byStringId = await this.ormRepo.findBy({ id });

    if (!ObjectId.isValid(id)) {
      return byStringId;
    }

    const byObjectId = await this.ormRepo.findBy({ _id: new ObjectId(id) });
    const seen = new Set<string>();
    const merged = [...byStringId, ...byObjectId].filter((entity) => {
      const key = entity._id.toHexString();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    return merged;
  }

  private pickPreferredEntity(entities: UserOrmEntity[]): UserOrmEntity | null {
    if (entities.length === 0) {
      return null;
    }

    // Prefer records with a real password to avoid selecting stale OAuth-only duplicates.
    const withPassword = entities.find((entity) =>
      Boolean(entity.password && entity.password.trim().length > 0),
    );

    return withPassword ?? entities[0] ?? null;
  }

  private async saveInternal(user: User): Promise<UserOrmEntity> {
    const ormEntity = UserMapper.toOrm(user);
    if (!user.id) {
      return this.ormRepo.save(ormEntity);
    }

    const existingEntities = await this.findAllByIdInternal(user.id);
    const preferred = this.pickPreferredEntity(existingEntities);

    if (!preferred) {
      return this.ormRepo.save(ormEntity);
    }

    ormEntity._id = preferred._id;
    const saved = await this.ormRepo.save(ormEntity);

    const duplicates = existingEntities.filter(
      (entity) => entity._id.toHexString() !== saved._id.toHexString(),
    );

    if (duplicates.length > 0) {
      await Promise.all(
        duplicates.map((entity) => this.ormRepo.delete({ _id: entity._id })),
      );
    }

    return saved;
  }

  private async deleteByIdInternal(id: string): Promise<void> {
    const byStringId = await this.ormRepo.delete({ id });
    if ((byStringId.affected ?? 0) > 0) {
      return;
    }

    if (ObjectId.isValid(id)) {
      await this.ormRepo.delete({ _id: new ObjectId(id) });
    }
  }
}
