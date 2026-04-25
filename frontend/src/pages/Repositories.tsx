import { useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  GitBranch,
  Github,
  ExternalLink,
  Search,
  LayoutGrid,
  List,
  ArrowLeft,
  Star,
  Lock,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getApiBaseUrl } from "@/hooks/use-session";
import { useGithubRepoList } from "@/hooks/use-github-repos";
import type { GithubRepo } from "@/types/api";

const apiBaseUrl = getApiBaseUrl();

const Repositories = () => {
  const {
    repos,
    error: reposError,
    tokenInvalid,
    githubLinked,
    isSessionLoading,
    isLoading: isLoadingRepos,
    refetch: handleRetry,
  } = useGithubRepoList();

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredRepos = repos.filter(
    (repo) =>
      repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      repo.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (repo.description ?? "")
        .toLowerCase()
        .includes(searchQuery.toLowerCase()),
  );

  function handleConnectGithub() {
    window.location.href = `${apiBaseUrl}/auth/github/login?mode=link`;
  }

  function handleReconnectGithub() {
    window.location.href = `${apiBaseUrl}/auth/github/login?mode=link`;
  }

  const totalRepos = repos.length;
  const privateRepos = repos.filter((r) => r.isPrivate).length;
  const publicRepos = totalRepos - privateRepos;
  const forkRepos = repos.filter((r) => r.isFork).length;

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

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              My Repositories
            </h1>
            <p className="text-sm text-muted-foreground">
              {githubLinked
                ? "Repositories from your connected GitHub account"
                : "Connect GitHub to view your repositories"}
            </p>
          </div>
          {githubLinked ? (
            <Button
              variant="outline"
              onClick={() => void handleRetry()}
              disabled={isLoadingRepos}
            >
              {isLoadingRepos ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Refresh
            </Button>
          ) : null}
        </div>

        {isSessionLoading ? (
          <div className="card-gradient rounded-lg border border-border p-12 text-center">
            <Loader2 className="h-8 w-8 text-muted-foreground mx-auto mb-3 animate-spin" />
            <p className="text-sm text-muted-foreground">Loading your account...</p>
          </div>
        ) : !githubLinked ? (
          <div className="card-gradient rounded-lg border border-border p-10 text-center">
            <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-muted/40 flex items-center justify-center">
              <Github className="h-7 w-7 text-foreground" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Connect your GitHub account
            </h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto mb-5">
              Link GitHub to import your repositories and run API contract
              checks against them. We only request read access to your repos
              and profile.
            </p>
            <Button onClick={handleConnectGithub}>
              <Github className="h-4 w-4 mr-2" />
              Connect GitHub
            </Button>
          </div>
        ) : tokenInvalid ? (
          <div className="card-gradient rounded-lg border border-warning/30 p-10 text-center">
            <h2 className="text-lg font-semibold text-foreground mb-2">
              GitHub access expired
            </h2>
            <p className="text-sm text-muted-foreground mb-5">
              Your GitHub token is no longer valid. Reconnect to refresh
              repository access.
            </p>
            <Button onClick={handleReconnectGithub}>
              <Github className="h-4 w-4 mr-2" />
              Reconnect GitHub
            </Button>
          </div>
        ) : reposError ? (
          <div className="card-gradient rounded-lg border border-destructive/30 p-10 text-center">
            <h2 className="text-lg font-semibold text-foreground mb-2">
              Couldn’t load repositories
            </h2>
            <p className="text-sm text-muted-foreground mb-5">{reposError}</p>
            <Button variant="outline" onClick={() => void handleRetry()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search repositories..."
                  className="pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-1 border border-border rounded-md p-1">
                <Button
                  variant={viewMode === "grid" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("grid")}
                  aria-label="Grid view"
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === "list" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("list")}
                  aria-label="List view"
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="Total" value={totalRepos} />
              <StatCard label="Public" value={publicRepos} accent="success" />
              <StatCard label="Private" value={privateRepos} />
              <StatCard label="Forks" value={forkRepos} />
            </div>

            {isLoadingRepos && totalRepos === 0 ? (
              <div className="card-gradient rounded-lg border border-border p-12 text-center">
                <Loader2 className="h-8 w-8 text-muted-foreground mx-auto mb-3 animate-spin" />
                <p className="text-sm text-muted-foreground">
                  Fetching repositories from GitHub...
                </p>
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredRepos.map((repo) => (
                  <RepoGridCard key={repo.id} repo={repo} />
                ))}
              </div>
            ) : (
              <div className="card-gradient rounded-lg border border-border overflow-hidden">
                <div className="divide-y divide-border">
                  {filteredRepos.map((repo) => (
                    <RepoListRow key={repo.id} repo={repo} />
                  ))}
                </div>
              </div>
            )}

            {!isLoadingRepos && filteredRepos.length === 0 ? (
              <div className="text-center py-12">
                <GitBranch className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  No repositories found
                </h3>
                <p className="text-sm text-muted-foreground">
                  {searchQuery
                    ? "Try adjusting your search query"
                    : "Your GitHub account doesn’t have any accessible repositories yet."}
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
};

function RepoGridCard({ repo }: { repo: GithubRepo }) {
  return (
    <Link
      to={`/repositories/${repo.id}`}
      className="card-gradient rounded-lg border border-border p-5 hover:border-primary/40 transition-all group"
    >
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-muted/50 shrink-0">
            <Github className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">
              {repo.name}
            </h3>
            <p className="text-xs text-muted-foreground truncate">
              {repo.fullName}
            </p>
          </div>
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
      </div>

      {repo.description ? (
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
          {repo.description}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground/70 italic mb-3">
          No description
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {repo.isPrivate ? (
          <Badge variant="muted" className="text-[10px] gap-1">
            <Lock className="h-3 w-3" /> Private
          </Badge>
        ) : (
          <Badge variant="success" className="text-[10px]">
            Public
          </Badge>
        )}
        {repo.isFork ? (
          <Badge variant="outline" className="text-[10px]">
            Fork
          </Badge>
        ) : null}
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Star className="h-3 w-3" /> {repo.stars}
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          {formatRelative(repo.updatedAt)}
        </span>
      </div>
    </Link>
  );
}

function RepoListRow({ repo }: { repo: GithubRepo }) {
  return (
    <Link
      to={`/repositories/${repo.id}`}
      className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors"
    >
      <div className="p-2 rounded-lg bg-muted/50 shrink-0">
        <Github className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-foreground truncate">
            {repo.fullName}
          </h3>
          {repo.isPrivate ? (
            <Badge variant="muted" className="text-[10px] gap-1">
              <Lock className="h-3 w-3" /> Private
            </Badge>
          ) : null}
          {repo.isFork ? (
            <Badge variant="outline" className="text-[10px]">
              Fork
            </Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {repo.description ?? "No description"}
        </p>
      </div>
      <span
        className={cn(
          "hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground",
        )}
      >
        <Star className="h-3 w-3" /> {repo.stars}
      </span>
      <span className="hidden md:block text-xs text-muted-foreground">
        {formatRelative(repo.updatedAt)}
      </span>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground"
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
  );
}

interface StatCardProps {
  label: string;
  value: number;
  accent?: "success" | "warning" | "muted";
}

function StatCard({ label, value, accent }: StatCardProps) {
  const borderClass =
    accent === "success"
      ? "border-success/30"
      : accent === "warning"
        ? "border-warning/30"
        : "border-border";
  const valueClass =
    accent === "success"
      ? "text-success"
      : accent === "warning"
        ? "text-warning"
        : "text-foreground";

  return (
    <div className={cn("card-gradient rounded-lg border p-4", borderClass)}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-bold font-mono", valueClass)}>{value}</p>
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "—";
  }
}

export default Repositories;
