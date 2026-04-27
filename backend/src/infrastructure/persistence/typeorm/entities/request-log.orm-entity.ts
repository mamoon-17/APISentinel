import { ObjectId } from "mongodb";
import { Column, Entity, Index, ObjectIdColumn } from "typeorm";
import {
    RequestLogMethod,
    RequestLogStatus,
    RequestViolation,
} from "../../../../domain/logs";

@Entity("request_logs")
@Index(["userId", "timestamp"])
@Index(["userId", "repositoryId"])
@Index(["userId", "specId"])
export class RequestLogOrmEntity {
    @ObjectIdColumn()
    _id: ObjectId;

    @Column()
    id: string;

    @Column()
    userId: string;

    @Column()
    repositoryId: string;

    @Column({ nullable: true })
    specId: string | null;

    @Column()
    timestamp: Date;

    @Column()
    method: RequestLogMethod;

    @Column()
    endpoint: string;

    @Column()
    status: RequestLogStatus;

    @Column()
    responseCode: number;

    @Column()
    latencyMs: number;

    @Column()
    violations: RequestViolation[];
}
