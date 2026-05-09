import {
  Activity,
  ShieldCheck,
  AlertTriangle,
  BarChart3,
  ArrowUpRight,
  GitBranch,
  Github,
  Star,
  Lock,
  ExternalLink,
  Loader2,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";
import { Header } from "@/components/Header";
import { StatsCard } from "@/components/StatsCard";
import { useGithubRepoList } from "@/hooks/use-github-repos";
import { useDashboardStats, useRequestLogs } from "@/hooks/use-dashboard";
import type { RequestLogEntry } from "@/hooks/use-dashboard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/* ── Status helpers ───────────────────────────────────────────────── */

function statusIcon(status: RequestLogEntry["status"]) {
  switch (status) {
    case "valid":
      return (
        <div className="flex items-center gap-1.5 w-24" title="No inconsistencies found">
          <CheckCircle className="h-4 w-4 text-success" />
          <span className="text-sm font-medium text-success">Passed</span>
        </div>
      );
    case "warning":
      return (
        <div className="flex items-center gap-1.5 w-24" title="Non-critical inconsistencies found">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <span className="text-sm font-medium text-warning">Warnings</span>
        </div>
      );
    case "error":
      return (
        <div className="flex items-center gap-1.5 w-24" title="Critical inconsistencies or run failure">
          <XCircle className="h-4 w-4 text-destructive" />
          <span className="text-sm font-medium text-destructive">Failed</span>
        </div>
      );
  }
}

function jobStatusBadge(jobStatus: RequestLogEntry["jobStatus"]) {
  switch (jobStatus) {
    case "queued":
      return (
        <Badge variant="muted" className="text-xs">
          Queued
        </Badge>
      );
    case "running":
      return (
        <Badge variant="muted" className="text-xs animate-pulse">
          Running
        </Badge>
      );
    case "succeeded":
      return (
        <Badge variant="success" className="text-xs">
          Passed
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="error" className="text-xs">
          Failed
        </Badge>
      );
  }
}

function triggerLabel(trigger: RequestLogEntry["trigger"]) {
  switch (trigger) {
    case "manual":
      return "Manual";
    case "auto-on-link":
      return "Auto";
    case "retry":
      return "Retry";
  }
}

/* ── Page Component ───────────────────────────────────────────────── */

const Index = () => {
  const { stats, isLoading: statsLoading } = useDashboardStats();
  const {
    logs,
    isLoading: logsLoading,
    refetch: refetchLogs,
  } = useRequestLogs(20);

  const {
    repos,
    isLoading,
    error,
    tokenInvalid,
    scopeInsufficient,
    githubLinked,
    refetch,
  } = useGithubRepoList();

  const total = repos.length;
  const publicN = repos.filter((r) => !r.isPrivate).length;
  const privateN = repos.filter((r) => r.isPrivate).length;
  const preview = repos.slice(0, 3);

  function formatUpdated(iso: string): string {
    try {
      return formatDistanceToNow(new Date(iso), { addSuffix: true });
    } catch {
      return "—";
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container py-6 space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard
            title="Health Checks Run"
            value={
              statsLoading
                ? "—"
                : (stats?.healthChecksRun ?? 0).toLocaleString()
            }
            icon={Activity}
          />
          <StatsCard
            title="Repos Analyzed"
            value={
              statsLoading
                ? "—"
                : (stats?.repositoriesAnalyzed ?? 0).toLocaleString()
            }
            icon={BarChart3}
            variant="success"
          />
          <StatsCard
            title="Inconsistencies"
            value={
              statsLoading
                ? "—"
                : (stats?.inconsistenciesFound ?? 0).toLocaleString()
            }
            icon={AlertTriangle}
            variant={
              (stats?.inconsistenciesFound ?? 0) > 0 ? "warning" : "default"
            }
          />
          <StatsCard
            title="Compliance Rate"
            value={
              statsLoading ? "—" : `${stats?.complianceRate ?? 100}%`
            }
            icon={ShieldCheck}
            variant="success"
          />
        </div>

        {/* GitHub repositories (live from your linked account) */}
        <div className="card-gradient rounded-lg border border-border overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 border-b border-border/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <GitBranch className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">
                  Linked Repositories
                </h3>
                <p className="text-sm text-muted-foreground">
                  {!githubLinked
                    ? "Connect GitHub in Settings to sync your repositories here."
                    : isLoading
                      ? "Loading your GitHub repositories…"
                      : scopeInsufficient
                        ? "Reconnect GitHub to enable private repository access."
                        : error
                          ? "Couldn't load repository list."
                          : tokenInvalid
                            ? "GitHub access expired—reconnect in Settings."
                            : total > 0
                              ? `${total} repositor${total === 1 ? "y" : "ies"} · ${publicN} public · ${privateN} private`
                              : "No repositories returned from GitHub."}
                </p>
              </div>
            </div>
            {githubLinked && (error || tokenInvalid || scopeInsufficient) ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refetch()}
              >
                Try again
              </Button>
            ) : null}
          </div>

          <div className="divide-y divide-border/50 min-h-[120px]">
            {!githubLinked ? (
              <p className="px-4 py-6 text-sm text-muted-foreground text-center">
                Open{" "}
                <span className="text-foreground font-medium">Settings</span> in
                the header and use{" "}
                <span className="text-foreground font-medium">
                  Connect GitHub
                </span>{" "}
                under Connections.
              </p>
            ) : isLoading && total === 0 && !error ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Fetching from GitHub…
              </div>
            ) : error ? (
              <p className="px-4 py-6 text-sm text-destructive/90 text-center">
                {error}
              </p>
            ) : scopeInsufficient ? (
              <p className="px-4 py-6 text-sm text-center text-muted-foreground">
                Re-authorize GitHub in Settings so private repositories can be
                listed.
              </p>
            ) : tokenInvalid ? (
              <p className="px-4 py-6 text-sm text-center text-muted-foreground">
                Re-authorize GitHub in Settings, then return to this page.
              </p>
            ) : preview.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground text-center">
                You don't have any accessible repositories, or the list is
                empty. See{" "}
                <Link
                  to="/repositories"
                  className="text-primary hover:underline"
                >
                  My Repositories
                </Link>{" "}
                for details.
              </p>
            ) : (
              preview.map((repo) => (
                <Link
                  key={repo.id}
                  to={`/repositories/${repo.id}`}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-muted/30 transition-colors group"
                >
                  <div className="p-2 rounded-lg bg-muted/50 shrink-0">
                    <Github className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground text-sm truncate group-hover:text-primary">
                      {repo.fullName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {repo.isPrivate ? (
                        <span className="inline-flex items-center gap-1">
                          <Lock className="h-3 w-3" /> Private
                        </span>
                      ) : (
                        "Public"
                      )}
                      {" · "}
                      <span className="inline-flex items-center gap-0.5">
                        <Star className="h-3 w-3" />
                        {repo.stars} stars
                      </span>
                      {" · "}
                      updated {formatUpdated(repo.updatedAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label="Open on GitHub"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      window.open(repo.url, "_blank", "noopener,noreferrer");
                    }}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                </Link>
              ))
            )}
          </div>

          {githubLinked &&
          total > 0 &&
          !error &&
          !tokenInvalid &&
          !scopeInsufficient ? (
            <Link
              to="/repositories"
              className="flex items-center justify-center gap-2 px-4 py-3 text-sm text-primary hover:bg-muted/30 transition-colors border-t border-border/50"
            >
              View all {total} repositor{total === 1 ? "y" : "ies"}
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          ) : null}
        </div>

        {/* Health Check Activity Log — real data from backend */}
        <div className="card-gradient rounded-lg border border-border overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-foreground">
                  Health Check Activity
                </h3>
                <p className="text-sm text-muted-foreground">
                  Recent health-check runs across your linked repositories
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refetchLogs()}
                disabled={logsLoading}
              >
                <RefreshCw
                  className={cn("h-3.5 w-3.5 mr-1.5", logsLoading && "animate-spin")}
                />
                Refresh
              </Button>
            </div>
          </div>

          <div className="divide-y divide-border">
            {logsLoading && logs.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading activity…
              </div>
            ) : logs.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  No health checks have been run yet. Link a spec to a
                  repository and run a health check to see results here.
                </p>
              </div>
            ) : (
              logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors"
                >
                  {statusIcon(log.status)}

                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-foreground truncate">
                      {log.repositoryFullName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      Spec: {log.specName || "—"} ·{" "}
                      {triggerLabel(log.trigger)} trigger
                    </p>
                  </div>

                  {jobStatusBadge(log.jobStatus)}

                  {log.inconsistencyCount > 0 && (
                    <Badge
                      variant={log.status === "error" ? "error" : "warning"}
                      className="text-xs"
                    >
                      {log.inconsistencyCount}{" "}
                      {log.inconsistencyCount === 1 ? "issue" : "issues"}
                    </Badge>
                  )}

                  {log.endpointsTotal > 0 && (
                    <span className="text-xs text-muted-foreground hidden md:inline">
                      {log.endpointsCovered}/{log.endpointsTotal} endpoints
                    </span>
                  )}

                  {log.durationMs !== null && (
                    <span className="text-xs text-muted-foreground w-16 text-right hidden sm:inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {log.durationMs < 1000
                        ? `${log.durationMs}ms`
                        : `${(log.durationMs / 1000).toFixed(1)}s`}
                    </span>
                  )}

                  <span className="text-xs text-muted-foreground w-24 text-right">
                    {formatDistanceToNow(new Date(log.timestamp), {
                      addSuffix: true,
                    })}
                  </span>

                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
