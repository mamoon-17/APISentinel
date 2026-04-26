import { err, ok, Result } from "neverthrow";
import { AppError } from "../../shared/errors/app-error";
import { RepoSpecLink, RepoSpecLinkRepository, SpecVersionRepository } from "../../domain/spec";
import type { RepositoryCodeProvider } from "../analysis/contracts/repository-code.provider";
import type { FrontendDetectionProvider } from "./contracts/frontend-detection.provider";

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

export interface DetectedFrontendResult {
  hasFrontend: boolean;
  /** Framework or technology, e.g. "React", "Next.js", "Django", "HTML/CSS" */
  frontendType?: string;
  /** Best guess where the frontend lives (folder path) */
  frontendRoot?: string;
  /** Small set of paths that triggered the detection */
  evidence: string[];
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
    private readonly frontendDetectionProvider?: FrontendDetectionProvider,
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

  async detectFrontendInRepo(input: {
    repositoryId: string;
    githubAccessToken?: string;
  }): Promise<Result<DetectedFrontendResult, AppError>> {
    const treeResult = await this.codeProvider.fetchFileTree(
      input.repositoryId,
      input.githubAccessToken,
    );
    if (treeResult.isErr()) return err(treeResult.error);

    const allPaths = treeResult.value;
    const staticSignal = detectStaticFrontendSignal(allPaths);
    if (staticSignal.hasFrontend) {
      return ok({
        hasFrontend: true,
        frontendType: staticSignal.frontendType ?? undefined,
        frontendRoot: staticSignal.frontendRoot ?? undefined,
        evidence: staticSignal.evidence,
      });
    }

    // Fast heuristic pass works across framework and static-site frontends.
    const heuristic = detectFrontendFromPaths(allPaths);
    if (isStrongFrontendHeuristic(heuristic)) {
      return ok({
        hasFrontend: true,
        frontendType: heuristic.frontendType ?? undefined,
        frontendRoot: heuristic.frontendRoot ?? undefined,
        evidence: heuristic.evidence,
      });
    }

    // LLM-powered detection: comprehensive, framework-agnostic
    if (this.frontendDetectionProvider && input.githubAccessToken) {
      const llmResult = await this.frontendDetectionProvider.detectFromRepository(
        input.repositoryId,
        allPaths,
        input.githubAccessToken,
      );

      if (llmResult.isOk()) {
        const { hasFrontend, frontendType, frontendRoot } = llmResult.value;
        if (!hasFrontend && heuristic.hasFrontend) {
          return ok({
            hasFrontend: true,
            frontendType: heuristic.frontendType ?? undefined,
            frontendRoot: heuristic.frontendRoot ?? undefined,
            evidence: heuristic.evidence,
          });
        }

        return ok({
          hasFrontend,
          frontendType:
            (frontendType || heuristic.frontendType) ?? undefined,
          frontendRoot:
            (frontendRoot || heuristic.frontendRoot) ?? undefined,
          evidence: heuristic.evidence.slice(0, 5),
        });
      }
      // LLM failed - fall through to heuristics
    }

    if (!heuristic.hasFrontend) {
      return ok({ hasFrontend: false, evidence: [] });
    }

    return ok({
      hasFrontend: true,
      frontendType: heuristic.frontendType ?? undefined,
      frontendRoot: heuristic.frontendRoot ?? undefined,
      evidence: heuristic.evidence,
    });
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

function findFrontendEvidence(allPaths: string[]): string[] {
  const evidence: string[] = [];
  const frontendDirs = [
    "frontend/",
    "client/",
    "web/",
    "ui/",
    "static/",
    "public/",
    "assets/",
    "site/",
    "www/",
  ];
  const templateDirs = ["templates/", "views/", "pages/", "partials/"];
  const frontendExts = new Set([
    ".html",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".vue",
    ".svelte",
    ".astro",
    ".erb",
    ".php",
    ".jinja",
    ".jinja2",
    ".twig",
    ".hbs",
    ".ejs",
  ]);
  const strongFiles = [
    "index.html",
    "vite.config.",
    "webpack.config.",
    "tailwind.config.",
    "postcss.config.",
    "next.config.",
    "nuxt.config.",
    "angular.json",
    "svelte.config.",
    "astro.config.",
    "manifest.webmanifest",
    "favicon.",
  ];

  for (const path of allPaths) {
    const lower = path.toLowerCase();
    const ext = lower.includes(".") ? "." + lower.split(".").pop() : "";

    const inFrontendDir = frontendDirs.some((dir) => lower.startsWith(dir) || lower.includes(`/${dir}`));
    const inTemplateDir = templateDirs.some((dir) => lower.includes(dir));
    const isFrontendFile = frontendExts.has(ext);
    const isStrongFrontendFile = strongFiles.some(
      (name) => lower.endsWith(name) || lower.includes(`/${name}`),
    );
    const isFrontendEntry =
      lower.endsWith(".tsx") ||
      lower.endsWith(".jsx") ||
      lower.endsWith(".js") ||
      lower.endsWith(".mjs");

    if (
      inFrontendDir ||
      isStrongFrontendFile ||
      (inTemplateDir && isFrontendFile) ||
      isFrontendFile
    ) {
      evidence.push(path);
    }

    if (
      isFrontendEntry &&
      !lower.includes("test") &&
      !lower.includes("spec") &&
      !lower.includes("/backend/") &&
      !lower.startsWith("backend/")
    ) {
      evidence.push(path);
    }

    if (evidence.length >= 12) break;
  }

  return evidence;
}

function guessRootFromEvidence(evidence: string[]): string | null {
  const preferred = [
    "frontend",
    "client",
    "web",
    "ui",
    "apps",
    "templates",
    "public",
    "static",
    "views",
    "src",
  ];
  for (const pref of preferred) {
    const hit = evidence.find((path) => path.toLowerCase().startsWith(`${pref}/`));
    if (hit) return pref;
  }

  const first = evidence[0];
  if (!first) return null;
  const seg = first.split("/")[0];
  return seg ? seg : null;
}

function detectFrontendFromPaths(allPaths: string[]): {
  hasFrontend: boolean;
  frontendType: string | null;
  frontendRoot: string | null;
  evidence: string[];
} {
  const evidence = uniquePaths(findFrontendEvidence(allPaths));
  const lowerPaths = allPaths.map((path) => path.toLowerCase());

  let score = 0;

  if (evidence.length > 0) score += 2;
  if (evidence.some((path) => path.toLowerCase().endsWith(".html"))) score += 2;
  if (evidence.some((path) => hasStyleExtension(path))) score += 1;
  if (lowerPaths.some((path) => path.endsWith("index.html"))) score += 2;
  if (lowerPaths.some((path) => path.includes("/public/") || path.startsWith("public/"))) score += 1;
  if (lowerPaths.some((path) => path.includes("/static/") || path.startsWith("static/"))) score += 1;
  if (lowerPaths.some((path) => path.includes("/assets/") || path.startsWith("assets/"))) score += 1;
  if (
    lowerPaths.some(
      (path) =>
        path.includes("vite.config.") ||
        path.includes("webpack.config.") ||
        path.includes("tailwind.config.") ||
        path.includes("postcss.config."),
    )
  ) {
    score += 2;
  }
  if (
    lowerPaths.some(
      (path) =>
        path.endsWith(".tsx") ||
        path.endsWith(".jsx") ||
        path.endsWith(".vue") ||
        path.endsWith(".svelte"),
    )
  ) {
    score += 2;
  }

  const frontendType = inferFrontendType(lowerPaths, evidence);
  if (frontendType) score += 1;

  return {
    hasFrontend: score >= 3,
    frontendType,
    frontendRoot: guessRootFromEvidence(evidence),
    evidence,
  };
}

function inferFrontendType(allPaths: string[], evidence: string[]): string | null {
  if (allPaths.some((path) => path.includes("next.config."))) return "Next.js";
  if (allPaths.some((path) => path.includes("nuxt.config."))) return "Nuxt";
  if (allPaths.some((path) => path.endsWith(".vue"))) return "Vue";
  if (allPaths.some((path) => path.endsWith(".svelte") || path.includes("svelte.config."))) return "Svelte";
  if (allPaths.some((path) => path.includes("angular.json"))) return "Angular";
  if (allPaths.some((path) => path.endsWith(".astro") || path.includes("astro.config."))) return "Astro";
  if (allPaths.some((path) => path.endsWith(".tsx") || path.endsWith(".jsx"))) return "React";
  if (allPaths.some((path) => path.includes("/templates/") || path.includes("/views/"))) {
    return "Server-rendered templates";
  }
  if (
    evidence.some((path) => path.toLowerCase().endsWith(".html")) &&
    evidence.some((path) => hasStyleExtension(path))
  ) {
    return "HTML/CSS";
  }
  if (evidence.some((path) => path.toLowerCase().endsWith(".html"))) return "HTML";
  return null;
}

function hasStyleExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith(".css") ||
    lower.endsWith(".scss") ||
    lower.endsWith(".sass") ||
    lower.endsWith(".less")
  );
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

function isStrongFrontendHeuristic(input: {
  hasFrontend: boolean;
  frontendType: string | null;
  frontendRoot: string | null;
  evidence: string[];
}): boolean {
  if (!input.hasFrontend) return false;

  const lowerEvidence = input.evidence.map((path) => path.toLowerCase());
  const htmlCount = lowerEvidence.filter((path) => path.endsWith(".html")).length;
  const styleCount = lowerEvidence.filter((path) => hasStyleExtension(path)).length;
  const frontendDirHit = lowerEvidence.some(
    (path) =>
      path.startsWith("frontend/") ||
      path.startsWith("client/") ||
      path.startsWith("web/") ||
      path.startsWith("ui/"),
  );

  return frontendDirHit || htmlCount >= 2 || (htmlCount >= 1 && styleCount >= 1);
}

function detectStaticFrontendSignal(allPaths: string[]): {
  hasFrontend: boolean;
  frontendType: string | null;
  frontendRoot: string | null;
  evidence: string[];
} {
  const frontendRoots = ["frontend/", "client/", "web/", "ui/"];
  const staticFileExts = [".html", ".css", ".scss", ".sass", ".less"];
  const modernUiExts = [".js", ".mjs", ".jsx", ".ts", ".tsx", ".vue", ".svelte", ".astro"];
  const lowerPaths = allPaths.map((p) => p.toLowerCase());

  for (const root of frontendRoots) {
    const inRoot = lowerPaths.filter((p) => p.startsWith(root));
    if (inRoot.length === 0) continue;

    const staticFiles = inRoot.filter((p) => staticFileExts.some((ext) => p.endsWith(ext)));
    const uiFiles = inRoot.filter((p) => modernUiExts.some((ext) => p.endsWith(ext)));
    const rootName = root.slice(0, -1);
    const sample = uniquePaths(
      [...staticFiles, ...uiFiles, ...inRoot]
        .slice(0, 8)
        .map((p) => allPaths.find((orig) => orig.toLowerCase() === p) ?? p),
    );

    if (staticFiles.length >= 2) {
      return {
        hasFrontend: true,
        frontendType: "HTML/CSS",
        frontendRoot: rootName,
        evidence: sample,
      };
    }

    if (staticFiles.length >= 1 && uiFiles.length >= 1) {
      return {
        hasFrontend: true,
        frontendType: inferFrontendType(lowerPaths, sample) ?? "Frontend",
        frontendRoot: rootName,
        evidence: sample,
      };
    }

    if (uiFiles.length >= 3) {
      return {
        hasFrontend: true,
        frontendType: inferFrontendType(lowerPaths, sample) ?? "Frontend",
        frontendRoot: rootName,
        evidence: sample,
      };
    }
  }

  return {
    hasFrontend: false,
    frontendType: null,
    frontendRoot: null,
    evidence: [],
  };
}
