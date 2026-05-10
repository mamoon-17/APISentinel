import { ObjectId } from "mongodb";
import { randomUUID } from "crypto";
import { ResultAsync } from "neverthrow";
import { Repository } from "typeorm";
import {
  AnalysisResultRepository,
  SavedAnalysisResult,
} from "../../../../application/analysis/contracts/analysis-result.repository";
import { AppError } from "../../../../shared/errors/app-error";
import { AnalysisResultOrmEntity } from "../entities/analysis-result.orm-entity";

export class TypeOrmAnalysisResultRepository
  implements AnalysisResultRepository
{
  constructor(private readonly ormRepo: Repository<AnalysisResultOrmEntity>) {}

  findLatest(input: {
    userId: string;
    repositoryId: string;
    analysisMode: "frontend-backend" | "backend-spec";
    resultVariant: "static" | "ai";
    specId?: string;
  }): ResultAsync<SavedAnalysisResult | null, AppError> {
    return ResultAsync.fromPromise(this.findLatestInternal(input), (error) =>
      AppError.fromUnknown("DB_QUERY_FAILED", error),
    ).map((row) => (row ? toDomain(row) : null));
  }

  findRecentForUser(
    userId: string,
    limit: number,
  ): ResultAsync<SavedAnalysisResult[], AppError> {
    return ResultAsync.fromPromise(
      this.findRecentForUserInternal(userId, limit),
      (error) => AppError.fromUnknown("DB_QUERY_FAILED", error),
    ).map((rows) => rows.map(toDomain));
  }

  save(result: SavedAnalysisResult): ResultAsync<SavedAnalysisResult, AppError> {
    return ResultAsync.fromPromise(this.saveInternal(result), (error) =>
      AppError.fromUnknown("DB_QUERY_FAILED", error),
    ).map(toDomain);
  }

  deleteMatching(input: {
    userId: string;
    repositoryId: string;
    analysisMode: "frontend-backend" | "backend-spec";
    resultVariant: "static" | "ai";
    specId?: string;
  }): ResultAsync<void, AppError> {
    return ResultAsync.fromPromise(this.deleteMatchingInternal(input), (error) =>
      AppError.fromUnknown("DB_QUERY_FAILED", error),
    ).map(() => undefined);
  }

  private async findLatestInternal(input: {
    userId: string;
    repositoryId: string;
    analysisMode: "frontend-backend" | "backend-spec";
    resultVariant: "static" | "ai";
    specId?: string;
  }): Promise<AnalysisResultOrmEntity | null> {
    const specId = input.specId?.trim() || undefined;
    const rows = await this.ormRepo.findBy({
      userId: input.userId,
      repositoryId: input.repositoryId,
      analysisMode: input.analysisMode,
      resultVariant: input.resultVariant,
      specId,
    });

    return rows.sort(
      (a, b) => new Date(b.analyzedAt).getTime() - new Date(a.analyzedAt).getTime(),
    )[0] ?? null;
  }

  private async saveInternal(
    result: SavedAnalysisResult,
  ): Promise<AnalysisResultOrmEntity> {
    const existing = await this.findLatestInternal({
      userId: result.userId,
      repositoryId: result.repositoryId,
      analysisMode: result.analysisMode,
      resultVariant: result.resultVariant,
      specId: result.specId,
    });

    const entity = new AnalysisResultOrmEntity();
    entity.id = existing?.id ?? (result.id || randomUUID());
    entity.userId = result.userId;
    entity.repositoryId = result.repositoryId;
    entity.repositoryFullName = result.repositoryFullName ?? existing?.repositoryFullName;
    entity.analysisMode = result.analysisMode;
    entity.resultVariant = result.resultVariant;
    entity.specId = result.specId?.trim() || undefined;
    entity.analyzedAt = result.analyzedAt;
    entity.payload = result.payload;

    if (existing?._id) {
      entity._id = existing._id;
    }

    return this.ormRepo.save(entity);
  }

  private async findRecentForUserInternal(
    userId: string,
    limit: number,
  ): Promise<AnalysisResultOrmEntity[]> {
    const rows = await this.ormRepo.findBy({ userId, resultVariant: "static" as const });
    return rows
      .sort(
        (a, b) =>
          new Date(b.analyzedAt).getTime() - new Date(a.analyzedAt).getTime(),
      )
      .slice(0, limit);
  }

  private async deleteMatchingInternal(input: {
    userId: string;
    repositoryId: string;
    analysisMode: "frontend-backend" | "backend-spec";
    resultVariant: "static" | "ai";
    specId?: string;
  }): Promise<void> {
    const specId = input.specId?.trim() || undefined;
    const rows = await this.ormRepo.findBy({
      userId: input.userId,
      repositoryId: input.repositoryId,
      analysisMode: input.analysisMode,
      resultVariant: input.resultVariant,
      specId,
    });

    for (const row of rows) {
      const result = await this.ormRepo.delete({ id: row.id });
      if ((result.affected ?? 0) === 0 && row._id && ObjectId.isValid(row._id)) {
        await this.ormRepo.delete({ _id: row._id });
      }
    }
  }
}

function toDomain(entity: AnalysisResultOrmEntity): SavedAnalysisResult {
  return {
    id: entity.id,
    userId: entity.userId,
    repositoryId: entity.repositoryId,
    repositoryFullName: entity.repositoryFullName ?? undefined,
    analysisMode: entity.analysisMode,
    resultVariant: entity.resultVariant,
    specId: entity.specId ?? undefined,
    analyzedAt: new Date(entity.analyzedAt),
    payload: entity.payload,
  };
}
