import { useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  GitBranch,
  Github,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  CircleDashed,
  Activity,
  FileJson,
  Link2,
  XCircle,
  Trash2,
  Loader2,
} from "lucide-react";
import { Header } from "@/components/Header";
import { MethodBadge } from "@/components/MethodBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { mockRepositories, mockHealthData } from "@/data/repositories";
import { mockApiSpecs } from "@/data/mockData";

const RepositoryDetail = () => {
  const { id } = useParams<{ id: string }>();
  const repository = mockRepositories.find((r) => r.id === id);

  if (!repository) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-16 text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Repository Not Found
          </h2>
          <Link to="/repositories">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to Repositories
            </Button>
          </Link>
        </div>
      </div>
    );
  }
};

export default RepositoryDetail;
