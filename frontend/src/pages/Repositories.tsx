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

const Repository = () => {
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

        {/* Repository List/Grid */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Search repositories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-64"
              />
              <Button
                variant={viewMode === "grid" ? "default" : "outline"}
                size="icon"
                onClick={() => setViewMode("grid")}
                aria-label="Grid view"
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "default" : "outline"}
                size="icon"
                onClick={() => setViewMode("list")}
                aria-label="List view"
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
            <span className="text-sm text-muted-foreground">
              {filteredRepos.length} repositories
            </span>
          </div>
          {filteredRepos.length === 0 ? (
            <div className="text-center text-muted-foreground py-12">
              <Search className="mx-auto mb-2 h-8 w-8" />
              <p>No repositories found.</p>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
              {filteredRepos.map((repo) => {
                const health = getHealthStatusLabel(repo.healthStatus);
                return (
                  <div
                    key={repo.id}
                    className="bg-card rounded-lg shadow p-5 flex flex-col gap-3"
                  >
                    <div className="flex items-center gap-2">
                      {getProviderIcon(repo.provider)}
                      <span className="font-semibold text-lg">{repo.name}</span>
                      <Badge variant={health.variant}>{health.label}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground truncate">
                      {repo.url}
                    </div>
                    <div className="flex items-center gap-2 mt-auto">
                      <span className="text-xs">
                        Linked{" "}
                        {formatDistanceToNow(new Date(repo.linkedAt), {
                          addSuffix: true,
                        })}
                      </span>
                      <a
                        href={repo.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto"
                        aria-label="Open repository"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                      <Link
                        to={`/repositories/${repo.id}`}
                        className="ml-2"
                        aria-label="View details"
                      >
                        <Button size="icon" variant="ghost">
                          <ArrowLeft className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredRepos.map((repo) => {
                const health = getHealthStatusLabel(repo.healthStatus);
                return (
                  <div
                    key={repo.id}
                    className="flex items-center gap-4 bg-card rounded-md px-4 py-3 shadow"
                  >
                    {getProviderIcon(repo.provider)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{repo.name}</span>
                        <Badge variant={health.variant}>{health.label}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {repo.url}
                      </div>
                    </div>
                    <span className="text-xs">
                      Linked{" "}
                      {formatDistanceToNow(new Date(repo.linkedAt), {
                        addSuffix: true,
                      })}
                    </span>
                    <a
                      href={repo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open repository"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                    <Link
                      to={`/repositories/${repo.id}`}
                      aria-label="View details"
                    >
                      <Button size="icon" variant="ghost">
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Repository;
