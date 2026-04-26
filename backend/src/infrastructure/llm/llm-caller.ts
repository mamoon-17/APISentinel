import OpenAI from "openai";
import { ok, err, Result } from "neverthrow";
import { AppError } from "../../shared/errors/app-error";

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
