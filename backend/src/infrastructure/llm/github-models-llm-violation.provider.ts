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
import {
  buildSchemaComparisonPrompt,
  buildSchemaResolutionPrompt,
} from "./prompt-builder";
import {
  callLlmForSchemaComparison,
  callLlmForSchemaResolution,
  type LlmViolation,
} from "./llm-caller";
import { resolveSchemaAgentically } from "./agentic-schema-resolver";

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
    let bestStatic: {
      requestBody: ReturnType<typeof extractSchemasFromFile>["requestBody"];
      responseBody: ReturnType<typeof extractSchemasFromFile>["responseBody"];
    } | null = null;

    if (match.routeFiles.length > 0) {
      for (const routeFile of match.routeFiles) {
        const extracted = extractSchemasFromFile(routeFile.content, routeFile.path);

        const requestResolved = extracted.requestBody.confidence !== "unresolved";
        const responseResolved = extracted.responseBody.confidence !== "unresolved";

        // Track the best static extraction we saw so we can pass confidence
        // context into the LLM prompt (even when we still need the LLM).
        if (!bestStatic) {
          bestStatic = extracted;
        } else {
          const score = (c: string) => (c === "high" ? 2 : c === "low" ? 1 : 0);
          const prevScore =
            score(bestStatic.requestBody.confidence) +
            score(bestStatic.responseBody.confidence);
          const nextScore =
            score(extracted.requestBody.confidence) +
            score(extracted.responseBody.confidence);
          if (nextScore > prevScore) bestStatic = extracted;
        }

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

    // If static was high confidence for both sides, trust it completely and
    // skip LLM calls (Req 3).
    if (
      bestStatic &&
      bestStatic.requestBody.confidence === "high" &&
      bestStatic.responseBody.confidence === "high"
    ) {
      const reqViolations =
        input.specRequestSchema && bestStatic.requestBody.schema
          ? compareSchemas(input.specRequestSchema, bestStatic.requestBody.schema, "requestBody")
          : [];
      const resViolations =
        input.specResponseSchema && bestStatic.responseBody.schema
          ? compareSchemas(input.specResponseSchema, bestStatic.responseBody.schema, "responseBody")
          : [];

      return {
        specPath: input.specPath,
        method: input.method,
        requestViolations: reqViolations,
        responseViolations: resViolations,
        confidence: "static:high",
      };
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

    const token = input.githubToken ?? this.githubToken;
    // ── Pass 1: Schema resolution (no spec comparison) ────────────────────
    const unresolvedRequest = (bestStatic?.requestBody.confidence ?? "unresolved") === "unresolved";
    const unresolvedResponse = (bestStatic?.responseBody.confidence ?? "unresolved") === "unresolved";

    const resolved = unresolvedRequest || unresolvedResponse
      ? await resolveSchemaAgentically({
          repositoryId: "unknown",
          method: input.method,
          path: input.specPath,
          handlerHintFile: match.routeFiles[0]?.path,
          files: input.files,
          githubToken: token,
          maxTurns: 15,
        }).then((r) =>
          r.map((value) => ({
            requestBodySchema: value.requestBodySchema,
            responseBodySchema: value.responseBodySchema,
            requestConfidence: value.requestBodySchema ? "resolved" : "failed",
            responseConfidence: value.responseBodySchema ? "resolved" : "failed",
            notes: value.notes.join("; "),
          })),
        )
      : await callLlmForSchemaResolution(
          buildSchemaResolutionPrompt({
            specPath: input.specPath,
            method: input.method,
            staticRequestSchema: bestStatic?.requestBody.schema ?? null,
            staticRequestConfidence: bestStatic?.requestBody.confidence ?? "unresolved",
            staticRequestReason: bestStatic?.requestBody.reason ?? "",
            staticResponseSchema: bestStatic?.responseBody.schema ?? null,
            staticResponseConfidence: bestStatic?.responseBody.confidence ?? "unresolved",
            staticResponseReason: bestStatic?.responseBody.reason ?? "",
            routeFiles: match.routeFiles,
            modelFiles: match.modelFiles,
            typeFiles: match.typeFiles,
          }),
          token,
        );
    if (resolved.isErr()) {
      return {
        specPath: input.specPath,
        method: input.method,
        requestViolations: [],
        responseViolations: [],
        confidence: "llm:unresolved",
        notes: `LLM schema resolution failed: ${resolved.error.message}`,
      };
    }

    // ── Pass 2: Schema comparison (no code in prompt) ─────────────────────
    const comparePrompt = buildSchemaComparisonPrompt({
      specPath: input.specPath,
      method: input.method,
      specRequestSchema: input.specRequestSchema,
      specResponseSchema: input.specResponseSchema,
      implRequestSchema: resolved.value.requestBodySchema,
      implResponseSchema: resolved.value.responseBodySchema,
    });

    const llmResult = await callLlmForSchemaComparison(comparePrompt, token);

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
      notes: [resolved.value.notes, notes].filter(Boolean).join(" | "),
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
