import { useParams, Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Globe,
  Tag,
  FileJson,
  CheckCircle2,
  CircleDashed,
  Activity,
  AlertTriangle,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Check,
  X,
} from "lucide-react";
import { Header } from "@/components/Header";
import { MethodBadge } from "@/components/MethodBadge";
import { SchemaViolations } from "@/components/SchemaViolations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { computeJsonDiff } from "@/lib/diff";
import { mockSpecDetails } from "@/data/specDetails";
import { mockApiSpecs } from "@/data/mockData";
import { useEffect, useState } from "react";
import { useSpecs } from "@/hooks/use-specs";
import { useRepositoryHealth } from "@/hooks/use-repository-health";

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

function getViolationTypeInfo(items: any[]) {
  if (items.length > 1) return violationLabels.multiple;
  const msg = items[0].message.toLowerCase();
  if (msg.includes('missing') || msg.includes('required')) return violationLabels.missing_field;
  if (msg.includes('extra') || msg.includes('unexpected') || msg.includes('not allowed')) return violationLabels.extra_field;
  if (msg.includes('type')) return violationLabels.type_mismatch;
  return violationLabels.schema_mismatch;
}

const SpecDetail = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const repositoryId = searchParams.get("repositoryId") ?? undefined;
  const { specs, isLoading, error } = useSpecs();
  const { healthData, isChecking, healthError, checkHealth } =
    useRepositoryHealth();
  const spec = id ? mockSpecDetails[id] : null;
  const apiSpec = mockApiSpecs.find((s) => s.id === id);
  const backendSpec = id ? specs.find((s) => s.id === id) : null;
  const [expandedEndpoints, setExpandedEndpoints] = useState<string[]>([]);
  const [expandedViolations, setExpandedViolations] = useState<string[]>([]);

  useEffect(() => {
    if (!backendSpec || !repositoryId) {
      return;
    }

    void checkHealth(repositoryId, backendSpec.id);
  }, [backendSpec, repositoryId, checkHealth]);

  if (isLoading && !spec && !backendSpec) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-16 text-center">
          <p className="text-sm text-muted-foreground">Loading spec details...</p>
        </div>
      </div>
    );
  }

  if (!spec && backendSpec) {
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
                  Live spec analysis for this uploaded OpenAPI document.
                </p>
                <div className="flex gap-6 text-sm flex-wrap">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Tag className="h-4 w-4" />
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
                      <span className="text-muted-foreground">Endpoint Coverage</span>
                      <span className="font-mono font-semibold text-foreground">
                        {calledCount}/{totalCount} ({coverage}%)
                      </span>
                    </div>
                    <Progress value={parseFloat(coverage)} className="h-2" />
                  </div>

                  <div className="card-gradient rounded-lg border border-border overflow-hidden">
                    <div className="px-6 py-4 border-b border-border">
                      <h2 className="text-lg font-semibold text-foreground">
                        All Endpoints
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        Derived from observed usage and missing-endpoint analysis.
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
                {isChecking ? (
                  <div className="card-gradient rounded-lg border border-border p-8 text-center">
                    <Loader2 className="h-8 w-8 text-primary mx-auto mb-3 animate-spin" />
                    <p className="text-sm text-muted-foreground">
                      Loading schema violations...
                    </p>
                  </div>
                ) : (
                  <div className="card-gradient rounded-lg border border-border p-5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg p-2 bg-destructive/10">
                        <AlertTriangle className="h-5 w-5 text-destructive" />
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-foreground">
                          {groupedViolations.length} Endpoint
                          {groupedViolations.length !== 1 ? "s" : ""} with
                          Violations
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Schema mismatches detected from repository analysis
                        </p>
                      </div>
                    </div>
                    <p className="text-3xl font-bold font-mono text-destructive">
                      {groupedViolations.length}
                    </p>
                  </div>
                )}

                {!isChecking ? (
                  groupedViolations.length === 0 ? (
                    <div className="card-gradient rounded-lg border border-success/30 p-8 text-center">
                      <CheckCircle2 className="h-8 w-8 text-success mx-auto mb-3" />
                      <h3 className="text-lg font-semibold text-foreground mb-1">
                        All Clear
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        No schema violations detected for this specification.
                      </p>
                    </div>
                  ) : (
                    <div className="card-gradient rounded-lg border border-border overflow-hidden divide-y divide-border">
                      {groupedViolations.map((group) => {
                        const isExpanded = expandedViolations.includes(group.id);
                        const info = getViolationTypeInfo(group.items);

                        return (
                          <div key={group.id}>
                            <div
                              className="flex items-center gap-4 px-6 py-4 cursor-pointer transition-colors hover:bg-muted/30"
                              onClick={() => {
                                setExpandedViolations((prev) =>
                                  prev.includes(group.id)
                                    ? prev.filter((id) => id !== group.id)
                                    : [...prev, group.id]
                                );
                              }}
                            >
                              <button className="text-muted-foreground shrink-0">
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </button>
                              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                              {group.method ? <MethodBadge method={group.method as any} /> : null}
                              <span className="font-mono text-sm text-foreground flex-1 truncate">{group.endpoint}</span>
                              <span className="text-sm text-muted-foreground hidden sm:block max-w-[180px] truncate">{/* No summary available from healthData directly */}</span>
                              <Badge variant={info.variant} className="text-xs shrink-0">{info.label}</Badge>
                              <span className="font-mono text-xs text-muted-foreground shrink-0">
                                {group.items.length} issue{group.items.length !== 1 ? 's' : ''}
                              </span>
                            </div>

                            {isExpanded && (
                              <div className="px-6 py-5 bg-muted/10 border-t border-border/50">
                                {/* Legend */}
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

                                    const { expected, received } = computeJsonDiff(item.schemaDiff.expected, item.schemaDiff.received);

                                    return (
                                      <div key={item.id} className="space-y-3">
                                        <p className="text-sm text-muted-foreground">
                                          {item.message} ({item.schemaDiff.location})
                                        </p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                          {/* Expected */}
                                          <div>
                                            <div className="flex items-center gap-2 mb-2">
                                              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/20">
                                                <Check className="h-3 w-3 text-primary" />
                                              </div>
                                              <span className="text-sm font-medium text-foreground">Expected (OpenAPI)</span>
                                            </div>
                                            <pre className="text-xs font-mono leading-relaxed overflow-x-auto bg-card rounded-md border border-border p-3">
                                              {expected.map((lineItem, i) => (
                                                <div
                                                  key={i}
                                                  className={cn('px-2 py-0.5 rounded-sm', lineStyles[lineItem.type as keyof typeof lineStyles])}
                                                >
                                                  {lineItem.line || '\u00A0'}
                                                </div>
                                              ))}
                                            </pre>
                                          </div>

                                          {/* Received */}
                                          <div>
                                            <div className="flex items-center gap-2 mb-2">
                                              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-warning/20">
                                                <X className="h-3 w-3 text-warning" />
                                              </div>
                                              <span className="text-sm font-medium text-foreground">Received (Actual)</span>
                                            </div>
                                            <pre className="text-xs font-mono leading-relaxed overflow-x-auto bg-card rounded-md border border-border p-3">
                                              {received.map((lineItem, i) => (
                                                <div
                                                  key={i}
                                                  className={cn('px-2 py-0.5 rounded-sm', lineStyles[lineItem.type as keyof typeof lineStyles])}
                                                >
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
                ) : null}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    );
  }

  if (!spec || !apiSpec) {
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

  const calledCount = spec.endpoints.filter((e) => e.called).length;
  const unusedCount = spec.endpoints.length - calledCount;
  const coverage = ((calledCount / spec.endpoints.length) * 100).toFixed(1);
  const totalCalls = spec.endpoints.reduce((sum, e) => sum + e.callCount, 0);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container py-6 space-y-6">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>

        {/* Spec header */}
        <div className="card-gradient rounded-lg border border-border p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-lg p-3 bg-primary/10">
              <FileJson className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <h1 className="text-2xl font-bold text-foreground">
                  {spec.name}
                </h1>
                <Badge variant="muted" className="font-mono">
                  {spec.version}
                </Badge>
                <Badge
                  variant={apiSpec.status === "active" ? "success" : "muted"}
                >
                  {apiSpec.status}
                </Badge>
              </div>
              <p className="text-muted-foreground mb-4">{spec.description}</p>
              <div className="flex gap-6 text-sm flex-wrap">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Globe className="h-4 w-4" />
                  <span className="font-mono">{spec.baseUrl}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Tag className="h-4 w-4" />
                  <span>{spec.endpoints.length} endpoints</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Tabbed content */}
        <Tabs defaultValue="endpoints" className="space-y-4">
          <TabsList className="bg-card border border-border">
            <TabsTrigger value="endpoints">Endpoints & Coverage</TabsTrigger>
            <TabsTrigger value="violations">Schema Violations</TabsTrigger>
          </TabsList>

          {/* Tab 1: Endpoints & Coverage merged */}
          <TabsContent value="endpoints">
            <div className="space-y-4">
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="card-gradient rounded-lg border border-border p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Activity className="h-4 w-4 text-primary" />
                    <span className="text-xs text-muted-foreground">Total</span>
                  </div>
                  <p className="text-2xl font-bold font-mono text-foreground">
                    {spec.endpoints.length}
                  </p>
                </div>
                <div className="card-gradient rounded-lg border border-success/30 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    <span className="text-xs text-muted-foreground">
                      Called
                    </span>
                  </div>
                  <p className="text-2xl font-bold font-mono text-success">
                    {calledCount}
                  </p>
                </div>
                <div className="card-gradient rounded-lg border border-warning/30 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <CircleDashed className="h-4 w-4 text-warning" />
                    <span className="text-xs text-muted-foreground">
                      Unused
                    </span>
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

              {/* Coverage bar */}
              <div className="card-gradient rounded-lg border border-border p-4">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-muted-foreground">
                    Endpoint Coverage
                  </span>
                  <span className="font-mono font-semibold text-foreground">
                    {calledCount}/{spec.endpoints.length} ({coverage}%)
                  </span>
                </div>
                <Progress value={parseFloat(coverage)} className="h-2" />
              </div>

              {/* Endpoint list with inline performance */}
              <div className="card-gradient rounded-lg border border-border overflow-hidden">
                <div className="px-6 py-4 border-b border-border">
                  <h2 className="text-lg font-semibold text-foreground">
                    All Endpoints
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Click to expand parameters & response schema
                  </p>
                </div>
                <div className="divide-y divide-border">
                  {[...spec.endpoints]
                    .sort((a, b) =>
                      a.called === b.called
                        ? b.callCount - a.callCount
                        : a.called
                          ? -1
                          : 1,
                    )
                    .map((ep) => (
                      <div key={ep.id}>
                        <div
                          className={cn(
                            "flex items-center gap-4 px-6 py-3.5 cursor-pointer transition-colors hover:bg-muted/30",
                            expandedEndpoints.includes(ep.id) && "bg-muted/20",
                            !ep.called && "opacity-60",
                          )}
                          onClick={() => {
                            setExpandedEndpoints((prev) =>
                              prev.includes(ep.id)
                                ? prev.filter((id) => id !== ep.id)
                                : [...prev, ep.id]
                            );
                          }}
                        >
                          {ep.called ? (
                            <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                          ) : (
                            <CircleDashed className="h-4 w-4 text-warning shrink-0" />
                          )}
                          <MethodBadge method={ep.method} />
                          <span className="font-mono text-sm text-foreground flex-1 truncate">
                            {ep.path}
                          </span>
                          <span className="text-sm text-muted-foreground hidden md:block max-w-[200px] truncate">
                            {ep.summary}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground w-20 text-right">
                            {ep.callCount.toLocaleString()} calls
                          </span>
                        </div>

                        {expandedEndpoints.includes(ep.id) && (
                          <div className="px-6 py-4 bg-muted/10 border-t border-border/50 space-y-4">
                            <div>
                              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                Parameters
                              </h4>
                              {ep.parameters.length > 0 ? (
                                <div className="space-y-1">
                                  {ep.parameters.map((p) => (
                                    <div
                                      key={p.name}
                                      className="flex items-center gap-3 text-sm font-mono"
                                    >
                                      <Badge
                                        variant="muted"
                                        className="text-xs"
                                      >
                                        {p.in}
                                      </Badge>
                                      <span className="text-foreground">
                                        {p.name}
                                      </span>
                                      <span className="text-muted-foreground">
                                        : {p.type}
                                      </span>
                                      {p.required && (
                                        <Badge
                                          variant="error"
                                          className="text-xs"
                                        >
                                          required
                                        </Badge>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-muted-foreground">
                                  No parameters
                                </p>
                              )}
                            </div>
                            <div>
                              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                                Response Schema
                              </h4>
                              <pre className="text-xs font-mono bg-card p-3 rounded-md border border-border text-foreground overflow-x-auto">
                                {JSON.stringify(ep.responseSchema, null, 2)}
                              </pre>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Tab 2: Schema Violations */}
          <TabsContent value="violations">
            <SchemaViolations specId={id!} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default SpecDetail;