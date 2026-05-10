import OpenAI from "openai";
import { ok, err, Result } from "neverthrow";
import { AppError } from "../../shared/errors/app-error";
import type { RepositoryFile } from "../../application/analysis/contracts/repository-code.provider";
import type { ExtractedSchema, HttpMethod } from "../../application/analysis/contracts/repository-snapshot.provider";
import { detectArchitectureContext } from "../../application/analysis/architecture-detector";

const GITHUB_MODELS_BASE_URL = "https://models.inference.ai.azure.com";
const MODEL = "gpt-4.1-mini";

type AgentAction =
  | { action: "list_directory"; path?: string; reason?: string }
  | { action: "read_file"; path?: string; reason?: string }
  | { action: "search_files"; query?: string; reason?: string }
  | {
      action: "finish_schema_resolution";
      requestBodySchema?: unknown;
      responseBodySchema?: unknown;
      notes?: unknown;
    };

export interface AgenticSchemaResolutionResult {
  requestBodySchema: ExtractedSchema | null;
  responseBodySchema: ExtractedSchema | null;
  notes: string[];
  turns: number;
  filesRead: string[];
}

/**
 * Agentic schema resolver for a single endpoint.
 *
 * This is intentionally bounded and only used when static confidence is
 * "unresolved". The agent can read files and list directories, and must
 * terminate by calling finish_schema_resolution (or hitting maxTurns).
 */
export async function resolveSchemaAgentically(input: {
  repositoryId: string;
  method: HttpMethod;
  path: string;
  handlerHintFile?: string;
  files: RepositoryFile[];
  githubToken: string;
  maxTurns?: number;
}): Promise<Result<AgenticSchemaResolutionResult, AppError>> {
  const maxTurns = input.maxTurns ?? 15;
  const client = new OpenAI({ baseURL: GITHUB_MODELS_BASE_URL, apiKey: input.githubToken });
  const tools = makeTools(input.files);

  const filesRead: string[] = [];
  const arch = detectArchitectureContext(input.files.map((f) => f.path));

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content:
        `You are an agentic schema resolution worker for APISentinel.
Project architecture: ${arch.architecture}
Route tracing order: ${arch.tracingOrder}

Your job is to resolve the actual request/response body schema for ONE endpoint by following imports and tracing values (handler -> service -> model/type).
Always respond with valid JSON only. Use the available actions to read files and list directories.
Stop only by returning action finish_schema_resolution.`,
    },
    {
      role: "user",
      content: `Resolve schemas for:
${input.method} ${input.path}

Static scan confidence is UNRESOLVED, so you MUST trace the values to their source.

If provided, start by reading the handler hint file first, then follow imports.
Handler hint: ${input.handlerHintFile ?? "(not provided)"}

Available actions (return JSON only):
{"action":"list_directory","path":"optional/path/prefix","reason":"why"}
{"action":"read_file","path":"exact/path/from/tree","reason":"why"}
{"action":"search_files","query":"text to search","reason":"why"}
{"action":"finish_schema_resolution","requestBodySchema":{...},"responseBodySchema":{...},"notes":["..."]}

Schema format: ExtractedSchema-like JSON:
{ "type": "object|array|string|number|boolean|unknown", "properties": {...}, "items": {...}, "required": [...] }

Start by listing the repository root and/or reading the handler hint file.`,
    },
  ];

  // If we have a hint, include a one-shot file read result to anchor the agent.
  if (input.handlerHintFile) {
    const hint = tools.readFile(input.handlerHintFile);
    filesRead.push(input.handlerHintFile);
    messages.push({
      role: "user",
      content: `TOOL_RESULT (prefetched handler hint):\n${hint}`,
    });
  } else if (arch.entryPoint) {
    // Entry-point-first feeding when no handler hint is available.
    const entry = tools.readFile(arch.entryPoint);
    filesRead.push(arch.entryPoint);
    messages.push({
      role: "user",
      content: `TOOL_RESULT (prefetched entry point):\n${entry}`,
    });
  }

  for (let turn = 1; turn <= maxTurns; turn++) {
    const actionResult = await requestAgentAction(client, messages);
    if (actionResult.isErr()) return err(actionResult.error);
    const action = actionResult.value;

    if (action.action === "finish_schema_resolution") {
      return ok({
        requestBodySchema: parseExtractedSchema(action.requestBodySchema),
        responseBodySchema: parseExtractedSchema(action.responseBodySchema),
        notes: Array.isArray(action.notes)
          ? action.notes.filter((n): n is string => typeof n === "string")
          : [],
        turns: turn,
        filesRead,
      });
    }

    // Execute tool action
    const toolOutput = executeAction(action, tools, filesRead);
    messages.push({ role: "assistant", content: JSON.stringify(action) });
    messages.push({ role: "user", content: `TOOL_RESULT:\n${toolOutput}` });
  }

  return ok({
    requestBodySchema: null,
    responseBodySchema: null,
    notes: [`Hit MAX_TURNS (${maxTurns}) before finish_schema_resolution.`],
    turns: maxTurns,
    filesRead,
  });
}

