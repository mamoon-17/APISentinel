import { okAsync, ResultAsync } from "neverthrow";
import {
  RepositorySnapshotProvider,
  RepositorySnapshot,
} from "../../application/analysis";
import { AppError } from "../../shared/errors/app-error";

const SNAPSHOTS: Record<string, RepositorySnapshot> = {
  "repo-1": {
    repositoryId: "repo-1",
    capturedAt: new Date().toISOString(),
    endpoints: [
      { path: "/users", method: "GET", callCount: 3400 },
      { path: "/users/{id}", method: "GET", callCount: 8900 },
      { path: "/users", method: "POST", callCount: 1200 },
    ],
  },
  "repo-2": {
    repositoryId: "repo-2",
    capturedAt: new Date().toISOString(),
    endpoints: [
      { path: "/orders", method: "GET", callCount: 2300 },
      { path: "/orders", method: "POST", callCount: 1200 },
      { path: "/orders/{id}/status", method: "PUT", callCount: 980 },
      { path: "/orders/bulk-update", method: "POST", callCount: 450 },
    ],
  },
  "repo-5": {
    repositoryId: "repo-5",
    capturedAt: new Date().toISOString(),
    endpoints: [
      { path: "/users", method: "GET", callCount: 1800 },
      { path: "/users/{id}", method: "GET", callCount: 2300 },
      { path: "/users/{id}/activity", method: "GET", callCount: 300 },
    ],
  },
};

/**
 * Fallback snapshot used when a repo ID does not match any known fixture.
 * Enables health-check testing with real GitHub repos during development.
 */
const DEFAULT_SNAPSHOT: Omit<RepositorySnapshot, "repositoryId"> = {
  capturedAt: new Date().toISOString(),
  endpoints: [
    { path: "/users", method: "GET", callCount: 1900 },
    { path: "/users/{id}", method: "GET", callCount: 1200 },
    { path: "/users/{id}/query", method: "GET", callCount: 1 },
    { path: "/users/{id}/analyze-snippet", method: "GET", callCount: 1 },
    { path: "/users/{id}/ingest", method: "GET", callCount: 1 },
  ],
};

export class FixtureRepositorySnapshotProvider implements RepositorySnapshotProvider {
  getSnapshot(repositoryId: string): ResultAsync<RepositorySnapshot, AppError> {
    const snapshot = SNAPSHOTS[repositoryId];
    if (snapshot) {
      return okAsync(snapshot);
    }

    // Fall back to a default snapshot for any unknown repo ID (dev convenience)
    return okAsync({
      repositoryId,
      ...DEFAULT_SNAPSHOT,
    });
  }
}
