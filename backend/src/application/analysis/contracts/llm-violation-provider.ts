import { ResultAsync } from "neverthrow";
import { AppError } from "../../../shared/errors/app-error";
import type { RepositoryFile } from "./repository-code.provider";
import type { ExtractedSchema } from "./repository-snapshot.provider";
import type { HttpMethod } from "./repository-snapshot.provider";

/**
 * One violation found for a single endpoint — either by static AST analysis
 * or by the LLM pass.
 */
export interface LlmEndpointViolation {
  field: string;
  expected: string;
  received: string;
  violationType: "type_mismatch" | "extra_field" | "missing_field";
  location: "requestBody" | "responseBody";
}

/**
 * The result for a single endpoint after the full two-pass analysis
 * (static AST + LLM fallback).
 */
export interface LlmEndpointResult {
  specPath: string;
  method: HttpMethod;
  requestViolations: LlmEndpointViolation[];
  responseViolations: LlmEndpointViolation[];
  /** How reliable this result is */
  confidence: "static:high" | "static:low" | "llm:resolved" | "llm:unresolved";
  notes?: string;
}

export interface LlmViolationInput {
  specPath: string;
  method: HttpMethod;
  specRequestSchema: ExtractedSchema | null;
  specResponseSchema: ExtractedSchema | null;
  /** All files fetched from the repository (mapper + extractor run inside the adapter) */
  files: RepositoryFile[];
  /**
   * Token used for LLM API calls. Passed per-request so each user's
   * own GitHub token is used rather than a shared service token.
   */
  githubToken?: string;
}

/**
 * PORT — analyses a single API endpoint against the provided repository files
 * and returns any schema violations found.
 *
 * Implementations live in infrastructure/ and are injected into AnalysisService.
 * The application layer has no knowledge of AST parsing, LLM calls, or prompt
 * building — those are adapter concerns.
 */
export interface LlmViolationProvider {
  analyseEndpoint(
    input: LlmViolationInput,
  ): ResultAsync<LlmEndpointResult, AppError>;
}
