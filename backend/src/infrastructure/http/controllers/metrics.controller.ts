import { Request, Response } from "express";
import { MetricsService } from "../../../application/metrics";
import {
    RequestLog,
    RequestLogMethod,
    RequestLogQuery,
    RequestLogStatus,
    RequestViolation,
    RequestViolationSeverity,
    RequestViolationType,
} from "../../../domain/logs";
import { configService } from "../../../shared/config/config.service";
import { verifySessionToken } from "../../../shared/auth/session-token";

const SESSION_COOKIE_NAME = "api_sentinel_session";
const MAX_PAGE_SIZE = 100;

interface CreateRequestLogBody {
    repositoryId?: string;
    specId?: string | null;
    timestamp?: string;
    method?: string;
    endpoint?: string;
    status?: string;
    responseCode?: number;
    latency?: number;
    violations?: RequestViolation[];
}

export class MetricsController {
    constructor(private readonly metricsService: MetricsService) { }

    getDashboardStats = async (
        req: Request,
        res: Response,
    ): Promise<void> => {
        const sessionUserId = this.readSessionUserId(req);
        if (!sessionUserId) {
            res.status(401).json({ code: "UNAUTHORIZED", message: "No session" });
            return;
        }

        const queryResult = this.parseQuery(req);
        if (!queryResult.ok) {
            res.status(400).json({ code: "VALIDATION_ERROR", message: queryResult.error });
            return;
        }

        const result = await this.metricsService.getDashboardStats(
            sessionUserId,
            queryResult.value,
        );

        result.match(
            (payload) => res.json(payload),
            (error) => res.status(500).json(error.toJSON()),
        );
    };

    listRequestLogs = async (
        req: Request,
        res: Response,
    ): Promise<void> => {
        const sessionUserId = this.readSessionUserId(req);
        if (!sessionUserId) {
            res.status(401).json({ code: "UNAUTHORIZED", message: "No session" });
            return;
        }

        const queryResult = this.parseQuery(req);
        if (!queryResult.ok) {
            res.status(400).json({ code: "VALIDATION_ERROR", message: queryResult.error });
            return;
        }

        const page = parsePositiveInt(req.query.page, 1);
        const pageSize = Math.min(
            parsePositiveInt(req.query.pageSize, 25),
            MAX_PAGE_SIZE,
        );

        const result = await this.metricsService.getRequestLogs(
            sessionUserId,
            queryResult.value,
            page,
            pageSize,
        );

        result.match(
            (payload) => res.json(payload),
            (error) => res.status(500).json(error.toJSON()),
        );
    };

    createRequestLog = async (
        req: Request<unknown, unknown, CreateRequestLogBody>,
        res: Response,
    ): Promise<void> => {
        const sessionUserId = this.readSessionUserId(req);
        if (!sessionUserId) {
            res.status(401).json({ code: "UNAUTHORIZED", message: "No session" });
            return;
        }

        const repositoryId = (req.body.repositoryId ?? "").trim();
        if (!repositoryId) {
            res.status(400).json({ code: "VALIDATION_ERROR", message: "repositoryId is required" });
            return;
        }

        const endpoint = (req.body.endpoint ?? "").trim();
        if (!endpoint) {
            res.status(400).json({ code: "VALIDATION_ERROR", message: "endpoint is required" });
            return;
        }

        const method = normalizeMethod(req.body.method);
        if (!method) {
            res.status(400).json({ code: "VALIDATION_ERROR", message: "method is invalid" });
            return;
        }

        const status = normalizeStatus(req.body.status);
        if (!status) {
            res.status(400).json({ code: "VALIDATION_ERROR", message: "status is invalid" });
            return;
        }

        const responseCode = Number(req.body.responseCode);
        if (!Number.isFinite(responseCode) || responseCode <= 0) {
            res.status(400).json({ code: "VALIDATION_ERROR", message: "responseCode must be a positive number" });
            return;
        }

        const latencyMs = Number(req.body.latency);
        if (!Number.isFinite(latencyMs) || latencyMs < 0) {
            res.status(400).json({ code: "VALIDATION_ERROR", message: "latency must be a non-negative number" });
            return;
        }

        const timestamp = parseOptionalTimestamp(req.body.timestamp);
        if (req.body.timestamp && !timestamp) {
            res.status(400).json({ code: "VALIDATION_ERROR", message: "timestamp must be ISO-8601" });
            return;
        }

        const violations = normalizeViolations(req.body.violations ?? []);

        const log = RequestLog.createNew({
            userId: sessionUserId,
            repositoryId,
            specId: req.body.specId ?? null,
            timestamp: timestamp ?? new Date(),
            method,
            endpoint,
            status,
            responseCode,
            latencyMs,
            violations,
        });

        const result = await this.metricsService.createRequestLog(log);
        result.match(
            (payload) => res.status(201).json(payload),
            (error) => res.status(500).json(error.toJSON()),
        );
    };

