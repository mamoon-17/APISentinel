export type ProjectArchitecture = "hexagonal" | "mvc" | "nestjs" | "flat";

export interface ArchitectureContext {
  architecture: ProjectArchitecture;
  tracingOrder: string;
  entryPoint: string | null;
}

export function detectArchitectureContext(filePaths: string[]): ArchitectureContext {
  const lower = filePaths.map((p) => p.replace(/\\/g, "/").toLowerCase());

  const hasHex =
    lower.some((p) => p.includes("/ports/")) ||
    lower.some((p) => p.includes("/adapters/")) ||
    lower.some((p) => p.includes("/infrastructure/")) ||
    lower.some((p) => p.includes("/application/"));
  const hasMvc = lower.some((p) => p.includes("/controllers/")) || lower.some((p) => p.includes("/routes/"));
  const hasNest =
    lower.some((p) => p.includes("/modules/")) ||
    lower.some((p) => p.endsWith(".module.ts")) ||
    lower.some((p) => p.includes("@nestjs"));

  const architecture: ProjectArchitecture = hasNest
    ? "nestjs"
    : hasHex
      ? "hexagonal"
      : hasMvc
        ? "mvc"
        : "flat";

  const tracingOrder =
    architecture === "hexagonal"
      ? "adapters/http -> application/use-cases -> domain -> infrastructure"
      : architecture === "nestjs"
        ? "controllers/modules -> services/providers -> dto/entities"
        : architecture === "mvc"
          ? "routes -> controllers -> services -> models"
          : "entry file -> routers -> handlers";

  return {
    architecture,
    tracingOrder,
    entryPoint: findEntryPoint(lower),
  };
}

export function findEntryPoint(lowerFilePaths: string[]): string | null {
  const candidates = [
    "src/server.ts",
    "src/server.js",
    "server.ts",
    "server.js",
    "src/app.ts",
    "src/app.js",
    "app.ts",
    "app.js",
    "src/main.ts",
    "src/main.js",
    "main.ts",
    "main.js",
    "src/index.ts",
    "src/index.js",
    "index.ts",
    "index.js",
  ];

  for (const candidate of candidates) {
    const hit = lowerFilePaths.find((p) => p.endsWith(candidate));
    if (hit) return hit;
  }
  return null;
}

