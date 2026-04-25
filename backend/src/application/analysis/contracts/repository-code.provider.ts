import { ResultAsync } from "neverthrow";
import { AppError } from "../../../shared/errors/app-error";

export interface RepositoryFile {
  path: string;
  content: string;
}

export interface RepositoryCodeProvider {
  /**
   * Fetches all relevant source files from a repository.
   * This abstracts away GitHub API calls, git cloning, etc.
   */
  fetchFiles(
    repositoryId: string,
    githubAccessToken?: string,
  ): ResultAsync<RepositoryFile[], AppError>;
}
