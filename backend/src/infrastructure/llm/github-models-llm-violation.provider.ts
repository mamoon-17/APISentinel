import { ResultAsync } from "neverthrow";
import { AppError } from "../../shared/errors/app-error";
import type {
  LlmViolationProvider,
  LlmViolationInput,
  LlmEndpointResult,
  LlmEndpointViolation,
} from "../../application/analysis/contracts/llm-violation-provider";
import { extractSchemasFromFile } from "../analysis/ast-code-scanner";
import { mapEndpointsToFiles } from "../analysis/endpoint-file-mapper";
import { buildViolationPrompt } from "./prompt-builder";
import { callLlmForViolations, type LlmViolation } from "./llm-caller";

/**
 * ADAPTER — implements the LlmViolationProvider port using:
 *   1. ts-morph AST static extraction (fast, free, deterministic)
 *   2. GPT-4.1-mini via GitHub Models (for unresolved endpoints)
 *
 * All infrastructure concerns (AST, LLM, prompt building) are contained here.
 * The application layer only sees the port interface.
 */
export class GithubModelsLlmViolationProvider implements LlmViolationProvider {
  constructor(
    private readonly githubToken: string,
    private readonly llmEnabled: boolean,
  ) {}

  analyseEndpoint(
    input: LlmViolationInput,
  ): ResultAsync<LlmEndpointResult, AppError> {
    return ResultAsync.fromPromise(
      this.doAnalyse(input),
      (e) =>
        e instanceof AppError
          ? e
          : new AppError("UNKNOWN_ERROR", String(e)),
    );
  }

  private async doAnalyse(input: LlmViolationInput): Promise<LlmEndpointResult> {
    const match = mapEndpointsToFiles(input.specPath, input.method, input.files);

    // ── Static AST pass ────────────────────────────────────────────────────
    if (match.routeFiles.length > 0) {
      for (const routeFile of match.routeFiles) {
        const extracted = extractSchemasFromFile(routeFile.content, routeFile.path);

        const requestResolved = extracted.requestBody.confidence !== "unresolved";
        const responseResolved = extracted.responseBody.confidence !== "unresolved";

        if (requestResolved || responseResolved) {
          const confidence =
            extracted.requestBody.confidence === "high" && extracted.responseBody.confidence === "high"
              ? "static:high"
              : "static:low";

          // Build violations from the diff between spec and extracted schemas
          const reqViolations = input.specRequestSchema && extracted.requestBody.schema
            ? compareSchemas(input.specRequestSchema, extracted.requestBody.schema, "requestBody")
            : [];
          const resViolations = input.specResponseSchema && extracted.responseBody.schema
            ? compareSchemas(input.specResponseSchema, extracted.responseBody.schema, "responseBody")
            : [];

          return {
            specPath: input.specPath,
            method: input.method,
            requestViolations: reqViolations,
            responseViolations: resViolations,
            confidence,
          };
        }
      }
    }

    // ── LLM pass (only if enabled and static could not resolve) ───────────
    if (!this.llmEnabled) {
      return {
        specPath: input.specPath,
        method: input.method,
        requestViolations: [],
        responseViolations: [],
        confidence: "llm:unresolved",
        notes: "LLM is disabled — enable LLM_ENABLED=true in .env to run AI analysis",
      };
    }

    const prompt = buildViolationPrompt({
      specPath: input.specPath,
      method: input.method,
      specRequestSchema: input.specRequestSchema,
      specResponseSchema: input.specResponseSchema,
      routeFiles: match.routeFiles,
      modelFiles: match.modelFiles,
      typeFiles: match.typeFiles,
    });

    const token = input.githubToken ?? this.githubToken;
    const llmResult = await callLlmForViolations(prompt, token);

    if (llmResult.isErr()) {
      return {
        specPath: input.specPath,
        method: input.method,
        requestViolations: [],
        responseViolations: [],
        confidence: "llm:unresolved",
        notes: `LLM call failed: ${llmResult.error.message}`,
      };
    }

    const { requestViolations, responseViolations, confidence, notes } = llmResult.value;

    const llmConfidence =
      requestViolations.length > 0 || responseViolations.length > 0
        ? "llm:resolved"
        : confidence === "low"
          ? "llm:unresolved"
          : "llm:resolved";

    return {
      specPath: input.specPath,
      method: input.method,
      requestViolations: requestViolations.map(adaptLlmViolation),
      responseViolations: responseViolations.map(adaptLlmViolation),
      confidence: llmConfidence,
      notes,
    };
  }
}

function adaptLlmViolation(v: LlmViolation): LlmEndpointViolation {
  return {
    field: v.field,
    expected: v.expected,
    received: v.received,
    violationType: v.violationType,
    location: v.location,
  };
}

/**
 * Very lightweight schema comparison for the static pass.
 * Detects type mismatches and missing/extra fields between two extracted schemas.
 */
function compareSchemas(
  spec: { type?: string; properties?: Record<string, { type?: string }> },
  actual: { type?: string; properties?: Record<string, { type?: string }> },
  location: "requestBody" | "responseBody",
): LlmEndpointViolation[] {
  const violations: LlmEndpointViolation[] = [];

  const specProps = spec.properties ?? {};
  const actualProps = actual.properties ?? {};

  // Fields in spec but missing in actual
  for (const [field, specField] of Object.entries(specProps)) {
    if (!(field in actualProps)) {
      violations.push({
        field,
        expected: specField.type ?? "unknown",
        received: "missing",
        violationType: "missing_field",
        location,
      });
    } else if (
      specField.type &&
      actualProps[field]?.type &&
      actualProps[field]?.type !== "unknown" &&
      specField.type !== actualProps[field]?.type
    ) {
      violations.push({
        field,
        expected: specField.type,
        received: actualProps[field]!.type!,
        violationType: "type_mismatch",
        location,
      });
    }
  }

  // Fields in actual but not in spec
  for (const field of Object.keys(actualProps)) {
    if (!(field in specProps)) {
      violations.push({
        field,
        expected: "not in spec",
        received: actualProps[field]?.type ?? "unknown",
        violationType: "extra_field",
        location,
      });
    }
  }

  return violations;
}
