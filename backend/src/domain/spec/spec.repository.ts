import { ResultAsync } from "neverthrow";
import { AppError } from "../../shared/errors/app-error";
import { SpecVersion } from "./spec.entity";

export interface SpecVersionRepository {
  findAll(): ResultAsync<SpecVersion[], AppError>;
  findById(id: string): ResultAsync<SpecVersion | null, AppError>;
  findBySpecId(specId: string): ResultAsync<SpecVersion[], AppError>;
  save(version: SpecVersion): ResultAsync<SpecVersion, AppError>;
  delete(versionId: string): ResultAsync<void, AppError>;
}
