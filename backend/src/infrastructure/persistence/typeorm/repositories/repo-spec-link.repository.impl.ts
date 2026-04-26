import { ObjectId } from "mongodb";
import { ResultAsync } from "neverthrow";
import { Repository } from "typeorm";
import { AppError } from "../../../../shared/errors/app-error";
import { RepoSpecLink, RepoSpecLinkRepository } from "../../../../domain/spec";
import { RepoSpecLinkOrmEntity } from "../entities/repo-spec-link.orm-entity";

export class TypeOrmRepoSpecLinkRepository implements RepoSpecLinkRepository {
  constructor(private readonly ormRepo: Repository<RepoSpecLinkOrmEntity>) {}

  findByRepositoryId(repositoryId: string): ResultAsync<RepoSpecLink[], AppError> {
    return ResultAsync.fromPromise(
      this.ormRepo.findBy({ repositoryId }),
      (e) => AppError.fromUnknown("DB_QUERY_FAILED", e),
    ).map((rows) => rows.map(toDomain));
  }

  findBySpecId(specId: string): ResultAsync<RepoSpecLink[], AppError> {
    return ResultAsync.fromPromise(
      this.ormRepo.findBy({ specId }),
      (e) => AppError.fromUnknown("DB_QUERY_FAILED", e),
    ).map((rows) => rows.map(toDomain));
  }

  findByRepositoryAndSpec(
    repositoryId: string,
    specId: string,
  ): ResultAsync<RepoSpecLink | null, AppError> {
    return ResultAsync.fromPromise(
      this.ormRepo.findOneBy({ repositoryId, specId }),
      (e) => AppError.fromUnknown("DB_QUERY_FAILED", e),
    ).map((row) => (row ? toDomain(row) : null));
  }

  save(link: RepoSpecLink): ResultAsync<RepoSpecLink, AppError> {
    return ResultAsync.fromPromise(
      this.saveInternal(link),
      (e) => AppError.fromUnknown("DB_QUERY_FAILED", e),
    ).map(toDomain);
  }

  delete(id: string): ResultAsync<void, AppError> {
    return ResultAsync.fromPromise(
      this.deleteInternal(id),
      (e) => AppError.fromUnknown("DB_QUERY_FAILED", e),
    ).map(() => undefined);
  }

  private async saveInternal(link: RepoSpecLink): Promise<RepoSpecLinkOrmEntity> {
    const entity = new RepoSpecLinkOrmEntity();
    entity.id = link.id;
    entity.repositoryId = link.repositoryId;
    entity.specId = link.specId;
    entity.linkedAt = link.linkedAt;

    // Update existing if id matches
    const existing = await this.ormRepo.findOneBy({ id: link.id });
    if (existing) entity._id = existing._id;

    return this.ormRepo.save(entity);
  }

  private async deleteInternal(id: string): Promise<void> {
    const result = await this.ormRepo.delete({ id });
    if ((result.affected ?? 0) > 0) return;
    if (ObjectId.isValid(id)) {
      await this.ormRepo.delete({ _id: new ObjectId(id) });
    }
  }
}

function toDomain(entity: RepoSpecLinkOrmEntity): RepoSpecLink {
  return new RepoSpecLink(
    entity.id,
    entity.repositoryId,
    entity.specId,
    entity.linkedAt,
  );
}
