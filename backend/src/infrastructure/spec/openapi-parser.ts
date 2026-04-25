import crypto from "crypto";
import path from "path";
import { load as loadYaml } from "js-yaml";
import { ParsedOpenApiSpec, OpenApiParser } from "../../application/spec";
import { SpecOperation, SpecSchema } from "../../domain/spec";

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
          requestBodySchema: extractRequestBodySchema(operation, document),
          responseBodySchema: extractResponseBodySchema(operation, document),
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

function extractRequestBodySchema(
  operation: Record<string, unknown>,
  document: Record<string, unknown>,
): SpecSchema | undefined {
  const requestBody = dereferenceSchemaLike(
    operation.requestBody,
    document,
    new Set<string>(),
  );
  if (!requestBody) {
    return undefined;
  }

  const content = toObject(requestBody.content);
  const mediaSchema = pickJsonMediaSchema(content);
  return mediaSchema
    ? toSpecSchema(mediaSchema, document, new Set<string>())
    : undefined;
}

function extractResponseBodySchema(
  operation: Record<string, unknown>,
  document: Record<string, unknown>,
): SpecSchema | undefined {
  const responses = toObject(operation.responses);
  if (Object.keys(responses).length === 0) {
    return undefined;
  }

  const preferred = Object.entries(responses).find(([status]) =>
    /^2\d\d$/.test(status),
  );
  const chosen = preferred?.[1] ?? responses.default;
  const responseNode = dereferenceSchemaLike(
    chosen,
    document,
    new Set<string>(),
  );
  if (!responseNode) {
    return undefined;
  }

  const content = toObject(responseNode.content);
  const mediaSchema = pickJsonMediaSchema(content);
  return mediaSchema
    ? toSpecSchema(mediaSchema, document, new Set<string>())
    : undefined;
}

function pickJsonMediaSchema(
  content: Record<string, unknown>,
): Record<string, unknown> | null {
  const directJson = toObject(content["application/json"]);
  if (Object.keys(directJson).length > 0) {
    return toObject(directJson.schema);
  }

  for (const [mediaType, value] of Object.entries(content)) {
    if (!mediaType.toLowerCase().includes("json")) {
      continue;
    }
    const media = toObject(value);
    const schema = toObject(media.schema);
    if (Object.keys(schema).length > 0) {
      return schema;
    }
  }

  return null;
}

function toSpecSchema(
  rawSchema: Record<string, unknown>,
  document: Record<string, unknown>,
  visitedRefs: Set<string>,
): SpecSchema {
  const schema = dereferenceSchemaLike(rawSchema, document, visitedRefs);
  if (!schema) {
    return { type: "unknown" };
  }

  const explicitType = pickString(schema.type);
  const inferredType = inferSchemaType(schema, explicitType);

  if (inferredType === "object") {
    const propertiesNode = toObject(schema.properties);
    const properties: Record<string, SpecSchema> = {};
    for (const [key, value] of Object.entries(propertiesNode)) {
      const childSchema = toSpecSchema(
        toObject(value),
        document,
        new Set(visitedRefs),
      );
      properties[key] = childSchema;
    }

    const requiredRaw = Array.isArray(schema.required) ? schema.required : [];
    const required = requiredRaw.filter(
      (item): item is string => typeof item === "string" && item.length > 0,
    );

    return {
      type: "object",
      properties: Object.keys(properties).length > 0 ? properties : undefined,
      required: required.length > 0 ? required : undefined,
    };
  }

  if (inferredType === "array") {
    const itemsNode = toObject(schema.items);
    return {
      type: "array",
      items:
        Object.keys(itemsNode).length > 0
          ? toSpecSchema(itemsNode, document, new Set(visitedRefs))
          : { type: "unknown" },
    };
  }

  if (
    inferredType === "string" ||
    inferredType === "number" ||
    inferredType === "boolean" ||
    inferredType === "unknown"
  ) {
    return { type: inferredType };
  }

  return { type: "unknown" };
}

function inferSchemaType(
  schema: Record<string, unknown>,
  explicitType: string | null,
): SpecSchema["type"] {
  if (explicitType === "integer") {
    return "number";
  }

  if (
    explicitType === "object" ||
    explicitType === "array" ||
    explicitType === "string" ||
    explicitType === "number" ||
    explicitType === "boolean"
  ) {
    return explicitType;
  }

  if (Array.isArray(schema.oneOf)) {
    const first = toObject(schema.oneOf[0]);
    return inferSchemaType(first, pickString(first.type));
  }

  if (Array.isArray(schema.anyOf)) {
    const first = toObject(schema.anyOf[0]);
    return inferSchemaType(first, pickString(first.type));
  }

  if (toObject(schema.properties) && Object.keys(toObject(schema.properties)).length > 0) {
    return "object";
  }

  if (Object.keys(toObject(schema.items)).length > 0) {
    return "array";
  }

  return "unknown";
}

function dereferenceSchemaLike(
  schemaLike: unknown,
  document: Record<string, unknown>,
  visitedRefs: Set<string>,
): Record<string, unknown> | null {
  const raw = toObject(schemaLike);
  if (Object.keys(raw).length === 0) {
    return null;
  }

  const ref = pickString(raw.$ref);
  if (!ref) {
    return raw;
  }

  if (visitedRefs.has(ref)) {
    return null;
  }
  visitedRefs.add(ref);

  const resolved = resolveJsonPointer(document, ref);
  if (!resolved) {
    return null;
  }

  return dereferenceSchemaLike(resolved, document, visitedRefs);
}

function resolveJsonPointer(
  document: Record<string, unknown>,
  pointer: string,
): unknown {
  if (!pointer.startsWith("#/")) {
    return null;
  }

  const parts = pointer
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));

  let current: unknown = document;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
