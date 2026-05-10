import path from "path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { ResultAsync } from "neverthrow";
import {
  SpecFileStorageProvider,
  StoredSpecFile,
} from "../../application/spec/contracts/spec-file-storage.provider";
import { AppError } from "../../shared/errors/app-error";

const BUCKET_NAME = "api-spec-uploads";

export class SupabaseSpecFileStorageProvider implements SpecFileStorageProvider {
  private readonly client: SupabaseClient;
  private bucketReady = false;

  constructor(supabaseUrl: string, serviceRoleKey: string) {
    this.client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }

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

  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;

    const { data: buckets, error: listError } =
      await this.client.storage.listBuckets();
    if (listError) throw listError;

    const exists = buckets?.some((b) => b.name === BUCKET_NAME);
    if (!exists) {
      const { error: createError } = await this.client.storage.createBucket(
        BUCKET_NAME,
        { public: false },
      );
      if (createError) throw createError;
    }

    this.bucketReady = true;
  }

  private async saveInternal(input: {
    specId: string;
    version: string;
    fileName?: string;
    content: string;
    sourceFormat: "json" | "yaml";
  }): Promise<StoredSpecFile> {
    await this.ensureBucket();

    const sanitizedSpecId = sanitize(input.specId);
    const preferredName =
      sanitizeFileName(input.fileName) ||
      `${sanitize(input.version || "version")}.${input.sourceFormat === "json" ? "json" : "yaml"}`;
    const finalName = `${Date.now()}-${preferredName}`;
    const storagePath = `${sanitizedSpecId}/${finalName}`;

    const contentType =
      input.sourceFormat === "json" ? "application/json" : "application/x-yaml";

    const { error } = await this.client.storage
      .from(BUCKET_NAME)
      .upload(storagePath, Buffer.from(input.content, "utf-8"), {
        contentType,
        upsert: false,
      });

    if (error) throw error;

    return {
      fileName: finalName,
      filePath: storagePath,
    };
  }

  private async deleteInternal(filePath: string): Promise<void> {
    if (!filePath.trim()) return;

    const { error } = await this.client.storage
      .from(BUCKET_NAME)
      .remove([filePath]);

    if (error) {
      const msg = error.message?.toLowerCase() ?? "";
      if (msg.includes("not found") || msg.includes("no such file")) return;
      throw error;
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
