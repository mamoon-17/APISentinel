import { ResultAsync } from "neverthrow";
import { AppError } from "../../../shared/errors/app-error";

/**
 * The inferred role of a file in the repository.
 * Used to prioritise what context the LLM receives for each endpoint.
 */
export type RepositoryFileRole =
  | "route"      // Express/Fastify/NestJS route handler
  | "model"      // Mongoose/Prisma/TypeORM model or entity
  | "type"       // TypeScript interface or type definitions
  | "service"    // Business logic / service layer
  | "schema"     // Zod / Joi / Yup validation schemas
  | "other";     // Everything else

export interface RepositoryFile {
  path: string;
  content: string;
  role: RepositoryFileRole;
}

export interface RepositoryCodeProvider {
  /**
   * Fetches all relevant source files from a repository.
   * This abstracts away GitHub API calls, git cloning, etc.
   */
  fetchFiles(
    repositoryId: string,
    githubAccessToken?: string,
  ): ResultAsync<RepositoryFile[], AppError>;
}
