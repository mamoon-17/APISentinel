import { randomUUID } from "crypto";
import { RequestLog } from "../../../../domain/logs";
import { RequestLogOrmEntity } from "../entities/request-log.orm-entity";

export class RequestLogMapper {
    static toDomain(entity: RequestLogOrmEntity): RequestLog {
        return new RequestLog(
            entity.id,
            entity.userId,
            entity.repositoryId,
            entity.specId ?? null,
            new Date(entity.timestamp),
            entity.method,
            entity.endpoint,
            entity.status,
            entity.responseCode,
            entity.latencyMs,
            entity.violations ?? [],
        );
    }

    static toOrm(log: RequestLog): RequestLogOrmEntity {
        const entity = new RequestLogOrmEntity();

        entity.id = log.id || randomUUID();
        entity.userId = log.userId;
        entity.repositoryId = log.repositoryId;
        entity.specId = log.specId ?? null;
        entity.timestamp = log.timestamp;
        entity.method = log.method;
        entity.endpoint = log.endpoint;
        entity.status = log.status;
        entity.responseCode = log.responseCode;
        entity.latencyMs = log.latencyMs;
        entity.violations = log.violations;

        return entity;
    }
}
