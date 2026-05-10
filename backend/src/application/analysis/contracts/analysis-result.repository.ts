import { ResultAsync } from "neverthrow";
import { AppError } from "../../../shared/errors/app-error";
import type {
  EndpointUsage,
  InconsistencyItem,
} from "../analysis.service";

export type SavedAnalysisMode = "frontend-backend" | "backend-spec";
export type SavedAnalysisVariant = "static" | "ai";

export interface SavedAnalysisPayload {
  repositoryId: string;
  specId: string;
  analyzedAt: string;
  totalApiCalls: number;
  endpointUsage: EndpointUsage[];
  inconsistencies: InconsistencyItem[];
}

export interface SavedAnalysisResult {
  id: string;
  userId: string;
  repositoryId: string;
  /** owner/repo full name — stored alongside the numeric ID for display */
  repositoryFullName?: string;
  analysisMode: SavedAnalysisMode;
  resultVariant: SavedAnalysisVariant;
  specId?: string;
  analyzedAt: Date;
  payload: SavedAnalysisPayload;
}

export interface AnalysisResultRepository {
  findLatest(input: {
    userId: string;
    repositoryId: string;
    analysisMode: SavedAnalysisMode;
    resultVariant: SavedAnalysisVariant;
    specId?: string;
  }): ResultAsync<SavedAnalysisResult | null, AppError>;
  /** Returns the most recent static analysis runs for a user, newest first. */
  findRecentForUser(
    userId: string,
    limit: number,
  ): ResultAsync<SavedAnalysisResult[], AppError>;
  save(result: SavedAnalysisResult): ResultAsync<SavedAnalysisResult, AppError>;
  deleteMatching(input: {
    userId: string;
    repositoryId: string;
    analysisMode: SavedAnalysisMode;
    resultVariant: SavedAnalysisVariant;
    specId?: string;
  }): ResultAsync<void, AppError>;
}
