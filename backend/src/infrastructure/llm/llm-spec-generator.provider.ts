import { ResultAsync } from "neverthrow";
import OpenAI from "openai";
import { AppError } from "../../shared/errors/app-error";
import type { SpecGeneratorProvider, GeneratedSpecPair } from "../../application/spec/contracts/spec-generator.provider";
import type { RepositoryFile } from "../../application/analysis/contracts/repository-code.provider";

const GITHUB_MODELS_BASE_URL = "https://models.inference.ai.azure.com";
const MODEL = "gpt-4.1-mini";
const MAX_FILE_CHARS = 4000;
const MAX_FILES_PER_ROLE = 6;

/**
 * ADAPTER — uses GPT-4.1-mini to generate two OpenAPI specs from repo files:
 *   1. An accurate spec that matches the actual code
 *   2. A violation spec with intentional type mismatches and field errors
 */
export class LlmSpecGeneratorProvider implements SpecGeneratorProvider {
  constructor(private readonly githubToken: string) {}

  generateFromFiles(
    files: RepositoryFile[],
    repoName: string,
  ): ResultAsync<GeneratedSpecPair, AppError> {
    return ResultAsync.fromPromise(
      this.doGenerate(files, repoName),
      (e) => e instanceof AppError ? e : new AppError("UNKNOWN_ERROR", String(e)),
    );
  }

  private async doGenerate(files: RepositoryFile[], repoName: string): Promise<GeneratedSpecPair> {
    const client = new OpenAI({ baseURL: GITHUB_MODELS_BASE_URL, apiKey: this.githubToken });

    const context = buildContext(files, repoName);

    // ── Pass 1: Generate accurate spec ───────────────────────────────────────
    const accurateCompletion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildAccuratePrompt(context) },
      ],
      temperature: 0,
      max_tokens: 4000,
    });

    const accurateRaw = accurateCompletion.choices[0]?.message?.content ?? "";
    const accurateSpec = extractYaml(accurateRaw);

    // ── Pass 2: Generate violation spec from the accurate one ────────────────
    const violationCompletion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildViolationPrompt(accurateSpec, context.routeSummary) },
      ],
      temperature: 0.2,
      max_tokens: 4000,
    });

    const violationRaw = violationCompletion.choices[0]?.message?.content ?? "";
    const violationSpec = extractYaml(violationRaw);

    // ── Pass 3: Generate a plain-language summary ─────────────────────────────
    const summaryCompletion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: `Based on this OpenAPI spec, write a 2-3 sentence plain English summary of what this API does, what endpoints it has, and what data it handles. Be concise.\n\n${accurateSpec}`,
        },
      ],
      temperature: 0,
      max_tokens: 200,
    });

    const summary = summaryCompletion.choices[0]?.message?.content?.trim() ?? "API generated from repository source code.";

    return { accurateSpec, violationSpec, summary };
  }
}

// ── Context builder ───────────────────────────────────────────────────────────

interface RepoContext {
  repoName: string;
  routeSummary: string;
  modelSummary: string;
  typeSummary: string;
}

function buildContext(files: RepositoryFile[], repoName: string): RepoContext {
  const routeFiles = files.filter(f => f.role === "route").slice(0, MAX_FILES_PER_ROLE);
  const modelFiles = files.filter(f => f.role === "model").slice(0, MAX_FILES_PER_ROLE);
  const typeFiles = files.filter(f => f.role === "type" || f.role === "schema").slice(0, MAX_FILES_PER_ROLE);

  // Fall back to service/other files if no route files found
  const fallbackFiles = files.filter(f => f.role === "service" || f.role === "other").slice(0, 4);
  const effectiveRouteFiles = routeFiles.length > 0 ? routeFiles : fallbackFiles;

  return {
    repoName,
    routeSummary: formatFiles(effectiveRouteFiles, "Route / Controller Files"),
    modelSummary: formatFiles(modelFiles, "Model / Entity Files"),
    typeSummary: formatFiles(typeFiles, "Type / Interface / Schema Files"),
  };
}

function formatFiles(files: RepositoryFile[], label: string): string {
  if (files.length === 0) return `## ${label}\n(none found)\n`;

  const sections = [`## ${label}`];
  for (const file of files) {
    sections.push(`### ${file.path}\n\`\`\`typescript\n${truncate(file.content, MAX_FILE_CHARS)}\n\`\`\``);
  }
  return sections.join("\n\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n... (${s.length - max} chars omitted)`;
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert API documentation engineer. You generate complete, valid OpenAPI 3.0 YAML specifications from backend source code. You always output only the raw YAML with no markdown code fences, no explanation, no preamble.`;

function buildAccuratePrompt(ctx: RepoContext): string {
  return `Analyse the following backend source code from the repository "${ctx.repoName}" and generate a complete, accurate OpenAPI 3.0.0 YAML specification.

Rules:
- Include ALL endpoints you can identify from the route files
- Match request body fields exactly to what the code reads from req.body
- Match response body fields exactly to what res.json() returns
- Use correct types (string, number, boolean, array, object)
- Include proper HTTP status codes (200, 201, 400, 401, 404, 500)
- Add the info block with title "${ctx.repoName} API", version "1.0.0"
- Add servers: [{url: "http://localhost:3000"}]
- Output ONLY raw YAML, no markdown fences, no explanation

${ctx.routeSummary}

${ctx.modelSummary}

${ctx.typeSummary}`;
}

function buildViolationPrompt(accurateSpec: string, routeSummary: string): string {
  return `You are given an accurate OpenAPI 3.0 YAML spec. Your job is to create a MODIFIED version that intentionally introduces schema violations so that a schema validator will detect them.

Apply ALL of the following changes:
1. For at least 3 request body fields: change their type to a wrong type (e.g. string → number, boolean → string, number → boolean)
2. Remove at least 2 required fields from request or response bodies
3. Add at least 3 fields that don't exist in the real code (extra fields in responses)
4. Change at least 2 response field names to wrong names (e.g. "userId" → "user_id", "createdAt" → "created")
5. Change at least 1 endpoint's HTTP method to wrong method (e.g. POST → PUT)
6. Mark at least 3 optional fields as required
7. Change status codes for at least 2 endpoints (e.g. 200 → 201, 201 → 200)

Keep the overall structure valid — it must still parse as valid OpenAPI 3.0 YAML.
Output ONLY raw YAML, no markdown fences, no explanation.

## Accurate spec to modify:
${accurateSpec}

## Original route context for reference:
${routeSummary.slice(0, 2000)}`;
}

// ── YAML extractor ────────────────────────────────────────────────────────────

/**
 * Strips any markdown code fences the model might add despite instructions.
 */
function extractYaml(raw: string): string {
  // Remove ```yaml ... ``` or ``` ... ``` wrappers
  const fenceMatch = raw.match(/```(?:yaml|yml)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1]!.trim();

  return raw.trim();
}
