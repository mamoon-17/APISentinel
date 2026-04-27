import {
  Activity,
  ShieldCheck,
  AlertTriangle,
  Clock,
  ArrowUpRight,
  GitBranch,
  Github,
  Star,
  Lock,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router-dom";
import { Header } from "@/components/Header";
import { StatsCard } from "@/components/StatsCard";
import { RequestLogTable } from "@/components/RequestLogTable";
import { useGithubRepoList } from "@/hooks/use-github-repos";
import { Button } from "@/components/ui/button";
import { useDashboardStats } from "@/hooks/use-dashboard-stats";
import { useRequestLogs } from "@/hooks/use-request-logs";

const Index = () => {
  const { stats, isLoading: statsLoading, error: statsError } =
    useDashboardStats();
  const {
    logs: requestLogs,
    isLoading: logsLoading,
    error: logsError,
  } = useRequestLogs();

  const statsUnavailable = statsLoading || Boolean(statsError);
  const validationRate = stats?.totalRequests
    ? ((stats.validRequests / stats.totalRequests) * 100).toFixed(1)
    : "0.0";

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
            title="Total Requests"
            value={
              statsUnavailable
                ? "—"
                : (stats?.totalRequests ?? 0).toLocaleString()
            }
            icon={Activity}
          />
          <StatsCard
            title="Valid Contracts"
            value={statsUnavailable ? "—" : `${validationRate}%`}
            icon={ShieldCheck}
            variant="success"
          />
          <StatsCard
            title="Violations"
            value={
              statsUnavailable
                ? "—"
                : (stats?.violations ?? 0).toLocaleString()
            }
            icon={AlertTriangle}
            variant="warning"
          />
          <StatsCard
            title="Success Rate"
            value={statsUnavailable ? "—" : `${stats?.uptime ?? 0}%`}
            icon={Clock}
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
                          ? "Couldn’t load repository list."
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
                You don’t have any accessible repositories, or the list is
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

        {/* Request Log */}
        {logsLoading && requestLogs.length === 0 ? (
          <div className="card-gradient rounded-lg border border-border p-12 text-center">
            <Loader2 className="h-8 w-8 text-muted-foreground mx-auto mb-3 animate-spin" />
            <p className="text-sm text-muted-foreground">Loading request logs...</p>
          </div>
        ) : logsError ? (
          <div className="card-gradient rounded-lg border border-destructive/30 p-10 text-center">
            <p className="text-sm text-muted-foreground">{logsError}</p>
          </div>
        ) : (
          <RequestLogTable logs={requestLogs} showApiFilter={true} />
        )}
      </div>
    </div>
  );
};

export default Index;
