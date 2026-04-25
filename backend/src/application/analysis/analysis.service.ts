import { err, ok, Result } from "neverthrow";
import { SpecVersionRepository } from "../../domain/spec";
import { AppError } from "../../shared/errors/app-error";
import {
  RepositorySnapshotProvider,
  SnapshotEndpointUsage,
  HttpMethod,
  ExtractedSchema,
} from "./contracts/repository-snapshot.provider";

export type InconsistencyType =
  | "missing_endpoint"
  | "extra_endpoint"
  | "method_mismatch"
  | "schema_mismatch";

export interface InconsistencyItem {
  id: string;
  type: InconsistencyType;
  endpoint: string;
  method?: HttpMethod;
  message: string;
  severity: "warning" | "error";
  schemaDiff?: SchemaDiffBlock;
}

export interface SchemaDiffBlock {
  location: "requestBody" | "responseBody";
  expected: ExtractedSchema;
  received: ExtractedSchema;
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

function normalizePath(value: string): string {
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
      const errors = checkSchemaInconsistencies(extractedRequestSchema, specOp.requestBodySchema, 'requestBody');
      for (const [index, errorMessage] of errors.entries()) {
        inconsistencies.push({
          id: `schema:${operation.method}:${operation.path}:request:${index}`,
          type: "schema_mismatch",
          endpoint: operation.path,
          method: operation.method,
          message: errorMessage,
          severity: "warning",
          schemaDiff: {
            location: "requestBody",
            expected: specOp.requestBodySchema,
            received: extractedRequestSchema,
          },
        });
      }
    }

    if (specOp.responseBodySchema) {
      const extractedResponseSchema = operation.responseBodySchema ?? {
        type: "unknown" as const,
      };
      const errors = checkSchemaInconsistencies(extractedResponseSchema, specOp.responseBodySchema, 'responseBody');
      for (const [index, errorMessage] of errors.entries()) {
        inconsistencies.push({
          id: `schema:${operation.method}:${operation.path}:response:${index}`,
          type: "schema_mismatch",
          endpoint: operation.path,
          method: operation.method,
          message: errorMessage,
          severity: "warning",
          schemaDiff: {
            location: "responseBody",
            expected: specOp.responseBodySchema,
            received: extractedResponseSchema,
          },
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

function checkSchemaInconsistencies(
  extracted: ExtractedSchema,
  spec: ExtractedSchema,
  path: string = "root",
): string[] {
  const errors: string[] = [];

  if (extracted.type === "unknown" && spec.type !== "unknown") {
    errors.push(`Type mismatch at ${path}: expected ${spec.type}, received unknown`);
    return errors;
  }
  
  if (extracted.type !== spec.type) {
    errors.push(`Type mismatch at ${path}: expected ${spec.type}, received ${extracted.type}`);
    return errors;
  }

  if (extracted.type === "object") {
    const specProps = spec.properties || {};
    const extProps = extracted.properties || {};

    for (const key of Object.keys(specProps)) {
      if (!extProps[key]) {
        errors.push(`Missing required field: ${key}`);
      } else {
        errors.push(...checkSchemaInconsistencies(extProps[key] as ExtractedSchema, specProps[key] as ExtractedSchema, `${path}.${key}`));
      }
    }

    for (const key of Object.keys(extProps)) {
      if (!specProps[key]) {
        errors.push(`Extra field found: ${key}`);
      }
    }
  }

  return errors;
}
