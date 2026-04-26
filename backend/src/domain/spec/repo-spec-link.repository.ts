import { ResultAsync } from "neverthrow";
import { AppError } from "../../shared/errors/app-error";
import { RepoSpecLink } from "./repo-spec-link.entity";

export interface RepoSpecLinkRepository {
  findByRepositoryId(repositoryId: string): ResultAsync<RepoSpecLink[], AppError>;
  findBySpecId(specId: string): ResultAsync<RepoSpecLink[], AppError>;
  findByRepositoryAndSpec(repositoryId: string, specId: string): ResultAsync<RepoSpecLink | null, AppError>;
  save(link: RepoSpecLink): ResultAsync<RepoSpecLink, AppError>;
  delete(id: string): ResultAsync<void, AppError>;
}
