import { err, ok, Result } from "neverthrow";
import { AppError } from "../../shared/errors/app-error";
import { SpecVersion, SpecVersionRepository } from "../../domain/spec";
import { OpenApiParser } from "./contracts/openapi-parser";

export interface SpecSummary {
  id: string;
  name: string;
  activeVersionId: string | null;
  activeVersion: string | null;
  status: "active" | "inactive";
  totalVersions: number;
  totalEndpoints: number;
  updatedAt: string;
}

export interface SpecVersionView {
  id: string;
  specId: string;
  specName: string;
  version: string;
  status: "active" | "inactive";
  uploadedAt: string;
  operationCount: number;
  linkedRepositoryCount: number;
}

export class SpecService {
  constructor(
    private readonly specRepository: SpecVersionRepository,
    private readonly openApiParser: OpenApiParser,
  ) {}

  async uploadSpec(input: {
    content: string;
    fileName?: string;
  }): Promise<Result<SpecVersionView, AppError>> {
    let parsed;
    try {
      parsed = this.openApiParser.parse(input.content, input.fileName);
    } catch (cause) {
      return err(
        new AppError(
          "SPEC_PARSE_FAILED",
          "Unable to parse OpenAPI document",
          cause,
        ),
      );
    }

    const specId = toSpecId(parsed.specName);
    const existingResult = await this.specRepository.findBySpecId(specId);
    if (existingResult.isErr()) {
      return err(existingResult.error);
    }

    const activeVersions = existingResult.value.filter(
      (version) => version.status === "active",
    );
    for (const activeVersion of activeVersions) {
      const inactive = activeVersion.withStatus("inactive");
      const saveInactiveResult = await this.specRepository.save(inactive);
      if (saveInactiveResult.isErr()) {
        return err(saveInactiveResult.error);
      }
    }

    const version = SpecVersion.createNew({
      specId,
      specName: parsed.specName,
      version: parsed.version,
      sourceHash: parsed.sourceHash,
      sourceFormat: parsed.sourceFormat,
      rawDocument: parsed.rawDocument,
      operations: parsed.operations,
    });

    const saveResult = await this.specRepository.save(version);
    if (saveResult.isErr()) {
      return err(saveResult.error);
    }

    return ok(toVersionView(saveResult.value));
  }

  async getSpecs(): Promise<Result<SpecSummary[], AppError>> {
    const allResult = await this.specRepository.findAll();
    if (allResult.isErr()) {
      return err(allResult.error);
    }

    const grouped = new Map<string, SpecVersion[]>();
    for (const version of allResult.value) {
      const group = grouped.get(version.specId) ?? [];
      group.push(version);
      grouped.set(version.specId, group);
    }

    const summaries = [...grouped.entries()].map(([specId, versions]) => {
      const sorted = [...versions].sort(
        (a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime(),
      );
      const latest = sorted[0];
      const active =
        sorted.find((version) => version.status === "active") ?? null;
      const totalEndpoints = sorted.reduce(
        (acc, version) => Math.max(acc, version.operationCount),
        0,
      );

      return {
        id: specId,
        name: latest?.specName ?? "Unknown API",
        activeVersionId: active?.id ?? null,
        activeVersion: active?.version ?? null,
        status: active ? "active" : "inactive",
        totalVersions: sorted.length,
        totalEndpoints,
        updatedAt: (latest?.uploadedAt ?? new Date(0)).toISOString(),
      } satisfies SpecSummary;
    });

    summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

    return ok(summaries);
  }

  async getVersionsBySpecId(
    specId: string,
  ): Promise<Result<SpecVersionView[], AppError>> {
    const result = await this.specRepository.findBySpecId(specId);
    if (result.isErr()) {
      return err(result.error);
    }

    const versions = result.value
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
      .map(toVersionView);

    return ok(versions);
  }

  async deleteVersion(versionId: string): Promise<Result<void, AppError>> {
    const targetResult = await this.specRepository.findById(versionId);
    if (targetResult.isErr()) {
      return err(targetResult.error);
    }

    const target = targetResult.value;
    if (!target) {
      return err(
        new AppError("SPEC_VERSION_NOT_FOUND", "Spec version not found"),
      );
    }

    if (target.linkedRepositoryCount > 0) {
      return err(
        new AppError(
          "SPEC_VERSION_IN_USE",
          "Cannot delete this spec version because it is linked to repositories",
        ),
      );
    }

    const bySpecResult = await this.specRepository.findBySpecId(target.specId);
    if (bySpecResult.isErr()) {
      return err(bySpecResult.error);
    }

    const siblings = bySpecResult.value.filter((item) => item.id !== target.id);
    const deleteResult = await this.specRepository.delete(target.id);
    if (deleteResult.isErr()) {
      return err(deleteResult.error);
    }

    if (target.status === "active" && siblings.length > 0) {
      const promote = [...siblings].sort(
        (a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime(),
      )[0];

      if (promote) {
        const promoteResult = await this.specRepository.save(
          promote.withStatus("active"),
        );
        if (promoteResult.isErr()) {
          return err(promoteResult.error);
        }
      }
    }

    return ok(undefined);
  }
}

function toVersionView(version: SpecVersion): SpecVersionView {
  return {
    id: version.id,
    specId: version.specId,
    specName: version.specName,
    version: version.version,
    status: version.status,
    uploadedAt: version.uploadedAt.toISOString(),
    operationCount: version.operationCount,
    linkedRepositoryCount: version.linkedRepositoryCount,
  };
}

function toSpecId(specName: string): string {
  const cleaned = specName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned.length > 0 ? cleaned : "uploaded-api";
}
