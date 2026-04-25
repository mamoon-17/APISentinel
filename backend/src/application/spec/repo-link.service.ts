import { err, ok, Result } from "neverthrow";
import { AppError } from "../../shared/errors/app-error";
import { RepoSpecLink, RepoSpecLinkRepository, SpecVersionRepository } from "../../domain/spec";
import type { RepositoryCodeProvider } from "../analysis/contracts/repository-code.provider";

export interface RepoLinkView {
  id: string;
  repositoryId: string;
  specId: string;
  specName: string;
  linkedAt: string;
}

export interface DetectedSpecResult {
  /** Path of the spec file found in the repo, e.g. "openapi.yaml" */
  filePath: string;
  /** Raw content of the spec file */
  content: string;
}

/** Common spec file paths to search for, in priority order */
const SPEC_FILE_CANDIDATES = [
  "openapi.yaml",
  "openapi.yml",
  "openapi.json",
  "swagger.yaml",
  "swagger.yml",
  "swagger.json",
  "api.yaml",
  "api.yml",
  "api.json",
  "docs/openapi.yaml",
  "docs/openapi.yml",
  "docs/swagger.yaml",
  "docs/api.yaml",
  "api-docs/openapi.yaml",
  ".api/openapi.yaml",
];

export class RepoLinkService {
  constructor(
    private readonly linkRepository: RepoSpecLinkRepository,
    private readonly specVersionRepository: SpecVersionRepository,
    private readonly codeProvider: RepositoryCodeProvider,
  ) {}

  async linkSpec(input: {
    repositoryId: string;
    specId: string;
    githubAccessToken?: string;
  }): Promise<Result<RepoLinkView, AppError>> {
    // Verify spec exists
    const specVersionsResult = await this.specVersionRepository.findBySpecId(input.specId);
    if (specVersionsResult.isErr()) return err(specVersionsResult.error);
    if (specVersionsResult.value.length === 0) {
      return err(new AppError("SPEC_VERSION_NOT_FOUND", `No spec found with id "${input.specId}"`));
    }

    const specName = specVersionsResult.value[0]!.specName;

    // Check if already linked
    const existingResult = await this.linkRepository.findByRepositoryAndSpec(
      input.repositoryId,
      input.specId,
    );
    if (existingResult.isErr()) return err(existingResult.error);
    if (existingResult.value) {
      return ok(toLinkView(existingResult.value, specName));
    }

    const link = RepoSpecLink.createNew(input.repositoryId, input.specId);
    const saveResult = await this.linkRepository.save(link);
    if (saveResult.isErr()) return err(saveResult.error);

    return ok(toLinkView(saveResult.value, specName));
  }

  async unlinkSpec(input: {
    repositoryId: string;
    specId: string;
  }): Promise<Result<void, AppError>> {
    const existingResult = await this.linkRepository.findByRepositoryAndSpec(
      input.repositoryId,
      input.specId,
    );
    if (existingResult.isErr()) return err(existingResult.error);
    if (!existingResult.value) {
      return err(new AppError("SPEC_VERSION_NOT_FOUND", "No link found between this repository and spec"));
    }

    return this.linkRepository.delete(existingResult.value.id);
  }

  async getLinksForRepository(
    repositoryId: string,
  ): Promise<Result<RepoLinkView[], AppError>> {
    const linksResult = await this.linkRepository.findByRepositoryId(repositoryId);
    if (linksResult.isErr()) return err(linksResult.error);

    const views: RepoLinkView[] = [];
    for (const link of linksResult.value) {
      const specResult = await this.specVersionRepository.findBySpecId(link.specId);
      const specName = specResult.isOk() && specResult.value[0]
        ? specResult.value[0].specName
        : link.specId;
      views.push(toLinkView(link, specName));
    }

    return ok(views);
  }

  async detectSpecInRepo(input: {
    repositoryId: string;
    githubAccessToken?: string;
  }): Promise<Result<DetectedSpecResult, AppError>> {
    // Fetch all repo files (roles, filtered list)
    const filesResult = await this.codeProvider.fetchFiles(
      input.repositoryId,
      input.githubAccessToken,
    );
    if (filesResult.isErr()) return err(filesResult.error);

    const files = filesResult.value;

    // Search for any well-known spec file path in the fetched files
    for (const candidate of SPEC_FILE_CANDIDATES) {
      const match = files.find(
        (f) =>
          f.path.toLowerCase() === candidate ||
          f.path.toLowerCase().endsWith(`/${candidate}`),
      );
      if (match) {
        return ok({ filePath: match.path, content: match.content });
      }
    }

    // Secondary scan: any file whose name contains "openapi" or "swagger"
    const fuzzyMatch = files.find((f) => {
      const name = f.path.toLowerCase();
      return (
        (name.includes("openapi") || name.includes("swagger")) &&
        (name.endsWith(".yaml") || name.endsWith(".yml") || name.endsWith(".json"))
      );
    });

    if (fuzzyMatch) {
      return ok({ filePath: fuzzyMatch.path, content: fuzzyMatch.content });
    }

    return err(
      new AppError(
        "SPEC_VERSION_NOT_FOUND",
        "No OpenAPI spec file detected in this repository. Common file names checked: " +
          SPEC_FILE_CANDIDATES.slice(0, 6).join(", ") + " and others.",
      ),
    );
  }
}

function toLinkView(link: RepoSpecLink, specName: string): RepoLinkView {
  return {
    id: link.id,
    repositoryId: link.repositoryId,
    specId: link.specId,
    specName,
    linkedAt: link.linkedAt.toISOString(),
  };
}
