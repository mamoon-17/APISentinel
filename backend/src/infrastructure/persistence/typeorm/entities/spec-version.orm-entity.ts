import { ObjectId } from "mongodb";
import { Column, Entity, ObjectIdColumn } from "typeorm";

interface SpecOperationValue {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  normalizedPath: string;
  operationId: string | null;
  summary: string | null;
}

@Entity("spec_versions")
export class SpecVersionOrmEntity {
  @ObjectIdColumn()
  _id: ObjectId;

  @Column()
  id: string;

  @Column()
  specId: string;

  @Column()
  specName: string;

  @Column()
  version: string;

  @Column()
  status: "active" | "inactive";

  @Column()
  uploadedAt: Date;

  @Column()
  operationCount: number;

  @Column()
  sourceHash: string;

  @Column()
  sourceFormat: "json" | "yaml";

  @Column()
  sourceFileName?: string | null;

  @Column()
  sourceFilePath?: string | null;

  @Column()
  rawDocument: Record<string, unknown>;

  @Column()
  operations: SpecOperationValue[];

  @Column()
  linkedRepositoryCount: number;
}
