import { ResultAsync } from "neverthrow";
import { AppError } from "../../../shared/errors/app-error";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface SnapshotEndpointUsage {
  path: string;
  method: HttpMethod;
  callCount: number;
}

export interface RepositorySnapshot {
  repositoryId: string;
  capturedAt: string;
  endpoints: SnapshotEndpointUsage[];
}

export interface RepositorySnapshotProvider {
  getSnapshot(repositoryId: string): ResultAsync<RepositorySnapshot, AppError>;
}
