import { ObjectId } from "mongodb";
import { ResultAsync } from "neverthrow";
import { Repository } from "typeorm";
import { AppError } from "../../../../shared/errors/app-error";
import { SpecVersion, SpecVersionRepository } from "../../../../domain/spec";
import { SpecVersionOrmEntity } from "../entities/spec-version.orm-entity";
import { SpecVersionMapper } from "../mappers/spec-version.mapper";

export class TypeOrmSpecVersionRepository implements SpecVersionRepository {
  constructor(private readonly ormRepo: Repository<SpecVersionOrmEntity>) {}

  findAll(): ResultAsync<SpecVersion[], AppError> {
    return ResultAsync.fromPromise(this.ormRepo.find(), (error) =>
      AppError.fromUnknown("DB_QUERY_FAILED", error),
    ).map((rows) => rows.map(SpecVersionMapper.toDomain));
  }

  findById(id: string): ResultAsync<SpecVersion | null, AppError> {
    return ResultAsync.fromPromise(this.findByIdInternal(id), (error) =>
      AppError.fromUnknown("DB_QUERY_FAILED", error),
    ).map((row) => (row ? SpecVersionMapper.toDomain(row) : null));
  }

  findBySpecId(specId: string): ResultAsync<SpecVersion[], AppError> {
    return ResultAsync.fromPromise(this.ormRepo.findBy({ specId }), (error) =>
      AppError.fromUnknown("DB_QUERY_FAILED", error),
    ).map((rows) => rows.map(SpecVersionMapper.toDomain));
  }

  save(version: SpecVersion): ResultAsync<SpecVersion, AppError> {
    return ResultAsync.fromPromise(this.saveInternal(version), (error) =>
      AppError.fromUnknown("DB_QUERY_FAILED", error),
    ).map(SpecVersionMapper.toDomain);
  }

  delete(versionId: string): ResultAsync<void, AppError> {
    return ResultAsync.fromPromise(this.deleteInternal(versionId), (error) =>
      AppError.fromUnknown("DB_QUERY_FAILED", error),
    ).map(() => undefined);
  }

  private async findByIdInternal(
    id: string,
  ): Promise<SpecVersionOrmEntity | null> {
    const byStringId = await this.ormRepo.findBy({ id });
    if (byStringId.length > 0) {
      return byStringId[0] ?? null;
    }

    if (!ObjectId.isValid(id)) {
      return null;
    }

    return this.ormRepo.findOneBy({ _id: new ObjectId(id) });
  }

  private async saveInternal(
    version: SpecVersion,
  ): Promise<SpecVersionOrmEntity> {
    const ormEntity = SpecVersionMapper.toOrm(version);

    if (version.id) {
      const existing = await this.findByIdInternal(version.id);
      if (existing) {
        ormEntity._id = existing._id;
      }
    }

    return this.ormRepo.save(ormEntity);
  }

  private async deleteInternal(versionId: string): Promise<void> {
    const byIdResult = await this.ormRepo.delete({ id: versionId });
    if ((byIdResult.affected ?? 0) > 0) {
      return;
    }

    if (ObjectId.isValid(versionId)) {
      await this.ormRepo.delete({ _id: new ObjectId(versionId) });
    }
  }
}
