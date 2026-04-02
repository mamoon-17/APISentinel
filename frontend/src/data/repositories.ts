import {
  LinkedRepository,
  RepositoryHealthData,
} from "@/types/api";

export const mockRepositories: LinkedRepository[] = [
  {
    id: "repo-1",
    name: "user-service",
    url: "https://github.com/acme-corp/user-service",
    provider: "github",
    linkedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7),
    linkedSpecId: "1",
    lastHealthCheck: new Date(Date.now() - 1000 * 60 * 30),
    healthStatus: "healthy",
  },
  {
    id: "repo-2",
    name: "order-management",
    url: "https://github.com/acme-corp/order-management",
    provider: "github",
    linkedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14),
    linkedSpecId: "2",
    lastHealthCheck: new Date(Date.now() - 1000 * 60 * 60 * 2),
    healthStatus: "issues",
  },
  {
    id: "repo-3",
    name: "payment-gateway",
    url: "https://gitlab.com/acme-corp/payment-gateway",
    provider: "gitlab",
    linkedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
    linkedSpecId: undefined,
    lastHealthCheck: undefined,
    healthStatus: "unchecked",
  },
  {
    id: "repo-4",
    name: "notification-service",
    url: "https://github.com/acme-corp/notification-service",
    provider: "github",
    linkedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2),
    linkedSpecId: undefined,
    lastHealthCheck: undefined,
    healthStatus: "unchecked",
  },
  {
    id: "repo-5",
    name: "analytics-dashboard",
    url: "https://bitbucket.org/acme-corp/analytics-dashboard",
    provider: "bitbucket",
    linkedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5),
    linkedSpecId: "1",
    lastHealthCheck: new Date(Date.now() - 1000 * 60 * 60),
    healthStatus: "healthy",
  },
];

// Kept for future dashboard panels; not required by the Index route.
export const mockHealthData: Record<string, RepositoryHealthData> = {
  "repo-1": {
    repositoryId: "repo-1",
    lastCheckedAt: new Date(Date.now() - 1000 * 60 * 30),
    totalApiCalls: 15420,
    endpointUsage: [
      {
        endpoint: "/users",
        method: "GET",
        callCount: 3420,
        lastCalledAt: new Date(Date.now() - 1000 * 60 * 5),
        inSpec: true,
      },
      {
        endpoint: "/users/{id}",
        method: "GET",
        callCount: 8934,
        lastCalledAt: new Date(Date.now() - 1000 * 60 * 2),
        inSpec: true,
      },
      {
        endpoint: "/users",
        method: "POST",
        callCount: 1245,
        lastCalledAt: new Date(Date.now() - 1000 * 60 * 15),
        inSpec: true,
      },
      {
        endpoint: "/users/{id}/profile",
        method: "GET",
        callCount: 1567,
        lastCalledAt: new Date(Date.now() - 1000 * 60 * 8),
        inSpec: true,
      },
      {
        endpoint: "/auth/login",
        method: "POST",
        callCount: 254,
        lastCalledAt: new Date(Date.now() - 1000 * 60 * 3),
        inSpec: true,
      },
    ],
    inconsistencies: [],
  },
  "repo-2": {
    repositoryId: "repo-2",
    lastCheckedAt: new Date(Date.now() - 1000 * 60 * 60 * 2),
    totalApiCalls: 8756,
    endpointUsage: [
      {
        endpoint: "/orders",
        method: "GET",
        callCount: 2345,
        lastCalledAt: new Date(Date.now() - 1000 * 60 * 10),
        inSpec: true,
      },
      {
        endpoint: "/orders",
        method: "POST",
        callCount: 1234,
        lastCalledAt: new Date(Date.now() - 1000 * 60 * 20),
        inSpec: true,
      },
      {
        endpoint: "/orders/{id}",
        method: "GET",
        callCount: 3456,
        lastCalledAt: new Date(Date.now() - 1000 * 60 * 5),
        inSpec: true,
      },
      {
        endpoint: "/orders/{id}/status",
        method: "PUT",
        callCount: 987,
        lastCalledAt: new Date(Date.now() - 1000 * 60 * 30),
        inSpec: false,
      },
      {
        endpoint: "/orders/bulk-update",
        method: "POST",
        callCount: 456,
        lastCalledAt: new Date(Date.now() - 1000 * 60 * 45),
        inSpec: false,
      },
      {
        endpoint: "/payments",
        method: "POST",
        callCount: 278,
        lastCalledAt: new Date(Date.now() - 1000 * 60 * 12),
        inSpec: true,
      },
    ],
    inconsistencies: [
      {
        id: "inc-1",
        type: "extra_endpoint",
        endpoint: "/orders/{id}/status",
        method: "PUT",
        message:
          "Endpoint is used in codebase but not defined in OpenAPI spec",
        severity: "error",
      },
      {
        id: "inc-2",
        type: "extra_endpoint",
        endpoint: "/orders/bulk-update",
        method: "POST",
        message:
          "Endpoint is used in codebase but not defined in OpenAPI spec",
        severity: "error",
      },
      {
        id: "inc-3",
        type: "missing_endpoint",
        endpoint: "/orders/{id}/refund",
        method: "POST",
        message:
          "Endpoint defined in spec but never called from this repository",
        severity: "warning",
      },
    ],
  },
  "repo-5": {
    repositoryId: "repo-5",
    lastCheckedAt: new Date(Date.now() - 1000 * 60 * 60),
    totalApiCalls: 4532,
    endpointUsage: [
      {
        endpoint: "/users",
        method: "GET",
        callCount: 1890,
        lastCalledAt: new Date(Date.now() - 1000 * 60 * 15),
        inSpec: true,
      },
      {
        endpoint: "/users/{id}",
        method: "GET",
        callCount: 2342,
        lastCalledAt: new Date(Date.now() - 1000 * 60 * 8),
        inSpec: true,
      },
      {
        endpoint: "/users/{id}/activity",
        method: "GET",
        callCount: 300,
        lastCalledAt: new Date(Date.now() - 1000 * 60 * 25),
        inSpec: true,
      },
    ],
    inconsistencies: [],
  },
};

