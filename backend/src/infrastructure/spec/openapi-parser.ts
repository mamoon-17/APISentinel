import crypto from "crypto";
import path from "path";
import { load as loadYaml } from "js-yaml";
import { ParsedOpenApiSpec, OpenApiParser } from "../../application/spec";
import { SpecOperation } from "../../domain/spec";

const SUPPORTED_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

export class DefaultOpenApiParser implements OpenApiParser {
  parse(content: string, fileName?: string): ParsedOpenApiSpec {
    const source = content.trim();
    if (!source) {
      throw new Error("Spec content is empty");
    }

    const { document, sourceFormat } = parseDocument(source);
    validateOpenApiShape(document);
    const info = toObject(document.info);
    const specName =
      pickString(info.title) ??
      inferSpecNameFromFile(fileName) ??
      "Uploaded API";
    const version = pickString(info.version) ?? "v1.0.0";

    const paths = toObject(document.paths);
    const operations: SpecOperation[] = [];

    for (const [routePath, value] of Object.entries(paths)) {
      const pathNode = toObject(value);

      for (const [rawMethod, operationValue] of Object.entries(pathNode)) {
        const method = rawMethod.toLowerCase();
        if (!SUPPORTED_METHODS.has(method)) {
          continue;
        }

        const operation = toObject(operationValue);
        operations.push({
          method: method.toUpperCase() as SpecOperation["method"],
          path: normalizePath(routePath),
          normalizedPath: normalizePath(routePath),
          operationId: pickString(operation.operationId),
          summary: pickString(operation.summary),
        });
      }
    }

    const uniqueOperations = dedupeOperations(operations);
    if (uniqueOperations.length === 0) {
      throw new Error(
        "OpenAPI document must define at least one supported path operation",
      );
    }

    return {
      specName,
      version,
      sourceFormat,
      sourceHash: hashSource(content),
      rawDocument: document,
      operations: uniqueOperations,
    };
  }
}

function validateOpenApiShape(document: Record<string, unknown>): void {
  const openapiVersion = pickString(document.openapi);
  const swaggerVersion = pickString(document.swagger);

  if (!openapiVersion && !swaggerVersion) {
    throw new Error(
      "Document is not a valid OpenAPI/Swagger definition (missing openapi/swagger)",
    );
  }

  const paths = document.paths;
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) {
    throw new Error("OpenAPI document must contain a valid paths object");
  }
}

function parseDocument(source: string): {
  document: Record<string, unknown>;
  sourceFormat: "json" | "yaml";
} {
  try {
    const parsed = JSON.parse(source) as unknown;
    const document = toObject(parsed);
    return { document, sourceFormat: "json" };
  } catch {
    const parsedYaml = loadYaml(source) as unknown;
    const document = toObject(parsedYaml);
    return { document, sourceFormat: "yaml" };
  }
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function inferSpecNameFromFile(fileName?: string): string | null {
  if (!fileName) {
    return null;
  }

  const ext = path.extname(fileName);
  const name = path.basename(fileName, ext).trim();
  return name.length > 0 ? name : null;
}

function hashSource(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function normalizePath(pathValue: string): string {
  if (!pathValue || pathValue.trim() === "") {
    return "/";
  }

  const withLeadingSlash = pathValue.startsWith("/")
    ? pathValue
    : `/${pathValue}`;

  return (
    withLeadingSlash
      .replace(/:[^/]+/g, "{param}")
      .replace(/\{[^/]+\}/g, "{param}")
      .replace(/\/+$/, "")
      .replace(/\/+/g, "/")
      .toLowerCase() || "/"
  );
}

function dedupeOperations(operations: SpecOperation[]): SpecOperation[] {
  const seen = new Set<string>();
  const deduped: SpecOperation[] = [];

  for (const operation of operations) {
    const key = `${operation.method}:${operation.normalizedPath}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(operation);
  }

  return deduped;
}
