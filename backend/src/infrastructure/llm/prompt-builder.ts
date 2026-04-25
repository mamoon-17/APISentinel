import type { RepositoryFile } from "../../application/analysis/contracts/repository-code.provider";
import type { ExtractedSchema } from "../../application/analysis/contracts/repository-snapshot.provider";

export interface LlmPromptInput {
  specPath: string;
  method: string;
  specRequestSchema: ExtractedSchema | null;
  specResponseSchema: ExtractedSchema | null;
  routeFiles: RepositoryFile[];
  modelFiles: RepositoryFile[];
  typeFiles: RepositoryFile[];
}

const MAX_FILE_CHARS = 3000;

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

  if (input.specRequestSchema) {
    sections.push(`\n## OpenAPI Spec — Request Body Schema\n\`\`\`json\n${JSON.stringify(input.specRequestSchema, null, 2)}\n\`\`\``);
  }

  if (input.specResponseSchema) {
    sections.push(`\n## OpenAPI Spec — Response Body Schema\n\`\`\`json\n${JSON.stringify(input.specResponseSchema, null, 2)}\n\`\`\``);
  }

  if (input.routeFiles.length > 0) {
    sections.push(`\n## Route Handler Files`);
    for (const file of input.routeFiles.slice(0, 3)) {
      sections.push(`### ${file.path}\n\`\`\`typescript\n${truncate(file.content, MAX_FILE_CHARS)}\n\`\`\``);
    }
  }

  if (input.modelFiles.length > 0) {
    sections.push(`\n## Model / Entity / Schema Files`);
    for (const file of input.modelFiles.slice(0, 5)) {
      sections.push(`### ${file.path}\n\`\`\`typescript\n${truncate(file.content, MAX_FILE_CHARS)}\n\`\`\``);
    }
  }

  if (input.typeFiles.length > 0) {
    sections.push(`\n## TypeScript Type Definitions`);
    for (const file of input.typeFiles.slice(0, 3)) {
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

function truncate(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + `\n... (truncated, ${content.length - maxChars} chars omitted)`;
}