    private readSessionUserId(req: Request): string | null {
        const token =
            typeof req.cookies[SESSION_COOKIE_NAME] === "string"
                ? req.cookies[SESSION_COOKIE_NAME]
                : undefined;
        if (!token) {
            return null;
        }

        const sessionUser = verifySessionToken(token, configService.getSessionSecret());
        return sessionUser?.id ?? null;
    }

    private parseQuery(req: Request): { ok: true; value: RequestLogQuery } | { ok: false; error: string } {
        const query: RequestLogQuery = {};

        if (typeof req.query.repositoryId === "string" && req.query.repositoryId.trim()) {
            query.repositoryId = req.query.repositoryId.trim();
        }

        if (typeof req.query.specId === "string" && req.query.specId.trim()) {
            query.specId = req.query.specId.trim();
        }

        if (typeof req.query.status === "string") {
            const status = normalizeStatus(req.query.status);
            if (!status) {
                return { ok: false, error: "status is invalid" };
            }
            query.status = status;
        }

        if (typeof req.query.method === "string") {
            const method = normalizeMethod(req.query.method);
            if (!method) {
                return { ok: false, error: "method is invalid" };
            }
            query.method = method;
        }

        if (typeof req.query.search === "string" && req.query.search.trim()) {
            query.search = req.query.search.trim();
        }

        if (typeof req.query.from === "string" && req.query.from.trim()) {
            const from = parseOptionalTimestamp(req.query.from);
            if (!from) {
                return { ok: false, error: "from must be ISO-8601" };
            }
            query.from = from;
        }

        if (typeof req.query.to === "string" && req.query.to.trim()) {
            const to = parseOptionalTimestamp(req.query.to);
            if (!to) {
                return { ok: false, error: "to must be ISO-8601" };
            }
            query.to = to;
        }

        return { ok: true, value: query };
    }
}

function normalizeMethod(value: unknown): RequestLogMethod | null {
    if (typeof value !== "string") {
        return null;
    }

    const upper = value.trim().toUpperCase();
    if (upper === "GET" || upper === "POST" || upper === "PUT" || upper === "PATCH" || upper === "DELETE") {
        return upper as RequestLogMethod;
    }

    return null;
}

function normalizeStatus(value: unknown): RequestLogStatus | null {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === "valid" || normalized === "warning" || normalized === "error") {
        return normalized as RequestLogStatus;
    }

    return null;
}

function parseOptionalTimestamp(value: string | undefined): Date | null {
    if (!value) {
        return null;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed;
}

function normalizeViolations(values: RequestViolation[]): RequestViolation[] {
    if (!Array.isArray(values)) {
        return [];
    }

    return values
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
            id: typeof item.id === "string" ? item.id : "",
            type: normalizeViolationType(item.type),
            field: typeof item.field === "string" ? item.field : "",
            expected: typeof item.expected === "string" ? item.expected : undefined,
            received: typeof item.received === "string" ? item.received : undefined,
            severity: normalizeViolationSeverity(item.severity),
            message: typeof item.message === "string" ? item.message : "",
        }))
        .filter((item) => item.id && item.field && item.message);
}

function normalizeViolationType(value: unknown): RequestViolationType {
    if (
        value === "extra_field" ||
        value === "missing_field" ||
        value === "type_mismatch" ||
        value === "format_error"
    ) {
        return value;
    }

    return "type_mismatch";
}

function normalizeViolationSeverity(value: unknown): RequestViolationSeverity {
    if (value === "warning" || value === "error") {
        return value;
    }

    return "warning";
}

function parsePositiveInt(value: unknown, fallback: number): number {
    if (typeof value !== "string") {
        return fallback;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }

    return Math.floor(parsed);
}
