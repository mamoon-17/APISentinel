import { ResultAsync } from "neverthrow";
import { AppError } from "../../../shared/errors/app-error";

export interface LlmFrontendDetectionResult {
  hasFrontend: boolean;
  /** e.g. "React", "Next.js", "Vue", "Django", "HTML/CSS" */
  frontendType: string | null;
  /** Root directory of the frontend, e.g. "frontend", "templates", "src" */
  frontendRoot: string | null;
}

export interface FrontendDetectionProvider {
  /**
   * Detects whether a repository has a frontend and what kind, using LLM analysis
   * of the repository tree plus representative file contents.
   */
  detectFromRepository(
    repositoryId: string,
    paths: string[],
    githubToken: string,
  ): ResultAsync<LlmFrontendDetectionResult, AppError>;
}
