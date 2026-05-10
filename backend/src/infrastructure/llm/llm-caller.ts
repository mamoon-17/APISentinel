import OpenAI from "openai";
import { ok, err, Result } from "neverthrow";
import { AppError } from "../../shared/errors/app-error";
import type { RepositoryFile } from "../../application/analysis/contracts/repository-code.provider";
import type {
  ExtractedSchema,
  HttpMethod,
} from "../../application/analysis/contracts/repository-snapshot.provider";

export interface LlmViolation {
  field: string;
  expected: string;
  received: string;
  violationType: "type_mismatch" | "extra_field" | "missing_field";
  location: "requestBody" | "responseBody";
}

export interface LlmViolationResponse {
  requestViolations: LlmViolation[];
  responseViolations: LlmViolation[];
  confidence: "high" | "medium" | "low";
  notes: string;
}

const GITHUB_MODELS_BASE_URL = "https://models.inference.ai.azure.com";
const MODEL = "gpt-4.1-mini";
const AGENT_MAX_STEPS = 10;
const MAX_TOOL_CONTENT_CHARS = 12_000;

/**
 * Calls GPT-4.1-mini via GitHub Models and returns structured schema violations.
 *
 * Uses GitHub Models endpoint (free with a GitHub token) instead of OpenAI directly.
 * The response is enforced as JSON via response_format.
 */
export async function callLlmForViolations(
  prompt: string,
  githubToken: string,
): Promise<Result<LlmViolationResponse, AppError>> {
  const client = new OpenAI({
    baseURL: GITHUB_MODELS_BASE_URL,
    apiKey: githubToken,
  });

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: "You are an API schema analyser. You find violations between OpenAPI specs and backend code. Always respond with valid JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 1500,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return err(new AppError("UNKNOWN_ERROR", `LLM returned invalid JSON: ${raw.slice(0, 200)}`));
    }

    const response = parseLlmResponse(parsed);
    return ok(response);
  } catch (error) {
    return err(AppError.fromUnknown("UNKNOWN_ERROR", error));
  }
}

function parseLlmResponse(raw: unknown): LlmViolationResponse {
  if (typeof raw !== "object" || raw === null) {
    return emptyResponse("low");
  }

  const obj = raw as Record<string, unknown>;

  const requestViolations = parseViolationArray(obj["requestViolations"]);
  const responseViolations = parseViolationArray(obj["responseViolations"]);
  const confidence = parseConfidence(obj["confidence"]);
  const notes = typeof obj["notes"] === "string" ? obj["notes"] : "";

  return { requestViolations, responseViolations, confidence, notes };
}

function parseViolationArray(raw: unknown): LlmViolation[] {
  if (!Array.isArray(raw)) return [];

  const violations: LlmViolation[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;

    const v = item as Record<string, unknown>;
    const violationType = parseViolationType(v["violationType"]);
    const location = parseLocation(v["location"]);
    if (!violationType || !location) continue;

    violations.push({
      field: String(v["field"] ?? "unknown"),
      expected: String(v["expected"] ?? "unknown"),
      received: String(v["received"] ?? "unknown"),
      violationType,
      location,
    });
  }
  return violations;
}

function parseViolationType(raw: unknown): LlmViolation["violationType"] | null {
  if (raw === "type_mismatch" || raw === "extra_field" || raw === "missing_field") return raw;
  return null;
}

function parseLocation(raw: unknown): LlmViolation["location"] | null {
  if (raw === "requestBody" || raw === "responseBody") return raw;
  return null;
}

function parseConfidence(raw: unknown): "high" | "medium" | "low" {
  if (raw === "high" || raw === "medium" || raw === "low") return raw;
  return "low";
}

function emptyResponse(confidence: "high" | "medium" | "low"): LlmViolationResponse {
  return { requestViolations: [], responseViolations: [], confidence, notes: "" };
}

export interface LlmFrontendDetectionResponse {
  hasFrontend: boolean;
  /** Framework/technology name, e.g. "React", "Next.js", "Vue", "Django", "HTML/CSS" */
  frontendType: string | null;
  /** Root directory of the frontend, e.g. "frontend", "templates", "src" */
  frontendRoot: string | null;
  confidence: "high" | "medium" | "low";
}

/**
 * Calls GPT-4.1-mini via GitHub Models to detect whether a repository contains a frontend,
 * and what kind (React, Next.js, Django templates, HTML/CSS, etc.).
 * Only file paths are sent — no file contents.
 */
