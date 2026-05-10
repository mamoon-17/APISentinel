import type { RepositoryFile } from "../../application/analysis/contracts/repository-code.provider";
import type { ExtractedSchema } from "../../application/analysis/contracts/repository-snapshot.provider";

export interface LlmPromptInput {
  specPath: string;
  method: string;
  specRequestSchema: ExtractedSchema | null;
  specResponseSchema: ExtractedSchema | null;
  staticRequestSchema: ExtractedSchema | null;
  staticRequestConfidence: "high" | "low" | "unresolved";
  staticRequestReason?: string;
  staticResponseSchema: ExtractedSchema | null;
  staticResponseConfidence: "high" | "low" | "unresolved";
  staticResponseReason?: string;
  routeFiles: RepositoryFile[];
  modelFiles: RepositoryFile[];
  typeFiles: RepositoryFile[];
}

// Keep prompts well under the ~8k token limit of gpt-4.1-mini.
// These caps are intentionally conservative to prevent 413 errors.
const MAX_FILE_CHARS = 1400;

/**
 * Builds a structured prompt for the LLM that asks it to identify
 * schema violations for a single endpoint.
 *
 * Context is deliberately kept lean:
 *  - Route handler file(s) — truncated to MAX_FILE_CHARS
 *  - Model/entity files — truncated to MAX_FILE_CHARS
 *  - Type definition files — truncated to MAX_FILE_CHARS
 *
 * The LLM must return ONLY a JSON object matching LlmViolationResponse.
 */
export function buildViolationPrompt(input: LlmPromptInput): string {
  const sections: string[] = [];

  sections.push(`You are an API schema analyser. Your job is to find schema violations for a single API endpoint.`);
  sections.push(`You must respond with ONLY a valid JSON object and nothing else.`);

  sections.push(`\n## Endpoint\n${input.method} ${input.specPath}`);

  sections.push(`\n## Static scan (grounding context)\nStatic scan already extracted these best-effort schemas from code. Use them as your starting point.`);
  sections.push(`\nRules for using static scan confidence:`);
  sections.push(`- Fields marked "high": treat as ground truth; do NOT re-examine them.`);
  sections.push(`- Fields marked "low": verify against the code provided; correct if needed.`);
  sections.push(`- Fields marked "unresolved": these are your primary investigation target; trace into imported files/types as needed.`);

  sections.push(
    `\n### Static — Request body (confidence: ${input.staticRequestConfidence})\nReason: ${input.staticRequestReason ?? ""}\n\`\`\`json\n${JSON.stringify(input.staticRequestSchema ?? { type: "unknown" }, null, 2)}\n\`\`\``,
  );
  sections.push(
    `\n### Static — Response body (confidence: ${input.staticResponseConfidence})\nReason: ${input.staticResponseReason ?? ""}\n\`\`\`json\n${JSON.stringify(input.staticResponseSchema ?? { type: "unknown" }, null, 2)}\n\`\`\``,
  );

  if (input.specRequestSchema) {
    sections.push(`\n## OpenAPI Spec — Request Body Schema\n\`\`\`json\n${JSON.stringify(input.specRequestSchema, null, 2)}\n\`\`\``);
  }

  if (input.specResponseSchema) {
    sections.push(`\n## OpenAPI Spec — Response Body Schema\n\`\`\`json\n${JSON.stringify(input.specResponseSchema, null, 2)}\n\`\`\``);
  }

  if (input.routeFiles.length > 0) {
    sections.push(`\n## Route Handler Files`);
    for (const file of input.routeFiles.slice(0, 1)) {
      sections.push(`### ${file.path}\n\`\`\`typescript\n${truncate(file.content, MAX_FILE_CHARS)}\n\`\`\``);
    }
  }

  if (input.modelFiles.length > 0) {
    sections.push(`\n## Model / Entity / Schema Files`);
    for (const file of input.modelFiles.slice(0, 2)) {
      sections.push(`### ${file.path}\n\`\`\`typescript\n${truncate(file.content, MAX_FILE_CHARS)}\n\`\`\``);
    }
  }

  if (input.typeFiles.length > 0) {
    sections.push(`\n## TypeScript Type Definitions`);
    for (const file of input.typeFiles.slice(0, 2)) {
      sections.push(`### ${file.path}\n\`\`\`typescript\n${truncate(file.content, MAX_FILE_CHARS)}\n\`\`\``);
    }
  }

  sections.push(`
## Task

Compare the actual code against the OpenAPI spec and find violations.

A violation exists when:
- A field is a different type in the code vs the spec (type_mismatch)
- The code sends a field not defined in the spec (extra_field)
- The code does NOT send a field that is required in the spec (missing_field)

## Response Format

Respond with ONLY this JSON structure:

{
  "requestViolations": [
    {
      "field": "fieldName",
      "expected": "type from spec",
      "received": "type from code",
      "violationType": "type_mismatch | extra_field | missing_field",
      "location": "requestBody"
    }
  ],
  "responseViolations": [
    {
      "field": "fieldName",
      "expected": "type from spec",
      "received": "type from code",
      "violationType": "type_mismatch | extra_field | missing_field",
      "location": "responseBody"
    }
  ],
  "confidence": "high | medium | low",
  "notes": "brief explanation of your reasoning or what was unclear"
}

If the code cannot be determined, return empty arrays and confidence "low".
If there are no violations, return empty arrays and confidence "high".`);

  return sections.join("\n");
}

