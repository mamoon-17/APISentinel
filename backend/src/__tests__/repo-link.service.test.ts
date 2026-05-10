import { describe, it, expect, vi, beforeEach } from "vitest";
import { ok, err, okAsync, errAsync } from "neverthrow";
import { RepoLinkService } from "../application/spec/repo-link.service";
import { RepoSpecLink } from "../domain/spec/repo-spec-link.entity";
import { AppError } from "../shared/errors/app-error";
import { SpecVersion } from "../domain/spec/spec.entity";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSpec(specId = "spec-1", specName = "My Spec") {
  return SpecVersion.createNew({
    specId,
    specName,
    version: "1.0.0",
    sourceHash: "hash-abc",
    sourceFormat: "yaml",
    rawDocument: {},
    operations: [
      {
        method: "GET",
        path: "/items",
        normalizedPath: "/items",
        operationId: null,
        summary: null,
      },
    ],
  });
}

function makeLink(repositoryId = "repo-1", specId = "spec-1") {
  return RepoSpecLink.createNew(repositoryId, specId);
}

// ─── Mock factories ───────────────────────────────────────────────────────────

function makeMocks() {
  const mockLinkRepo: any = {
    findByRepositoryId: vi.fn(),
    findByRepositoryAndSpec: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
  };

  const mockSpecRepo: any = {
    findBySpecId: vi.fn(),
  };

  const mockCodeProvider: any = {
    fetchFiles: vi.fn(),
    fetchFileTree: vi.fn(),
  };

  return { mockLinkRepo, mockSpecRepo, mockCodeProvider };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("RepoLinkService", () => {
  let mocks: ReturnType<typeof makeMocks>;
  let service: RepoLinkService;

  beforeEach(() => {
    mocks = makeMocks();
    service = new RepoLinkService(
      mocks.mockLinkRepo,
      mocks.mockSpecRepo,
      mocks.mockCodeProvider,
    );
  });

  // ══════════════════════════════════════════════════════════════════════════
  // linkSpec
  // ══════════════════════════════════════════════════════════════════════════

  describe("linkSpec — happy path", () => {
    it("creates a new link when no link exists", async () => {
      const spec = makeSpec();
      mocks.mockSpecRepo.findBySpecId.mockResolvedValue(ok([spec]));
      mocks.mockLinkRepo.findByRepositoryId.mockResolvedValue(ok([]));
      const newLink = makeLink();
      mocks.mockLinkRepo.save.mockResolvedValue(ok(newLink));

      const result = await service.linkSpec({ repositoryId: "repo-1", specId: "spec-1" });

      expect(result.isOk()).toBe(true);
      expect(mocks.mockLinkRepo.save).toHaveBeenCalledOnce();
      expect(mocks.mockLinkRepo.delete).not.toHaveBeenCalled();
    });

    it("returns the existing link when the same spec is already linked", async () => {
      const spec = makeSpec("spec-1");
      mocks.mockSpecRepo.findBySpecId.mockResolvedValue(ok([spec]));
      const existingLink = makeLink("repo-1", "spec-1");
      mocks.mockLinkRepo.findByRepositoryId.mockResolvedValue(ok([existingLink]));

      const result = await service.linkSpec({ repositoryId: "repo-1", specId: "spec-1" });

      expect(result.isOk()).toBe(true);
      expect(mocks.mockLinkRepo.save).not.toHaveBeenCalled();
      expect(mocks.mockLinkRepo.delete).not.toHaveBeenCalled();
    });

    it("enforces single-spec constraint — unlinks old spec before linking new one", async () => {
      const newSpec = makeSpec("spec-new", "New Spec");
      mocks.mockSpecRepo.findBySpecId.mockResolvedValue(ok([newSpec]));

      // An existing link to a DIFFERENT spec
      const existingLink = makeLink("repo-1", "spec-old");
      Object.assign(existingLink, { id: "link-old-id" });
      mocks.mockLinkRepo.findByRepositoryId.mockResolvedValue(ok([existingLink]));

      mocks.mockLinkRepo.delete.mockResolvedValue(ok(undefined));
      const savedLink = makeLink("repo-1", "spec-new");
      mocks.mockLinkRepo.save.mockResolvedValue(ok(savedLink));

      const result = await service.linkSpec({ repositoryId: "repo-1", specId: "spec-new" });

      expect(result.isOk()).toBe(true);
      expect(mocks.mockLinkRepo.delete).toHaveBeenCalledWith("link-old-id");
      expect(mocks.mockLinkRepo.save).toHaveBeenCalledOnce();
    });

    it("returns the correct specName in the view", async () => {
      const spec = makeSpec("spec-1", "Awesome API");
      mocks.mockSpecRepo.findBySpecId.mockResolvedValue(ok([spec]));
      mocks.mockLinkRepo.findByRepositoryId.mockResolvedValue(ok([]));
      mocks.mockLinkRepo.save.mockResolvedValue(ok(makeLink("repo-1", "spec-1")));

      const result = await service.linkSpec({ repositoryId: "repo-1", specId: "spec-1" });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().specName).toBe("Awesome API");
    });
  });

  describe("linkSpec — error cases", () => {
    it("returns err when spec does not exist", async () => {
      mocks.mockSpecRepo.findBySpecId.mockResolvedValue(ok([]));

      const result = await service.linkSpec({ repositoryId: "repo-1", specId: "spec-missing" });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe("SPEC_VERSION_NOT_FOUND");
    });

    it("returns err when spec lookup fails", async () => {
      mocks.mockSpecRepo.findBySpecId.mockResolvedValue(
        err(new AppError("DB_QUERY_FAILED", "DB down")),
      );

      const result = await service.linkSpec({ repositoryId: "repo-1", specId: "spec-1" });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe("DB_QUERY_FAILED");
    });

    it("returns err when findByRepositoryId fails", async () => {
      const spec = makeSpec();
      mocks.mockSpecRepo.findBySpecId.mockResolvedValue(ok([spec]));
      mocks.mockLinkRepo.findByRepositoryId.mockResolvedValue(
        err(new AppError("DB_QUERY_FAILED", "DB error")),
      );

      const result = await service.linkSpec({ repositoryId: "repo-1", specId: "spec-1" });

      expect(result.isErr()).toBe(true);
    });

    it("returns err when delete of old link fails", async () => {
      const newSpec = makeSpec("spec-new");
      mocks.mockSpecRepo.findBySpecId.mockResolvedValue(ok([newSpec]));
      const oldLink = makeLink("repo-1", "spec-old");
      mocks.mockLinkRepo.findByRepositoryId.mockResolvedValue(ok([oldLink]));
      mocks.mockLinkRepo.delete.mockResolvedValue(
        err(new AppError("DB_QUERY_FAILED", "Delete failed")),
      );

      const result = await service.linkSpec({ repositoryId: "repo-1", specId: "spec-new" });

      expect(result.isErr()).toBe(true);
      expect(mocks.mockLinkRepo.save).not.toHaveBeenCalled();
    });

    it("returns err when save fails", async () => {
      const spec = makeSpec();
      mocks.mockSpecRepo.findBySpecId.mockResolvedValue(ok([spec]));
      mocks.mockLinkRepo.findByRepositoryId.mockResolvedValue(ok([]));
      mocks.mockLinkRepo.save.mockResolvedValue(
        err(new AppError("DB_QUERY_FAILED", "Save failed")),
      );

      const result = await service.linkSpec({ repositoryId: "repo-1", specId: "spec-1" });

      expect(result.isErr()).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // unlinkSpec
  // ══════════════════════════════════════════════════════════════════════════

  describe("unlinkSpec", () => {
    it("successfully unlinks an existing spec", async () => {
      const link = makeLink("repo-1", "spec-1");
      mocks.mockLinkRepo.findByRepositoryAndSpec.mockResolvedValue(ok(link));
      mocks.mockLinkRepo.delete.mockResolvedValue(ok(undefined));

      const result = await service.unlinkSpec({ repositoryId: "repo-1", specId: "spec-1" });

      expect(result.isOk()).toBe(true);
      expect(mocks.mockLinkRepo.delete).toHaveBeenCalledWith(link.id);
    });

    it("returns err when link does not exist", async () => {
      mocks.mockLinkRepo.findByRepositoryAndSpec.mockResolvedValue(ok(null));

      const result = await service.unlinkSpec({ repositoryId: "repo-1", specId: "spec-ghost" });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe("SPEC_VERSION_NOT_FOUND");
    });

    it("returns err when repository lookup fails", async () => {
      mocks.mockLinkRepo.findByRepositoryAndSpec.mockResolvedValue(
        err(new AppError("DB_QUERY_FAILED", "DB error")),
      );

      const result = await service.unlinkSpec({ repositoryId: "repo-1", specId: "spec-1" });

      expect(result.isErr()).toBe(true);
    });

    it("propagates delete error", async () => {
      const link = makeLink();
      mocks.mockLinkRepo.findByRepositoryAndSpec.mockResolvedValue(ok(link));
      mocks.mockLinkRepo.delete.mockResolvedValue(
        err(new AppError("DB_QUERY_FAILED", "Delete failed")),
      );

      const result = await service.unlinkSpec({ repositoryId: "repo-1", specId: "spec-1" });

      expect(result.isErr()).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getLinksForRepository
  // ══════════════════════════════════════════════════════════════════════════

  describe("getLinksForRepository", () => {
    it("returns empty array when no links exist", async () => {
      mocks.mockLinkRepo.findByRepositoryId.mockResolvedValue(ok([]));

      const result = await service.getLinksForRepository("repo-empty");

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(0);
    });

    it("returns correct view for a single link", async () => {
      const link = makeLink("repo-1", "spec-1");
      mocks.mockLinkRepo.findByRepositoryId.mockResolvedValue(ok([link]));
      const spec = makeSpec("spec-1", "Named Spec");
      mocks.mockSpecRepo.findBySpecId.mockResolvedValue(ok([spec]));

      const result = await service.getLinksForRepository("repo-1");

      expect(result.isOk()).toBe(true);
      const views = result._unsafeUnwrap();
      expect(views).toHaveLength(1);
      expect(views[0]!.specId).toBe("spec-1");
      expect(views[0]!.specName).toBe("Named Spec");
      expect(views[0]!.repositoryId).toBe("repo-1");
    });

    it("uses specId as fallback specName when spec lookup fails", async () => {
      const link = makeLink("repo-1", "spec-orphan");
      mocks.mockLinkRepo.findByRepositoryId.mockResolvedValue(ok([link]));
      mocks.mockSpecRepo.findBySpecId.mockResolvedValue(ok([]));

      const result = await service.getLinksForRepository("repo-1");

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()[0]!.specName).toBe("spec-orphan");
    });

    it("returns err when findByRepositoryId fails", async () => {
      mocks.mockLinkRepo.findByRepositoryId.mockResolvedValue(
        err(new AppError("DB_QUERY_FAILED", "DB error")),
      );

      const result = await service.getLinksForRepository("repo-1");

      expect(result.isErr()).toBe(true);
    });

    it("returns multiple links when multiple specs are linked", async () => {
      const links = [makeLink("repo-1", "spec-a"), makeLink("repo-1", "spec-b")];
      mocks.mockLinkRepo.findByRepositoryId.mockResolvedValue(ok(links));
      mocks.mockSpecRepo.findBySpecId.mockResolvedValue(ok([makeSpec("spec-a", "Spec A")]));

      const result = await service.getLinksForRepository("repo-1");

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toHaveLength(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // detectSpecInRepo
  // ══════════════════════════════════════════════════════════════════════════

  describe("detectSpecInRepo", () => {
    it("returns detected spec when openapi.yaml exists in repo files", async () => {
      mocks.mockCodeProvider.fetchFiles.mockResolvedValue(
        ok([{ path: "openapi.yaml", content: "openapi: 3.0.0" }]),
      );

      const result = await service.detectSpecInRepo({ repositoryId: "repo-1" });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().filePath).toBe("openapi.yaml");
      expect(result._unsafeUnwrap().content).toBe("openapi: 3.0.0");
    });

    it("detects spec in a sub-directory path", async () => {
      mocks.mockCodeProvider.fetchFiles.mockResolvedValue(
        ok([{ path: "docs/openapi.yaml", content: "openapi: 3.0.0" }]),
      );

      const result = await service.detectSpecInRepo({ repositoryId: "repo-1" });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().filePath).toBe("docs/openapi.yaml");
    });

    it("uses fuzzy matching for openapi-named files", async () => {
      mocks.mockCodeProvider.fetchFiles.mockResolvedValue(
        ok([{ path: "config/my-openapi-v2.yaml", content: "openapi: 3.0.0" }]),
      );

      const result = await service.detectSpecInRepo({ repositoryId: "repo-1" });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().filePath).toBe("config/my-openapi-v2.yaml");
    });

    it("returns err when no spec file found", async () => {
      mocks.mockCodeProvider.fetchFiles.mockResolvedValue(
        ok([{ path: "src/index.ts", content: "const x = 1" }]),
      );

      const result = await service.detectSpecInRepo({ repositoryId: "repo-1" });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe("SPEC_VERSION_NOT_FOUND");
    });

    it("returns err when code provider fails", async () => {
      mocks.mockCodeProvider.fetchFiles.mockResolvedValue(
        err(new AppError("GITHUB_FETCH_FAILED", "Network error")),
      );

      const result = await service.detectSpecInRepo({ repositoryId: "repo-1" });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe("GITHUB_FETCH_FAILED");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // detectFrontendInRepo
  // ══════════════════════════════════════════════════════════════════════════

  describe("detectFrontendInRepo", () => {
    it("detects React frontend from .tsx files in a frontend/ dir", async () => {
      mocks.mockCodeProvider.fetchFileTree.mockResolvedValue(
        ok([
          "frontend/index.html",
          "frontend/src/App.tsx",
          "frontend/src/main.tsx",
          "frontend/vite.config.ts",
        ]),
      );

      const result = await service.detectFrontendInRepo({ repositoryId: "repo-1" });

      expect(result.isOk()).toBe(true);
      const detection = result._unsafeUnwrap();
      expect(detection.hasFrontend).toBe(true);
    });

    it("returns hasFrontend=false for pure backend repository", async () => {
      mocks.mockCodeProvider.fetchFileTree.mockResolvedValue(
        ok([
          "src/server.ts",
          "src/routes/users.ts",
          "src/models/user.ts",
          "package.json",
          "tsconfig.json",
        ]),
      );

      const result = await service.detectFrontendInRepo({ repositoryId: "repo-1" });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().hasFrontend).toBe(false);
    });

    it("returns err when file tree fetch fails", async () => {
      mocks.mockCodeProvider.fetchFileTree.mockResolvedValue(
        err(new AppError("GITHUB_FETCH_FAILED", "Network error")),
      );

      const result = await service.detectFrontendInRepo({ repositoryId: "repo-1" });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe("GITHUB_FETCH_FAILED");
    });

    it("provides evidence files when frontend is detected", async () => {
      mocks.mockCodeProvider.fetchFileTree.mockResolvedValue(
        ok([
          "frontend/index.html",
          "frontend/styles.css",
          "frontend/app.js",
        ]),
      );

      const result = await service.detectFrontendInRepo({ repositoryId: "repo-1" });

      expect(result.isOk()).toBe(true);
      const detection = result._unsafeUnwrap();
      expect(detection.hasFrontend).toBe(true);
      expect(detection.evidence.length).toBeGreaterThan(0);
    });
  });
});
