export type SpecVersionStatus = "active" | "inactive";

export interface SpecSchema {
  type: "object" | "array" | "string" | "number" | "boolean" | "unknown";
  properties?: Record<string, SpecSchema>;
  required?: string[];
  items?: SpecSchema;
}

export interface SpecOperation {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  normalizedPath: string;
  operationId: string | null;
  summary: string | null;
  requestBodySchema?: SpecSchema;
  responseBodySchema?: SpecSchema;
}

export class SpecVersion {
  constructor(
    public readonly id: string,
    public readonly specId: string,
    public readonly specName: string,
    public readonly version: string,
    public readonly status: SpecVersionStatus,
    public readonly uploadedAt: Date,
    public readonly operationCount: number,
    public readonly sourceHash: string,
    public readonly sourceFormat: "json" | "yaml",
    public readonly rawDocument: Record<string, unknown>,
    public readonly operations: SpecOperation[],
    public readonly linkedRepositoryCount: number,
  ) {}

  static createNew(params: {
    specId: string;
    specName: string;
    version: string;
    sourceHash: string;
    sourceFormat: "json" | "yaml";
    rawDocument: Record<string, unknown>;
    operations: SpecOperation[];
  }): SpecVersion {
    return new SpecVersion(
      "",
      params.specId,
      params.specName,
      params.version,
      "active",
      new Date(),
      params.operations.length,
      params.sourceHash,
      params.sourceFormat,
      params.rawDocument,
      params.operations,
      0,
    );
  }

  withStatus(status: SpecVersionStatus): SpecVersion {
    return new SpecVersion(
      this.id,
      this.specId,
      this.specName,
      this.version,
      status,
      this.uploadedAt,
      this.operationCount,
      this.sourceHash,
      this.sourceFormat,
      this.rawDocument,
      this.operations,
      this.linkedRepositoryCount,
    );
  }
}
