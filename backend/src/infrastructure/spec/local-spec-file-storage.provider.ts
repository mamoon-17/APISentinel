import fs from "fs/promises";
import path from "path";
import { ResultAsync } from "neverthrow";
import {
  SpecFileStorageProvider,
  StoredSpecFile,
} from "../../application/spec/contracts/spec-file-storage.provider";
import { AppError } from "../../shared/errors/app-error";

export class LocalSpecFileStorageProvider implements SpecFileStorageProvider {
  constructor(private readonly baseDirectory: string) {}

  saveUploadedSpec(input: {
    specId: string;
    version: string;
    fileName?: string;
    content: string;
    sourceFormat: "json" | "yaml";
  }): ResultAsync<StoredSpecFile, AppError> {
    return ResultAsync.fromPromise(this.saveInternal(input), (error) =>
      AppError.fromUnknown("SPEC_STORAGE_FAILED", error),
    );
  }

  deleteStoredSpec(filePath: string): ResultAsync<void, AppError> {
    return ResultAsync.fromPromise(this.deleteInternal(filePath), (error) =>
      AppError.fromUnknown("SPEC_STORAGE_FAILED", error),
    );
  }

  private async saveInternal(input: {
    specId: string;
    version: string;
    fileName?: string;
    content: string;
    sourceFormat: "json" | "yaml";
  }): Promise<StoredSpecFile> {
    const dir = path.resolve(this.baseDirectory, sanitize(input.specId));
    await fs.mkdir(dir, { recursive: true });

    const preferredName =
      sanitizeFileName(input.fileName) ||
      `${sanitize(input.version || "version")}.${input.sourceFormat === "json" ? "json" : "yaml"}`;
    const finalName = `${Date.now()}-${preferredName}`;
    const absolutePath = path.join(dir, finalName);

    await fs.writeFile(absolutePath, input.content, "utf8");

    return {
      fileName: finalName,
      filePath: absolutePath,
    };
  }

  private async deleteInternal(filePath: string): Promise<void> {
    if (!filePath.trim()) return;
    try {
      await fs.unlink(filePath);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError?.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

function sanitize(input: string): string {
  return input.trim().replace(/[^a-zA-Z0-9-_]+/g, "-") || "spec";
}

function sanitizeFileName(fileName?: string): string | null {
  if (!fileName) return null;
  const cleaned = path.basename(fileName).replace(/[^a-zA-Z0-9._-]+/g, "-");
  return cleaned.length > 0 ? cleaned : null;
}
