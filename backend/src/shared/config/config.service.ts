import { ok, err, Result } from "neverthrow";
import dotenv from "dotenv";

dotenv.config();

class ConfigService {
  private database_uri?: string;
  private port?: number;
  private initialized: boolean;

  constructor() {
    this.database_uri = process.env.DATABASE_URI;
    this.port = process.env.PORT ? parseInt(process.env.PORT) : undefined;
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

    if (missing.length > 0) return err(missing);

    this.initialized = true;
    return ok("Environment variables loaded successfully");
  }

  getDatabaseUri() {
    return this.database_uri;
  }

  getPort() {
    return this.port;
  }

  isInitialized() {
    return this.initialized;
  }
}

export const configService = new ConfigService();
