import { describe, it, expect, vi, beforeEach } from "vitest";
import { RepoLinkService } from "../application/spec/repo-link.service";
import { RepoSpecLink } from "../domain/spec/repo-spec-link.entity";
import { ok, err } from "neverthrow";
import { AppError } from "../shared/errors/app-error";
import { SpecVersion } from "../domain/spec/spec.entity";

describe("RepoLinkService", () => {
  let linkService: RepoLinkService;
  let mockLinkRepo: any;
  let mockSpecRepo: any;
  let mockCodeProvider: any;

  beforeEach(() => {
    mockLinkRepo = {
      findByRepositoryId: vi.fn(),
      findByRepositoryAndSpec: vi.fn(),
      save: vi.fn(),
      delete: vi.fn(),
    };

    mockSpecRepo = {
      findBySpecId: vi.fn(),
    };

    mockCodeProvider = {};

    linkService = new RepoLinkService(
      mockLinkRepo,
      mockSpecRepo,
      mockCodeProvider
    );
  });

  describe("linkSpec", () => {
    it("should enforce single-spec constraint by unlinking existing specs before linking a new one", async () => {
      // Arrange
      const repositoryId = "repo-1";
      const existingSpecId = "spec-1";
      const newSpecId = "spec-2";

      // Mock that the spec to be linked actually exists
      const newSpec = SpecVersion.createNew({
        specId: newSpecId,
        specName: "User Spec",
        version: "1.0",
        sourceHash: "hash1",
        sourceFormat: "yaml",
        rawDocument: {},
        operations: [],
      });
      mockSpecRepo.findBySpecId.mockResolvedValue(ok([newSpec]));

      // Mock that another spec is already linked
      const existingLink = RepoSpecLink.createNew(repositoryId, existingSpecId);
      Object.assign(existingLink, { id: "link-123" });
      mockLinkRepo.findByRepositoryId.mockResolvedValue(ok([existingLink]));

      // Mock successful deletion of old link and saving of new link
      mockLinkRepo.delete.mockResolvedValue(ok(undefined));
      
      const newLink = RepoSpecLink.createNew(repositoryId, newSpecId);
      mockLinkRepo.save.mockResolvedValue(ok(newLink));

      // Act
      const result = await linkService.linkSpec({ repositoryId, specId: newSpecId });

      // Assert
      expect(result.isOk()).toBe(true);
      expect(mockLinkRepo.delete).toHaveBeenCalledWith("link-123");
      expect(mockLinkRepo.save).toHaveBeenCalledTimes(1);
      
      if (result.isOk()) {
        expect(result.value.specId).toBe(newSpecId);
        expect(result.value.specName).toBe("User Spec");
      }
    });

    it("should just return the existing link if the requested spec is already linked", async () => {
      // Arrange
      const repositoryId = "repo-1";
      const specId = "spec-1";

      const spec = SpecVersion.createNew({
        specId,
        specName: "User Spec",
        version: "1.0",
        sourceHash: "hash2",
        sourceFormat: "yaml",
        rawDocument: {},
        operations: [],
      });
      mockSpecRepo.findBySpecId.mockResolvedValue(ok([spec]));

      const existingLink = RepoSpecLink.createNew(repositoryId, specId);
      mockLinkRepo.findByRepositoryId.mockResolvedValue(ok([existingLink]));

      // Act
      const result = await linkService.linkSpec({ repositoryId, specId });

      // Assert
      expect(result.isOk()).toBe(true);
      expect(mockLinkRepo.delete).not.toHaveBeenCalled();
      expect(mockLinkRepo.save).not.toHaveBeenCalled();
    });
  });
});
