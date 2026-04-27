export type RequestLogStatus = "valid" | "warning" | "error";
export type RequestLogMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RequestViolationType =
    | "extra_field"
    | "missing_field"
    | "type_mismatch"
    | "format_error";

export type RequestViolationSeverity = "warning" | "error";

export interface RequestViolation {
    id: string;
    type: RequestViolationType;
    field: string;
    expected?: string;
    received?: string;
    severity: RequestViolationSeverity;
    message: string;
}

export class RequestLog {
    constructor(
        public readonly id: string,
        public readonly userId: string,
        public readonly repositoryId: string,
        public readonly specId: string | null,
        public readonly timestamp: Date,
        public readonly method: RequestLogMethod,
        public readonly endpoint: string,
        public readonly status: RequestLogStatus,
        public readonly responseCode: number,
        public readonly latencyMs: number,
        public readonly violations: RequestViolation[],
    ) { }

    static createNew(params: {
        userId: string;
        repositoryId: string;
        specId?: string | null;
        timestamp?: Date;
        method: RequestLogMethod;
        endpoint: string;
        status: RequestLogStatus;
        responseCode: number;
        latencyMs: number;
        violations?: RequestViolation[];
    }): RequestLog {
        return new RequestLog(
            "",
            params.userId,
            params.repositoryId,
            params.specId ?? null,
            params.timestamp ?? new Date(),
            params.method,
            params.endpoint,
            params.status,
            params.responseCode,
            params.latencyMs,
            params.violations ?? [],
        );
    }
}
