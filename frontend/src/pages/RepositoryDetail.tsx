import { type ChangeEvent, useEffect, useRef, useState } from "react";
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
  Loader2,
  Sparkles,
  Download,
  CheckCheck,
  Trash2,
  ChevronDown,
  ChevronRight,
  Check,
  X,
} from "lucide-react";
import { Header } from "@/components/Header";
import { MethodBadge } from "@/components/MethodBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import { computeJsonDiff } from "@/lib/diff";
import { useGithubRepoList } from "@/hooks/use-github-repos";
import { useSpecs } from "@/hooks/use-specs";
import { getApiBaseUrl } from "@/hooks/use-session";
import {
  SPECS_GENERATE_FROM_REPO_API_PATH,
  REPO_SPEC_LINKS_API_PATH,
  REPO_SPEC_LINK_DELETE_API_PATH,
  REPO_DETECT_SPEC_API_PATH,
  REPO_DETECT_FRONTEND_API_PATH,
  REPO_LLM_FRONTEND_BACKEND_API_PATH,
} from "@/lib/api-paths";
import type {
  ApiSpec,
  RepositoryHealthData,
  RepositorySpecLinkPayload,
} from "@/types/api";

interface RepositoryStateResponse {
  link: RepositorySpecLinkPayload | null;
  latestJob: unknown | null;
  latestResult: unknown | null;
}


