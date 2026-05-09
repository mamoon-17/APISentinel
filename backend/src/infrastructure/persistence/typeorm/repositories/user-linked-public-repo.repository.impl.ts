import crypto from "crypto";
import { Repository } from "typeorm";
import { ResultAsync } from "neverthrow";
import { AppError } from "../../../../shared/errors/app-error";
import { UserLinkedPublicRepoOrmEntity } from "../entities/user-linked-public-repo.orm-entity";

export interface PersistedLinkedRepoInput {
  userId: string;
  repoId: string;
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  isPrivate: boolean;
  isFork: boolean;
  stars: number;
  updatedAt: string;
}

export class TypeOrmUserLinkedPublicRepoRepository {
  constructor(
    private readonly ormRepo: Repository<UserLinkedPublicRepoOrmEntity>,
  ) {}

  findByUserId(
    userId: string,
  ): ResultAsync<UserLinkedPublicRepoOrmEntity[], AppError> {
    return ResultAsync.fromPromise(this.ormRepo.findBy({ userId }), (error) =>
      AppError.fromUnknown("DB_QUERY_FAILED", error),
    );
  }

  saveOrUpdate(
    input: PersistedLinkedRepoInput,
  ): ResultAsync<UserLinkedPublicRepoOrmEntity, AppError> {
    return ResultAsync.fromPromise(this.saveOrUpdateInternal(input), (error) =>
      AppError.fromUnknown("DB_QUERY_FAILED", error),
    );
  }

  private async saveOrUpdateInternal(
    input: PersistedLinkedRepoInput,
  ): Promise<UserLinkedPublicRepoOrmEntity> {
    const existing = await this.ormRepo.findOneBy({
      userId: input.userId,
      repoId: input.repoId,
    });

    if (existing) {
      existing.name = input.name;
      existing.fullName = input.fullName;
      existing.url = input.url;
      existing.description = input.description;
      existing.isPrivate = input.isPrivate;
      existing.isFork = input.isFork;
      existing.stars = input.stars;
      existing.updatedAt = input.updatedAt;
      return this.ormRepo.save(existing);
    }

    const nowIso = new Date().toISOString();
    const created = this.ormRepo.create({
      id: crypto.randomUUID(),
      userId: input.userId,
      repoId: input.repoId,
      name: input.name,
      fullName: input.fullName,
      url: input.url,
      description: input.description,
      isPrivate: input.isPrivate,
      isFork: input.isFork,
      stars: input.stars,
      updatedAt: input.updatedAt,
      linkedAt: nowIso,
    });

    return this.ormRepo.save(created);
  }
}
