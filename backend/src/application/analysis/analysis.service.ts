import crypto from "crypto";
import { err, ok, Result } from "neverthrow";
import { SpecVersionRepository } from "../../domain/spec";
import { AppError } from "../../shared/errors/app-error";
import {
  RepositorySnapshotProvider,
  SnapshotEndpointUsage,
  HttpMethod,
  ExtractedSchema,
} from "./contracts/repository-snapshot.provider";
import type { RepositoryFile } from "./contracts/repository-code.provider";
import type { LlmViolationProvider, LlmEndpointViolation } from "./contracts/llm-violation-provider";

export type InconsistencyType =
  | "missing_endpoint"
  | "extra_endpoint"
  | "method_mismatch"
  | "schema_mismatch";

export interface DiffLine {
  type: "match" | "error" | "warning" | "missing";
  line: string;
}

export interface SchemaDiffBlock {
  location: "requestBody" | "responseBody";
  expectedLines: DiffLine[];
  receivedLines: DiffLine[];
  errorCount: number;
  warningCount: number;
}

export type AnalysisConfidence =
  | "static:high"
  | "static:low"
  | "llm:resolved"
  | "llm:unresolved";

export interface InconsistencyItem {
  id: string;
  type: InconsistencyType;
  endpoint: string;
  method?: HttpMethod;
  message: string;
  severity: "warning" | "error";
  schemaDiff?: SchemaDiffBlock;
  confidence?: AnalysisConfidence;
}

export interface EndpointUsage {
  endpoint: string;
  method: HttpMethod;
  callCount: number;
  inSpec: boolean;
}

export interface RepositoryInconsistenciesView {
  repositoryId: string;
  specId: string;
  analyzedAt: string;
  totalApiCalls: number;
  endpointUsage: EndpointUsage[];
  inconsistencies: InconsistencyItem[];
}

export interface SpecViolationItem {
  id: string;
  type: InconsistencyType;
  endpoint: string;
  method?: HttpMethod;
  message: string;
  severity: "warning" | "error";
  schemaDiff?: SchemaDiffBlock;
  confidence?: AnalysisConfidence;
}

export interface SpecViolationsView {
  specId: string;
  repositoryId: string;
  analyzedAt: string;
  totalViolations: number;
  violations: SpecViolationItem[];
}

interface NormalizedOperation {
  path: string;
  method: HttpMethod;
  callCount?: number;
  requestBodySchema?: ExtractedSchema;
  responseBodySchema?: ExtractedSchema;
}

export class AnalysisService {
  constructor(
    private readonly specVersionRepository: SpecVersionRepository,
    private readonly snapshotProvider: RepositorySnapshotProvider,
    private readonly llmViolationProvider?: LlmViolationProvider,
  ) {}

