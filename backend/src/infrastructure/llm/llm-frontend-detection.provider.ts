import { ResultAsync } from "neverthrow";
import { AppError } from "../../shared/errors/app-error";
import type { FrontendDetectionProvider, LlmFrontendDetectionResult } from "../../application/spec/contracts/frontend-detection.provider";
import { callLlmForFrontendDetection } from "./llm-caller";

export class LlmFrontendDetectionProvider implements FrontendDetectionProvider {
  detectFromRepository(
    repositoryId: string,
    paths: string[],
    githubToken: string,
  ): ResultAsync<LlmFrontendDetectionResult, AppError> {
    return ResultAsync.fromPromise(
      callLlmForFrontendDetection(repositoryId, paths, githubToken).then((r) => {
        if (r.isErr()) throw r.error;
        const { hasFrontend, frontendType, frontendRoot } = r.value;
        return { hasFrontend, frontendType, frontendRoot };
      }),
      (e) => (e instanceof AppError ? e : new AppError("UNKNOWN_ERROR", String(e))),
    );
  }
}
