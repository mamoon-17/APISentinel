/** Must match the backend route (see server.ts + auth router). */
export const REPOSITORIES_API_PATH = "/auth/repositories";
export const REPOSITORY_BY_URL_API_PATH = "/auth/repositories/by-url";

/** Spec lifecycle endpoints (Workstream 3). */
export const SPECS_API_PATH = "/specs";
export const SPECS_UPLOAD_API_PATH = "/specs/upload";

/** Repository analysis endpoints (Workstream 4). */
export const REPOSITORIES_ANALYSIS_API_PATH = "/repositories";

/** LLM-powered schema violations endpoint. */
export const SPECS_LLM_VIOLATIONS_API_PATH = (specId: string, repositoryId: string) =>
  `/specs/${specId}/llm-violations?repositoryId=${repositoryId}`;

/** LLM-powered Frontend ↔ Backend verification endpoint. */
export const REPO_LLM_FRONTEND_BACKEND_API_PATH = (repositoryId: string) =>
  `/repositories/${repositoryId}/llm-frontend-backend-violations`;

/** Generate spec pair from a linked repository. */
export const SPECS_GENERATE_FROM_REPO_API_PATH = (repositoryId: string) =>
  `/specs/generate-from-repo?repositoryId=${repositoryId}`;

/** Spec-to-repo link management. */
export const REPO_SPEC_LINKS_API_PATH = (repositoryId: string) =>
  `/repositories/${repositoryId}/spec-links`;

export const REPO_SPEC_LINK_DELETE_API_PATH = (repositoryId: string, specId: string) =>
  `/repositories/${repositoryId}/spec-links/${specId}`;

/** Auto-detect spec in repo. */
export const REPO_DETECT_SPEC_API_PATH = (repositoryId: string) =>
  `/repositories/${repositoryId}/detect-spec`;

/** Detect whether repo contains a frontend. */
export const REPO_DETECT_FRONTEND_API_PATH = (repositoryId: string) =>
  `/repositories/${repositoryId}/detect-frontend`;

export const HEALTH_CHECKS_API_BASE_PATH = "/health-checks";
