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
import type {
  LlmViolationProvider,
  LlmEndpointViolation,
} from "./contracts/llm-violation-provider";

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
  expectedRequestBodySchema?: ExtractedSchema;
  receivedRequestBodySchema?: ExtractedSchema;
  /** Backend-declared / inferred response shape */
  expectedResponseBodySchema?: ExtractedSchema;
  /** Shape the frontend code appears to consume (destructuring, etc.) */
  receivedResponseBodySchema?: ExtractedSchema;
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
    const snapshotResult = await this.snapshotProvider.getSnapshot(
      input.repositoryId,
      input.githubAccessToken,
    );
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    // No spec selected → run Frontend ↔ Backend comparison
    if (!input.specId || input.specId.trim().length === 0) {
      return ok(
        buildFrontendBackendView({
          repositoryId: input.repositoryId,
          analyzedAt: new Date().toISOString(),
          endpoints: snapshotResult.value.endpoints,
        }),
      );
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

    // Spec comparison should only consider server-side routes.
    const usageOps = normalizeUsage(
      snapshotResult.value.endpoints.filter((e) => e.source !== "client"),
    );
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
    const specOpByKey = new Map<string, NormalizedOperation>(
      specOps.map((op) => [`${op.method}:${op.path}`, op] as const),
    );
    const endpointUsage: EndpointUsage[] = usageOps.map((op) => {
      const key = `${op.method}:${op.path}`;
      const specOp = specOpByKey.get(key);
      return {
        endpoint: op.path,
        method: op.method,
        callCount: op.callCount || 0,
        inSpec: specPaths.has(key),
        expectedRequestBodySchema: specOp?.requestBodySchema,
        receivedRequestBodySchema: op.requestBodySchema,
        expectedResponseBodySchema: specOp?.responseBodySchema,
        receivedResponseBodySchema: op.responseBodySchema,
      };
    });

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
   * LLM-powered Frontend ↔ Backend verification.
   *
   * Re-runs the static FE↔BE analysis, then for each schema-mismatch
   * inconsistency, asks the LLM to verify by examining the backend handler
   * code. Treats the frontend's extracted request body as the "spec" the
   * backend should accept.
   */
  async getLlmFrontendBackendViolations(input: {
    repositoryId: string;
    files: RepositoryFile[];
    githubToken?: string;
  }): Promise<Result<RepositoryInconsistenciesView, AppError>> {
    if (!this.llmViolationProvider) {
      return err(
        new AppError(
          "LLM_NOT_CONFIGURED",
          "AI analysis is not enabled on this server. Configure LLM in the backend to use this feature.",
        ),
      );
    }

    const snapshotResult = await this.snapshotProvider.getSnapshot(
      input.repositoryId,
      input.githubToken,
    );
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    const baseView = buildFrontendBackendView({
      repositoryId: input.repositoryId,
      analyzedAt: new Date().toISOString(),
      endpoints: snapshotResult.value.endpoints,
    });

    // For each schema_mismatch we have frontend body data for, ask the LLM to
    // re-verify against the actual backend handler files. This refines the
    // received-side schema with high-confidence type info from the backend
    // source (e.g. TypeScript types, validation schemas).
    const refined: InconsistencyItem[] = [];

    for (const item of baseView.inconsistencies) {
      // Only schema mismatches benefit from LLM verification — others
      // (missing/extra/method) are factual signals about route presence.
      if (item.type !== "schema_mismatch" || !item.schemaDiff || !item.method) {
        refined.push({ ...item, confidence: item.confidence ?? "static:low" });
        continue;
      }

      // The "spec request schema" the LLM compares against is the frontend's
      // extracted body shape — what the backend is being asked to accept.
      const matchingClient = snapshotResult.value.endpoints.find(
        (e) =>
          e.source === "client" &&
          e.method === item.method &&
          feBeMatchPath(normalizePath(e.path)) === feBeMatchPath(item.endpoint),
      );

      const llmResult = await this.llmViolationProvider.analyseEndpoint({
        specPath: item.endpoint,
        method: item.method,
        specRequestSchema: matchingClient?.requestBodySchema ?? null,
        specResponseSchema: null,
        files: input.files,
        githubToken: input.githubToken,
      });

      if (llmResult.isErr()) {
        refined.push({ ...item, confidence: "llm:unresolved" });
        continue;
      }

      const { requestViolations, confidence, notes } = llmResult.value;

      if (requestViolations.length === 0) {
        // LLM confirmed no real mismatch — drop the static false positive.
        continue;
      }

      // The LLM was given the frontend body as "spec" and the backend handler
      // as "code". In its output: v.expected = frontend type, v.received =
      // backend type. We swap to match the UI's columns where the left
      // ("Expected") shows the backend and the right ("Received") shows the
      // frontend.
      const errorCount = requestViolations.filter(
        (v) =>
          v.violationType === "type_mismatch" ||
          v.violationType === "missing_field",
      ).length;
      const warningCount = requestViolations.filter(
        (v) => v.violationType === "extra_field",
      ).length;

      const expectedLines: DiffLine[] = requestViolations.map((v) => {
        if (v.violationType === "missing_field") {
          // Frontend sends this field, backend handler does not read it.
          return {
            type: "missing",
            line: `"${v.field}": not accepted by backend`,
          };
        }
        if (v.violationType === "extra_field") {
          // Backend handler reads a field that the frontend never sends.
          return {
            type: "error",
            line: `"${v.field}": "${v.received}"  // required by backend`,
          };
        }
        // Type mismatch — backend's actual type
        return { type: "error", line: `"${v.field}": "${v.received}"` };
      });

      const receivedLines: DiffLine[] = requestViolations.map((v) => {
        if (v.violationType === "missing_field") {
          return {
            type: "warning",
            line: `"${v.field}": "${v.expected}"  // sent by frontend`,
          };
        }
        if (v.violationType === "extra_field") {
          return {
            type: "missing",
            line: `"${v.field}": not sent by frontend`,
          };
        }
        // Type mismatch — frontend's actual type
        return { type: "error", line: `"${v.field}": "${v.expected}"` };
      });

      refined.push({
        ...item,
        message: notes
          ? `Request body mismatch (AI verified) — ${notes}`
          : `Request body mismatch (AI verified) — ${errorCount} error(s), ${warningCount} warning(s)`,
        severity: errorCount > 0 ? "error" : "warning",
        schemaDiff: {
          location: "requestBody",
          expectedLines,
          receivedLines,
          errorCount,
          warningCount,
        },
        confidence,
      });
    }

    return ok({
      ...baseView,
      inconsistencies: refined,
    });
  }

  async getFrontendBackendViolationsFromEndpoints(input: {
    repositoryId: string;
    endpoints: SnapshotEndpointUsage[];
  }): Promise<Result<RepositoryInconsistenciesView, AppError>> {
    return ok(
      buildFrontendBackendView({
        repositoryId: input.repositoryId,
        analyzedAt: new Date().toISOString(),
        endpoints: input.endpoints,
      }),
    );
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
      return err(
        new AppError(
          "LLM_NOT_CONFIGURED",
          "AI analysis is not enabled on this server. Configure the LLM in the backend to use this feature.",
        ),
      );
    }

    const allVersionsResult = await this.specVersionRepository.findBySpecId(
      input.specId,
    );
    if (allVersionsResult.isErr()) return err(allVersionsResult.error);

    const versions = allVersionsResult.value;
    if (versions.length === 0) {
      return err(
        new AppError("SPEC_VERSION_NOT_FOUND", "No spec version found"),
      );
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
          specRequestSchema:
            (operation.requestBodySchema as unknown as ExtractedSchema) ?? null,
          specResponseSchema:
            (operation.responseBodySchema as unknown as ExtractedSchema) ??
            null,
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

      const { requestViolations, responseViolations, confidence, notes } =
        result.value;

      if (requestViolations.length > 0) {
        violations.push(
          makeLlmViolationItem(
            operation,
            requestViolations,
            "requestBody",
            confidence,
            notes,
          ),
        );
      }
      if (responseViolations.length > 0) {
        violations.push(
          makeLlmViolationItem(
            operation,
            responseViolations,
            "responseBody",
            confidence,
            notes,
          ),
        );
      }

      // Record as unresolved even when there are no violations, so the UI
      // can show the user that the endpoint was attempted but inconclusive
      if (
        requestViolations.length === 0 &&
        responseViolations.length === 0 &&
        confidence === "llm:unresolved"
      ) {
        violations.push({
          id: crypto.randomUUID(),
          type: "schema_mismatch",
          endpoint: operation.normalizedPath,
          method: operation.method,
          message:
            notes ??
            `Unable to determine schema for ${operation.method} ${operation.path}`,
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

function buildFrontendBackendView(input: {
  repositoryId: string;
  analyzedAt: string;
  endpoints: SnapshotEndpointUsage[];
}): RepositoryInconsistenciesView {
  const clientOps = normalizeUsage(
    input.endpoints.filter((e) => e.source === "client"),
  );
  const serverOps = normalizeUsage(
    input.endpoints.filter((e) => e.source === "server"),
  );

  const serverByPath = new Map<string, Set<HttpMethod>>();
  for (const op of serverOps) {
    const matchKey = feBeMatchPath(op.path);
    const set = serverByPath.get(matchKey) ?? new Set<HttpMethod>();
    set.add(op.method);
    serverByPath.set(matchKey, set);
  }

  const clientByPath = new Map<string, Set<HttpMethod>>();
  for (const op of clientOps) {
    const matchKey = feBeMatchPath(op.path);
    const set = clientByPath.get(matchKey) ?? new Set<HttpMethod>();
    set.add(op.method);
    clientByPath.set(matchKey, set);
  }

  const inconsistencies: InconsistencyItem[] = [];

  for (const op of clientOps) {
    const allowed = serverByPath.get(feBeMatchPath(op.path));
    if (!allowed) {
      inconsistencies.push({
        id: `extra:${op.method}:${op.path}`,
        type: "extra_endpoint",
        endpoint: op.path,
        method: op.method,
        message:
          "Endpoint is called from the Frontend but no matching Backend route was detected in this repository.",
        severity: "error",
        schemaDiff: buildBodyOnlyDiff(
          undefined,
          op.requestBodySchema,
          "missing-backend",
        ),
      });
      continue;
    }

    if (!allowed.has(op.method)) {
      inconsistencies.push({
        id: `method:${op.method}:${op.path}`,
        type: "method_mismatch",
        endpoint: op.path,
        method: op.method,
        message: `Method mismatch. Backend routes detected: ${[...allowed.keys()].join(", ")}`,
        severity: "error",
        schemaDiff: buildBodyOnlyDiff(
          undefined,
          op.requestBodySchema,
          "method-mismatch",
        ),
      });
    }
  }

  // Schema mismatches for endpoints that exist on both sides (request + response)
  for (const server of serverOps) {
    const matchingClient = clientOps.find(
      (c) =>
        feBeMatchPath(c.path) === feBeMatchPath(server.path) &&
        c.method === server.method,
    );
    if (!matchingClient) continue;

    if (server.requestBodySchema && matchingClient.requestBodySchema) {
      const diff = buildSchemaDiff(
        server.requestBodySchema,
        matchingClient.requestBodySchema,
        "requestBody",
      );
      if (diff) {
        inconsistencies.push({
          id: `schema:${server.method}:${server.path}:request`,
          type: "schema_mismatch",
          endpoint: server.path,
          method: server.method,
          message: `Request body mismatch — ${diff.errorCount} error(s), ${diff.warningCount} warning(s)`,
          severity: diff.errorCount > 0 ? "error" : "warning",
          schemaDiff: diff,
          confidence: "static:low",
        });
      }
    }

    if (server.responseBodySchema && matchingClient.responseBodySchema) {
      const diff = buildSchemaDiff(
        server.responseBodySchema,
        matchingClient.responseBodySchema,
        "responseBody",
      );
      if (diff) {
        inconsistencies.push({
          id: `schema:${server.method}:${server.path}:response`,
          type: "schema_mismatch",
          endpoint: server.path,
          method: server.method,
          message: `Response body mismatch — ${diff.errorCount} error(s), ${diff.warningCount} warning(s)`,
          severity: diff.errorCount > 0 ? "error" : "warning",
          schemaDiff: diff,
          confidence: "static:low",
        });
      }
    }
  }

  // Backend routes that are never called from frontend (show, but treat as low-signal warnings)
  for (const op of serverOps) {
    const calledMethods = clientByPath.get(feBeMatchPath(op.path));
    if (!calledMethods || !calledMethods.has(op.method)) {
      inconsistencies.push({
        id: `missing:${op.method}:${op.path}`,
        type: "missing_endpoint",
        endpoint: op.path,
        method: op.method,
        message:
          "Backend route was detected but no matching Frontend call was found in this repository.",
        severity: "warning",
      });
    }
  }

  const totalApiCalls = input.endpoints
    .filter((e) => e.source === "client")
    .reduce((acc, endpoint) => acc + endpoint.callCount, 0);

  // API Usage should list ALL backend endpoints, even with 0 frontend calls.
  const clientCountByKey = new Map<string, number>();
  const clientRequestByKey = new Map<string, ExtractedSchema | undefined>();
  const clientResponseByKey = new Map<string, ExtractedSchema | undefined>();
  for (const c of clientOps) {
    const key = `${c.method}:${feBeMatchPath(c.path)}`;
    clientCountByKey.set(
      key,
      (clientCountByKey.get(key) ?? 0) + (c.callCount ?? 0),
    );
    if (!clientRequestByKey.has(key)) {
      clientRequestByKey.set(key, c.requestBodySchema);
    }
    if (!clientResponseByKey.has(key)) {
      clientResponseByKey.set(key, c.responseBodySchema);
    }
  }

  const endpointUsage: EndpointUsage[] = serverOps.map((op) => {
    const key = `${op.method}:${feBeMatchPath(op.path)}`;
    const callCount = clientCountByKey.get(key) ?? 0;
    return {
      endpoint: op.path,
      method: op.method,
      callCount,
      // "inSpec" reused by UI — here it means "called by frontend"
      inSpec: callCount > 0,
      expectedRequestBodySchema: op.requestBodySchema,
      receivedRequestBodySchema: clientRequestByKey.get(key),
      expectedResponseBodySchema: op.responseBodySchema,
      receivedResponseBodySchema: clientResponseByKey.get(key),
    };
  });

  return {
    repositoryId: input.repositoryId,
    specId: "frontend-backend",
    analyzedAt: input.analyzedAt,
    totalApiCalls,
    endpointUsage,
    inconsistencies,
  };
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

/**
 * Normalize a path for Frontend ↔ Backend matching.
 *
 * Strips common prefixes so that frontend calls like `/api/v1/users` match
 * backend routes declared as `/users`, and resolves unresolved base-URL
 * variables (`/{param}/api/users` → `/api/users`).
 *
 * Applied to BOTH frontend and backend paths before comparison.
 */
function feBeMatchPath(normalizedPath: string): string {
  let p = normalizedPath.startsWith("/")
    ? normalizedPath
    : `/${normalizedPath}`;

  // Strip unresolved base-URL variable prefix (e.g. /{param}/api/users → /api/users)
  if (p.startsWith("/{param}/")) {
    p = p.slice("/{param}".length);
  }

  // Strip common API + version prefixes in order from most-specific to least.
  // This lets /api/v1/users and /v1/users and /api/users all match /users.
  const prefixesToStrip = [
    "/api/v1", "/api/v2", "/api/v3",
    "/api",
    "/v1", "/v2", "/v3",
  ];
  for (const prefix of prefixesToStrip) {
    if (p.startsWith(prefix + "/") || p === prefix) {
      const rest = p.slice(prefix.length);
      p = !rest || rest === "/" ? "/" : rest.startsWith("/") ? rest : `/${rest}`;
      break;
    }
  }

  return p || "/";
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
    const usedMethods = usageByPath.get(operation.path);
    if (!usedMethods || !usedMethods.has(operation.method)) {
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

/**
 * Build a one-sided diff block — used for inconsistency types that are not a
 * traditional "spec vs received" mismatch (extra_endpoint, method_mismatch),
 * but still benefit from showing the body that was observed in code so the
 * user can inspect what the frontend actually sends.
 */
function buildBodyOnlyDiff(
  expected: ExtractedSchema | undefined,
  received: ExtractedSchema | undefined,
  reason: "missing-backend" | "method-mismatch",
): SchemaDiffBlock | undefined {
  if (!expected && !received) return undefined;

  const expectedLines: DiffLine[] = expected
    ? renderSchemaLines(expected, 0, "match")
    : [
        {
          type: "missing",
          line:
            reason === "missing-backend"
              ? "// no matching backend route"
              : "// no backend route for this method",
        },
      ];

  const receivedLines: DiffLine[] = received
    ? renderSchemaLines(received, 0, "warning")
    : [{ type: "missing", line: "// no body detected from frontend call" }];

  return {
    location: "requestBody",
    expectedLines,
    receivedLines,
    errorCount: 0,
    warningCount: received ? Object.keys(received.properties ?? {}).length : 0,
  };
}

function renderSchemaLines(
  schema: ExtractedSchema,
  indent: number,
  type: DiffLine["type"],
): DiffLine[] {
  const pad = "  ".repeat(indent);

  if (schema.type === "object") {
    const lines: DiffLine[] = [{ type: "match", line: `${pad}{` }];
    const props = schema.properties ?? {};
    for (const [key, child] of Object.entries(props)) {
      if (child.type === "object" || child.type === "array") {
        lines.push({
          type,
          line: `${pad}  "${key}": ${typeLabelLocal(child)}`,
        });
      } else {
        lines.push({ type, line: `${pad}  "${key}": "${child.type}"` });
      }
    }
    lines.push({ type: "match", line: `${pad}}` });
    return lines;
  }

  if (schema.type === "array") {
    return [{ type, line: `${pad}${typeLabelLocal(schema)}` }];
  }

  return [{ type, line: `${pad}"${schema.type}"` }];
}

function typeLabelLocal(schema: ExtractedSchema): string {
  if (schema.type === "array") {
    return `array<${schema.items?.type ?? "unknown"}>`;
  }
  return schema.type;
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
    (v) =>
      v.violationType === "type_mismatch" ||
      v.violationType === "missing_field",
  ).length;
  const warningCount = violations.filter(
    (v) => v.violationType === "extra_field",
  ).length;

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
      return {
        type: "warning" as const,
        line: `"${v.field}": "${v.received}"  // extra`,
      };
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
