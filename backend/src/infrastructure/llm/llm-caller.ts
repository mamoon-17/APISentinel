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
