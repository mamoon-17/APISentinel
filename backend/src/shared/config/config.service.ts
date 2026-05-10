import { ok, err, Result } from "neverthrow";
import dotenv from "dotenv";

dotenv.config();

class ConfigService {
  private database_uri?: string;
  private port?: number;
  private githubClientId?: string;
  private githubClientSecret?: string;
  private githubCallbackUrl?: string;
  private googleClientId?: string;
  private googleClientSecret?: string;
  private googleCallbackUrl?: string;
  private frontendBaseUrl?: string;
  private sessionSecret?: string;
  private useFixtureSnapshots: boolean;
  private llmEnabled: boolean;
  private githubModelsToken?: string;
  private supabaseUrl?: string;
  private supabaseServiceRoleKey?: string;
  private initialized: boolean;

  constructor() {
    this.database_uri = process.env.DATABASE_URI;
    this.port = process.env.PORT ? parseInt(process.env.PORT) : undefined;
    this.githubClientId = process.env.GITHUB_CLIENT_ID;
    this.githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
    this.githubCallbackUrl = process.env.GITHUB_CALLBACK_URL;
    this.googleClientId = process.env.GOOGLE_CLIENT_ID;
    this.googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    this.googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL;
    this.frontendBaseUrl = process.env.FRONTEND_BASE_URL;
    this.sessionSecret = process.env.SESSION_SECRET;
    this.useFixtureSnapshots =
      process.env.USE_FIXTURE_SNAPSHOTS?.trim().toLowerCase() === "true";
    this.llmEnabled =
      process.env.LLM_ENABLED?.trim().toLowerCase() === "true";
    this.githubModelsToken = process.env.GITHUB_MODELS_TOKEN;
    this.supabaseUrl = process.env.SUPABASE_URL;
    this.supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.initialized = false;
  }

  init(): Result<string, Error[]> {
    const missing: Error[] = [];

    if (!this.database_uri) {
      missing.push(
        new Error("DATABASE_URI not found in environment variables"),
      );
    }

    if (!this.port) {
      missing.push(new Error("PORT not found in environment variables"));
    }

    if (!this.githubClientId) {
      missing.push(
        new Error("GITHUB_CLIENT_ID not found in environment variables"),
      );
    }

    if (!this.githubClientSecret) {
      missing.push(
        new Error("GITHUB_CLIENT_SECRET not found in environment variables"),
      );
    }

    if (!this.githubCallbackUrl) {
      missing.push(
        new Error("GITHUB_CALLBACK_URL not found in environment variables"),
      );
    }

    if (!this.frontendBaseUrl) {
      missing.push(
        new Error("FRONTEND_BASE_URL not found in environment variables"),
      );
    }

    if (!this.sessionSecret) {
      missing.push(
        new Error("SESSION_SECRET not found in environment variables"),
      );
    }

    if (missing.length > 0) return err(missing);

    this.initialized = true;
    return ok("Environment variables loaded successfully");
  }

  private ensureDefined<T>(value: T | undefined, keyName: string): T {
    if (value === undefined) {
      throw new Error(`${keyName} is not configured`);
    }

    return value;
  }

  getDatabaseUri() {
    return this.ensureDefined(this.database_uri, "DATABASE_URI");
  }

  getPort() {
    return this.ensureDefined(this.port, "PORT");
  }

  getGithubClientId() {
    return this.ensureDefined(this.githubClientId, "GITHUB_CLIENT_ID");
  }

  getGithubClientSecret() {
    return this.ensureDefined(this.githubClientSecret, "GITHUB_CLIENT_SECRET");
  }

  getGithubCallbackUrl() {
    return this.ensureDefined(this.githubCallbackUrl, "GITHUB_CALLBACK_URL");
  }

  getGoogleClientId() {
    return this.ensureDefined(this.googleClientId, "GOOGLE_CLIENT_ID");
  }

  getGoogleClientSecret() {
    return this.ensureDefined(this.googleClientSecret, "GOOGLE_CLIENT_SECRET");
  }

  getGoogleCallbackUrl() {
    return this.ensureDefined(this.googleCallbackUrl, "GOOGLE_CALLBACK_URL");
  }

  isGoogleOAuthConfigured() {
    return Boolean(
      this.googleClientId && this.googleClientSecret && this.googleCallbackUrl,
    );
  }

  getFrontendBaseUrl() {
    return this.ensureDefined(this.frontendBaseUrl, "FRONTEND_BASE_URL");
  }

  getSessionSecret() {
    return this.ensureDefined(this.sessionSecret, "SESSION_SECRET");
  }

  shouldUseFixtureSnapshots() {
    return this.useFixtureSnapshots;
  }

  isLlmEnabled() {
    return this.llmEnabled;
  }

  getGithubModelsToken() {
    return this.githubModelsToken;
  }

  getSupabaseUrl() {
    return this.supabaseUrl;
  }

  getSupabaseServiceRoleKey() {
    return this.supabaseServiceRoleKey;
  }

  isInitialized() {
    return this.initialized;
  }
}

export const configService = new ConfigService();
