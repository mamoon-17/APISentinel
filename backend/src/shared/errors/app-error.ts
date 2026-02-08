export type AppErrorCode =
  | "CONFIG_NOT_INITIALIZED"
  | "DATASOURCE_INIT_FAILED"
  | "DATASOURCE_NOT_INITIALIZED"
  | "DB_QUERY_FAILED"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
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
