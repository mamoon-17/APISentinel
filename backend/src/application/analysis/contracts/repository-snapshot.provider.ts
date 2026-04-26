import { ResultAsync } from "neverthrow";
import { AppError } from "../../../shared/errors/app-error";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ExtractedSchema {
  type: "object" | "array" | "string" | "number" | "boolean" | "unknown";
  properties?: Record<string, ExtractedSchema>;
  required?: string[];
  items?: ExtractedSchema;
  /** Confidence of the extraction: high = directly read from code, low = inferred/simulated */
  confidence?: "high" | "low" | "unresolved";
}

export interface SnapshotEndpointUsage {
  path: string;
  method: HttpMethod;
  callCount: number;
  requestBodySchema?: ExtractedSchema;
  responseBodySchema?: ExtractedSchema;
}

export interface RepositorySnapshot {
  repositoryId: string;
  capturedAt: string;
  endpoints: SnapshotEndpointUsage[];
}

export interface RepositorySnapshotProvider {
  getSnapshot(
    repositoryId: string,
    githubAccessToken?: string,
  ): ResultAsync<RepositorySnapshot, AppError>;
}
