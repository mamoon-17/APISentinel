import { ObjectId } from "mongodb";
import { ResultAsync } from "neverthrow";
import { Repository } from "typeorm";
import { AppError } from "../../../../shared/errors/app-error";
import {
    RequestLog,
    RequestLogPage,
    RequestLogQuery,
    RequestLogRepository,
} from "../../../../domain/logs";
import { RequestLogOrmEntity } from "../entities/request-log.orm-entity";
import { RequestLogMapper } from "../mappers/request-log.mapper";

export class TypeOrmRequestLogRepository implements RequestLogRepository {
    constructor(private readonly ormRepo: Repository<RequestLogOrmEntity>) { }

    save(log: RequestLog): ResultAsync<RequestLog, AppError> {
        return ResultAsync.fromPromise(this.saveInternal(log), (error) =>
            AppError.fromUnknown("DB_QUERY_FAILED", error),
        ).map(RequestLogMapper.toDomain);
    }

    findByUserId(
        userId: string,
        query: RequestLogQuery,
        page: number,
        pageSize: number,
    ): ResultAsync<RequestLogPage, AppError> {
        return ResultAsync.fromPromise(
            this.findByUserIdInternal(userId, query, page, pageSize),
            (error) => AppError.fromUnknown("DB_QUERY_FAILED", error),
        );
    }

    findAllByUserId(
        userId: string,
        query: RequestLogQuery,
    ): ResultAsync<RequestLog[], AppError> {
        return ResultAsync.fromPromise(
            this.findAllByUserIdInternal(userId, query),
            (error) => AppError.fromUnknown("DB_QUERY_FAILED", error),
        ).map((rows) => rows.map(RequestLogMapper.toDomain));
    }

    private async saveInternal(log: RequestLog): Promise<RequestLogOrmEntity> {
        const ormEntity = RequestLogMapper.toOrm(log);

        if (log.id) {
            const existing = await this.findByIdInternal(log.id);
            if (existing) {
                ormEntity._id = existing._id;
            }
        }

        return this.ormRepo.save(ormEntity);
    }

    private async findByIdInternal(
        id: string,
    ): Promise<RequestLogOrmEntity | null> {
        const byStringId = await this.ormRepo.findBy({ id });
        if (byStringId.length > 0) {
            return byStringId[0] ?? null;
        }

        if (!ObjectId.isValid(id)) {
            return null;
        }

        return this.ormRepo.findOneBy({ _id: new ObjectId(id) });
    }

    private async findAllByUserIdInternal(
        userId: string,
        query: RequestLogQuery,
    ): Promise<RequestLogOrmEntity[]> {
        const rows = await this.ormRepo.find({ where: { userId } });
        return applyFilters(rows, query);
    }

    private async findByUserIdInternal(
        userId: string,
        query: RequestLogQuery,
        page: number,
        pageSize: number,
    ): Promise<RequestLogPage> {
        const rows = await this.ormRepo.find({ where: { userId } });
        const filtered = applyFilters(rows, query);
        const sorted = filtered.sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
        const start = Math.max(page - 1, 0) * pageSize;
        const logs = sorted
            .slice(start, start + pageSize)
            .map(RequestLogMapper.toDomain);

        return {
            logs,
            total: filtered.length,
        };
    }
}

function applyFilters(
    rows: RequestLogOrmEntity[],
    query: RequestLogQuery,
): RequestLogOrmEntity[] {
    let filtered = rows;

    if (query.repositoryId) {
        filtered = filtered.filter((row) => row.repositoryId === query.repositoryId);
    }

    if (query.specId) {
        filtered = filtered.filter((row) => row.specId === query.specId);
    }

    if (query.status) {
        filtered = filtered.filter((row) => row.status === query.status);
    }

    if (query.method) {
        filtered = filtered.filter((row) => row.method === query.method);
    }

    if (query.from) {
        const fromMs = query.from.getTime();
        filtered = filtered.filter((row) => new Date(row.timestamp).getTime() >= fromMs);
    }

    if (query.to) {
        const toMs = query.to.getTime();
        filtered = filtered.filter((row) => new Date(row.timestamp).getTime() <= toMs);
    }

    if (query.search) {
        const needle = query.search.trim().toLowerCase();
        if (needle) {
            filtered = filtered.filter((row) =>
                row.endpoint.toLowerCase().includes(needle),
            );
        }
    }

    return filtered;
}