export interface LlmSchemaResolutionPromptInput {
  specPath: string;
  method: string;
  staticRequestSchema: ExtractedSchema | null;
  staticRequestConfidence: "high" | "low" | "unresolved";
  staticRequestReason?: string;
  staticResponseSchema: ExtractedSchema | null;
  staticResponseConfidence: "high" | "low" | "unresolved";
  staticResponseReason?: string;
  routeFiles: RepositoryFile[];
  modelFiles: RepositoryFile[];
  typeFiles: RepositoryFile[];
}

export function buildSchemaResolutionPrompt(
  input: LlmSchemaResolutionPromptInput,
): string {
  const sections: string[] = [];

  sections.push(
    `You are resolving the actual request/response schema for ONE API endpoint.`,
  );
  sections.push(`Do NOT compare against any OpenAPI spec yet.`);
  sections.push(`Respond with ONLY valid JSON and nothing else.`);
  sections.push(`\n## Endpoint\n${input.method} ${input.specPath}`);

  sections.push(`\n## Static scan (starting point)`);
  sections.push(`Rules:`);
  sections.push(`- Fields marked "high": treat as ground truth; do NOT re-examine them.`);
  sections.push(`- Fields marked "low": verify against the code provided; correct if needed.`);
  sections.push(`- Fields marked "unresolved": trace into imported files/types until you find the shape.`);

  sections.push(
    `\n### Static — Request body (confidence: ${input.staticRequestConfidence})\nReason: ${input.staticRequestReason ?? ""}\n\`\`\`json\n${JSON.stringify(input.staticRequestSchema ?? { type: "unknown" }, null, 2)}\n\`\`\``,
  );
  sections.push(
    `\n### Static — Response body (confidence: ${input.staticResponseConfidence})\nReason: ${input.staticResponseReason ?? ""}\n\`\`\`json\n${JSON.stringify(input.staticResponseSchema ?? { type: "unknown" }, null, 2)}\n\`\`\``,
  );

  if (input.routeFiles.length > 0) {
    sections.push(`\n## Route Handler Files`);
    for (const file of input.routeFiles.slice(0, 1)) {
      sections.push(
        `### ${file.path}\n\`\`\`typescript\n${truncate(file.content, MAX_FILE_CHARS)}\n\`\`\``,
      );
    }
  }

  if (input.modelFiles.length > 0) {
    sections.push(`\n## Model / Entity / Schema Files`);
    for (const file of input.modelFiles.slice(0, 2)) {
      sections.push(
        `### ${file.path}\n\`\`\`typescript\n${truncate(file.content, MAX_FILE_CHARS)}\n\`\`\``,
      );
    }
  }

  if (input.typeFiles.length > 0) {
    sections.push(`\n## TypeScript Type Definitions`);
    for (const file of input.typeFiles.slice(0, 2)) {
      sections.push(
        `### ${file.path}\n\`\`\`typescript\n${truncate(file.content, MAX_FILE_CHARS)}\n\`\`\``,
      );
    }
  }

  sections.push(`
## Output format

Return ONLY this JSON:
{
  "requestBodySchema": <ExtractedSchema | null>,
  "responseBodySchema": <ExtractedSchema | null>,
  "requestConfidence": "resolved" | "partial" | "failed",
  "responseConfidence": "resolved" | "partial" | "failed",
  "notes": "short notes (what you traced, what was unclear)"
}

Guidance:
- "resolved": you found a concrete object/DTO/type shape
- "partial": you found some fields but not all
- "failed": you could not determine the shape from the provided files
`);

  return sections.join("\n");
}

export interface LlmSchemaComparisonPromptInput {
  specPath: string;
  method: string;
  specRequestSchema: ExtractedSchema | null;
  specResponseSchema: ExtractedSchema | null;
  implRequestSchema: ExtractedSchema | null;
  implResponseSchema: ExtractedSchema | null;
}

export function buildSchemaComparisonPrompt(
  input: LlmSchemaComparisonPromptInput,
): string {
  return `You are comparing two schemas. Do NOT look at any code.

Endpoint: ${input.method} ${input.specPath}

Resolved implementation schema (request):
${JSON.stringify(input.implRequestSchema ?? { type: "unknown" }, null, 2)}

Resolved implementation schema (response):
${JSON.stringify(input.implResponseSchema ?? { type: "unknown" }, null, 2)}

OpenAPI spec schema (request):
${JSON.stringify(input.specRequestSchema ?? { type: "unknown" }, null, 2)}

OpenAPI spec schema (response):
${JSON.stringify(input.specResponseSchema ?? { type: "unknown" }, null, 2)}

Return ONLY this JSON:
{
  "requestViolations": [
    { "field": "fieldName", "expected": "type from spec", "received": "type from impl", "violationType": "type_mismatch | extra_field | missing_field", "location": "requestBody" }
  ],
  "responseViolations": [
    { "field": "fieldName", "expected": "type from spec", "received": "type from impl", "violationType": "type_mismatch | extra_field | missing_field", "location": "responseBody" }
  ],
  "confidence": "high" | "medium" | "low",
  "notes": "brief explanation"
}

Return empty arrays if schemas match.`;
}

function truncate(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + `\n... (truncated, ${content.length - maxChars} chars omitted)`;
}
