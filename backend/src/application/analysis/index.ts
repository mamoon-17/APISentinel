export { AnalysisService } from "./analysis.service";
export type {
  InconsistencyItem,
  RepositoryInconsistenciesView,
  SpecViolationItem,
  SpecViolationsView,
  SchemaDiffBlock,
} from "./analysis.service";
export type {
  HttpMethod,
  ExtractedSchema,
  RepositorySnapshot,
  RepositorySnapshotProvider,
  SnapshotEndpointUsage,
} from "./contracts/repository-snapshot.provider";
export type {
  RepositoryFile,
  RepositoryCodeProvider,
} from "./contracts/repository-code.provider";
export type { CodeScannerProvider } from "./contracts/code-scanner.provider";
