import { ResultAsync } from "neverthrow";
import { AppError } from "../../shared/errors/app-error";
import type { CodeScannerProvider } from "../../application/analysis/contracts/code-scanner.provider";
import type { RepositoryFile } from "../../application/analysis/contracts/repository-code.provider";
import type {
  ExtractedSchema,
  SnapshotEndpointUsage,
} from "../../application/analysis/contracts/repository-snapshot.provider";
import {
  callLlmForAgenticEndpointScan,
  type AgenticDetectedEndpoint,
} from "../llm/llm-caller";

/**
 * Deep scanner: keeps the deterministic static pass, then lets GPT-4.1-mini
 * explore files with bounded list/read/search tools and merge in endpoints the
 * regex pass missed.
 */
export class AgenticCodeScannerProvider implements CodeScannerProvider {
  constructor(
    private readonly staticScanner: CodeScannerProvider,
    private readonly githubToken: string,
    private readonly repositoryId: string,
  ) {}

  scan(files: RepositoryFile[]): ResultAsync<SnapshotEndpointUsage[], AppError> {
    return ResultAsync.fromPromise(
      this.doScan(files),
      (error) =>
        error instanceof AppError
          ? error
          : AppError.fromUnknown("UNKNOWN_ERROR", error),
    );
  }

  private async doScan(
    files: RepositoryFile[],
  ): Promise<SnapshotEndpointUsage[]> {
    const staticResult = await this.staticScanner.scan(files);
    if (staticResult.isErr()) {
      throw staticResult.error;
    }

    const agentResult = await callLlmForAgenticEndpointScan(
      this.repositoryId,
      files,
      this.githubToken,
    );

    // If the LLM call failed (e.g. content filter, quota), fall back to the
    // static scan alone rather than surfacing an error to the caller.
    if (agentResult.isErr()) {
      console.warn("[AgenticScanner] LLM call failed, returning static-only results:", agentResult.error.message);
      return staticResult.value;
    }

    return mergeEndpointUsages(
      staticResult.value,
      agentResult.value.endpoints.map(agentEndpointToUsage),
    );
  }
}

function agentEndpointToUsage(
  endpoint: AgenticDetectedEndpoint,
): SnapshotEndpointUsage {
  return {
    path: normalizePath(endpoint.path),
    method: endpoint.method,
    callCount: endpoint.callCount ?? 1,
    requestBodySchema: withConfidence(endpoint.requestBodySchema),
    responseBodySchema: withConfidence(endpoint.responseBodySchema),
    source: endpoint.source,
  };
}

function mergeEndpointUsages(
  staticEndpoints: SnapshotEndpointUsage[],
  agentEndpoints: SnapshotEndpointUsage[],
): SnapshotEndpointUsage[] {
  const merged = new Map<string, SnapshotEndpointUsage>();

  for (const endpoint of [...staticEndpoints, ...agentEndpoints]) {
    const normalized = {
      ...endpoint,
      path: normalizePath(endpoint.path),
    };
    const key = `${normalized.source ?? "unknown"}:${normalized.method}:${normalized.path}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...normalized });
      continue;
    }

    existing.callCount = Math.max(existing.callCount, normalized.callCount);
    existing.requestBodySchema =
      preferSchema(existing.requestBodySchema, normalized.requestBodySchema);
    existing.responseBodySchema = preferSchema(
      existing.responseBodySchema,
      normalized.responseBodySchema,
    );
  }

  return [...merged.values()].sort((a, b) =>
    `${a.source}:${a.method}:${a.path}`.localeCompare(
      `${b.source}:${b.method}:${b.path}`,
    ),
  );
}

function preferSchema(
  current: ExtractedSchema | undefined,
  next: ExtractedSchema | undefined,
): ExtractedSchema | undefined {
  if (!current) return next;
  if (!next) return current;
  if (current.type === "unknown" && next.type !== "unknown") return next;
  if (
    current.type === "object" &&
    Object.keys(current.properties ?? {}).length === 0 &&
    next.type === "object" &&
    Object.keys(next.properties ?? {}).length > 0
  ) {
    return next;
  }
  return current;
}

function withConfidence(
  schema: ExtractedSchema | undefined,
): ExtractedSchema | undefined {
  if (!schema) return undefined;
  return addConfidence(schema, "high");
}

function addConfidence(
  schema: ExtractedSchema,
  confidence: "high" | "low" | "unresolved",
): ExtractedSchema {
  return {
    ...schema,
    confidence: schema.confidence ?? confidence,
    properties: schema.properties
      ? Object.fromEntries(
          Object.entries(schema.properties).map(([key, child]) => [
            key,
            addConfidence(child, confidence),
          ]),
        )
      : undefined,
    items: schema.items ? addConfidence(schema.items, confidence) : undefined,
  };
}

function normalizePath(value: string): string {
  if (!value || value.trim().length === 0) return "/";
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