export async function callLlmForFrontendDetection(
  repositoryId: string,
  filePaths: string[],
  githubToken: string,
): Promise<Result<LlmFrontendDetectionResponse, AppError>> {
  const client = new OpenAI({
    baseURL: GITHUB_MODELS_BASE_URL,
    apiKey: githubToken,
  });

  const sample = selectRepresentativePaths(filePaths, 400);
  const pathList = sample.join("\n");
  const contentSamples = await fetchFrontendContentSamples(repositoryId, sample, githubToken);
  const serializedSamples = contentSamples.length > 0
    ? contentSamples
        .map(
          (sampleItem) =>
            `FILE: ${sampleItem.path}\n${sampleItem.content}`,
        )
        .join("\n\n---\n\n")
    : "No representative file contents could be fetched.";

  const prompt = `You are analyzing a GitHub repository's file tree to detect if it has a frontend (UI that users interact with directly in a browser or native app).

File paths in this repository:
${pathList}

Representative file excerpts:
${serializedSamples}

Determine:
1. Does this repo contain a frontend? Consider any evidence: HTML files, CSS/SCSS assets, templates, UI markup, JavaScript/TypeScript that manipulates the DOM, framework config files, entry files, public/static/assets folders, bundler files, and any other language that serves a user-facing interface.
2. What frontend framework/technology is it? Be specific: "React", "Next.js", "Vue", "Angular", "Svelte", "HTML/CSS", "Django", "Flask", "Ruby on Rails", "PHP", "WordPress", "Jekyll", "Hugo", etc.
3. What root directory contains the frontend code? Could be "frontend", "client", "web", "ui", "templates", "src", "public", "views", "pages", etc.
4. Your confidence level.

Respond with JSON only:
{
  "hasFrontend": boolean,
  "frontendType": string or null,
  "frontendRoot": string or null,
  "confidence": "high" | "medium" | "low"
}`;

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: "You are a repository structure analyzer. Detect frontend presence and framework type from file paths. Always respond with valid JSON only.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 300,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return err(new AppError("UNKNOWN_ERROR", `LLM returned invalid JSON: ${raw.slice(0, 200)}`));
    }

    return ok(parseFrontendDetectionResponse(parsed));
  } catch (error) {
    return err(AppError.fromUnknown("UNKNOWN_ERROR", error));
  }
}

export interface AgenticDetectedEndpoint {
  path: string;
  method: HttpMethod;
  source: "client" | "server";
  callCount?: number;
  requestBodySchema?: ExtractedSchema;
  responseBodySchema?: ExtractedSchema;
  confidence?: "high" | "medium" | "low";
  evidence?: string[];
}

export interface AgenticEndpointScanResponse {
  endpoints: AgenticDetectedEndpoint[];
  notes: string[];
}

type AgentAction =
  | {
      action: "list_files";
      prefix?: string;
      reason?: string;
    }
  | {
      action: "read_file";
      path?: string;
      reason?: string;
    }
  | {
      action: "search_files";
      query?: string;
      reason?: string;
    }
  | {
      action: "final";
      endpoints?: unknown;
      notes?: unknown;
    };

/**
 * Runs a bounded agentic scan over repository files.
 *
 * The model does not receive every source file up front. It gets file-access
 * tools, explores framework/config clues, follows imports, and finally returns
 * a structured endpoint map.
 */