async function requestAgentAction(
  client: OpenAI,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
): Promise<Result<AgentAction, AppError>> {
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages,
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 1400,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return err(new AppError("UNKNOWN_ERROR", `Agent returned invalid JSON: ${raw.slice(0, 200)}`));
    }

    if (typeof parsed !== "object" || parsed === null) {
      return ok({ action: "list_directory", path: "", reason: "fallback" });
    }

    const action = (parsed as Record<string, unknown>)["action"];
    if (
      action === "list_directory" ||
      action === "read_file" ||
      action === "search_files" ||
      action === "finish_schema_resolution"
    ) {
      return ok(parsed as AgentAction);
    }

    return ok({ action: "list_directory", path: "", reason: "unrecognized action fallback" });
  } catch (error) {
    return err(AppError.fromUnknown("UNKNOWN_ERROR", error));
  }
}

function executeAction(
  action: Exclude<AgentAction, { action: "finish_schema_resolution" }>,
  tools: ReturnType<typeof makeTools>,
  filesRead: string[],
): string {
  if (action.action === "list_directory") {
    return tools.listDirectory(String(action.path ?? ""));
  }
  if (action.action === "read_file") {
    const p = String(action.path ?? "");
    filesRead.push(p);
    return tools.readFile(p);
  }
  return tools.searchFiles(String(action.query ?? ""));
}

function normalizeToolPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

function makeTools(files: RepositoryFile[]) {
  const byPath = new Map(files.map((f) => [normalizeToolPath(f.path), f] as const));
  const allPaths = files.map((f) => f.path);
  const MAX_TOOL_CHARS = 6000;

  return {
    listDirectory(prefix: string): string {
      const norm = normalizeToolPath(prefix);
      const hits = allPaths
        .filter((p) => (norm ? normalizeToolPath(p).startsWith(norm) : true))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 140);
      return hits.length > 0 ? hits.join("\n") : "No files.";
    },
    readFile(path: string): string {
      const file = byPath.get(normalizeToolPath(path));
      if (!file) return `File not found: ${path}`;
      return `FILE: ${file.path}\n${file.content.slice(0, MAX_TOOL_CHARS)}${file.content.length > MAX_TOOL_CHARS ? "\n\n[truncated]" : ""}`;
    },
    searchFiles(query: string): string {
      const needle = query.trim().toLowerCase();
      if (needle.length < 2) return "Search query too short.";
      const results: string[] = [];
      for (const f of files) {
        const lp = f.path.toLowerCase();
        const lc = f.content.toLowerCase();
        if (!lp.includes(needle) && !lc.includes(needle)) continue;
        results.push(`FILE: ${f.path}`);
        if (results.length >= 24) break;
      }
      return results.length > 0 ? results.join("\n") : "No matches.";
    },
  };
}

function parseExtractedSchema(raw: unknown): ExtractedSchema | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const type = obj["type"];
  if (
    type !== "object" &&
    type !== "array" &&
    type !== "string" &&
    type !== "number" &&
    type !== "boolean" &&
    type !== "unknown"
  ) {
    return null;
  }
  const schema: ExtractedSchema = { type };
  if (type === "object" && typeof obj["properties"] === "object" && obj["properties"] !== null) {
    const properties: Record<string, ExtractedSchema> = {};
    for (const [k, v] of Object.entries(obj["properties"] as Record<string, unknown>)) {
      const child = parseExtractedSchema(v);
      if (child) properties[k] = child;
    }
    if (Object.keys(properties).length > 0) schema.properties = properties;
  }
  if (type === "array") {
    schema.items = parseExtractedSchema(obj["items"]) ?? { type: "unknown" };
  }
  if (Array.isArray(obj["required"])) {
    schema.required = obj["required"].filter((x): x is string => typeof x === "string");
  }
  return schema;
}

