export type AppErrorCode =
  | "CONFIG_NOT_INITIALIZED"
  | "DATASOURCE_INIT_FAILED"
  | "DATASOURCE_NOT_INITIALIZED"
  | "DB_QUERY_FAILED"
  | "SPEC_STORAGE_FAILED"
  | "SPEC_PARSE_FAILED"
  | "SPEC_SELECTION_REQUIRED"
  | "SPEC_VERSION_NOT_FOUND"
  | "SPEC_VERSION_NOT_ANALYZABLE"
  | "SPEC_VERSION_IN_USE"
  | "REPOSITORY_SNAPSHOT_NOT_FOUND"
  | "REPOSITORY_SNAPSHOT_EMPTY"
  | "GITHUB_RATE_LIMITED"
  | "GITHUB_AUTH_REQUIRED"
  | "GITHUB_FETCH_FAILED"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "LLM_NOT_CONFIGURED"
  | "UNKNOWN_ERROR";

export class AppError {
  constructor(
    public readonly code: AppErrorCode,
    public readonly message: string,
    public readonly cause?: unknown,
  ) {}

  static fromUnknown(code: AppErrorCode, error: unknown): AppError {
    if (error instanceof Error) {
      return new AppError(code, error.message, error);
    }
    return new AppError(code, String(error), error);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
    };
  }
}