export async function callLlmForAgenticEndpointScan(
  repositoryId: string,
  files: RepositoryFile[],
  githubToken: string,
): Promise<Result<AgenticEndpointScanResponse, AppError>> {
  const client = new OpenAI({
    baseURL: GITHUB_MODELS_BASE_URL,
    apiKey: githubToken,
  });

  const tools = makeRepositoryTools(files);
  const initialTree = tools.listFiles("", 260);
  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    {
      role: "system",
      content:
        "You are an agentic code analysis worker for APISentinel. Your job is to exhaustively find ALL app-owned frontend HTTP API calls and backend route declarations in the repository. Use the tools to explore files, follow imports, and find every HTTP call. Understand these stacks: React/Next/Vue/Angular/Svelte clients; Express/Nest/Fastify/Hono backends; Python FastAPI/Flask/Django backends. Do not include static assets, third-party external service URLs (googleapis.com, auth0.com, stripe.com, etc.), or CDN URLs. Normalize dynamic path segments as {param}. Respond with valid JSON only.",
    },
    {
      role: "user",
      content: `Repository id: ${repositoryId}

Available tool actions:
{"action":"list_files","prefix":"optional/path/prefix","reason":"why"}
{"action":"read_file","path":"exact/path/from/tree","reason":"why"}
{"action":"search_files","query":"text or regex-like keyword","reason":"why"}
{"action":"final","endpoints":[{"path":"/api/users/{param}","method":"GET","source":"client","callCount":1,"requestBodySchema":{"type":"object","properties":{"name":{"type":"string"}}},"responseBodySchema":{"type":"object","properties":{"id":{"type":"string"}}},"confidence":"high","evidence":["src/api.ts"]}],"notes":["short note"]}

IMPORTANT — frontend HTTP call patterns to detect (source: "client"):
1. fetch('/api/path', ...) or fetch(\`\${BASE_URL}/path\`) or fetch(\`\${import.meta.env.VITE_API_URL}/path\`) or fetch('http://localhost:3000/path')
2. axios.get/post/put/patch/delete('/path') or apiClient.get('/path') or http.post('/path')
3. axios({ url: '/path', method: 'POST', data: {...} }) or axios.create({ baseURL }) instances
4. useSWR('/path', fetcher) or useSWRInfinite((i) => \`/path/\${i}\`, ...)
5. useQuery(['/path'], ...) or useQuery({ queryFn: () => fetch('/path') }) — React Query / Tanstack Query
6. builder.query({ query: () => '/path' }) or builder.mutation({ query: (arg) => ({ url: '/path', method: 'POST' }) }) — RTK Query
7. $fetch('/path') or $api('/path') — Nuxt / custom wrappers
8. Template literals: fetch(\`/api/users/\${id}\`) → path /api/users/{param}
9. Environment base URLs: if BASE = import.meta.env.VITE_API_URL or process.env.API_URL, then fetch(\`\${BASE}/users\`) → path /users (strip the base)

When you see an axios.create or similar with a baseURL, find all calls on that instance and prepend the base path to each route.

IMPORTANT — backend route patterns to detect (source: "server"):
Express: router.get('/path', ...) or app.post('/path', ...)
NestJS: @Get('/path') @Post('/path') in @Controller('prefix') classes
FastAPI: @app.get('/path') @router.post('/path')
Flask: @app.route('/path', methods=['GET','POST'])
Django: path('users/', view) or re_path(r'^users/\$', view)

Strategy: search for "fetch(", "axios", "useSWR", "useQuery", "createApi", ".get(", ".post(" to find client files. Read those files fully. Also search for "router.", "@Get", "@Post", "app.get", "app.post", "@app.route" to find backend route files.

Start from this prioritized tree sample:
${initialTree}`,
    },
  ];

  try {
    for (let step = 0; step < AGENT_MAX_STEPS; step++) {
      const action = await requestAgentAction(client, messages);

      if (action.action === "final") {
        return ok(parseAgenticEndpointScanResponse(action));
      }

      const toolResult = executeAgentTool(action, tools);
      messages.push({
        role: "assistant",
        content: JSON.stringify(action),
      });
      messages.push({
        role: "user",
        content: `TOOL_RESULT:\n${toolResult}`,
      });
    }

    messages.push({
      role: "user",
      content:
        'Stop using tools. Return your best final JSON now: {"action":"final","endpoints":[...],"notes":[...]}',
    });

    const finalAction = await requestAgentAction(client, messages);
    return ok(parseAgenticEndpointScanResponse(finalAction));
  } catch (error) {
    return err(AppError.fromUnknown("UNKNOWN_ERROR", error));
  }
}

