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
        {}
      </div>
    </div>
  );
};

export default Repository;
