export type ValidationStatus = "valid" | "warning" | "error";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestLog {
  id: string;
  timestamp: Date;
  method: HttpMethod;
  endpoint: string;
  status: ValidationStatus;
  responseCode: number;
  latency: number;
  violations: Violation[];
}

export interface Violation {
  id: string;
  type: "extra_field" | "missing_field" | "type_mismatch" | "format_error";
  field: string;
  expected?: string;
  received?: string;
  severity: "warning" | "error";
  message: string;
}

export interface ApiSpec {
  id: string;
  name: string;
  version: string;
  uploadedAt: Date;
  endpoints: number;
  status: "active" | "inactive";
}

export interface BackendSpecSummary {
  id: string;
  name: string;
  activeVersionId: string | null;
  activeVersion: string | null;
  status: "active" | "inactive";
  totalVersions: number;
  totalEndpoints: number;
  updatedAt: string;
  sourceFileName?: string | null;
  sourceFilePath?: string | null;
}

export interface BackendSpecVersion {
  id: string;
  specId: string;
  specName: string;
  version: string;
  status: "active" | "inactive";
  uploadedAt: string;
  operationCount: number;
  linkedRepositoryCount: number;
  sourceFileName?: string | null;
  sourceFilePath?: string | null;
}

export interface DashboardStats {
  totalRequests: number;
  validRequests: number;
  violations: number;
  uptime: number;
}

/** A repository row from `GET /auth/repositories` (GitHub API, proxied by backend) */
export interface GithubRepo {
  id: string;
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  isPrivate: boolean;
  isFork: boolean;
  stars: number;
  updatedAt: string;
}

export interface LinkedRepository {
  id: string;
  name: string;
  url: string;
  provider: "github" | "gitlab" | "bitbucket";
  linkedAt: Date;
  linkedSpecId?: string;
  lastHealthCheck?: Date;
  healthStatus: "healthy" | "issues" | "unchecked";
}

export interface RepositoryHealthData {
  repositoryId: string;
  lastCheckedAt: Date;
  totalApiCalls: number;
  endpointUsage: EndpointUsage[];
  inconsistencies: SpecInconsistency[];
}

export interface EndpointUsage {
  endpoint: string;
  method: HttpMethod;
  callCount: number;
  lastCalledAt?: Date;
  inSpec: boolean;
  /**
   * Backend↔Spec mode only: whether a matching backend route was detected
   * for this spec endpoint.
   */
  presentInBackend?: boolean;
  /** In Frontend ↔ Backend mode: inferred from backend route handler */
  expectedRequestBodySchema?: unknown;
  /** In Frontend ↔ Backend mode: inferred from frontend call sites */
  receivedRequestBodySchema?: unknown;
  /** In Frontend ↔ Backend mode: backend response shape */
  expectedResponseBodySchema?: unknown;
  /** In Frontend ↔ Backend mode: shape frontend code appears to consume */
  receivedResponseBodySchema?: unknown;
}

export interface DiffLine {
  type: "match" | "error" | "warning" | "missing";
  line: string;
}

export type AnalysisConfidence =
  | "static:high"
  | "static:low"
  | "llm:resolved"
  | "llm:unresolved";

export interface SpecInconsistency {
  id: string;
  type:
    | "missing_endpoint"
    | "extra_endpoint"
    | "method_mismatch"
    | "schema_mismatch";
  endpoint: string;
  method?: HttpMethod;
  message: string;
  severity: "warning" | "error";
  schemaDiff?: {
    location: "requestBody" | "responseBody";
    expectedLines: DiffLine[];
    receivedLines: DiffLine[];
    errorCount: number;
    warningCount: number;
  };
  confidence?: AnalysisConfidence;
}

export type HealthCheckJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export type HealthCheckJobTrigger = "manual" | "auto-on-link" | "retry";

export interface HealthCheckResultPayload {
  repositoryId: string;
  specId: string;
  specName: string;
  checkedAt: string;
  totalApiCalls: number;
  endpointUsage: {
    endpoint: string;
    method: HttpMethod;
    callCount: number;
    lastCalledAt: string;
    inSpec: boolean;
  }[];
  inconsistencies: {
    id: string;
    type:
      | "missing_endpoint"
      | "extra_endpoint"
      | "method_mismatch"
      | "schema_mismatch";
    endpoint: string;
    method: HttpMethod;
    message: string;
    severity: "warning" | "error";
  }[];
  healthy: boolean;
}

export interface HealthCheckJobPayload {
  id: string;
  userId: string;
  repositoryId: string;
  repositoryName: string;
  repositoryFullName: string;
  specId: string;
  specName: string;
  trigger: HealthCheckJobTrigger;
  status: HealthCheckJobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  nextRetryAt?: string;
  errorMessage?: string;
  result?: HealthCheckResultPayload;
  retryOfJobId?: string;
}

export interface RepositorySpecLinkPayload {
  userId: string;
  repositoryId: string;
  repositoryName: string;
  repositoryFullName: string;
  specId: string;
  specName: string;
  linkedAt: string;
}

/** Response shape of GET /repositories/:id/inconsistencies */
export interface BackendRepositoryInconsistenciesView {
  repositoryId: string;
  specId: string;
  analyzedAt: string;
  totalApiCalls: number;
  endpointUsage: EndpointUsage[];
  inconsistencies: SpecInconsistency[];
}

export interface SpecViolationsView {
  specId: string;
  repositoryId: string;
  analyzedAt: string;
  totalViolations: number;
  violations: SpecInconsistency[];
}

export interface RepositoryAnalysisStatePayload {
  staticResult: BackendRepositoryInconsistenciesView | null;
  aiResult: BackendRepositoryInconsistenciesView | null;
}
