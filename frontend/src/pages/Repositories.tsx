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
};

export default Repositories;
