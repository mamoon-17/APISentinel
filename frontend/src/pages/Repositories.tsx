import { useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  GitBranch,
  Plus,
  Github,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  CircleDashed,
  Search,
  LayoutGrid,
  List,
  ArrowLeft,
} from "lucide-react";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { mockRepositories } from "@/data/repositories";
import { mockApiSpecs } from "@/data/mockData";

const Repositories = () => {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [newRepoUrl, setNewRepoUrl] = useState("");

  const filteredRepos = mockRepositories.filter(
    (repo) =>
      repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      repo.url.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case "github":
        return <Github className="h-4 w-4" />;
      case "gitlab":
        return <GitBranch className="h-4 w-4" />;
      case "bitbucket":
        return <GitBranch className="h-4 w-4" />;
      default:
        return <GitBranch className="h-4 w-4" />;
    }
  };

  const getHealthStatusIcon = (status: string) => {
    switch (status) {
      case "healthy":
        return <CheckCircle2 className="h-4 w-4 text-success" />;
      case "issues":
        return <AlertTriangle className="h-4 w-4 text-warning" />;
      default:
        return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getHealthStatusLabel = (status: string) => {
    switch (status) {
      case "healthy":
        return { label: "Healthy", variant: "success" as const };
      case "issues":
        return { label: "Issues Found", variant: "warning" as const };
      default:
        return { label: "Not Checked", variant: "muted" as const };
    }
  };

  const handleLinkRepository = () => {
    // In a real app, this would make an API call
    console.log("Linking repository:", newRepoUrl);
    setNewRepoUrl("");
    setIsLinkDialogOpen(false);
  };

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

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Linked Repositories
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage your connected repositories and check API contract
              compliance
            </p>
          </div>
          <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Link Repository
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Link a Repository</DialogTitle>
                <DialogDescription>
                  Enter the URL of the repository you want to link. We support
                  GitHub, GitLab, and Bitbucket.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <Input
                  placeholder="https://github.com/org/repo"
                  value={newRepoUrl}
                  onChange={(e) => setNewRepoUrl(e.target.value)}
                />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsLinkDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleLinkRepository} disabled={!newRepoUrl}>
                  Link Repository
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Search and View Controls */}
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
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Repository Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="card-gradient rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">Total Repositories</p>
            <p className="text-2xl font-bold font-mono text-foreground">
              {mockRepositories.length}
            </p>
          </div>
          <div className="card-gradient rounded-lg border border-success/30 p-4">
            <p className="text-sm text-muted-foreground">Healthy</p>
            <p className="text-2xl font-bold font-mono text-success">
              {
                mockRepositories.filter((r) => r.healthStatus === "healthy")
                  .length
              }
            </p>
          </div>
          <div className="card-gradient rounded-lg border border-warning/30 p-4">
            <p className="text-sm text-muted-foreground">With Issues</p>
            <p className="text-2xl font-bold font-mono text-warning">
              {
                mockRepositories.filter((r) => r.healthStatus === "issues")
                  .length
              }
            </p>
          </div>
          <div className="card-gradient rounded-lg border border-border p-4">
            <p className="text-sm text-muted-foreground">Unchecked</p>
            <p className="text-2xl font-bold font-mono text-muted-foreground">
              {
                mockRepositories.filter((r) => r.healthStatus === "unchecked")
                  .length
              }
            </p>
          </div>
        </div>

        {/* Repository List/Grid */}
        {viewMode === "grid" ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredRepos.map((repo) => {
              const linkedSpec = repo.linkedSpecId
                ? mockApiSpecs.find((s) => s.id === repo.linkedSpecId)
                : null;
              const healthStatus = getHealthStatusLabel(repo.healthStatus);

              return (
                <Link
                  key={repo.id}
                  to={`/repositories/${repo.id}`}
                  className="card-gradient rounded-lg border border-border p-5 hover:border-primary/40 transition-all group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-muted/50">
                        {getProviderIcon(repo.provider)}
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                          {repo.name}
                        </h3>
                        <p className="text-xs text-muted-foreground capitalize">
                          {repo.provider}
                        </p>
                      </div>
                    </div>
                    {getHealthStatusIcon(repo.healthStatus)}
                  </div>

                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Status</span>
                      <Badge variant={healthStatus.variant}>
                        {healthStatus.label}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Linked Spec</span>
                      <span className="font-mono text-xs text-foreground">
                        {linkedSpec ? linkedSpec.name : "Not linked"}
                      </span>
                    </div>

                    {repo.lastHealthCheck && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">
                          Last Check
                        </span>
                        <span className="text-xs text-foreground">
                          {formatDistanceToNow(repo.lastHealthCheck, {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                    )}

                    <div className="pt-2 border-t border-border/50">
                      <p className="text-xs text-muted-foreground truncate font-mono">
                        {repo.url}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="card-gradient rounded-lg border border-border overflow-hidden">
            <div className="divide-y divide-border">
              {filteredRepos.map((repo) => {
                const linkedSpec = repo.linkedSpecId
                  ? mockApiSpecs.find((s) => s.id === repo.linkedSpecId)
                  : null;
                const healthStatus = getHealthStatusLabel(repo.healthStatus);

                return (
                  <Link
                    key={repo.id}
                    to={`/repositories/${repo.id}`}
                    className="flex items-center gap-4 px-6 py-4 hover:bg-muted/30 transition-colors"
                  >
                    <div className="p-2 rounded-lg bg-muted/50">
                      {getProviderIcon(repo.provider)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-foreground">
                          {repo.name}
                        </h3>
                        <Badge
                          variant={healthStatus.variant}
                          className="text-xs"
                        >
                          {healthStatus.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate font-mono">
                        {repo.url}
                      </p>
                    </div>
                    <div className="hidden sm:block text-sm text-muted-foreground">
                      {linkedSpec ? (
                        <span>Linked to {linkedSpec.name}</span>
                      ) : (
                        <span className="italic">No spec linked</span>
                      )}
                    </div>
                    <div className="hidden md:block text-xs text-muted-foreground">
                      {repo.lastHealthCheck
                        ? `Checked ${formatDistanceToNow(repo.lastHealthCheck, { addSuffix: true })}`
                        : "Never checked"}
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {filteredRepos.length === 0 && (
          <div className="text-center py-12">
            <GitBranch className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              No repositories found
            </h3>
            <p className="text-sm text-muted-foreground">
              {searchQuery
                ? "Try adjusting your search query"
                : "Link your first repository to get started"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Repositories;