async function requestAgentAction(
  client: OpenAI,
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>,
): Promise<AgentAction> {
  let raw: string;
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages,
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 1800,
    });
    raw = completion.choices[0]?.message?.content ?? "{}";
  } catch (apiError: unknown) {
    // Azure OpenAI content filter returns HTTP 400 with a specific message.
    // Treat it as a graceful end-of-loop rather than a hard failure so we
    // still return whatever endpoints were already collected.
    const isContentFilter =
      isApiError(apiError) &&
      (apiError.status === 400 ||
        String((apiError as { message?: unknown }).message ?? "").includes(
          "content management policy",
        ));
    return {
      action: "final",
      endpoints: [],
      notes: [
        isContentFilter
          ? "Azure content filter blocked a request — returning partial results from earlier steps."
          : `LLM call failed: ${String((apiError as { message?: unknown }).message ?? apiError)}`,
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      action: "final",
      endpoints: [],
      notes: [`Agent returned invalid JSON: ${raw.slice(0, 160)}`],
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { action: "final", endpoints: [], notes: [] };
  }

  const action = (parsed as Record<string, unknown>)["action"];
  if (
    action === "list_files" ||
    action === "read_file" ||
    action === "search_files" ||
    action === "final"
  ) {
    return parsed as AgentAction;
  }

  return { action: "final", endpoints: [], notes: ["Agent stopped without a recognized action."] };
}

function isApiError(error: unknown): error is { status?: number; message?: unknown } {
  return typeof error === "object" && error !== null && "status" in error;
}

function makeRepositoryTools(files: RepositoryFile[]) {
  const byPath = new Map(
    files.map((file) => [normalizeToolPath(file.path), file] as const),
  );

  return {
    listFiles(prefix: string, limit = 220): string {
      const normalizedPrefix = normalizeToolPath(prefix);
      return files
        .map((file) => file.path)
        .filter((path) =>
          normalizedPrefix ? normalizeToolPath(path).startsWith(normalizedPrefix) : true,
        )
        .sort((a, b) => scoreAgentPath(b) - scoreAgentPath(a) || a.localeCompare(b))
        .slice(0, limit)
        .join("\n");
    },
    readFile(path: string): string {
      const file = byPath.get(normalizeToolPath(path));
      if (!file) {
        return `File not found: ${path}`;
      }

      const content = file.content.slice(0, MAX_TOOL_CONTENT_CHARS);
      const suffix =
        file.content.length > MAX_TOOL_CONTENT_CHARS
          ? "\n\n[truncated: file is larger than agent read limit]"
          : "";
      return `FILE: ${file.path}\nROLE: ${file.role}\n${content}${suffix}`;
    },
    searchFiles(query: string): string {
      const needle = query.trim().toLowerCase();
      if (needle.length < 2) {
        return "Search query is too short.";
      }

      const results: string[] = [];
      for (const file of files) {
        const lowerPath = file.path.toLowerCase();
        const lowerContent = file.content.toLowerCase();
        if (!lowerPath.includes(needle) && !lowerContent.includes(needle)) {
          continue;
        }

        const snippets = extractSearchSnippets(file.content, needle, 3);
        results.push(
          [`FILE: ${file.path}`, ...snippets.map((line) => `  ${line}`)].join(
            "\n",
          ),
        );

        if (results.length >= 24) break;
      }

      return results.length > 0 ? results.join("\n---\n") : "No matches.";
    },
  };
}

function executeAgentTool(
  action: Exclude<AgentAction, { action: "final" }>,
  tools: ReturnType<typeof makeRepositoryTools>,
): string {
  if (action.action === "list_files") {
    return tools.listFiles(String(action.prefix ?? ""));
  }
  if (action.action === "read_file") {
    return tools.readFile(String(action.path ?? ""));
  }
  return tools.searchFiles(String(action.query ?? ""));
}

function extractSearchSnippets(
  content: string,
  needle: string,
  limit: number,
): string[] {
  const lines = content.split(/\r?\n/);
  const snippets: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line.toLowerCase().includes(needle)) continue;
    snippets.push(`${i + 1}: ${line.trim().slice(0, 260)}`);
    if (snippets.length >= limit) break;
  }
  return snippets.length > 0 ? snippets : ["path match"];
}

function parseAgenticEndpointScanResponse(
  raw: AgentAction,
): AgenticEndpointScanResponse {
  const endpointsRaw =
    raw.action === "final" && Array.isArray(raw.endpoints)
      ? raw.endpoints
      : [];

  const endpoints: AgenticDetectedEndpoint[] = [];
  for (const item of endpointsRaw) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const method = parseHttpMethod(obj["method"]);
    const source = parseEndpointSource(obj["source"]);
    const path = normalizeAgentPath(String(obj["path"] ?? ""));
    if (!method || !source || !path) continue;

    endpoints.push({
      path,
      method,
      source,
      callCount: parsePositiveInteger(obj["callCount"]) ?? 1,
      requestBodySchema: parseExtractedSchema(obj["requestBodySchema"]),
      responseBodySchema: parseExtractedSchema(obj["responseBodySchema"]),
      confidence: parseConfidence(obj["confidence"]),
      evidence: Array.isArray(obj["evidence"])
        ? obj["evidence"].filter((value): value is string => typeof value === "string")
        : undefined,
    });
  }

  const notes =
    raw.action === "final" && Array.isArray(raw.notes)
      ? raw.notes.filter((value): value is string => typeof value === "string")
      : [];

  return { endpoints, notes };
}

