import { Repository } from "typeorm";
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
    return ResultAsync.fromPromise(this.ormRepo.findOneBy({ id }), (error) =>
      AppError.fromUnknown("DB_QUERY_FAILED", error),
    ).map((entity) => (entity ? UserMapper.toDomain(entity) : null));
  }

  save(user: User): ResultAsync<User, AppError> {
    const ormEntity = UserMapper.toOrm(user);
    return ResultAsync.fromPromise(this.ormRepo.save(ormEntity), (error) =>
      AppError.fromUnknown("DB_QUERY_FAILED", error),
    ).map(UserMapper.toDomain);
  }

  delete(id: string): ResultAsync<void, AppError> {
    return ResultAsync.fromPromise(this.ormRepo.delete(id), (error) =>
      AppError.fromUnknown("DB_QUERY_FAILED", error),
    ).map(() => undefined);
  }
}
