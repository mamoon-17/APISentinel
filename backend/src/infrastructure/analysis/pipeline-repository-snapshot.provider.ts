import { ResultAsync } from "neverthrow";
import { AppError } from "../../shared/errors/app-error";
import {
  RepositorySnapshotProvider,
  RepositorySnapshot,
} from "../../application/analysis/contracts/repository-snapshot.provider";
import { RepositoryCodeProvider } from "../../application/analysis/contracts/repository-code.provider";
import { CodeScannerProvider } from "../../application/analysis/contracts/code-scanner.provider";
import { filterBackendOnlyFiles } from "./backend-only-files";

export class PipelineRepositorySnapshotProvider implements RepositorySnapshotProvider {
  constructor(
    private readonly codeProvider: RepositoryCodeProvider,
    private readonly scanner: CodeScannerProvider,
  ) {}

  getSnapshot(
    repositoryId: string,
    githubAccessToken?: string,
  ): ResultAsync<RepositorySnapshot, AppError> {
    // 1. Fetch files from the repository
    // 2. Scan the files for API endpoint usages
    // 3. Assemble and return the snapshot
    return this.codeProvider
      .fetchFiles(repositoryId, githubAccessToken)
      .map((files) => filterBackendOnlyFiles(files))
      .andThen((files) => this.scanner.scan(files))
      .map((endpoints) => ({
        repositoryId,
        capturedAt: new Date().toISOString(),
        endpoints,
      }));
  }
}