function parseHttpMethod(raw: unknown): HttpMethod | null {
  const value = String(raw ?? "").toUpperCase();
  if (
    value === "GET" ||
    value === "POST" ||
    value === "PUT" ||
    value === "PATCH" ||
    value === "DELETE"
  ) {
    return value;
  }
  return null;
}

function parseEndpointSource(raw: unknown): "client" | "server" | null {
  if (raw === "client" || raw === "server") return raw;
  return null;
}

function parsePositiveInteger(raw: unknown): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function parseExtractedSchema(raw: unknown): ExtractedSchema | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
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
    return undefined;
  }

  const schema: ExtractedSchema = { type };
  if (type === "object" && typeof obj["properties"] === "object" && obj["properties"] !== null) {
    const properties: Record<string, ExtractedSchema> = {};
    for (const [key, value] of Object.entries(obj["properties"] as Record<string, unknown>)) {
      const child = parseExtractedSchema(value);
      if (child) properties[key] = child;
    }
    if (Object.keys(properties).length > 0) schema.properties = properties;
  }
  if (Array.isArray(obj["required"])) {
    schema.required = obj["required"].filter(
      (value): value is string => typeof value === "string",
    );
  }
  if (type === "array") {
    schema.items = parseExtractedSchema(obj["items"]) ?? { type: "unknown" };
  }
  schema.confidence = "high";
  return schema;
}

function normalizeAgentPath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let raw = trimmed;

  // Extract path from full URLs (e.g. http://localhost:3000/api/users)
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      raw = parsed.pathname || "/";
    } catch {
      const match = /^https?:\/\/[^/]+(\/[^?#]*)/i.exec(raw);
      raw = match?.[1] ?? "/";
    }
    if (!raw || raw === "/") return null;
  }

  const withoutQuery = raw.split(/[?#]/)[0] ?? "";
  const withSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  const normalized =
    withSlash
      .replace(/:[^/]+/g, "{param}")
      .replace(/\{[^/]+\}/g, "{param}")
      .replace(/\/+/g, "/")
      .replace(/\/$/, "") || "/";
  if (looksLikeStaticAssetPath(normalized)) return null;
  return normalized.toLowerCase();
}

function looksLikeStaticAssetPath(path: string): boolean {
  return /\.(js|mjs|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|map)$/i.test(path);
}

function normalizeToolPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

function scoreAgentPath(path: string): number {
  const lower = path.toLowerCase();
  let score = 0;
  if (lower.endsWith("package.json")) score += 40;
  if (lower.includes("route")) score += 28;
  if (lower.includes("controller")) score += 26;
  if (lower.includes("router")) score += 24;
  if (lower.includes("api")) score += 22;
  if (lower.includes("endpoint")) score += 20;
  if (lower.includes("client")) score += 18;
  if (lower.includes("service")) score += 16;
  if (lower.includes("hook")) score += 12;
  if (lower.includes("pages/") || lower.includes("app/")) score += 10;
  if (lower.includes("views.py") || lower.includes("urls.py")) score += 18;
  if (lower.endsWith(".tsx") || lower.endsWith(".jsx")) score += 8;
  if (lower.endsWith(".ts") || lower.endsWith(".js")) score += 6;
  if (lower.endsWith(".py")) score += 7;
  return score;
}

function selectRepresentativePaths(paths: string[], limit: number): string[] {
  // Always include config and key indicator files first
  const priority: string[] = [];
  const rest: string[] = [];

  const configNames = new Set([
    "package.json", "requirements.txt", "gemfile", "composer.json", "cargo.toml",
    "pipfile", "pyproject.toml", "build.gradle", "pom.xml", "go.mod",
    "next.config.js", "next.config.ts", "vite.config.js", "vite.config.ts",
    "angular.json", "svelte.config.js", "nuxt.config.js", "webpack.config.js",
    "manage.py", "app.py", "settings.py", "index.html", "index.php",
    "tailwind.config.js", "tailwind.config.ts", "postcss.config.js", "postcss.config.cjs",
  ]);

  const frontendExtensions = new Set([
    ".html", ".css", ".scss", ".sass", ".less",
    ".vue", ".svelte", ".astro", ".erb", ".php", ".jinja", ".jinja2", ".twig",
    ".jsx", ".tsx",
  ]);
  const frontendDirs = ["/frontend/", "/client/", "/web/", "/ui/", "/public/", "/static/", "/assets/", "/templates/", "/views/"];

  for (const p of paths) {
    const lower = p.toLowerCase();
    const fileName = lower.split("/").pop() ?? "";
    const ext = "." + (fileName.split(".").pop() ?? "");

    if (
      configNames.has(fileName) ||
      frontendExtensions.has(ext) ||
      frontendDirs.some((dir) => lower.includes(dir) || lower.startsWith(dir.slice(1)))
    ) {
      priority.push(p);
    } else {
      rest.push(p);
    }
  }

  const selected = priority.slice(0, Math.min(priority.length, limit));
  const remaining = limit - selected.length;
  if (remaining > 0) {
    selected.push(...rest.slice(0, remaining));
  }
  return selected;
}

async function fetchFrontendContentSamples(
  repositoryId: string,
  candidatePaths: string[],
  githubToken: string,
): Promise<Array<{ path: string; content: string }>> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "APISentinel",
    Authorization: `Bearer ${githubToken}`,
  };

  try {
    const repoRes = await fetch(`https://api.github.com/repositories/${repositoryId}`, { headers });
    if (!repoRes.ok) {
      return [];
    }

    const repoData = (await repoRes.json()) as { full_name?: string; default_branch?: string };
    const fullName = repoData.full_name;
    const defaultBranch = repoData.default_branch;
    if (!fullName || !defaultBranch) {
      return [];
    }

    const selected = [...candidatePaths]
      .sort((a, b) => scoreFrontendPath(b) - scoreFrontendPath(a))
      .slice(0, 16);

    const samples: Array<{ path: string; content: string }> = [];
    for (const path of selected) {
      const response = await fetch(
        `https://raw.githubusercontent.com/${fullName}/${defaultBranch}/${path}`,
        { headers },
      );
      if (!response.ok) continue;

      const content = (await response.text()).trim();
      if (!content) continue;

      samples.push({
        path,
        content: truncateSample(content),
      });
    }

    return samples;
  } catch {
    return [];
  }
}

