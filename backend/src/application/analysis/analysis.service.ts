import { err, ok, Result } from "neverthrow";
import { SpecVersionRepository } from "../../domain/spec";
import { AppError } from "../../shared/errors/app-error";
import {
  RepositorySnapshotProvider,
  SnapshotEndpointUsage,
  HttpMethod,
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

interface NormalizedOperation {
  path: string;
  method: HttpMethod;
  callCount?: number;
}

export class AnalysisService {
  constructor(
    private readonly specVersionRepository: SpecVersionRepository,
    private readonly snapshotProvider: RepositorySnapshotProvider,
  ) {}

  async getRepositoryInconsistencies(input: {
    repositoryId: string;
    specId?: string;
  }): Promise<Result<RepositoryInconsistenciesView, AppError>> {
    const snapshotResult = await this.snapshotProvider.getSnapshot(
      input.repositoryId,
    );
    if (snapshotResult.isErr()) {
      return err(snapshotResult.error);
    }

    const allVersionsResult = input.specId
      ? this.specVersionRepository.findBySpecId(input.specId)
      : this.specVersionRepository.findAll();

    const versionsResult = await allVersionsResult;
    if (versionsResult.isErr()) {
      return err(versionsResult.error);
    }

    const candidateVersions = input.specId
      ? versionsResult.value
      : versionsResult.value.filter((version) => version.status === "active");

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

    const usageOps = normalizeUsage(snapshotResult.value.endpoints);
    const specOps = specVersion.operations.map((operation) => ({
      path: operation.normalizedPath,
      method: operation.method,
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
}

function normalizeUsage(
  endpoints: SnapshotEndpointUsage[],
): NormalizedOperation[] {
  return endpoints.map((endpoint) => ({
    path: normalizePath(endpoint.path),
    method: endpoint.method,
    callCount: endpoint.callCount,
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

  const specByPath = new Map<string, Set<HttpMethod>>();
  for (const operation of specOps) {
    const existing = specByPath.get(operation.path) ?? new Set<HttpMethod>();
    existing.add(operation.method);
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

    if (!allowedMethods.has(operation.method)) {
      inconsistencies.push({
        id: `method:${operation.method}:${operation.path}`,
        type: "method_mismatch",
        endpoint: operation.path,
        method: operation.method,
        message: `Method mismatch. Spec allows: ${[...allowedMethods].join(", ")}`,
        severity: "error",
      });
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
