import { err, ok, Result } from "neverthrow";
import {
    RequestLog,
    RequestLogPage,
    RequestLogQuery,
    RequestLogRepository,
    RequestViolation,
} from "../../domain/logs";
import { AppError } from "../../shared/errors/app-error";

export interface DashboardStatsView {
    totalRequests: number;
    validRequests: number;
    violations: number;
    uptime: number;
    windowStart?: string;
    windowEnd?: string;
}

export interface RequestLogView {
    id: string;
    repositoryId: string;
    specId: string | null;
    timestamp: string;
    method: string;
    endpoint: string;
    status: string;
    responseCode: number;
    latency: number;
    violations: RequestViolation[];
}

export interface RequestLogPageView {
    logs: RequestLogView[];
    total: number;
    page: number;
    pageSize: number;
}

export class MetricsService {
    constructor(private readonly requestLogRepository: RequestLogRepository) { }

    async getDashboardStats(
        userId: string,
        query: RequestLogQuery,
    ): Promise<Result<DashboardStatsView, AppError>> {
        const logsResult = await this.requestLogRepository.findAllByUserId(
            userId,
            query,
        );
        if (logsResult.isErr()) {
            return err(logsResult.error);
        }

        const logs = logsResult.value;
        const totalRequests = logs.length;
        const validRequests = logs.filter(
            (log) => log.status === "valid",
        ).length;
        const errorRequests = logs.filter((log) => log.status === "error").length;
        const violations = logs.reduce(
            (sum, log) => sum + (log.violations?.length ?? 0),
            0,
        );

        const uptime = totalRequests > 0
            ? roundToTwo(((totalRequests - errorRequests) / totalRequests) * 100)
            : 100;

        return ok({
            totalRequests,
            validRequests,
            violations,
            uptime,
            windowStart: query.from?.toISOString(),
            windowEnd: query.to?.toISOString(),
        });
    }

    async getRequestLogs(
        userId: string,
        query: RequestLogQuery,
        page: number,
        pageSize: number,
    ): Promise<Result<RequestLogPageView, AppError>> {
        const logsResult = await this.requestLogRepository.findByUserId(
            userId,
            query,
            page,
            pageSize,
        );
        if (logsResult.isErr()) {
            return err(logsResult.error);
        }

        return ok(toLogPageView(logsResult.value, page, pageSize));
    }

    async createRequestLog(
        log: RequestLog,
    ): Promise<Result<RequestLogView, AppError>> {
        const savedResult = await this.requestLogRepository.save(log);
        if (savedResult.isErr()) {
            return err(savedResult.error);
        }

        return ok(toLogView(savedResult.value));
    }
}

function toLogPageView(
    page: RequestLogPage,
    currentPage: number,
    pageSize: number,
): RequestLogPageView {
    return {
        logs: page.logs.map(toLogView),
        total: page.total,
        page: currentPage,
        pageSize,
    };
}

function toLogView(log: RequestLog): RequestLogView {
    return {
        id: log.id,
        repositoryId: log.repositoryId,
        specId: log.specId ?? null,
        timestamp: log.timestamp.toISOString(),
        method: log.method,
        endpoint: log.endpoint,
        status: log.status,
        responseCode: log.responseCode,
        latency: log.latencyMs,
        violations: log.violations ?? [],
    };
}

function roundToTwo(value: number): number {
    return Math.round(value * 100) / 100;
}
