import { randomUUID } from "crypto";
import { SpecVersion } from "../../../../domain/spec";
import { SpecVersionOrmEntity } from "../entities/spec-version.orm-entity";

export class SpecVersionMapper {
  static toDomain(entity: SpecVersionOrmEntity): SpecVersion {
    return new SpecVersion(
      entity.id,
      entity.specId,
      entity.specName,
      entity.version,
      entity.status,
      new Date(entity.uploadedAt),
      entity.operationCount,
      entity.sourceHash,
      entity.sourceFormat,
      entity.sourceFileName ?? null,
      entity.sourceFilePath ?? null,
      entity.rawDocument,
      entity.operations,
      entity.linkedRepositoryCount,
    );
  }

  static toOrm(specVersion: SpecVersion): SpecVersionOrmEntity {
    const entity = new SpecVersionOrmEntity();

    entity.id = specVersion.id || randomUUID();
    entity.specId = specVersion.specId;
    entity.specName = specVersion.specName;
    entity.version = specVersion.version;
    entity.status = specVersion.status;
    entity.uploadedAt = specVersion.uploadedAt;
    entity.operationCount = specVersion.operationCount;
    entity.sourceHash = specVersion.sourceHash;
    entity.sourceFormat = specVersion.sourceFormat;
    entity.sourceFileName = specVersion.sourceFileName;
    entity.sourceFilePath = specVersion.sourceFilePath;
    entity.rawDocument = specVersion.rawDocument;
    entity.operations = specVersion.operations;
    entity.linkedRepositoryCount = specVersion.linkedRepositoryCount;

    return entity;
  }
}