const RepositoryDetail = () => {
  const { id } = useParams<{ id: string }>();
  const {
    repos,
    isLoading,
    error,
    githubLinked,
    tokenInvalid,
    scopeInsufficient,
    refetch,
  } = useGithubRepoList();
  const repository = id ? repos.find((r) => r.id === id) : undefined;
  const [healthData, setHealthData] = useState<RepositoryHealthData | null>(
    null,
  );
  const [healthError, setHealthError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [linkedSpecMeta, setLinkedSpecMeta] =
    useState<RepositorySpecLinkPayload | null>(null);
  const [isHydratingState, setIsHydratingState] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);

  const [frontendDetected, setFrontendDetected] = useState<{
    hasFrontend: boolean;
    frontendType?: string;
    frontendRoot?: string;
    evidence?: string[];
  } | null>(null);
  const [isDetectingFrontend, setIsDetectingFrontend] = useState(false);

  const [expandedEndpointKeys, setExpandedEndpointKeys] = useState<string[]>(
    [],
  );

  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [selectedSpecId, setSelectedSpecId] = useState<string | undefined>(
    undefined,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [deleteVersionId, setDeleteVersionId] = useState<string | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [specActionError, setSpecActionError] = useState<string | null>(null);

  // Spec link state
  const [repoLinks, setRepoLinks] = useState<Array<{ id: string; specId: string; specName: string; linkedAt: string }>>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [detectedSpec, setDetectedSpec] = useState<{ filePath: string; content: string } | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);

  // Generate from repo state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generatedSpecs, setGeneratedSpecs] = useState<{
    accurateSpec: string;
    violationSpec: string;
    summary: string;
  } | null>(null);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);

  // AI (LLM) frontend ↔ backend verification state
  const [aiHealthData, setAiHealthData] = useState<RepositoryHealthData | null>(null);
  const [isAiScanning, setIsAiScanning] = useState(false);
  const [aiScanError, setAiScanError] = useState<string | null>(null);
  const [useAiResults, setUseAiResults] = useState(false);
  const {
    specs,
    isLoading: isSpecsLoading,
    error: specsError,
    uploadSpecFile,
    deleteVersion,
  } = useSpecs();

  useEffect(() => {
    // Spec selection is scoped to the current repository detail page.
    setSelectedSpecId(undefined);
    setSpecActionError(null);
  }, [id]);

  useEffect(() => {
    // When navigating directly, ensure we refetch once.
    if (githubLinked && repos.length === 0 && !isLoading && !error) {
      void refetch();
    }
  }, [githubLinked, repos.length, isLoading, error, refetch]);

  useEffect(() => {
    if (!repository || !githubLinked) {
      return;
    }

    let isCancelled = false;

    const hydrateRepositoryState = async () => {
      setIsHydratingState(true);
      setJobError(null);

      try {
        const response = await fetch(
          `${getApiBaseUrl()}/health-checks/repositories/${repository.id}/state`,
          {
            credentials: "include",
          },
        );

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as RepositoryStateResponse;
        if (isCancelled) {
          return;
        }

        if (payload.link) {
          setLinkedSpecMeta(payload.link);
          setSelectedSpecId(payload.link.specId);
        }
      } catch {
        // Keep the page usable even if state hydration fails.
      } finally {
        if (!isCancelled) {
          setIsHydratingState(false);
        }
      }
    };

    void hydrateRepositoryState();

    return () => {
      isCancelled = true;
    };
  }, [githubLinked, repository]);

  useEffect(() => {
    if (!id || !githubLinked || !repository) {
      setIsDetectingFrontend(false);
      return;
    }

    let isCancelled = false;

    const detectFrontend = async () => {
      setIsDetectingFrontend(true);
      setFrontendDetected(null);

      try {
        const response = await fetch(
          `${getApiBaseUrl()}${REPO_DETECT_FRONTEND_API_PATH(id)}`,
          { credentials: "include" },
        );

        if (!response.ok) {
          if (!isCancelled) {
            setFrontendDetected(null);
          }
          return;
        }

        const data = (await response.json()) as {
          hasFrontend: boolean;
          frontendType?: string;
          frontendRoot?: string;
          evidence?: string[];
        };

        if (!isCancelled) {
          setFrontendDetected(data);
        }
      } catch {
        if (!isCancelled) {
          setFrontendDetected(null);
        }
      } finally {
        if (!isCancelled) {
          setIsDetectingFrontend(false);
        }
      }
    };

    void detectFrontend();

    return () => {
      isCancelled = true;
    };
  }, [id, githubLinked, repository]);

  // Fetch existing spec links whenever the repo changes
  useEffect(() => {
    if (!id) return;
    void fetch(`${getApiBaseUrl()}${REPO_SPEC_LINKS_API_PATH(id)}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((data: unknown) => setRepoLinks(Array.isArray(data) ? data : []))
      .catch(() => setRepoLinks([]));
  }, [id]);

  if (!githubLinked) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-16 text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Connect GitHub to view repositories
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

  if (tokenInvalid) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-16 text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            GitHub access expired
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            Reconnect GitHub in Settings, then try again.
          </p>
          <Link to="/repositories">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to Repositories
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (scopeInsufficient) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-16 text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            GitHub permission update required
          </h2>
          <p className="text-sm text-muted-foreground mb-6">
            Reconnect GitHub in Settings so private repositories can be listed.
          </p>
          <Link to="/repositories">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to Repositories
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading && !repository) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-16 text-center">
          <Loader2 className="h-8 w-8 text-muted-foreground mx-auto mb-3 animate-spin" />
          <p className="text-sm text-muted-foreground">Loading repository...</p>
        </div>
      </div>
    );
  }

  if (error && !repository) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container py-16 text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Couldn’t load repository
          </h2>
          <p className="text-sm text-muted-foreground mb-6">{error}</p>
          <Link to="/repositories">
            <Button variant="outline">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to Repositories
            </Button>
          </Link>
        </div>
      </div>
    );
  }

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

  const linkedSpec = selectedSpecId
    ? specs.find((s) => s.id === selectedSpecId)
    : null;
  const selectedSpecIsAnalyzable = (linkedSpec?.totalEndpoints ?? 0) > 0;
  const isSpecComparison = Boolean(selectedSpecId);

  const lineStyles: Record<string, string> = {
    match: "text-foreground",
    error: "text-destructive bg-destructive/10",
    warning: "text-warning bg-warning/10",
    missing: "text-muted-foreground bg-muted/30 line-through",
  };

  // When AI scan results are enabled, render those instead of the static scan.
  const displayHealthData =
    useAiResults && aiHealthData ? aiHealthData : healthData;

  const effectiveHealthStatus: "healthy" | "issues" | "unchecked" = displayHealthData
    ? displayHealthData.inconsistencies.length > 0
      ? "issues"
      : "healthy"
    : "unchecked";
  const inSpecCount = displayHealthData
    ? displayHealthData.endpointUsage.filter((endpoint) => endpoint.inSpec).length
    : 0;
  const notInSpecCount = displayHealthData
    ? displayHealthData.endpointUsage.filter((endpoint) => !endpoint.inSpec).length
    : 0;
  const totalBackendEndpoints = displayHealthData
    ? displayHealthData.endpointUsage.length
    : 0;
  const linkedAt = linkedSpec ? new Date(linkedSpec.updatedAt) : null;

  const repositoryVm = {
    id: repository.id,
    name: repository.name,
    fullName: repository.fullName,
    url: repository.url,
    provider: "github" as const,
    lastHealthCheck: undefined as Date | undefined,
    healthStatus: "unchecked" as const,
  };

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case "github":
        return <Github className="h-6 w-6" />;
      default:
        return <GitBranch className="h-6 w-6" />;
    }
  };

  function getHealthStatusBadge(
    status: "healthy" | "issues" | "unchecked" | "checking",
  ) {
    switch (status) {
      case "healthy":
        return <Badge variant="success">Healthy</Badge>;
      case "issues":
        return <Badge variant="warning">Issues Found</Badge>;
      case "checking":
        return (
          <Badge variant="muted" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Running
          </Badge>
        );
      default:
        return <Badge variant="muted">Not Checked</Badge>;
    }
  }

  const handleCheckHealth = async () => {
    if (!id || !repository) return;
    setSpecActionError(null);
    setJobError(null);
    setHealthError(null);
    setAiHealthData(null);
    setUseAiResults(false);
    setAiScanError(null);
    setIsChecking(true);

    try {
      const url = new URL(
        `${getApiBaseUrl()}/repositories/${repository.id}/inconsistencies`,
      );
      if (selectedSpecId) {
        url.searchParams.set("specId", selectedSpecId);
      }

      const response = await fetch(url.toString(), {
        credentials: "include",
      });

      const payload = (await response.json().catch(() => null)) as any;
      if (!response.ok) {
        setHealthError(payload?.message ?? "Unable to start repository analysis.");
        return;
      }

      // Backend payload matches RepositoryHealthData closely; normalize dates.
      setHealthData({
        repositoryId: payload.repositoryId,
        lastCheckedAt: new Date(payload.analyzedAt),
        totalApiCalls: payload.totalApiCalls ?? 0,
        endpointUsage: Array.isArray(payload.endpointUsage)
          ? payload.endpointUsage.map((u: any) => ({
              endpoint: u.endpoint,
              method: u.method,
              callCount: u.callCount ?? 0,
              lastCalledAt: payload.analyzedAt
                ? new Date(payload.analyzedAt)
                : undefined,
              inSpec: Boolean(u.inSpec),
              expectedRequestBodySchema: u.expectedRequestBodySchema,
              receivedRequestBodySchema: u.receivedRequestBodySchema,
            }))
          : [],
        inconsistencies: Array.isArray(payload.inconsistencies)
          ? payload.inconsistencies
          : [],
      });
    } catch {
      setHealthError("Network error — could not reach backend");
    } finally {
      setIsChecking(false);
    }
  };

  const runAiScan = async () => {
    if (!id || !repository) return;
    if (aiHealthData) {
      setUseAiResults(true);
      return;
    }
    setIsAiScanning(true);
    setAiScanError(null);
    try {
      const response = await fetch(
        `${getApiBaseUrl()}${REPO_LLM_FRONTEND_BACKEND_API_PATH(id)}`,
        { credentials: "include" },
      );
      const payload = (await response.json().catch(() => null)) as any;
      if (!response.ok) {
        setAiScanError(payload?.message ?? "AI analysis failed.");
        return;
      }
      setAiHealthData({
        repositoryId: payload.repositoryId,
        lastCheckedAt: new Date(payload.analyzedAt),
        totalApiCalls: payload.totalApiCalls ?? 0,
        endpointUsage: Array.isArray(payload.endpointUsage)
          ? payload.endpointUsage.map((u: any) => ({
              endpoint: u.endpoint,
              method: u.method,
              callCount: u.callCount ?? 0,
              lastCalledAt: payload.analyzedAt
                ? new Date(payload.analyzedAt)
                : undefined,
              inSpec: Boolean(u.inSpec),
              expectedRequestBodySchema: u.expectedRequestBodySchema,
              receivedRequestBodySchema: u.receivedRequestBodySchema,
            }))
          : [],
        inconsistencies: Array.isArray(payload.inconsistencies)
          ? payload.inconsistencies
          : [],
      });
      setUseAiResults(true);
    } catch {
      setAiScanError("Network error — could not reach backend");
    } finally {
      setIsAiScanning(false);
    }
  };

  const handleLinkSpec = async () => {
    if (!id || !selectedSpecId) return;
    try {
      const res = await fetch(`${getApiBaseUrl()}${REPO_SPEC_LINKS_API_PATH(id)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specId: selectedSpecId }),
      });
      const data = await res.json().catch(() => null) as any;
      if (res.ok && data) {
        setRepoLinks(prev => [...prev.filter(l => l.specId !== data.specId), data]);
      }
    } catch { /* ignore */ }
    setIsLinkDialogOpen(false);
    setJobError(null);
  };

  const handleUnlinkSpec = async (specId: string) => {
    if (!id) return;
    await fetch(`${getApiBaseUrl()}${REPO_SPEC_LINK_DELETE_API_PATH(id, specId)}`, {
      method: "DELETE",
      credentials: "include",
    });
    setRepoLinks(prev => prev.filter(l => l.specId !== specId));
  };

  const handleDetectSpec = async () => {
    if (!id) return;
    setIsDetecting(true);
    setDetectError(null);
    setDetectedSpec(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}${REPO_DETECT_SPEC_API_PATH(id)}`, { credentials: "include" });
      const data = await res.json().catch(() => null) as any;
      if (!res.ok) { setDetectError(data?.message ?? "No spec file found in this repository"); return; }
      setDetectedSpec(data);
    } catch { setDetectError("Network error"); }
    finally { setIsDetecting(false); }
  };

  const handleUploadDetectedSpec = async () => {
    if (!detectedSpec) return;
    try {
      setSpecActionError(null);
      const file = new File([detectedSpec.content], detectedSpec.filePath.split("/").pop() ?? "openapi.yaml", { type: "text/yaml" });
      const uploaded = await uploadSpecFile(file);
      setSelectedSpecId(uploaded.specId);
      setDetectedSpec(null);
    } catch (error) {
      setSpecActionError(error instanceof Error ? error.message : "Failed to upload detected spec");
    }
  };

  const handleGenerateFromRepo = async () => {
    if (!id) return;
    setIsGenerating(true);
    setGenerateError(null);
    setGeneratedSpecs(null);
    try {
      const res = await fetch(
        `${getApiBaseUrl()}${SPECS_GENERATE_FROM_REPO_API_PATH(id)}`,
        { credentials: "include" },
      );
      const data = await res.json().catch(() => null) as any;
      if (!res.ok) {
        setGenerateError(data?.message ?? "Generation failed");
        return;
      }
      setGeneratedSpecs(data);
      setIsGenerateModalOpen(true);
    } catch {
      setGenerateError("Network error — could not reach backend");
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadSpec = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const uploadGeneratedSpec = async (content: string, label: string) => {
    try {
      setSpecActionError(null);
      const file = new File([content], `${label}.yaml`, { type: "text/yaml" });
      const uploaded = await uploadSpecFile(file);
      setSelectedSpecId(uploaded.specId);
      setIsGenerateModalOpen(false);
    } catch (error) {
      setSpecActionError(
        error instanceof Error ? error.message : `Failed to upload ${label} spec`,
      );
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      setSpecActionError(null);
      const uploaded = await uploadSpecFile(file);
      setSelectedSpecId(uploaded.specId);
    } catch (error) {
      setSpecActionError(
        error instanceof Error ? error.message : "Failed to upload spec",
      );
    }
  };

  const openDeleteConfirm = (versionId: string) => {
    setDeleteVersionId(versionId);
    setIsDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = () => {
    if (!deleteVersionId) return;
    void deleteVersion(deleteVersionId);
    if (selectedSpecId === deleteVersionId) {
      setSelectedSpecId(undefined);
    }
    setIsDeleteConfirmOpen(false);
    setDeleteVersionId(null);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container py-6 space-y-6">
        <Link
          to="/repositories"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Repositories
        </Link>

        <div className="card-gradient rounded-lg border border-border p-6">
          <div className="flex flex-col lg:flex-row lg:items-start gap-6">
            <div className="flex items-start gap-4 flex-1">
              <div className="rounded-lg p-3 bg-primary/10">
                {getProviderIcon(repositoryVm.provider)}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <h1 className="text-2xl font-bold text-foreground">
                    {repositoryVm.fullName}
                  </h1>
                  {getHealthStatusBadge(effectiveHealthStatus)}
                </div>
                <a
                  href={repositoryVm.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
                >
                  <span className="font-mono">{repositoryVm.url}</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
                <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                  <span>
                    {linkedAt
                      ? `Linked: ${formatDistanceToNow(linkedAt, {
                          addSuffix: true,
                        })}`
                      : "No spec linked"}
                  </span>
                  {displayHealthData?.lastCheckedAt ? (
                    <span>
                      Last checked:{" "}
                      {formatDistanceToNow(displayHealthData.lastCheckedAt, {
                        addSuffix: true,
                      })}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Dialog
                open={isLinkDialogOpen}
                onOpenChange={setIsLinkDialogOpen}
              >
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Link2 className="h-4 w-4 mr-2" />
                    {linkedSpec ? "Change Spec (Backend vs Spec)" : "Link Spec (Backend vs Spec)"}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Link spec for backend comparison</DialogTitle>
                    <DialogDescription>
                      Select an OpenAPI specification to compare against what we detect in your <strong>backend</strong> code.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="py-4">
                    {specActionError ? (
                      <p className="mb-3 text-sm text-destructive">
                        {specActionError}
                      </p>
                    ) : null}
                    {specsError ? (
                      <p className="mb-3 text-sm text-destructive">
                        {specsError}
                      </p>
                    ) : null}
                    <div className="border border-border rounded-md max-h-[220px] overflow-y-auto">
                      {isSpecsLoading ? (
                        <div className="px-3 py-3 text-sm text-muted-foreground">
                          Loading specifications...
                        </div>
                      ) : specs.length === 0 ? (
                        <div className="px-3 py-3 text-sm text-muted-foreground">
                          No specifications uploaded yet.
                        </div>
                      ) : (
                        specs.map((spec) => (
                          <div
                            key={spec.id}
                            className={cn(
                              "flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors",
                              selectedSpecId === spec.id && "bg-primary/20",
                            )}
                          >
                            <div
                              className="flex items-center gap-2 flex-1"
                              onClick={() => {
                                if (spec.totalEndpoints === 0) {
                                  setSpecActionError(
                                    "This spec has 0 endpoints and cannot be used for health analysis.",
                                  );
                                  return;
                                }
                                setSpecActionError(null);
                                setSelectedSpecId(spec.id);
                              }}
                            >
                              <FileJson className="h-4 w-4" />
                              <span>{spec.name}</span>
                              <span className="text-muted-foreground text-xs">
                                ({spec.activeVersion ?? "no active version"})
                              </span>
                              {spec.totalEndpoints === 0 ? (
                                <span className="text-destructive text-xs">
                                  invalid (0 endpoints)
                                </span>
                              ) : null}
                            </div>
                            {spec.activeVersionId ? (
                              <span
                                className="text-destructive cursor-pointer px-2 hover:text-destructive/80"
                                onClick={() =>
                                  openDeleteConfirm(spec.activeVersionId)
                                }
                              >
                                −
                              </span>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".yaml,.yml,.json"
                      onChange={handleFileChange}
                      style={{ display: "none" }}
                    />
                    <div className="mt-3 flex flex-wrap gap-2 items-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleUploadClick}
                      >
                        <FileJson className="h-4 w-4 mr-2" />
                        Upload Spec
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleDetectSpec()}
                        disabled={isDetecting}
                        className="border-emerald-500/40 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/30"
                      >
                        {isDetecting
                          ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          : <CheckCheck className="h-4 w-4 mr-2" />
                        }
                        {isDetecting ? "Scanning repo…" : "Detect Spec"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleGenerateFromRepo()}
                        disabled={isGenerating}
                        className="border-primary/40 text-primary hover:bg-primary/10"
                      >
                        {isGenerating
                          ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          : <Sparkles className="h-4 w-4 mr-2" />
                        }
                        {isGenerating ? "Analysing repo…" : "Generate from Repo"}
                      </Button>
                      {generateError && (
                        <span className="text-xs text-destructive">{generateError}</span>
                      )}
                    </div>

                    {/* Auto-detect result banner */}
                    {detectError && (
                      <div className="mt-2 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <span>{detectError}</span>
                      </div>
                    )}
                    {detectedSpec && (
                      <div className="mt-3 p-3 rounded-lg border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/20 flex items-start gap-3">
                        <CheckCheck className="h-4 w-4 mt-0.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                            Spec detected: <code className="font-mono">{detectedSpec.filePath}</code>
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Found an OpenAPI file in this repository. Upload it now to start analysis.
                          </p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => {
                            const blob = new Blob([detectedSpec.content], { type: "text/yaml" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url; a.download = detectedSpec.filePath.split("/").pop() ?? "openapi.yaml"; a.click();
                            URL.revokeObjectURL(url);
                          }}>
                            <Download className="h-3 w-3 mr-1" /> Download
                          </Button>
                          <Button size="sm" className="h-7 text-xs" onClick={() => void handleUploadDetectedSpec()}>
                            Upload
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Linked specs list */}
                    {repoLinks.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs text-muted-foreground font-medium mb-1.5">Linked specs</p>
                        <div className="flex flex-col gap-1">
                          {repoLinks.map((link) => (
                            <div key={link.id} className="flex items-center justify-between rounded-md border px-3 py-1.5 text-xs">
                              <span className="font-medium truncate mr-2">{link.specName}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-muted-foreground">{new Date(link.linkedAt).toLocaleDateString()}</span>
                                <button
                                  className="text-destructive hover:underline"
                                  onClick={() => void handleUnlinkSpec(link.specId)}
                                >
                                  Unlink
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <Dialog
                    open={isDeleteConfirmOpen}
                    onOpenChange={setIsDeleteConfirmOpen}
                  >
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Delete Spec Version</DialogTitle>
                        <DialogDescription>
                          Are you sure you want to delete this specification
                          version? This action cannot be undone.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => setIsDeleteConfirmOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={handleConfirmDelete}
                        >
                          Delete
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  {/* Generated Spec Result Modal */}
                  <Dialog open={isGenerateModalOpen} onOpenChange={setIsGenerateModalOpen}>
                    <DialogContent className="max-w-2xl">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <Sparkles className="h-5 w-5 text-primary" />
                          Specs Generated from Repository
                        </DialogTitle>
                        <DialogDescription>
                          {generatedSpecs?.summary}
                        </DialogDescription>
                      </DialogHeader>

                      <div className="space-y-4 py-2">
                        {/* Accurate spec */}
                        <div className="rounded-lg border border-border p-4 space-y-3">
                          <div className="flex items-center gap-2">
                            <CheckCheck className="h-4 w-4 text-green-400" />
                            <p className="font-medium text-sm text-foreground">Accurate Spec</p>
                            <span className="text-xs text-muted-foreground">— matches what the repo actually does. Running AI analysis should give 0 violations.</span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => downloadSpec(generatedSpecs?.accurateSpec ?? "", "accurate-spec")}
                            >
                              <Download className="h-3.5 w-3.5 mr-1.5" />
                              Download YAML
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => void uploadGeneratedSpec(generatedSpecs?.accurateSpec ?? "", "accurate-spec")}
                            >
                              Upload to APISentinel
                            </Button>
                          </div>
                        </div>

                        {/* Violation spec */}
                        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-destructive" />
                            <p className="font-medium text-sm text-foreground">Violation Spec</p>
                            <span className="text-xs text-muted-foreground">— intentionally broken. Running AI analysis will show multiple violations.</span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => downloadSpec(generatedSpecs?.violationSpec ?? "", "violation-spec")}
                            >
                              <Download className="h-3.5 w-3.5 mr-1.5" />
                              Download YAML
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => void uploadGeneratedSpec(generatedSpecs?.violationSpec ?? "", "violation-spec")}
                            >
                              Upload to APISentinel
                            </Button>
                          </div>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>

                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setIsLinkDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => void handleLinkSpec()}
                      disabled={!selectedSpecId || !selectedSpecIsAnalyzable}
                    >
                      Link Spec for Backend Comparison
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Button
                onClick={handleCheckHealth}
                disabled={isChecking}
              >
                {isChecking ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Checking...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Check Repo Health
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="muted" className="font-mono">
              Mode:{" "}
              <span className="text-foreground font-medium">
                {selectedSpecId ? "Backend ↔ Spec" : "Frontend ↔ Backend"}
              </span>
            </Badge>
            {isDetectingFrontend ? (
              <Badge variant="muted" className="gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" />
                Detecting frontend...
              </Badge>
            ) : frontendDetected ? (
              frontendDetected.hasFrontend ? (
                <Badge variant="success">
                  {frontendDetected.frontendType
                    ? `${frontendDetected.frontendType} frontend`
                    : "Frontend detected"}
                  {frontendDetected.frontendRoot ? ` · ${frontendDetected.frontendRoot}` : ""}
                </Badge>
              ) : (
                <Badge variant="warning">No frontend detected</Badge>
              )
            ) : null}
            <span>
              {selectedSpecId
                ? "This run compares backend routes and schemas against the linked OpenAPI spec."
                : "This run compares frontend HTTP calls against backend route declarations (no spec required)."}
            </span>
          </div>

          {linkedSpec ? (
            <div className="mt-6 p-4 rounded-lg bg-muted/30 border border-border/50">
              <div className="flex items-center gap-3">
                <FileJson className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Linked to: {linkedSpec.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Version {linkedSpec.activeVersion ?? "n/a"} •{" "}
                    {linkedSpec.totalEndpoints} endpoints
                  </p>
                </div>
                <Link
                  to={`/spec/${linkedSpec.id}?repositoryId=${repositoryVm.id}`}
                  className="ml-auto"
                >
                  <Button variant="ghost" size="sm">
                    View Spec
                  </Button>
                </Link>
              </div>
            </div>
          ) : null}

          {jobError ? (
            <p className="mt-4 text-sm text-destructive">{jobError}</p>
          ) : null}
        </div>

        {/* Health Check Results */}
        {healthError && !isChecking && (
          <div className="card-gradient rounded-lg border border-destructive/40 bg-destructive/5 p-6 flex items-start gap-4">
            <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-destructive mb-1">
                Health check failed
              </p>
              <p className="text-sm text-muted-foreground">{healthError}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCheckHealth}
              disabled={false}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        )}

        {isHydratingState ? (
          <div className="card-gradient rounded-lg border border-border p-12 text-center">
            <Loader2 className="h-10 w-10 text-primary mx-auto mb-4 animate-spin" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Loading repository checks
            </h3>
            <p className="text-sm text-muted-foreground">
              Restoring previous health check state and linked spec.
            </p>
          </div>
        ) : null}

        {!healthData && !isChecking && !isHydratingState ? (
          <div className="card-gradient rounded-lg border border-border p-12 text-center">
            <CircleDashed className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              No Health Data Available
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Click "Check Repo Health" to scan this repo. You can run this with
              or without a linked spec.
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              {selectedSpecId ? (
                <>
                  You are comparing <span className="font-medium text-foreground">backend</span>{" "}
                  against the linked <span className="font-medium text-foreground">OpenAPI spec</span>.
                </>
              ) : (
                <>
                  You are comparing <span className="font-medium text-foreground">frontend calls</span>{" "}
                  against <span className="font-medium text-foreground">backend routes</span> (no spec).
                </>
              )}
            </p>
            <Button onClick={handleCheckHealth} disabled={false}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Check Repo Health
            </Button>
          </div>
        ) : null}

        {isChecking ? (
          <div className="card-gradient rounded-lg border border-border p-12 text-center">
            <Loader2 className="h-12 w-12 text-primary mx-auto mb-4 animate-spin" />
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Analyzing Repository...
            </h3>
            <p className="text-sm text-muted-foreground">
              Scan job is running in the background queue. This view will update
              automatically when the job finishes.
            </p>
          </div>
        ) : null}

        {healthData && !isChecking ? (
          <Tabs defaultValue="usage" className="space-y-4">
            <TabsList className="bg-card border border-border">
              <TabsTrigger value="usage">API Usage</TabsTrigger>
              <TabsTrigger value="inconsistencies" className="relative">
                Inconsistencies
                {displayHealthData && displayHealthData.inconsistencies.length > 0 ? (
                  <span className="ml-2 px-1.5 py-0.5 text-xs font-medium bg-destructive text-destructive-foreground rounded-full">
                    {displayHealthData.inconsistencies.length}
                  </span>
                ) : null}
              </TabsTrigger>
            </TabsList>

            {/* AI Analysis toggle banner — only meaningful in Frontend ↔ Backend mode */}
            {!isSpecComparison ? (
              <div className="card-gradient rounded-lg border border-border p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground flex items-center gap-2">
                    {useAiResults ? (
                      <>
                        <Sparkles className="h-4 w-4 text-primary" />
                        Showing AI-verified analysis
                      </>
                    ) : (
                      <>Static analysis (regex + AST)</>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {useAiResults
                      ? "GPT-4.1-mini re-verified each detected schema mismatch by reading the route handlers."
                      : "Static signals only. Run AI analysis for higher-trust verification of body mismatches."}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {useAiResults && (
                    <button
                      onClick={() => setUseAiResults(false)}
                      className="text-xs text-muted-foreground hover:text-foreground px-3 py-1 rounded border border-border hover:bg-muted/30"
                    >
                      Back to static
                    </button>
                  )}
                  <button
                    onClick={() => void runAiScan()}
                    disabled={isAiScanning}
                    className="text-xs text-primary hover:text-primary/80 px-3 py-1 rounded border border-primary/30 hover:bg-primary/10 disabled:opacity-50 flex items-center gap-1"
                  >
                    {isAiScanning && <Loader2 className="h-3 w-3 animate-spin" />}
                    {isAiScanning
                      ? "Analysing..."
                      : aiHealthData
                        ? useAiResults
                          ? "AI Analysis Ready"
                          : "Show AI Analysis"
                        : "Run AI Analysis"}
                  </button>
                </div>
              </div>
            ) : null}

            {aiScanError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                <p className="text-xs text-destructive">{aiScanError}</p>
              </div>
            ) : null}

            <TabsContent value="usage">
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="card-gradient rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Activity className="h-4 w-4 text-primary" />
                      <span className="text-xs text-muted-foreground">
                        {isSpecComparison ? "Total API Calls" : "Total Endpoints"}
                      </span>
                    </div>
                    <p className="text-2xl font-bold font-mono text-foreground">
                      {isSpecComparison
                        ? (displayHealthData?.totalApiCalls ?? 0).toLocaleString()
                        : totalBackendEndpoints.toLocaleString()}
                    </p>
                    {!isSpecComparison ? (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Detected in backend code
                      </p>
                    ) : null}
                  </div>
                  <div className="card-gradient rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      <span className="text-xs text-muted-foreground">
                        {isSpecComparison ? "Endpoints Used" : "Frontend Calls"}
                      </span>
                    </div>
                    <p className="text-2xl font-bold font-mono text-success">
                      {isSpecComparison
                        ? totalBackendEndpoints
                        : (displayHealthData?.totalApiCalls ?? 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="card-gradient rounded-lg border border-success/30 p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      <span className="text-xs text-muted-foreground">
                        {isSpecComparison ? "In Spec" : "Called by Frontend"}
                      </span>
                    </div>
                    <p className="text-2xl font-bold font-mono text-success">
                      {inSpecCount}
                    </p>
                  </div>
                  <div className="card-gradient rounded-lg border border-warning/30 p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className="h-4 w-4 text-warning" />
                      <span className="text-xs text-muted-foreground">
                        {isSpecComparison ? "Not In Spec" : "Not Called"}
                      </span>
                    </div>
                    <p className="text-2xl font-bold font-mono text-warning">
                      {notInSpecCount}
                    </p>
                  </div>
                </div>

                {isSpecComparison &&
                displayHealthData &&
                displayHealthData.endpointUsage.length > 0 &&
                inSpecCount === 0 ? (
                  <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
                    <p className="text-sm text-warning">
                      Zero endpoint overlap with the linked specification. This
                      usually means the selected spec does not belong to this
                      repository.
                    </p>
                  </div>
                ) : null}

                {/* Endpoint Usage List */}
                <div className="card-gradient rounded-lg border border-border overflow-hidden">
                  <div className="px-6 py-4 border-b border-border">
                    <h2 className="text-lg font-semibold text-foreground">
                      Endpoint Usage
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {isSpecComparison
                        ? "API calls detected in this repository"
                        : "All backend routes detected in this repository, with frontend call counts"}
                    </p>
                  </div>
                  <div className="divide-y divide-border">
                    {(displayHealthData?.endpointUsage ?? [])
                      .slice()
                      .sort((a, b) => b.callCount - a.callCount)
                      .map((usage) => {
                        const key = `${usage.method}:${usage.endpoint}`;
                        const isExpanded = expandedEndpointKeys.includes(key);
                        const hasBodyInfo =
                          !isSpecComparison &&
                          (usage.expectedRequestBodySchema ||
                            usage.receivedRequestBodySchema);

                        const diff = hasBodyInfo
                          ? computeJsonDiff(
                              usage.expectedRequestBodySchema ?? null,
                              usage.receivedRequestBodySchema ?? null,
                            )
                          : null;

                        const issueCount = diff
                          ? diff.expected.filter(
                              (l) => l.type === "error" || l.type === "missing",
                            ).length +
                            diff.received.filter((l) => l.type === "warning").length
                          : 0;

                        return (
                          <div key={key}>
                            <div
                              className={cn(
                                "flex items-center gap-4 px-6 py-4 cursor-pointer transition-colors hover:bg-muted/30",
                                usage.callCount === 0 && "opacity-60",
                                !usage.inSpec &&
                                  usage.callCount > 0 &&
                                  "bg-warning/5",
                              )}
                              onClick={() => {
                                if (!hasBodyInfo) return;
                                setExpandedEndpointKeys((prev) =>
                                  prev.includes(key)
                                    ? prev.filter((k) => k !== key)
                                    : [...prev, key],
                                );
                              }}
                            >
                              {hasBodyInfo ? (
                                <button className="text-muted-foreground shrink-0">
                                  {isExpanded ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </button>
                              ) : (
                                <span className="w-4 shrink-0" />
                              )}

                              {usage.inSpec ? (
                                <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                              ) : (
                                <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                              )}
                              <MethodBadge method={usage.method} />
                              <span className="font-mono text-sm text-foreground flex-1 truncate">
                                {usage.endpoint}
                              </span>
                              <span className="font-mono text-xs text-muted-foreground shrink-0">
                                {usage.callCount.toLocaleString()} calls
                              </span>

                              {!isSpecComparison && hasBodyInfo ? (
                                <Badge
                                  variant={
                                    issueCount > 0 ? "destructive" : "default"
                                  }
                                  className="text-xs shrink-0"
                                >
                                  {issueCount > 0
                                    ? `${issueCount} issue${
                                        issueCount !== 1 ? "s" : ""
                                      }`
                                    : "Body OK"}
                                </Badge>
                              ) : null}

                              <span className="text-xs text-muted-foreground hidden sm:block shrink-0">
                                {formatDistanceToNow(new Date(usage.lastCalledAt), {
                                  addSuffix: true,
                                })}
                              </span>
                              {!usage.inSpec ? (
                                <Badge variant="warning" className="text-xs shrink-0">
                                  {isSpecComparison ? "Not in spec" : "Not in backend"}
                                </Badge>
                              ) : null}
                            </div>

                            {!isSpecComparison && hasBodyInfo && isExpanded && diff ? (
                              <div className="px-6 py-5 bg-muted/10 border-t border-border/50">
                                <div className="flex items-center gap-6 text-xs mb-4">
                                  <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-sm bg-destructive/30 border border-destructive/50" />
                                    <span className="text-muted-foreground">
                                      Type mismatch / missing field
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-sm bg-warning/30 border border-warning/50" />
                                    <span className="text-muted-foreground">
                                      Extra field
                                    </span>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div>
                                    <div className="flex items-center gap-2 mb-2">
                                      <div className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/20">
                                        <Check className="h-3 w-3 text-primary" />
                                      </div>
                                      <span className="text-sm font-medium text-foreground">
                                        Expected (Backend)
                                      </span>
                                    </div>
                                    <pre className="text-xs font-mono leading-relaxed overflow-x-auto bg-card rounded-md border border-border p-3">
                                      {diff.expected.map((item, i) => (
                                        <div
                                          key={i}
                                          className={cn(
                                            "px-2 py-0.5 rounded-sm",
                                            lineStyles[item.type],
                                          )}
                                        >
                                          {item.line || "\u00A0"}
                                        </div>
                                      ))}
                                    </pre>
                                  </div>

                                  <div>
                                    <div className="flex items-center gap-2 mb-2">
                                      <div className="flex items-center justify-center w-5 h-5 rounded-full bg-warning/20">
                                        <X className="h-3 w-3 text-warning" />
                                      </div>
                                      <span className="text-sm font-medium text-foreground">
                                        Received (Frontend)
                                      </span>
                                    </div>
                                    <pre className="text-xs font-mono leading-relaxed overflow-x-auto bg-card rounded-md border border-border p-3">
                                      {diff.received.map((item, i) => (
                                        <div
                                          key={i}
                                          className={cn(
                                            "px-2 py-0.5 rounded-sm",
                                            lineStyles[item.type],
                                          )}
                                        >
                                          {item.line || "\u00A0"}
                                        </div>
                                      ))}
                                    </pre>
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="inconsistencies">
              {(displayHealthData?.inconsistencies.length ?? 0) === 0 ? (
                <div className="card-gradient rounded-lg border border-success/30 p-12 text-center">
                  <CheckCircle2 className="h-12 w-12 text-success mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    No Inconsistencies Found
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {isSpecComparison
                      ? "All API calls in this repository match the linked OpenAPI specification."
                      : "All frontend calls in this repository match detected backend routes."}
                  </p>
                </div>
              ) : (
                <div className="card-gradient rounded-lg border border-border overflow-hidden">
                  <div className="px-6 py-4 border-b border-border">
                    <h2 className="text-lg font-semibold text-foreground">
                      {isSpecComparison
                        ? "Spec Inconsistencies"
                        : "Frontend ↔ Backend Inconsistencies"}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {isSpecComparison
                        ? "Differences between repository API usage and OpenAPI specification"
                        : "Differences between frontend HTTP calls and backend route declarations. Click any row to see the expected vs received body."}
                    </p>
                  </div>
                  <div className="divide-y divide-border">
                    {(displayHealthData?.inconsistencies ?? []).map((inc) => (
                      <details
                        key={inc.id}
                        className={cn(
                          "px-6 py-4 group",
                          inc.severity === "error"
                            ? "bg-destructive/5"
                            : "bg-warning/5",
                        )}
                      >
                        <summary className="list-none cursor-pointer">
                          <div className="flex items-start gap-4">
                            {inc.severity === "error" ? (
                              <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                            ) : (
                              <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <MethodBadge method={inc.method} />
                                <span className="font-mono text-sm text-foreground">
                                  {inc.endpoint}
                                </span>
                                <Badge
                                  variant={
                                    inc.severity === "error" ? "error" : "warning"
                                  }
                                  className="text-xs"
                                >
                                  {inc.type.replace(/_/g, " ")}
                                </Badge>
                                {inc.confidence === "llm:resolved" ? (
                                  <Badge variant="muted" className="text-xs gap-1">
                                    <Sparkles className="h-3 w-3" /> AI verified
                                  </Badge>
                                ) : null}
                                {inc.schemaDiff ? (
                                  <Badge variant="muted" className="text-xs">
                                    Click to view body diff
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {inc.message}
                              </p>
                            </div>
                          </div>
                        </summary>

                        {inc.schemaDiff ? (
                          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="rounded-md border border-border bg-background/30 p-3">
                              <p className="text-xs font-medium text-foreground mb-2">
                                {isSpecComparison ? "Expected (Spec)" : "Expected (Backend)"}
                              </p>
                              <pre className="text-[11px] leading-5 font-mono whitespace-pre-wrap">
                                {Array.isArray(inc.schemaDiff.expectedLines)
                                  ? inc.schemaDiff.expectedLines.map((l: any, i: number) => (
                                      <div
                                        key={i}
                                        className={cn(
                                          "px-1 rounded-sm",
                                          lineStyles[l.type as keyof typeof lineStyles],
                                        )}
                                      >
                                        {l.line || " "}
                                      </div>
                                    ))
                                  : JSON.stringify(inc.schemaDiff.expectedLines, null, 2)}
                              </pre>
                            </div>
                            <div className="rounded-md border border-border bg-background/30 p-3">
                              <p className="text-xs font-medium text-foreground mb-2">
                                {isSpecComparison ? "Received (Backend)" : "Received (Frontend)"}
                              </p>
                              <pre className="text-[11px] leading-5 font-mono whitespace-pre-wrap">
                                {Array.isArray(inc.schemaDiff.receivedLines)
                                  ? inc.schemaDiff.receivedLines.map((l: any, i: number) => (
                                      <div
                                        key={i}
                                        className={cn(
                                          "px-1 rounded-sm",
                                          lineStyles[l.type as keyof typeof lineStyles],
                                        )}
                                      >
                                        {l.line || " "}
                                      </div>
                                    ))
                                  : JSON.stringify(inc.schemaDiff.receivedLines, null, 2)}
                              </pre>
                            </div>
                          </div>
                        ) : null}
                      </details>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        ) : null}

        {!linkedSpec &&
        displayHealthData &&
        displayHealthData.inconsistencies.length === 0 ? (
          <div className="p-4 rounded-lg bg-muted/30 border border-border">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">Tip:</strong> Link this
              repository to an OpenAPI specification to automatically detect
              inconsistencies between your code and the API contract.
            </p>
          </div>
        ) : null}

        <Dialog
          open={isDeleteConfirmOpen}
          onOpenChange={setIsDeleteConfirmOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Spec Version</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this specification version? This
                action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsDeleteConfirmOpen(false)}
              >
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleConfirmDelete}>
                <Trash2 className="h-4 w-4 mr-2" /> Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default RepositoryDetail;