function scoreFrontendPath(path: string): number {
  const lower = path.toLowerCase();
  let score = 0;

  if (lower.endsWith("package.json")) score += 14;
  if (lower.endsWith("index.html")) score += 13;
  if (lower.endsWith(".html")) score += 12;
  if (lower.endsWith(".css") || lower.endsWith(".scss") || lower.endsWith(".sass") || lower.endsWith(".less")) score += 11;
  if (lower.endsWith(".tsx") || lower.endsWith(".jsx")) score += 10;
  if (lower.endsWith(".vue") || lower.endsWith(".svelte") || lower.endsWith(".astro")) score += 10;
  if (lower.includes("vite.config.") || lower.includes("webpack.config.") || lower.includes("tailwind.config.") || lower.includes("postcss.config.")) score += 9;
  if (lower.includes("/frontend/") || lower.startsWith("frontend/")) score += 8;
  if (lower.includes("/client/") || lower.startsWith("client/")) score += 8;
  if (lower.includes("/web/") || lower.startsWith("web/")) score += 8;
  if (lower.includes("/ui/") || lower.startsWith("ui/")) score += 7;
  if (lower.includes("/templates/") || lower.includes("/views/")) score += 7;
  if (lower.includes("/public/") || lower.includes("/static/") || lower.includes("/assets/")) score += 6;
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) score += 4;

  return score;
}

function truncateSample(content: string): string {
  return content.slice(0, 3000);
}

function parseFrontendDetectionResponse(raw: unknown): LlmFrontendDetectionResponse {
  if (typeof raw !== "object" || raw === null) {
    return { hasFrontend: false, frontendType: null, frontendRoot: null, confidence: "low" };
  }
  const obj = raw as Record<string, unknown>;
  return {
    hasFrontend: obj["hasFrontend"] === true,
    frontendType: typeof obj["frontendType"] === "string" && obj["frontendType"] !== "null" ? obj["frontendType"] : null,
    frontendRoot: typeof obj["frontendRoot"] === "string" && obj["frontendRoot"] !== "null" ? obj["frontendRoot"] : null,
    confidence: parseConfidence(obj["confidence"]),
  };
}
