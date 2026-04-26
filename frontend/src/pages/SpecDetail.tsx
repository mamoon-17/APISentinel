import { useParams, Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  FileJson,
  CheckCircle2,
  CircleDashed,
  Activity,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Check,
  X,
} from "lucide-react";
import { Header } from "@/components/Header";
import { MethodBadge } from "@/components/MethodBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { useSpecs } from "@/hooks/use-specs";
import { useRepositoryHealth } from "@/hooks/use-repository-health";
import type { SpecInconsistency, AnalysisConfidence } from "@/types/api";
import { SPECS_LLM_VIOLATIONS_API_PATH } from "@/lib/api-paths";
import { getApiBaseUrl } from "@/hooks/use-session";

type LlmCachePayload = {
  analyzedAt: string;
  violations: SpecInconsistency[];
};

function llmCacheKey(specId: string, repositoryId: string) {
  return `apisentinel:llm-violations:${specId}:${repositoryId}`;
}

const lineStyles = {
  match: 'text-foreground',
  error: 'text-destructive bg-destructive/10',
  warning: 'text-warning bg-warning/10',
  missing: 'text-muted-foreground bg-muted/30 line-through',
};

const violationLabels: Record<string, { label: string; variant: 'destructive' | 'default' }> = {
  type_mismatch: { label: 'Type Mismatch', variant: 'destructive' },
  extra_field: { label: 'Extra Field', variant: 'default' },
  missing_field: { label: 'Missing Field', variant: 'destructive' },
  multiple: { label: 'Multiple Issues', variant: 'destructive' },
  schema_mismatch: { label: 'Schema Mismatch', variant: 'destructive' },
};

function getViolationTypeInfo(items: SpecInconsistency[]) {
  const totalErrors = items.reduce((sum, i) => sum + (i.schemaDiff?.errorCount ?? 0), 0);
  const totalWarnings = items.reduce((sum, i) => sum + (i.schemaDiff?.warningCount ?? 0), 0);

  if (totalErrors > 0 && totalWarnings > 0) return violationLabels.multiple;
  if (totalErrors > 0) return violationLabels.type_mismatch;
  if (totalWarnings > 0) return violationLabels.extra_field;
  return violationLabels.schema_mismatch;
}

function getTotalIssues(items: SpecInconsistency[]): number {
  return items.reduce(
    (sum, i) => sum + (i.schemaDiff?.errorCount ?? 0) + (i.schemaDiff?.warningCount ?? 0),
    0,
  );
}

function ConfidenceBadge({
  confidence,
}: {
  confidence?: import("@/types/api").AnalysisConfidence;
}) {
  // Confidence badges are a Static Analysis feature only.
  // In AI mode they are hidden at the call site.
  if (confidence === "static:high") {
    return (
      <span
        className={cn(
          "text-xs font-mono px-2 py-0.5 rounded-full border bg-green-500/15 text-green-400 border-green-500/30",
        )}
      >
        High confidence
      </span>
    );
  }
  if (confidence === "static:low") {
    return (
      <span
        className={cn(
          "text-xs font-mono px-2 py-0.5 rounded-full border bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
        )}
      >
        Low confidence
      </span>
    );
  }
  return null;
}

const SpecDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const repositoryId = searchParams.get("repositoryId") ?? undefined;
  const { specs, isLoading, error } = useSpecs();
  const { healthData, isChecking, healthError, checkHealth } =
    useRepositoryHealth();
  const backendSpec = id ? specs.find((s) => s.id === id) : null;
  const [expandedViolations, setExpandedViolations] = useState<string[]>([]);
  const [llmViolations, setLlmViolations] = useState<SpecInconsistency[] | null>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);
  const [useLlm, setUseLlm] = useState(false);

  useEffect(() => {
    if (!backendSpec || !repositoryId) {
      setLlmViolations(null);
      setUseLlm(false);
      return;
    }

    try {
      const raw = window.localStorage.getItem(llmCacheKey(backendSpec.id, repositoryId));
      if (!raw) return;
      const parsed = JSON.parse(raw) as LlmCachePayload;
      if (!Array.isArray(parsed.violations)) return;
      setLlmViolations(parsed.violations);
    } catch {
      // ignore cache failures
    }
  }, [backendSpec, repositoryId]);

  useEffect(() => {
    if (!backendSpec || !repositoryId) {
      return;
    }

    void checkHealth(repositoryId, backendSpec.id);
  }, [backendSpec, repositoryId, checkHealth]);

  const runLlmAnalysis = async () => {
    if (!backendSpec || !repositoryId) return;

    // If we already have results, just show them (user can still rerun explicitly).
    if (llmViolations && llmViolations.length >= 0) {
      setUseLlm(true);
      return;
    }

    setLlmLoading(true);
    setLlmError(null);
    try {
      const res = await fetch(
        `${getApiBaseUrl()}${SPECS_LLM_VIOLATIONS_API_PATH(backendSpec.id, repositoryId)}`,
        { credentials: "include" },
      );
      const data = await res.json().catch(() => null) as any;
      if (!res.ok) {
        setLlmError(data?.message ?? "LLM analysis failed");
        return;
      }
      const violations = (data?.violations ?? []) as SpecInconsistency[];
      setLlmViolations(violations);
      setUseLlm(true);
      try {
        window.localStorage.setItem(
          llmCacheKey(backendSpec.id, repositoryId),
          JSON.stringify({
            analyzedAt: new Date().toISOString(),
            violations,
          } satisfies LlmCachePayload),
        );
      } catch {
        // ignore cache write failures
      }
    } catch {
      setLlmError("Network error — could not reach backend");
    } finally {
      setLlmLoading(false);
    }
  };


  if (isLoading && !backendSpec) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-16 text-center">
          <p className="text-sm text-muted-foreground">Loading spec details...</p>
        </div>
      </div>
    );
  }

  if (backendSpec) {
    const usageRows = healthData?.endpointUsage ?? [];
    const usageByKey = new Map(
      usageRows.map((item) => [`${item.method}:${item.endpoint}`, item]),
    );

    const missingRows = (healthData?.inconsistencies ?? []).filter(
      (item) => item.type === "missing_endpoint" && item.method,
    );

    const missingAsUsage = missingRows.map((item) => ({
      endpoint: item.endpoint,
      method: item.method!,
      callCount: 0,
      inSpec: true,
      lastCalledAt: undefined,
    }));

    for (const item of missingAsUsage) {
      const key = `${item.method}:${item.endpoint}`;
      if (!usageByKey.has(key)) {
        usageByKey.set(key, item);
      }
    }

    const allEndpoints = [...usageByKey.values()].sort((a, b) => {
      if (a.callCount !== b.callCount) return b.callCount - a.callCount;
      if (a.endpoint !== b.endpoint) return a.endpoint.localeCompare(b.endpoint);
      return a.method.localeCompare(b.method);
    });

    const calledCount = allEndpoints.filter((row) => row.callCount > 0).length;
    const totalCount = Math.max(backendSpec.totalEndpoints, allEndpoints.length);
    const unusedCount = Math.max(totalCount - calledCount, 0);
    const coverage =
      totalCount > 0 ? ((calledCount / totalCount) * 100).toFixed(1) : "0.0";
    const totalCalls = usageRows.reduce((sum, row) => sum + row.callCount, 0);

    const schemaMismatches = (healthData?.inconsistencies ?? []).filter(
      (item) => item.type === "schema_mismatch",
    );

    const groups = new Map<
      string,
      {
        id: string;
        endpoint: string;
        method?: string;
        severity: "warning" | "error";
        items: typeof schemaMismatches;
      }
    >();

    for (const mismatch of schemaMismatches) {
      const key = `${mismatch.method ?? "UNKNOWN"}:${mismatch.endpoint}`;
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          id: key,
          endpoint: mismatch.endpoint,
          method: mismatch.method,
          severity: mismatch.severity,
          items: [mismatch],
        });
        continue;
      }

      existing.items.push(mismatch);
      if (mismatch.severity === "error") {
        existing.severity = "error";
      }
    }

    const groupedViolations = [...groups.values()];

    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-6 space-y-6">
          <Link
            to={repositoryId ? `/repositories/${repositoryId}` : "/repositories"}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {repositoryId ? "Back to Repository" : "Back to Repositories"}
          </Link>

          <div className="card-gradient rounded-lg border border-border p-6">
            <div className="flex items-start gap-4">
              <div className="rounded-lg p-3 bg-primary/10">
                <FileJson className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1 flex-wrap">
                  <h1 className="text-2xl font-bold text-foreground">
                    {backendSpec.name}
                  </h1>
                  <Badge variant="muted" className="font-mono">
                    {backendSpec.activeVersion ?? "n/a"}
                  </Badge>
                  <Badge
                    variant={
                      backendSpec.status === "active" ? "success" : "muted"
                    }
                  >
                    {backendSpec.status}
                  </Badge>
                </div>
                <p className="text-muted-foreground mb-4">
                  Live comparison between your uploaded OpenAPI spec and what we can detect from your backend repository code.
                </p>
                <div className="flex gap-6 text-sm flex-wrap">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>{backendSpec.totalVersions} versions</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Activity className="h-4 w-4" />
                    <span>{backendSpec.totalEndpoints} endpoints</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {!repositoryId ? (
            <div className="card-gradient rounded-lg border border-warning/40 bg-warning/10 p-6">
              <p className="text-sm text-warning">
                Open this page from Repository Detail to load analysis context
                automatically.
              </p>
            </div>
          ) : null}

          {healthError ? (
            <div className="card-gradient rounded-lg border border-destructive/40 bg-destructive/10 p-6">
              <p className="text-sm text-destructive">{healthError}</p>
            </div>
          ) : null}

          <Tabs defaultValue="endpoints" className="space-y-4">
            <TabsList className="bg-card border border-border">
              <TabsTrigger value="endpoints">Endpoints & Coverage</TabsTrigger>
              <TabsTrigger value="violations">Schema Violations</TabsTrigger>
            </TabsList>

            <TabsContent value="endpoints">
              {isChecking ? (
                <div className="card-gradient rounded-lg border border-border p-8 text-center">
                  <Loader2 className="h-8 w-8 text-primary mx-auto mb-3 animate-spin" />
                  <p className="text-sm text-muted-foreground">
                    Loading endpoints and coverage...
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="card-gradient rounded-lg border border-border p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Activity className="h-4 w-4 text-primary" />
                        <span className="text-xs text-muted-foreground">Total</span>
                      </div>
                      <p className="text-2xl font-bold font-mono text-foreground">
                        {totalCount}
                      </p>
                    </div>
                    <div className="card-gradient rounded-lg border border-success/30 p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle2 className="h-4 w-4 text-success" />
                        <span className="text-xs text-muted-foreground">Called</span>
                      </div>
                      <p className="text-2xl font-bold font-mono text-success">
                        {calledCount}
                      </p>
                    </div>
                    <div className="card-gradient rounded-lg border border-warning/30 p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <CircleDashed className="h-4 w-4 text-warning" />
                        <span className="text-xs text-muted-foreground">Unused</span>
                      </div>
                      <p className="text-2xl font-bold font-mono text-warning">
                        {unusedCount}
                      </p>
                    </div>
                    <div className="card-gradient rounded-lg border border-border p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <Activity className="h-4 w-4 text-primary" />
                        <span className="text-xs text-muted-foreground">
                          Total Calls
                        </span>
                      </div>
                      <p className="text-2xl font-bold font-mono text-foreground">
                        {totalCalls.toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="card-gradient rounded-lg border border-border p-4">
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className="text-muted-foreground">Endpoint coverage (backend scan vs spec)</span>
                      <span className="font-mono font-semibold text-foreground">
                        {calledCount}/{totalCount} ({coverage}%)
                      </span>
                    </div>
                    <Progress value={parseFloat(coverage)} className="h-2" />
                    <p className="mt-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Spec</span>: your uploaded OpenAPI endpoints.{" "}
                      <span className="font-medium text-foreground">Backend scan</span>: endpoints detected from your backend source code.
                    </p>
                  </div>

                  <div className="card-gradient rounded-lg border border-border overflow-hidden">
                    <div className="px-6 py-4 border-b border-border">
                      <h2 className="text-lg font-semibold text-foreground">
                        All Endpoints
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        Derived from backend scan signals plus missing-endpoint analysis from the OpenAPI spec.
                      </p>
                    </div>
                    <div className="divide-y divide-border">
                      {allEndpoints.length === 0 ? (
                        <div className="px-6 py-6 text-sm text-muted-foreground">
                          No endpoint analysis data yet.
                        </div>
                      ) : (
                        allEndpoints.map((ep, idx) => (
                          <div
                            key={`${ep.method}:${ep.endpoint}:${idx}`}
                            className={cn(
                              "flex items-center gap-4 px-6 py-3.5",
                              ep.callCount === 0 && "opacity-70",
                            )}
                          >
                            {ep.callCount > 0 ? (
                              <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                            ) : (
                              <CircleDashed className="h-4 w-4 text-warning shrink-0" />
                            )}
                            <MethodBadge method={ep.method} />
                            <span className="font-mono text-sm text-foreground flex-1 truncate">
                              {ep.endpoint}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {ep.callCount.toLocaleString()} calls
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="violations">
              <div className="space-y-4">
                {/* LLM analysis trigger */}
                {repositoryId && (
                  <div className="card-gradient rounded-lg border border-border p-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {useLlm ? "Showing AI-powered analysis" : "Static analysis (from repository scan)"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {useLlm
                          ? "GPT-4.1-mini analysed your repo files against the spec"
                          : "Confidence: High = extracted directly from code; Low = inferred/partial. Static scan uses backend code only. Run AI analysis for deeper results."}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {useLlm && (
                        <button
                          onClick={() => { setUseLlm(false); }}
                          className="text-xs text-muted-foreground hover:text-foreground px-3 py-1 rounded border border-border hover:bg-muted/30"
                        >
                          Back to static
                        </button>
                      )}
                      <button
                        onClick={() => void runLlmAnalysis()}
                        disabled={llmLoading}
                        className="text-xs text-primary hover:text-primary/80 px-3 py-1 rounded border border-primary/30 hover:bg-primary/10 disabled:opacity-50 flex items-center gap-1"
                      >
                        {llmLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                        {llmLoading
                          ? "Analysing..."
                          : llmViolations
                            ? (useLlm ? "AI Analysis Ready" : "Show AI Analysis")
                            : "Run AI Analysis"}
                      </button>
                    </div>
                  </div>
                )}

                {llmError && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                    <p className="text-xs text-destructive">{llmError}</p>
                  </div>
                )}

                {(isChecking && !useLlm) ? (
                  <div className="card-gradient rounded-lg border border-border p-8 text-center">
                    <Loader2 className="h-8 w-8 text-primary mx-auto mb-3 animate-spin" />
                    <p className="text-sm text-muted-foreground">Loading schema violations...</p>
                  </div>
                ) : (
                  <div className="card-gradient rounded-lg border border-border p-5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg p-2 bg-destructive/10">
                        <AlertTriangle className="h-5 w-5 text-destructive" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-foreground">
                          {(useLlm ? llmViolations ?? [] : groupedViolations).length} Endpoint{(useLlm ? llmViolations ?? [] : groupedViolations).length !== 1 ? "s" : ""} with Violations
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Endpoints returning responses inconsistent with the OpenAPI specification
                        </p>
                      </div>
                    </div>
                    <p className="text-3xl font-bold font-mono text-destructive">
                      {(useLlm ? llmViolations ?? [] : groupedViolations).length}
                    </p>
                  </div>
                )}

                {(!isChecking || useLlm) && (
                  (useLlm ? llmViolations ?? [] : groupedViolations).length === 0 ? (
                    <div className="card-gradient rounded-lg border border-success/30 p-8 text-center">
                      <CheckCircle2 className="h-8 w-8 text-success mx-auto mb-3" />
                      <h3 className="text-lg font-semibold text-foreground mb-1">All Clear</h3>
                      <p className="text-sm text-muted-foreground">No schema violations detected for this specification.</p>
                    </div>
                  ) : (
                    <div className="card-gradient rounded-lg border border-border overflow-hidden divide-y divide-border">
                      {(useLlm
                        ? (llmViolations ?? []).map(v => ({ id: v.id, endpoint: v.endpoint, method: v.method, severity: v.severity, items: [v] }))
                        : groupedViolations
                      ).map((group) => {
                        const isExpanded = expandedViolations.includes(group.id);
                        const info = getViolationTypeInfo(group.items);
                        const totalIssues = getTotalIssues(group.items);
                        const locationLabel =
                          group.items.length === 1 && group.items[0].schemaDiff
                            ? group.items[0].schemaDiff.location === "requestBody" ? "Request body" : "Response body"
                            : group.items.length > 1 ? "Request & response" : undefined;
                        const confidence = group.items[0]?.confidence;

                        return (
                          <div key={group.id}>
                            <div
                              className="flex items-center gap-4 px-6 py-4 cursor-pointer transition-colors hover:bg-muted/30"
                              onClick={() => setExpandedViolations((prev) =>
                                prev.includes(group.id) ? prev.filter((x) => x !== group.id) : [...prev, group.id]
                              )}
                            >
                              <button className="text-muted-foreground shrink-0">
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </button>
                              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                              {group.method ? <MethodBadge method={group.method as any} /> : null}
                              <span className="font-mono text-sm text-foreground flex-1 truncate">{group.endpoint}</span>
                              {locationLabel && (
                                <span className="text-sm text-muted-foreground hidden sm:block shrink-0">{locationLabel}</span>
                              )}
                              <Badge variant={info.variant} className="text-xs shrink-0">{info.label}</Badge>
                              {!useLlm && <ConfidenceBadge confidence={confidence} />}
                              <span className="font-mono text-xs text-muted-foreground shrink-0">
                                {totalIssues} issue{totalIssues !== 1 ? 's' : ''}
                              </span>
                            </div>

                            {isExpanded && (
                              <div className="px-6 py-5 bg-muted/10 border-t border-border/50">
                                <div className="flex items-center gap-6 text-xs mb-4">
                                  <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-sm bg-destructive/30 border border-destructive/50" />
                                    <span className="text-muted-foreground">Type Mismatch</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-sm bg-warning/30 border border-warning/50" />
                                    <span className="text-muted-foreground">Extra Field</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-sm bg-muted border border-border" />
                                    <span className="text-muted-foreground">Missing Field</span>
                                  </div>
                                </div>

                                <div className="space-y-6">
                                  {group.items.map((item) => {
                                    if (!item.schemaDiff) {
                                      return (
                                        <div key={item.id} className="p-3 text-sm text-muted-foreground bg-card rounded-md border border-border">
                                          {item.message}
                                        </div>
                                      );
                                    }
                                    const { expectedLines, receivedLines, errorCount, warningCount } = item.schemaDiff;
                                    return (
                                      <div key={item.id} className="space-y-3">
                                        <div className="flex items-center gap-3 flex-wrap">
                                          <p className="text-sm text-muted-foreground">
                                            {item.schemaDiff.location === "requestBody" ? "Request body" : "Response body"} schema mismatch
                                          </p>
                                          {errorCount > 0 && (
                                            <span className="inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-full bg-destructive/15 text-destructive border border-destructive/30">
                                              {errorCount} error{errorCount !== 1 ? 's' : ''}
                                            </span>
                                          )}
                                          {warningCount > 0 && (
                                            <span className="inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/30">
                                              {warningCount} warning{warningCount !== 1 ? 's' : ''}
                                            </span>
                                          )}
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                          <div>
                                            <div className="flex items-center gap-2 mb-2">
                                              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/20">
                                                <Check className="h-3 w-3 text-primary" />
                                              </div>
                                              <span className="text-sm font-medium text-foreground">Expected (OpenAPI)</span>
                                            </div>
                                            <pre className="text-xs font-mono leading-relaxed overflow-x-auto bg-card rounded-md border border-border p-3">
                                              {expectedLines.map((lineItem, i) => (
                                                <div key={i} className={cn('px-2 py-0.5 rounded-sm', lineStyles[lineItem.type as keyof typeof lineStyles])}>
                                                  {lineItem.line || '\u00A0'}
                                                </div>
                                              ))}
                                            </pre>
                                          </div>
                                          <div>
                                            <div className="flex items-center gap-2 mb-2">
                                              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-warning/20">
                                                <X className="h-3 w-3 text-warning" />
                                              </div>
                                              <span className="text-sm font-medium text-foreground">Received (Actual)</span>
                                            </div>
                                            <pre className="text-xs font-mono leading-relaxed overflow-x-auto bg-card rounded-md border border-border p-3">
                                              {receivedLines.map((lineItem, i) => (
                                                <div key={i} className={cn('px-2 py-0.5 rounded-sm', lineStyles[lineItem.type as keyof typeof lineStyles])}>
                                                  {lineItem.line || '\u00A0'}
                                                </div>
                                              ))}
                                            </pre>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    );
  }

  if (!backendSpec) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-16 text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Spec Not Found
          </h2>
          {error ? (
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
          ) : null}
          <Link to="/dashboard">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    );
  }
};

export default SpecDetail;