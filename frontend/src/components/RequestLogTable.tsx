import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  XCircle,
  Filter,
} from "lucide-react";
import { RequestLog, ApiSpec } from "@/types/api";
import { StatusIndicator } from "./StatusIndicator";
import { MethodBadge } from "./MethodBadge";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface RequestLogTableProps {
  logs: RequestLog[];
  specs?: ApiSpec[];
  showApiFilter?: boolean;
}

export function RequestLogTable({
  logs,
  specs,
  showApiFilter = false,
}: RequestLogTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedApiId, setSelectedApiId] = useState<string>("all");

  // In a real app, logs would have a specId field. For demo, we'll derive it from endpoint patterns
  const getLogSpecId = (log: RequestLog): string | null => {
    if (log.specId) return log.specId;
    if (log.endpoint.includes("/users") || log.endpoint.includes("/auth"))
      return "1";
    if (
      log.endpoint.includes("/orders") ||
      log.endpoint.includes("/payments") ||
      log.endpoint.includes("/inventory")
    )
      return "2";
    return null;
  };

  const filteredLogs =
    selectedApiId === "all"
      ? logs
      : logs.filter((log) => getLogSpecId(log) === selectedApiId);

  const selectedSpec = specs?.find((s) => s.id === selectedApiId);

  return (
    <div className="card-gradient rounded-lg border border-border overflow-hidden">
      <div className="px-6 py-4 border-b border-border">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">
              Request Log
            </h3>
            <p className="text-sm text-muted-foreground">
              {selectedApiId === "all"
                ? "Real-time API contract validation across all APIs"
                : `Showing requests for ${selectedSpec?.name || "selected API"}`}
            </p>
          </div>

          {showApiFilter && specs && specs.length > 0 && (
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={selectedApiId} onValueChange={setSelectedApiId}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Filter by API" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All APIs</SelectItem>
                  {specs.map((spec) => (
                    <SelectItem key={spec.id} value={spec.id}>
                      {spec.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {selectedApiId !== "all" && selectedSpec && (
          <div className="mt-3 px-3 py-2 bg-primary/5 border border-primary/20 rounded-md">
            <p className="text-xs text-primary">
              <span className="font-medium">Filtering:</span>{" "}
              {selectedSpec.name} ({selectedSpec.version}) —{" "}
              {filteredLogs.length} request
              {filteredLogs.length !== 1 ? "s" : ""}
            </p>
          </div>
        )}
      </div>

      <div className="divide-y divide-border">
        {filteredLogs.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No requests found for the selected filter.
            </p>
          </div>
        ) : (
          filteredLogs.map((log) => {
            const logSpecId = getLogSpecId(log);
            const logSpec = specs?.find((s) => s.id === logSpecId);

            return (
              <div key={log.id} className="animate-slide-up">
                <div
                  className={cn(
                    "flex items-center gap-4 px-6 py-4 cursor-pointer transition-colors hover:bg-muted/30",
                    expandedId === log.id && "bg-muted/20",
                  )}
                  onClick={() =>
                    setExpandedId(expandedId === log.id ? null : log.id)
                  }
                >
                  <button className="text-muted-foreground hover:text-foreground transition-colors">
                    {expandedId === log.id ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>

                  <StatusIndicator
                    status={log.status}
                    pulse={log.status === "error"}
                  />

                  <MethodBadge method={log.method} />

                  <span className="font-mono text-sm text-foreground flex-1 truncate">
                    {log.endpoint}
                  </span>

                  {showApiFilter && logSpec && selectedApiId === "all" && (
                    <Badge
                      variant="muted"
                      className="text-xs hidden lg:inline-flex"
                    >
                      {logSpec.name}
                    </Badge>
                  )}

                  <Badge variant="muted" className="font-mono">
                    {log.responseCode}
                  </Badge>

                  <span className="text-sm text-muted-foreground w-16 text-right">
                    {log.latency}ms
                  </span>

                  {log.violations.length > 0 && (
                    <Badge
                      variant={log.status === "error" ? "error" : "warning"}
                    >
                      {log.violations.length}{" "}
                      {log.violations.length === 1 ? "issue" : "issues"}
                    </Badge>
                  )}

                  <span className="text-xs text-muted-foreground w-24 text-right">
                    {formatDistanceToNow(log.timestamp, { addSuffix: true })}
                  </span>
                </div>

                {expandedId === log.id && log.violations.length > 0 && (
                  <div className="px-6 py-4 bg-muted/10 border-t border-border/50">
                    <h4 className="text-sm font-medium text-foreground mb-3">
                      Contract Violations
                    </h4>
                    <div className="space-y-2">
                      {log.violations.map((violation) => (
                        <div
                          key={violation.id}
                          className={cn(
                            "flex items-start gap-3 p-3 rounded-md border",
                            violation.severity === "error"
                              ? "bg-destructive/5 border-destructive/20"
                              : "bg-warning/5 border-warning/20",
                          )}
                        >
                          {violation.severity === "error" ? (
                            <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-warning mt-0.5 shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground">
                              {violation.message}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1 font-mono">
                              Field: {violation.field}
                              {violation.expected &&
                                ` • Expected: ${violation.expected}`}
                              {violation.received &&
                                ` • Received: ${violation.received}`}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

