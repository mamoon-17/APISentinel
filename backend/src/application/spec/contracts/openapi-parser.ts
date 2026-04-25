import { SpecOperation } from "../../../domain/spec";

export interface ParsedOpenApiSpec {
  specName: string;
  version: string;
  sourceFormat: "json" | "yaml";
  sourceHash: string;
  rawDocument: Record<string, unknown>;
  operations: SpecOperation[];
}

export interface OpenApiParser {
  parse(content: string, fileName?: string): ParsedOpenApiSpec;
}
