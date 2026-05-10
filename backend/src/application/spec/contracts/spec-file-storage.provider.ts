import { ResultAsync } from "neverthrow";
import { AppError } from "../../../shared/errors/app-error";

export interface StoredSpecFile {
  fileName: string;
  filePath: string;
}

export interface SpecFileStorageProvider {
  saveUploadedSpec(input: {
    specId: string;
    version: string;
    fileName?: string;
    content: string;
    sourceFormat: "json" | "yaml";
  }): ResultAsync<StoredSpecFile, AppError>;
  deleteStoredSpec(filePath: string): ResultAsync<void, AppError>;
}
