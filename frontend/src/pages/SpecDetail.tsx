import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Globe,
  Tag,
  FileJson,
  CheckCircle2,
  CircleDashed,
  Activity,
} from "lucide-react";
import { Header } from "@/components/Header";
import { MethodBadge } from "@/components/MethodBadge";
import { SchemaViolations } from "@/components/SchemaViolations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { mockSpecDetails } from "@/data/specDetails";
import { mockApiSpecs } from "@/data/mockData";
import { useState } from "react";

const SpecDetail = () => {
  const { id } = useParams<{ id: string }>();
  const spec = id ? mockSpecDetails[id] : null;
  const apiSpec = mockApiSpecs.find((s) => s.id === id);
  const [expandedEndpoints, setExpandedEndpoints] = useState<string[]>([]);

  if (!spec || !apiSpec) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-16 text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Spec Not Found
          </h2>
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