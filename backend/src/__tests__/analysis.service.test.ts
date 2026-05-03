import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, err, errAsync, okAsync } from "neverthrow";
import { AnalysisService, normalizePath } from "../application/analysis/analysis.service";
import { AppError } from "../shared/errors/app-error";
import { SpecVersion } from "../domain/spec/spec.entity";
import type { RepositorySnapshotProvider, SnapshotEndpointUsage } from "../application/analysis/contracts/repository-snapshot.provider";
import type { SpecVersionRepository } from "../domain/spec";
import type { LlmViolationProvider } from "../application/analysis/contracts/llm-violation-provider";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSpecVersion(overrides: Partial<Parameters<typeof SpecVersion.createNew>[0]> = {}) {
  return SpecVersion.createNew({
    specId: "spec-1",
    specName: "Test Spec",
    version: "1.0.0",
    sourceHash: "hash-abc",
    sourceFormat: "yaml",
    rawDocument: {},
    operations: [
      {
        method: "GET",
        path: "/users",
        normalizedPath: "/users",
        operationId: "listUsers",
        summary: "List users",
        requestBodySchema: undefined,
        responseBodySchema: { type: "array", items: { type: "object" } },
      },
      {
        method: "POST",
        path: "/users",
        normalizedPath: "/users",
        operationId: "createUser",
        summary: "Create user",
        requestBodySchema: {
          type: "object",
          properties: { name: { type: "string" }, email: { type: "string" } },
          required: ["name", "email"],
        },
        responseBodySchema: { type: "object" },
      },
    ],
    ...overrides,
  });
}

function makeSnapshot(endpoints: Partial<SnapshotEndpointUsage>[] = []) {
  return {
    repositoryId: "repo-1",
    capturedAt: new Date().toISOString(),
    endpoints: endpoints.map((e) => ({
      path: "/users",
      method: "GET" as const,
      callCount: 10,
      source: "server" as const,
      ...e,
    })),
  };
}

// ─── Mocks ───────────────────────────────────────────────────────────────────

