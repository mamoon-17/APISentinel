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
}

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
}
