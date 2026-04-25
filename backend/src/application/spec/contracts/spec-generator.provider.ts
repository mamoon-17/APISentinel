import { ResultAsync } from "neverthrow";
import { AppError } from "../../../shared/errors/app-error";
import type { RepositoryFile } from "../../analysis/contracts/repository-code.provider";

export interface GeneratedSpecPair {
  /**
   * An OpenAPI YAML spec that accurately reflects what the repository code
   * actually does — request/response shapes match the real handler logic.
   * Uploading this and running AI analysis should produce zero violations.
   */
  accurateSpec: string;

  /**
   * An OpenAPI YAML spec that intentionally mismatches the repository code.
   * Types are swapped, required fields are added/removed, extra fields are
   * introduced. Uploading this will trigger schema violations in the analysis tab.
   */
  violationSpec: string;

  /** Human-readable summary of what was found in the repo */
  summary: string;
}

/**
 * PORT — generates a pair of OpenAPI specs (accurate + intentional violations)
 * from a set of repository source files.
 *
 * Implementations live in infrastructure/ and use an LLM to analyse the code.
 */
export interface SpecGeneratorProvider {
  generateFromFiles(
    files: RepositoryFile[],
    repoName: string,
  ): ResultAsync<GeneratedSpecPair, AppError>;
}