  async getRepositoryInconsistencies(input: {
    repositoryId: string;
    specId?: string;
    githubAccessToken?: string;
  }): Promise<Result<RepositoryInconsistenciesView, AppError>> {
    if (!input.specId || input.specId.trim().length === 0) {
      return err(
        new AppError(
          "SPEC_SELECTION_REQUIRED",
          "Select a specification before running repository analysis.",
        ),
      );
    }

    const snapshotResult = await this.snapshotProvider.getSnapshot(
      input.repositoryId,
      input.githubAccessToken,
    );
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    const allVersionsResult = this.specVersionRepository.findBySpecId(
      input.specId,
    );

    const versionsResult = await allVersionsResult;
    if (versionsResult.isErr()) {
      return err(versionsResult.error);
    }

    const candidateVersions = versionsResult.value;

    if (candidateVersions.length === 0) {
      return err(
        new AppError(
          "SPEC_VERSION_NOT_FOUND",
          "No active spec version found for comparison",
        ),
      );
    }

    const specVersion = [...candidateVersions].sort(
      (a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime(),
    )[0];

    if (!specVersion) {
      return err(
        new AppError(
          "SPEC_VERSION_NOT_FOUND",
          "Spec version not found for comparison",
        ),
      );
    }

    if (specVersion.operationCount === 0) {
      return err(
        new AppError(
          "SPEC_VERSION_NOT_ANALYZABLE",
          "Selected spec has no analyzable operations. Upload a valid OpenAPI spec with endpoints.",
        ),
      );
    }

    const usageOps = normalizeUsage(snapshotResult.value.endpoints);
    if (usageOps.length === 0) {
      return err(
        new AppError(
          "REPOSITORY_SNAPSHOT_EMPTY",
          "No API endpoints were detected in this repository snapshot yet. Try another repository or improve extraction rules.",
        ),
      );
    }

    const specOps = specVersion.operations.map((operation) => ({
      path: operation.normalizedPath,
      method: operation.method,
      requestBodySchema:
        operation.requestBodySchema as unknown as ExtractedSchema,
      responseBodySchema:
        operation.responseBodySchema as unknown as ExtractedSchema,
    }));

    const inconsistencies = classifyInconsistencies(usageOps, specOps);
    const totalApiCalls = snapshotResult.value.endpoints.reduce(
      (acc, endpoint) => acc + endpoint.callCount,
      0,
    );

    const specPaths = new Set(specOps.map((op) => `${op.method}:${op.path}`));
    const endpointUsage: EndpointUsage[] = usageOps.map((op) => ({
      endpoint: op.path,
      method: op.method,
      callCount: op.callCount || 0,
      inSpec: specPaths.has(`${op.method}:${op.path}`),
    }));

    return ok({
      repositoryId: input.repositoryId,
      specId: specVersion.specId,
      analyzedAt: new Date().toISOString(),
      totalApiCalls,
      endpointUsage,
      inconsistencies,
    });
  }

  async getSpecViolations(input: {
    specId: string;
    repositoryId: string;
    githubAccessToken?: string;
  }): Promise<Result<SpecViolationsView, AppError>> {
    const analysisResult = await this.getRepositoryInconsistencies({
      repositoryId: input.repositoryId,
      specId: input.specId,
      githubAccessToken: input.githubAccessToken,
    });

    if (analysisResult.isErr()) {
      return err(analysisResult.error);
    }

    const violations = analysisResult.value.inconsistencies.map((item) => ({
      id: item.id,
      type: item.type,
      endpoint: item.endpoint,
      method: item.method,
      message: item.message,
      severity: item.severity,
      schemaDiff: item.schemaDiff,
    }));

    return ok({
      specId: input.specId,
      repositoryId: input.repositoryId,
      analyzedAt: analysisResult.value.analyzedAt,
      totalViolations: violations.length,
      violations,
    });
  }

  /**
   * LLM-powered schema violation analysis.
   *
   * Delegates to the injected LlmViolationProvider port which handles all
   * infrastructure concerns (AST parsing, endpoint mapping, prompt building,
   * LLM calls). The service only orchestrates: load spec → call port per
   * operation → assemble result.
   */
  async getLlmSchemaViolations(input: {
    specId: string;
    repositoryId: string;
    files: RepositoryFile[];
    /** Per-request auth token forwarded to the LLM adapter */
    githubToken?: string;
  }): Promise<Result<SpecViolationsView, AppError>> {
    if (!this.llmViolationProvider) {
      return err(new AppError("UNKNOWN_ERROR", "LLM violation provider is not configured"));
    }

    const allVersionsResult = await this.specVersionRepository.findBySpecId(input.specId);
    if (allVersionsResult.isErr()) return err(allVersionsResult.error);

    const versions = allVersionsResult.value;
    if (versions.length === 0) {
      return err(new AppError("SPEC_VERSION_NOT_FOUND", "No spec version found"));
    }

    const specVersion = [...versions].sort(
      (a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime(),
    )[0]!;

    // Analyse all operations in parallel (batched inside the provider)
    const results = await Promise.all(
      specVersion.operations.map((operation) =>
        this.llmViolationProvider!.analyseEndpoint({
          specPath: operation.path,
          method: operation.method,
          specRequestSchema: (operation.requestBodySchema as unknown as ExtractedSchema) ?? null,
          specResponseSchema: (operation.responseBodySchema as unknown as ExtractedSchema) ?? null,
          files: input.files,
          githubToken: input.githubToken,
        }),
      ),
    );

    const violations: SpecViolationItem[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      const operation = specVersion.operations[i]!;

      if (result.isErr()) {
        violations.push({
          id: crypto.randomUUID(),
          type: "schema_mismatch",
          endpoint: operation.normalizedPath,
          method: operation.method,
          message: `Analysis failed: ${result.error.message}`,
          severity: "warning",
          confidence: "llm:unresolved",
        });
        continue;
      }

      const { requestViolations, responseViolations, confidence, notes } = result.value;

      if (requestViolations.length > 0) {
        violations.push(makeLlmViolationItem(operation, requestViolations, "requestBody", confidence, notes));
      }
      if (responseViolations.length > 0) {
        violations.push(makeLlmViolationItem(operation, responseViolations, "responseBody", confidence, notes));
      }

      // Record as unresolved even when there are no violations, so the UI
      // can show the user that the endpoint was attempted but inconclusive
      if (requestViolations.length === 0 && responseViolations.length === 0 && confidence === "llm:unresolved") {
        violations.push({
          id: crypto.randomUUID(),
          type: "schema_mismatch",
          endpoint: operation.normalizedPath,
          method: operation.method,
          message: notes ?? `Unable to determine schema for ${operation.method} ${operation.path}`,
          severity: "warning",
          confidence: "llm:unresolved",
        });
      }
    }

    return ok({
      specId: input.specId,
      repositoryId: input.repositoryId,
      analyzedAt: new Date().toISOString(),
      totalViolations: violations.length,
      violations,
    });
  }
}

function normalizeUsage(
  endpoints: SnapshotEndpointUsage[],
): NormalizedOperation[] {
  return endpoints.map((endpoint) => ({
    path: normalizePath(endpoint.path),
    method: endpoint.method,
    callCount: endpoint.callCount,
    requestBodySchema: endpoint.requestBodySchema,
    responseBodySchema: endpoint.responseBodySchema,
  }));
}

export function normalizePath(value: string): string {
  if (!value || value.trim().length === 0) {
    return "/";
  }

  const withSlash = value.startsWith("/") ? value : `/${value}`;
  return (
    withSlash
      .replace(/:[^/]+/g, "{param}")
      .replace(/\{[^/]+\}/g, "{param}")
      .replace(/\/+/g, "/")
      .replace(/\/$/, "")
      .toLowerCase() || "/"
  );
}

function classifyInconsistencies(
  usageOps: NormalizedOperation[],
  specOps: NormalizedOperation[],
): InconsistencyItem[] {
  const inconsistencies: InconsistencyItem[] = [];

  const specByPath = new Map<string, Map<HttpMethod, NormalizedOperation>>();
  for (const operation of specOps) {
    const existing =
      specByPath.get(operation.path) ??
      new Map<HttpMethod, NormalizedOperation>();
    existing.set(operation.method, operation);
    specByPath.set(operation.path, existing);
  }

  const usageByPath = new Map<string, Set<HttpMethod>>();
  for (const operation of usageOps) {
    const existing = usageByPath.get(operation.path) ?? new Set<HttpMethod>();
    existing.add(operation.method);
    usageByPath.set(operation.path, existing);

    const allowedMethods = specByPath.get(operation.path);
    if (!allowedMethods) {
      inconsistencies.push({
        id: `extra:${operation.method}:${operation.path}`,
        type: "extra_endpoint",
        endpoint: operation.path,
        method: operation.method,
        message:
          "Endpoint is used in repository snapshot but not present in spec",
        severity: "error",
      });
      continue;
    }

    const specOp = allowedMethods.get(operation.method);
    if (!specOp) {
      inconsistencies.push({
        id: `method:${operation.method}:${operation.path}`,
        type: "method_mismatch",
        endpoint: operation.path,
        method: operation.method,
        message: `Method mismatch. Spec allows: ${[...allowedMethods.keys()].join(", ")}`,
        severity: "error",
      });
      continue;
    }

    if (specOp.requestBodySchema) {
      const extractedRequestSchema = operation.requestBodySchema ?? {
        type: "unknown" as const,
      };
      const diff = buildSchemaDiff(
        specOp.requestBodySchema,
        extractedRequestSchema,
        "requestBody",
      );
      if (diff) {
        const reqConfidence = operation.requestBodySchema?.confidence;
        inconsistencies.push({
          id: `schema:${operation.method}:${operation.path}:request`,
          type: "schema_mismatch",
          endpoint: operation.path,
          method: operation.method,
          message: `Request body schema mismatch — ${diff.errorCount} error(s), ${diff.warningCount} warning(s)`,
          severity: diff.errorCount > 0 ? "error" : "warning",
          schemaDiff: diff,
          confidence: reqConfidence === "high" ? "static:high" : "static:low",
        });
      }
    }

    if (specOp.responseBodySchema) {
      const extractedResponseSchema = operation.responseBodySchema ?? {
        type: "unknown" as const,
      };
      const diff = buildSchemaDiff(
        specOp.responseBodySchema,
        extractedResponseSchema,
        "responseBody",
      );
      if (diff) {
        const resConfidence = operation.responseBodySchema?.confidence;
        inconsistencies.push({
          id: `schema:${operation.method}:${operation.path}:response`,
          type: "schema_mismatch",
          endpoint: operation.path,
          method: operation.method,
          message: `Response body schema mismatch — ${diff.errorCount} error(s), ${diff.warningCount} warning(s)`,
          severity: diff.errorCount > 0 ? "error" : "warning",
          schemaDiff: diff,
          confidence: resConfidence === "high" ? "static:high" : "static:low",
        });
      }
    }
  }

  for (const operation of specOps) {
    if (!usageByPath.has(operation.path)) {
      inconsistencies.push({
        id: `missing:${operation.method}:${operation.path}`,
        type: "missing_endpoint",
        endpoint: operation.path,
        method: operation.method,
        message:
          "Endpoint is defined in spec but not seen in repository snapshot",
        severity: "warning",
      });
    }
  }

  return inconsistencies;
}

// ─── Deep schema diff engine ─────────────────────────────────────────────────

interface DiffAcc {
  exp: DiffLine[];
  rec: DiffLine[];
  errors: number;
  warnings: number;
}

function typeLabel(schema: ExtractedSchema): string {
  if (schema.type === "array") {
    return `array<${schema.items?.type ?? "unknown"}>`;
  }
  return schema.type;
}

/**
 * Recursively diff object properties at the given indent depth.
 * Both `acc.exp` and `acc.rec` always grow by the same number of lines so the
 * two panels stay visually aligned in the UI.
 */
function diffObjectFields(
  specProps: Record<string, ExtractedSchema>,
  extProps: Record<string, ExtractedSchema>,
  specRequired: Set<string>,
  indent: number,
  acc: DiffAcc,
): void {
  const pad = "  ".repeat(indent);

  // Spec fields first (preserves spec order), then any extra fields from extracted
  const allKeys = [
    ...Object.keys(specProps),
    ...Object.keys(extProps).filter((k) => !(k in specProps)),
  ];

  for (const key of allKeys) {
    const specField = specProps[key] as ExtractedSchema | undefined;
    const extField = extProps[key] as ExtractedSchema | undefined;
    const isRequired = specRequired.has(key);

    if (specField && extField) {
      if (specField.type !== extField.type) {
        // ── Type mismatch ──────────────────────────────────────────────────
        acc.exp.push({
          type: "error",
          line: `${pad}"${key}": "${typeLabel(specField)}"${isRequired ? "  // required" : ""}`,
        });
        acc.rec.push({
          type: "error",
          line: `${pad}"${key}": "${typeLabel(extField)}"`,
        });
        acc.errors++;
      } else if (specField.type === "object") {
        // ── Nested object — recurse ────────────────────────────────────────
        const nested: DiffAcc = { exp: [], rec: [], errors: 0, warnings: 0 };
        diffObjectFields(
          specField.properties ?? {},
          extField.properties ?? {},
          new Set(specField.required ?? []),
          indent + 1,
          nested,
        );
        const hasIssues = nested.errors > 0 || nested.warnings > 0;
        const hdrType: DiffLine["type"] = hasIssues ? "error" : "match";
        acc.exp.push({ type: hdrType, line: `${pad}"${key}": {` });
        acc.rec.push({ type: hdrType, line: `${pad}"${key}": {` });
        acc.exp.push(...nested.exp);
        acc.rec.push(...nested.rec);
        acc.exp.push({ type: "match", line: `${pad}}` });
        acc.rec.push({ type: "match", line: `${pad}}` });
        acc.errors += nested.errors;
        acc.warnings += nested.warnings;
      } else if (specField.type === "array") {
        const specItemType = specField.items?.type;
        const extItemType = extField.items?.type;

        if (specItemType && extItemType && specItemType !== extItemType) {
          // ── Array item type mismatch ───────────────────────────────────
          acc.exp.push({
            type: "error",
            line: `${pad}"${key}": "array<${specItemType}>"${isRequired ? "  // required" : ""}`,
          });
          acc.rec.push({
            type: "error",
            line: `${pad}"${key}": "array<${extItemType}>"`,
          });
          acc.errors++;
        } else if (
          specField.items?.type === "object" &&
          (specField.items.properties ?? extField.items?.properties)
        ) {
          // ── Array of objects — recurse into item schema ────────────────
          const nested: DiffAcc = { exp: [], rec: [], errors: 0, warnings: 0 };
          diffObjectFields(
            specField.items.properties ?? {},
            extField.items?.properties ?? {},
            new Set(specField.items.required ?? []),
            indent + 2,
            nested,
          );
          const hasIssues = nested.errors > 0 || nested.warnings > 0;
          const hdrType: DiffLine["type"] = hasIssues ? "error" : "match";
          acc.exp.push({ type: hdrType, line: `${pad}"${key}": [{` });
          acc.rec.push({ type: hdrType, line: `${pad}"${key}": [{` });
          acc.exp.push(...nested.exp);
          acc.rec.push(...nested.rec);
          acc.exp.push({ type: "match", line: `${pad}}]` });
          acc.rec.push({ type: "match", line: `${pad}}]` });
          acc.errors += nested.errors;
          acc.warnings += nested.warnings;
        } else {
          // ── Arrays match ───────────────────────────────────────────────
          const itemType = specField.items?.type ?? "unknown";
          acc.exp.push({
            type: "match",
            line: `${pad}"${key}": "array<${itemType}>"${isRequired ? "  // required" : ""}`,
          });
          acc.rec.push({
            type: "match",
            line: `${pad}"${key}": "array<${itemType}>"`,
          });
        }
      } else {
        // ── Primitive match ────────────────────────────────────────────────
        acc.exp.push({
          type: "match",
          line: `${pad}"${key}": "${specField.type}"${isRequired ? "  // required" : ""}`,
        });
        acc.rec.push({
          type: "match",
          line: `${pad}"${key}": "${extField.type}"`,
        });
      }
    } else if (specField && !extField) {
      // ── Field defined in spec but absent from extracted ──────────────────
      const lineType: DiffLine["type"] = isRequired ? "error" : "missing";
      acc.exp.push({
        type: lineType,
        line: `${pad}"${key}": "${typeLabel(specField)}"  // ${isRequired ? "required — missing" : "optional — not found"}`,
      });
      acc.rec.push({ type: "missing", line: "" });
      if (isRequired) acc.errors++;
      else acc.warnings++;
    } else if (!specField && extField) {
      // ── Extra field in extracted that is not in spec ─────────────────────
      acc.exp.push({ type: "missing", line: "" });
      acc.rec.push({
        type: "warning",
        line: `${pad}"${key}": "${typeLabel(extField)}"  // extra`,
      });
      acc.warnings++;
    }
  }
}

/**
 * Build a pre-formatted side-by-side schema diff block.
 * Returns null when there are no differences (no inconsistency to report).
 */
export function buildSchemaDiff(
  spec: ExtractedSchema,
  extracted: ExtractedSchema,
  location: "requestBody" | "responseBody",
): SchemaDiffBlock | null {
  // Scanner had no schema data for this endpoint — cannot compare, skip silently
  if (extracted.type === "unknown") {
    return null;
  }

  // Top-level type mismatch
  if (spec.type !== extracted.type) {
    return {
      location,
      expectedLines: [{ type: "error", line: `// type: "${spec.type}"` }],
      receivedLines: [{ type: "error", line: `// type: "${extracted.type}"` }],
      errorCount: 1,
      warningCount: 0,
    };
  }

  if (spec.type === "object") {
    const acc: DiffAcc = { exp: [], rec: [], errors: 0, warnings: 0 };
    diffObjectFields(
      spec.properties ?? {},
      extracted.properties ?? {},
      new Set(spec.required ?? []),
      1,
      acc,
    );

    if (acc.errors === 0 && acc.warnings === 0) return null;

    return {
      location,
      expectedLines: [
        { type: "match", line: "{" },
        ...acc.exp,
        { type: "match", line: "}" },
      ],
      receivedLines: [
        { type: "match", line: "{" },
        ...acc.rec,
        { type: "match", line: "}" },
      ],
      errorCount: acc.errors,
      warningCount: acc.warnings,
    };
  }

  if (spec.type === "array") {
    const specItemType = spec.items?.type;
    const extItemType = extracted.items?.type;

    if (specItemType && extItemType && specItemType !== extItemType) {
      return {
        location,
        expectedLines: [{ type: "error", line: `array<${specItemType}>` }],
        receivedLines: [{ type: "error", line: `array<${extItemType}>` }],
        errorCount: 1,
        warningCount: 0,
      };
    }

    if (
      spec.items?.type === "object" &&
      (spec.items.properties ?? extracted.items?.properties)
    ) {
      const acc: DiffAcc = { exp: [], rec: [], errors: 0, warnings: 0 };
      diffObjectFields(
        spec.items.properties ?? {},
        extracted.items?.properties ?? {},
        new Set(spec.items.required ?? []),
        1,
        acc,
      );

      if (acc.errors === 0 && acc.warnings === 0) return null;

      return {
        location,
        expectedLines: [
          { type: "match", line: "[{" },
          ...acc.exp,
          { type: "match", line: "}]" },
        ],
        receivedLines: [
          { type: "match", line: "[{" },
          ...acc.rec,
          { type: "match", line: "}]" },
        ],
        errorCount: acc.errors,
        warningCount: acc.warnings,
      };
    }
  }

  return null;
}

// ── LLM analysis helpers ──────────────────────────────────────────────────────

function makeLlmViolationItem(
  operation: { path: string; method: HttpMethod; normalizedPath: string },
  violations: LlmEndpointViolation[],
  location: "requestBody" | "responseBody",
  confidence: AnalysisConfidence,
  notes?: string,
): SpecViolationItem {
  const errorCount = violations.filter(
    (v) => v.violationType === "type_mismatch" || v.violationType === "missing_field",
  ).length;
  const warningCount = violations.filter((v) => v.violationType === "extra_field").length;

  const expectedLines: DiffLine[] = violations.map((v) => {
    if (v.violationType === "extra_field") {
      return { type: "missing" as const, line: `"${v.field}": not in spec` };
    }
    return { type: "error" as const, line: `"${v.field}": "${v.expected}"` };
  });

  const receivedLines: DiffLine[] = violations.map((v) => {
    if (v.violationType === "missing_field") {
      return { type: "error" as const, line: `"${v.field}": missing` };
    }
    if (v.violationType === "extra_field") {
      return { type: "warning" as const, line: `"${v.field}": "${v.received}"  // extra` };
    }
    return {
      type: "error" as const,
      line: `"${v.field}": "${v.received}"  // expected ${v.expected}`,
    };
  });

  const message = notes
    ? `${location === "requestBody" ? "Request" : "Response"} body mismatch — ${notes}`
    : `${location === "requestBody" ? "Request" : "Response"} body mismatch — ${errorCount} error(s), ${warningCount} warning(s)`;

  return {
    id: crypto.randomUUID(),
    type: "schema_mismatch",
    endpoint: operation.normalizedPath,
    method: operation.method,
    message,
    severity: errorCount > 0 ? "error" : "warning",
    schemaDiff: {
      location,
      expectedLines,
      receivedLines,
      errorCount,
      warningCount,
    },
    confidence,
  };
}
