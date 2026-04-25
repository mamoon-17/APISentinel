/** Must match the backend route (see server.ts + auth router). */
export const REPOSITORIES_API_PATH = "/auth/repositories";

/** Spec lifecycle endpoints (Workstream 3). */
export const SPECS_API_PATH = "/specs";
export const SPECS_UPLOAD_API_PATH = "/specs/upload";

/** Repository analysis endpoints (Workstream 4). */
export const REPOSITORIES_ANALYSIS_API_PATH = "/repositories";

/** LLM-powered schema violations endpoint. */
export const SPECS_LLM_VIOLATIONS_API_PATH = (specId: string, repositoryId: string) =>
  `/specs/${specId}/llm-violations?repositoryId=${repositoryId}`;

/** Generate spec pair from a linked repository. */
export const SPECS_GENERATE_FROM_REPO_API_PATH = (repositoryId: string) =>
  `/specs/generate-from-repo?repositoryId=${repositoryId}`;

