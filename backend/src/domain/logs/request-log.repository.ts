import { ResultAsync } from "neverthrow";
import { AppError } from "../../shared/errors/app-error";
import {
    RequestLog,
    RequestLogMethod,
    RequestLogStatus,
} from "./request-log.entity";

export interface RequestLogQuery {
    repositoryId?: string;
    specId?: string;
    status?: RequestLogStatus;
    method?: RequestLogMethod;
    from?: Date;
    to?: Date;
    search?: string;
}

export interface RequestLogPage {
    logs: RequestLog[];
    total: number;
}

export interface RequestLogRepository {
    save(log: RequestLog): ResultAsync<RequestLog, AppError>;
    findByUserId(
        userId: string,
        query: RequestLogQuery,
        page: number,
        pageSize: number,
    ): ResultAsync<RequestLogPage, AppError>;
    findAllByUserId(
        userId: string,
        query: RequestLogQuery,
    ): ResultAsync<RequestLog[], AppError>;
}
