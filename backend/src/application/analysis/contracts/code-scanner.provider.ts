import { ResultAsync } from "neverthrow";
import { AppError } from "../../../shared/errors/app-error";
import { RepositoryFile } from "./repository-code.provider";
import { SnapshotEndpointUsage } from "./repository-snapshot.provider";

export interface CodeScannerProvider {
  /**
   * Scans the provided files and extracts API endpoint usage,
   * returning normalized paths, methods, and inferred payloads.
   */
  scan(files: RepositoryFile[]): ResultAsync<SnapshotEndpointUsage[], AppError>;
}
