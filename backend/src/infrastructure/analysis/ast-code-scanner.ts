import { Project, SyntaxKind, ObjectLiteralExpression } from "ts-morph";
import type { ExtractedSchema } from "../../application/analysis/contracts/repository-snapshot.provider";

export type ExtractionConfidence = "high" | "low" | "unresolved";

export interface ExtractionResult {
  schema: ExtractedSchema | null;
  confidence: ExtractionConfidence;
  /** Human-readable reason for the confidence level */
  reason: string;
}

/**
 * Extracts the request body and response body schemas from a TypeScript
 * route handler using AST analysis via ts-morph.
 *
 * Handles:
 *  - res.json({ ... }) literal objects → high confidence
 *  - const { field1, field2 } = req.body → medium confidence (shape from destructuring)
 *  - TypeScript types on req.body (req.body as UserRequest) → high confidence (from types)
 *  - res.json(variable) → unresolved (needs LLM)
 */
export function extractSchemasFromFile(
  fileContent: string,
  filePath: string,
): {
  requestBody: ExtractionResult;
  responseBody: ExtractionResult;
} {
  try {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
    const sourceFile = project.createSourceFile(filePath, fileContent);

    const requestBody = extractRequestBodySchema(sourceFile as any);
    const responseBody = extractResponseBodySchema(sourceFile as any);

    return { requestBody, responseBody };
  } catch {
    return {
      requestBody: { schema: null, confidence: "unresolved", reason: "AST parse error" },
      responseBody: { schema: null, confidence: "unresolved", reason: "AST parse error" },
    };
  }
}

function extractRequestBodySchema(sourceFile: any): ExtractionResult {
  // Strategy 1: Find TypeScript type cast on req.body
  // e.g. const body = req.body as CreateUserDto
  const typeAssertions: string[] = [];
  sourceFile.forEachDescendant((node: any) => {
    if (node.getKind() === SyntaxKind.AsExpression) {
      const expr = node.getExpression?.();
      if (expr?.getText?.()?.includes("req.body")) {
        const typeText = node.getTypeNode?.()?.getText?.();
        if (typeText) typeAssertions.push(typeText);
      }
    }
  });

  if (typeAssertions.length > 0) {
    return {
      schema: { type: "object", properties: undefined },
      confidence: "low",
      reason: `req.body typed as ${typeAssertions[0]} — type name recorded but shape needs LLM resolution`,
    };
  }

  // Strategy 2: Destructuring from req.body
  // const { email, password } = req.body
  const destructuredFields: string[] = [];
  sourceFile.forEachDescendant((node: any) => {
    if (node.getKind() === SyntaxKind.VariableDeclaration) {
      const initializer = node.getInitializer?.();
      if (initializer?.getText?.()?.includes("req.body")) {
        const bindingPattern = node.getNameNode?.();
        if (bindingPattern?.getKind() === SyntaxKind.ObjectBindingPattern) {
          bindingPattern.getElements?.()?.forEach((el: any) => {
            const name = el.getName?.();
            if (name) destructuredFields.push(name);
          });
        }
      }
    }
  });

  if (destructuredFields.length > 0) {
    const properties: Record<string, ExtractedSchema> = {};
    for (const field of destructuredFields) {
      properties[field] = { type: "unknown" };
    }
    return {
      schema: { type: "object", properties },
      confidence: "low",
      reason: `req.body destructuring found: ${destructuredFields.join(", ")} — types unknown`,
    };
  }

  return {
    schema: null,
    confidence: "unresolved",
    reason: "No req.body usage pattern found — escalate to LLM",
  };
}

function extractResponseBodySchema(sourceFile: any): ExtractionResult {
  const jsonCallArgs: ObjectLiteralExpression[] = [];

  // Find all res.json(...) calls
  sourceFile.forEachDescendant((node: any) => {
    if (node.getKind() === SyntaxKind.CallExpression) {
      const expr = node.getExpression?.();
      if (expr?.getText?.()?.match(/res\.(json|send|status\(\d+\)\.json)/)) {
        const args = node.getArguments?.() ?? [];
        for (const arg of args) {
          if (arg.getKind() === SyntaxKind.ObjectLiteralExpression) {
            jsonCallArgs.push(arg);
          }
        }
      }
    }
  });

  if (jsonCallArgs.length > 0) {
    // Use the first literal object found (usually the success response)
    const schema = objectLiteralToSchema(jsonCallArgs[0]!);
    return {
      schema,
      confidence: "high",
      reason: `res.json() called with literal object — ${Object.keys(schema.properties ?? {}).length} fields extracted`,
    };
  }

  // Fallback: look for res.json(variable) — unresolved
  let hasJsonCall = false;
  sourceFile.forEachDescendant((node: any) => {
    if (node.getKind() === SyntaxKind.CallExpression) {
      const text = node.getExpression?.()?.getText?.() ?? "";
      if (text.includes("res.json") || text.includes("res.send")) {
        hasJsonCall = true;
      }
    }
  });

  if (hasJsonCall) {
    return {
      schema: null,
      confidence: "unresolved",
      reason: "res.json() called with a variable/expression — escalate to LLM",
    };
  }

  return {
    schema: null,
    confidence: "unresolved",
    reason: "No res.json() call found in file",
  };
}

/**
 * Converts an ObjectLiteralExpression AST node to an ExtractedSchema.
 * Only one level deep — nested objects are typed as "object" without diving further.
 */
function objectLiteralToSchema(node: ObjectLiteralExpression): ExtractedSchema {
  const properties: Record<string, ExtractedSchema> = {};

  for (const prop of (node as any).getProperties?.() ?? []) {
    if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;

    const name = prop.getName?.();
    if (!name) continue;

    const initializer = prop.getInitializer?.();
    if (!initializer) {
      properties[name] = { type: "unknown" };
      continue;
    }

    properties[name] = inferSchemaFromNode(initializer);
  }

  return { type: "object", properties };
}

function inferSchemaFromNode(node: any): ExtractedSchema {
  const kind = node.getKind();

  if (kind === SyntaxKind.StringLiteral || kind === SyntaxKind.TemplateExpression) {
    return { type: "string" };
  }
  if (kind === SyntaxKind.NumericLiteral) {
    return { type: "number" };
  }
  if (kind === SyntaxKind.TrueKeyword || kind === SyntaxKind.FalseKeyword) {
    return { type: "boolean" };
  }
  if (kind === SyntaxKind.NullKeyword || kind === SyntaxKind.UndefinedKeyword) {
    return { type: "unknown" };
  }
  if (kind === SyntaxKind.ArrayLiteralExpression) {
    const elements = node.getElements?.() ?? [];
    const firstItem = elements[0];
    return {
      type: "array",
      items: firstItem ? inferSchemaFromNode(firstItem) : { type: "unknown" },
    };
  }
  if (kind === SyntaxKind.ObjectLiteralExpression) {
    return objectLiteralToSchema(node);
  }

  // Identifier or call expression — we can't determine the type statically
  return { type: "unknown" };
}