function makeMocks() {
  const mockSpecRepo: SpecVersionRepository = {
    findBySpecId: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    findById: vi.fn(),
  } as any;

  const mockSnapshotProvider: RepositorySnapshotProvider = {
    getSnapshot: vi.fn(),
  };

  const mockLlmProvider: LlmViolationProvider = {
    analyseEndpoint: vi.fn(),
  };

  return { mockSpecRepo, mockSnapshotProvider, mockLlmProvider };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("AnalysisService", () => {

  // ══════════════════════════════════════════════════════════════════════════
  // normalizePath utility
  // ══════════════════════════════════════════════════════════════════════════

  describe("normalizePath", () => {
    it("prepends slash when missing", () => {
      expect(normalizePath("users")).toBe("/users");
    });

    it("normalises Express :param to {param}", () => {
      expect(normalizePath("/users/:id")).toBe("/users/{param}");
    });

    it("normalises OpenAPI {param} style", () => {
      expect(normalizePath("/users/{userId}/posts/{postId}")).toBe("/users/{param}/posts/{param}");
    });

    it("collapses double slashes", () => {
      expect(normalizePath("//users//list")).toBe("/users/list");
    });

    it("strips trailing slash", () => {
      expect(normalizePath("/users/")).toBe("/users");
    });

    it("lowercases the path", () => {
      expect(normalizePath("/Users/List")).toBe("/users/list");
    });

    it("returns '/' for empty string", () => {
      expect(normalizePath("")).toBe("/");
    });

    it("returns '/' for whitespace-only string", () => {
      expect(normalizePath("   ")).toBe("/");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getRepositoryInconsistencies
  // ══════════════════════════════════════════════════════════════════════════

  describe("getRepositoryInconsistencies", () => {
    let service: AnalysisService;
    let mocks: ReturnType<typeof makeMocks>;

    beforeEach(() => {
      mocks = makeMocks();
      service = new AnalysisService(mocks.mockSpecRepo, mocks.mockSnapshotProvider);
    });

    it("returns err when snapshot provider fails", async () => {
      vi.mocked(mocks.mockSnapshotProvider.getSnapshot).mockReturnValue(
        errAsync(new AppError("GITHUB_FETCH_FAILED", "Network error")),
      );

      const result = await service.getRepositoryInconsistencies({ repositoryId: "repo-1" });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe("GITHUB_FETCH_FAILED");
    });

    it("runs frontend-backend comparison when no specId given", async () => {
      vi.mocked(mocks.mockSnapshotProvider.getSnapshot).mockReturnValue(
        okAsync(makeSnapshot([
          { path: "/api/users", method: "GET", source: "client", callCount: 5 },
          { path: "/api/users", method: "GET", source: "server", callCount: 0 },
        ])),
      );

      const result = await service.getRepositoryInconsistencies({ repositoryId: "repo-1" });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().specId).toBe("frontend-backend");
    });

    it("returns err when spec has no versions", async () => {
      vi.mocked(mocks.mockSnapshotProvider.getSnapshot).mockReturnValue(
        okAsync(makeSnapshot([{ path: "/users", method: "GET", source: "server" }])),
      );
      vi.mocked(mocks.mockSpecRepo.findBySpecId).mockResolvedValue(ok([]));

      const result = await service.getRepositoryInconsistencies({
        repositoryId: "repo-1",
        specId: "spec-missing",
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe("SPEC_VERSION_NOT_FOUND");
    });

    it("returns err when spec has 0 operations", async () => {
      const emptySpec = makeSpecVersion({ operations: [] });
      vi.mocked(mocks.mockSnapshotProvider.getSnapshot).mockReturnValue(
        okAsync(makeSnapshot([{ path: "/users", method: "GET", source: "server" }])),
      );
      vi.mocked(mocks.mockSpecRepo.findBySpecId).mockResolvedValue(ok([emptySpec]));

      const result = await service.getRepositoryInconsistencies({
        repositoryId: "repo-1",
        specId: "spec-1",
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe("SPEC_VERSION_NOT_ANALYZABLE");
    });

    it("returns err when repository snapshot has no server endpoints", async () => {
      const spec = makeSpecVersion();
      vi.mocked(mocks.mockSnapshotProvider.getSnapshot).mockReturnValue(
        okAsync(makeSnapshot([])), // no endpoints
      );
      vi.mocked(mocks.mockSpecRepo.findBySpecId).mockResolvedValue(ok([spec]));

      const result = await service.getRepositoryInconsistencies({
        repositoryId: "repo-1",
        specId: "spec-1",
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe("REPOSITORY_SNAPSHOT_EMPTY");
    });

    it("detects extra_endpoint for route not in spec", async () => {
      const spec = makeSpecVersion();
      vi.mocked(mocks.mockSnapshotProvider.getSnapshot).mockReturnValue(
        okAsync(makeSnapshot([
          { path: "/users", method: "GET", source: "server", callCount: 5 },
          { path: "/admin/secret", method: "GET", source: "server", callCount: 1 },
        ])),
      );
      vi.mocked(mocks.mockSpecRepo.findBySpecId).mockResolvedValue(ok([spec]));

      const result = await service.getRepositoryInconsistencies({
        repositoryId: "repo-1",
        specId: "spec-1",
      });

      expect(result.isOk()).toBe(true);
      const { inconsistencies } = result._unsafeUnwrap();
      const extra = inconsistencies.find((i) => i.type === "extra_endpoint");
      expect(extra).toBeDefined();
      expect(extra?.endpoint).toBe("/admin/secret");
    });

    it("detects missing_endpoint for spec route not in snapshot", async () => {
      const spec = makeSpecVersion();
      vi.mocked(mocks.mockSnapshotProvider.getSnapshot).mockReturnValue(
        // Only GET /users, but spec also has POST /users
        okAsync(makeSnapshot([{ path: "/users", method: "GET", source: "server", callCount: 5 }])),
      );
      vi.mocked(mocks.mockSpecRepo.findBySpecId).mockResolvedValue(ok([spec]));

      const result = await service.getRepositoryInconsistencies({
        repositoryId: "repo-1",
        specId: "spec-1",
      });

      expect(result.isOk()).toBe(true);
      const { inconsistencies } = result._unsafeUnwrap();
      const missing = inconsistencies.find(
        (i) => i.type === "missing_endpoint" && i.method === "POST",
      );
      expect(missing).toBeDefined();
    });

    it("computes correct totalApiCalls", async () => {
      const spec = makeSpecVersion();
      vi.mocked(mocks.mockSnapshotProvider.getSnapshot).mockReturnValue(
        okAsync(makeSnapshot([
          { path: "/users", method: "GET", source: "server", callCount: 7 },
          { path: "/users", method: "POST", source: "server", callCount: 3 },
        ])),
      );
      vi.mocked(mocks.mockSpecRepo.findBySpecId).mockResolvedValue(ok([spec]));

      const result = await service.getRepositoryInconsistencies({
        repositoryId: "repo-1",
        specId: "spec-1",
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().totalApiCalls).toBe(10);
    });

    it("returns ok with empty inconsistencies when spec matches snapshot exactly", async () => {
      const spec = makeSpecVersion({ operations: [
        { method: "GET", path: "/users", normalizedPath: "/users", operationId: null, summary: null },
      ]});
      vi.mocked(mocks.mockSnapshotProvider.getSnapshot).mockReturnValue(
        okAsync(makeSnapshot([{ path: "/users", method: "GET", source: "server", callCount: 10 }])),
      );
      vi.mocked(mocks.mockSpecRepo.findBySpecId).mockResolvedValue(ok([spec]));

      const result = await service.getRepositoryInconsistencies({
        repositoryId: "repo-1",
        specId: "spec-1",
      });

      expect(result.isOk()).toBe(true);
      const { inconsistencies } = result._unsafeUnwrap();
      // No extra or method mismatch inconsistencies
      expect(inconsistencies.filter((i) => i.type === "extra_endpoint")).toHaveLength(0);
      expect(inconsistencies.filter((i) => i.type === "method_mismatch")).toHaveLength(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Frontend ↔ Backend view (no specId)
  // ══════════════════════════════════════════════════════════════════════════

  describe("Frontend ↔ Backend mode (no specId)", () => {
    let service: AnalysisService;
    let mocks: ReturnType<typeof makeMocks>;

    beforeEach(() => {
      mocks = makeMocks();
      service = new AnalysisService(mocks.mockSpecRepo, mocks.mockSnapshotProvider);
    });

    it("flags client endpoint missing from server as extra_endpoint", async () => {
      vi.mocked(mocks.mockSnapshotProvider.getSnapshot).mockReturnValue(
        okAsync(makeSnapshot([
          { path: "/api/orders", method: "POST", source: "client", callCount: 3 },
          // No server route for /api/orders
        ])),
      );

      const result = await service.getRepositoryInconsistencies({ repositoryId: "repo-1" });

      expect(result.isOk()).toBe(true);
      const extra = result._unsafeUnwrap().inconsistencies.find((i) => i.type === "extra_endpoint");
      expect(extra?.endpoint).toBe("/api/orders");
    });

    it("flags server route not called by frontend as missing_endpoint", async () => {
      vi.mocked(mocks.mockSnapshotProvider.getSnapshot).mockReturnValue(
        okAsync(makeSnapshot([
          { path: "/api/internal", method: "GET", source: "server", callCount: 0 },
        ])),
      );

      const result = await service.getRepositoryInconsistencies({ repositoryId: "repo-1" });

      expect(result.isOk()).toBe(true);
      const missing = result._unsafeUnwrap().inconsistencies.find(
        (i) => i.type === "missing_endpoint",
      );
      expect(missing?.endpoint).toBe("/api/internal");
    });

    it("returns specId='frontend-backend' always", async () => {
      vi.mocked(mocks.mockSnapshotProvider.getSnapshot).mockReturnValue(
        okAsync(makeSnapshot([])),
      );

      const result = await service.getRepositoryInconsistencies({ repositoryId: "repo-x" });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().specId).toBe("frontend-backend");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getLlmFrontendBackendViolations
  // ══════════════════════════════════════════════════════════════════════════

  describe("getLlmFrontendBackendViolations", () => {
    let service: AnalysisService;
    let mocks: ReturnType<typeof makeMocks>;

    beforeEach(() => {
      mocks = makeMocks();
      service = new AnalysisService(
        mocks.mockSpecRepo,
        mocks.mockSnapshotProvider,
        mocks.mockLlmProvider,
      );
    });

    it("returns err when LLM provider is not configured", async () => {
      const serviceNoLlm = new AnalysisService(mocks.mockSpecRepo, mocks.mockSnapshotProvider);

      const result = await serviceNoLlm.getLlmFrontendBackendViolations({
        repositoryId: "repo-1",
        files: [],
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe("UNKNOWN_ERROR");
    });

    it("returns err when snapshot provider fails", async () => {
      vi.mocked(mocks.mockSnapshotProvider.getSnapshot).mockReturnValue(
        errAsync(new AppError("GITHUB_FETCH_FAILED", "Network error")),
      );

      const result = await service.getLlmFrontendBackendViolations({
        repositoryId: "repo-1",
        files: [],
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe("GITHUB_FETCH_FAILED");
    });

    it("passes non-schema-mismatch items through unchanged", async () => {
      vi.mocked(mocks.mockSnapshotProvider.getSnapshot).mockReturnValue(
        okAsync(makeSnapshot([
          { path: "/ghost", method: "GET", source: "client", callCount: 1 },
          // No server route → extra_endpoint
        ])),
      );

      const result = await service.getLlmFrontendBackendViolations({
        repositoryId: "repo-1",
        files: [],
      });

      expect(result.isOk()).toBe(true);
      const { inconsistencies } = result._unsafeUnwrap();
      const extra = inconsistencies.find((i) => i.type === "extra_endpoint");
      expect(extra).toBeDefined();
      // LLM analyseEndpoint should NOT be called for non-schema-mismatch items
      expect(mocks.mockLlmProvider.analyseEndpoint).not.toHaveBeenCalled();
    });

    it("drops schema_mismatch when LLM finds no violations (false positive)", async () => {
      vi.mocked(mocks.mockSnapshotProvider.getSnapshot).mockReturnValue(
        okAsync(makeSnapshot([
          {
            path: "/api/login",
            method: "POST",
            source: "server",
            callCount: 5,
            requestBodySchema: { type: "object", properties: { username: { type: "string" } } },
          },
          {
            path: "/api/login",
            method: "POST",
            source: "client",
            callCount: 5,
            requestBodySchema: { type: "object", properties: { email: { type: "string" } } },
          },
        ])),
      );
      vi.mocked(mocks.mockLlmProvider.analyseEndpoint).mockReturnValue(
        okAsync({
          specPath: "/api/login",
          method: "POST" as const,
          requestViolations: [],
          responseViolations: [],
          confidence: "llm:resolved" as const,
        }),
      );

      const result = await service.getLlmFrontendBackendViolations({
        repositoryId: "repo-1",
        files: [],
      });

      expect(result.isOk()).toBe(true);
      const { inconsistencies } = result._unsafeUnwrap();
      const schemaMismatches = inconsistencies.filter((i) => i.type === "schema_mismatch");
      expect(schemaMismatches).toHaveLength(0);
    });

    it("keeps schema_mismatch with llm:unresolved confidence when LLM fails", async () => {
      vi.mocked(mocks.mockSnapshotProvider.getSnapshot).mockReturnValue(
        okAsync(makeSnapshot([
          {
            path: "/api/login",
            method: "POST",
            source: "server",
            callCount: 5,
            requestBodySchema: { type: "object", properties: { username: { type: "string" } } },
          },
          {
            path: "/api/login",
            method: "POST",
            source: "client",
            callCount: 5,
            requestBodySchema: { type: "object", properties: { email: { type: "string" } } },
          },
        ])),
      );
      vi.mocked(mocks.mockLlmProvider.analyseEndpoint).mockReturnValue(
        errAsync(new AppError("UNKNOWN_ERROR", "LLM timeout")),
      );

      const result = await service.getLlmFrontendBackendViolations({
        repositoryId: "repo-1",
        files: [],
      });

      expect(result.isOk()).toBe(true);
      const { inconsistencies } = result._unsafeUnwrap();
      const unresolved = inconsistencies.find(
        (i) => i.type === "schema_mismatch" && i.confidence === "llm:unresolved",
      );
      expect(unresolved).toBeDefined();
    });

    it("returns enriched schema diff when LLM finds violations", async () => {
      vi.mocked(mocks.mockSnapshotProvider.getSnapshot).mockReturnValue(
        okAsync(makeSnapshot([
          {
            path: "/api/register",
            method: "POST",
            source: "server",
            callCount: 2,
            requestBodySchema: { type: "object", properties: { name: { type: "string" } } },
          },
          {
            path: "/api/register",
            method: "POST",
            source: "client",
            callCount: 2,
            requestBodySchema: { type: "object", properties: { username: { type: "string" } } },
          },
        ])),
      );
      vi.mocked(mocks.mockLlmProvider.analyseEndpoint).mockReturnValue(
        okAsync({
          specPath: "/api/register",
          method: "POST" as const,
          requestViolations: [
            { field: "username", expected: "string", received: "undefined", violationType: "missing_field", location: "requestBody" as const },
          ],
          responseViolations: [],
          confidence: "llm:resolved" as const,
          notes: "Backend expects 'name', not 'username'",
        }),
      );

      const result = await service.getLlmFrontendBackendViolations({
        repositoryId: "repo-1",
        files: [],
      });

      expect(result.isOk()).toBe(true);
      const { inconsistencies } = result._unsafeUnwrap();
      const mismatch = inconsistencies.find(
        (i) => i.type === "schema_mismatch" && i.confidence === "llm:resolved",
      );
      expect(mismatch).toBeDefined();
      expect(mismatch?.schemaDiff).toBeDefined();
      expect(mismatch?.schemaDiff?.errorCount).toBeGreaterThanOrEqual(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getSpecViolations
  // ══════════════════════════════════════════════════════════════════════════

  describe("getSpecViolations", () => {
    let service: AnalysisService;
    let mocks: ReturnType<typeof makeMocks>;

    beforeEach(() => {
      mocks = makeMocks();
      service = new AnalysisService(mocks.mockSpecRepo, mocks.mockSnapshotProvider);
    });

    it("propagates errors from getRepositoryInconsistencies", async () => {
      vi.mocked(mocks.mockSnapshotProvider.getSnapshot).mockReturnValue(
        errAsync(new AppError("GITHUB_FETCH_FAILED", "fail")),
      );

      const result = await service.getSpecViolations({
        specId: "spec-1",
        repositoryId: "repo-1",
      });

      expect(result.isErr()).toBe(true);
    });

    it("returns shaped SpecViolationsView on success", async () => {
      const spec = makeSpecVersion();
      vi.mocked(mocks.mockSnapshotProvider.getSnapshot).mockReturnValue(
        okAsync(makeSnapshot([
          { path: "/users", method: "GET", source: "server", callCount: 5 },
        ])),
      );
      vi.mocked(mocks.mockSpecRepo.findBySpecId).mockResolvedValue(ok([spec]));

      const result = await service.getSpecViolations({
        specId: "spec-1",
        repositoryId: "repo-1",
      });

      expect(result.isOk()).toBe(true);
      const view = result._unsafeUnwrap();
      expect(view.specId).toBe("spec-1");
      expect(view.repositoryId).toBe("repo-1");
      expect(typeof view.totalViolations).toBe("number");
      expect(Array.isArray(view.violations)).toBe(true);
    });
  });
});
