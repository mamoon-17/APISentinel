import { useEffect, useMemo, useRef, useState } from "react";
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
import { useGithubRepoList } from "@/hooks/use-github-repos";
import { getApiBaseUrl } from "@/hooks/use-session";
import { HEALTH_CHECKS_API_BASE_PATH } from "@/lib/api-paths";
import type {
  ApiSpec,
  HealthCheckJobPayload,
  HealthCheckResultPayload,
  RepositorySpecLinkPayload,
} from "@/types/api";

interface RepositoryStateResponse {
  link: RepositorySpecLinkPayload | null;
  latestJob: HealthCheckJobPayload | null;
  latestResult: HealthCheckResultPayload | null;
}

interface JobResponse {
  job: HealthCheckJobPayload;
  deduped?: boolean;
}

const AUTO_HEALTH_CHECK_SETTING_KEY = "cg_auto_health_check_on_link";

const RepositoryDetail = () => {
  const { id } = useParams<{ id: string }>();
  const {
    repos,
    isLoading,
    error,
    githubLinked,
    tokenInvalid,
    scopeInsufficient,
  } = useGithubRepoList();
  const repository = id ? repos.find((r) => r.id === id) : undefined;

  const [healthData, setHealthData] = useState<HealthCheckResultPayload | null>(
    null,
  );
  const [currentJob, setCurrentJob] = useState<HealthCheckJobPayload | null>(
    null,
  );
  const [linkedSpecMeta, setLinkedSpecMeta] =
    useState<RepositorySpecLinkPayload | null>(null);
  const [isHydratingState, setIsHydratingState] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);

  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [selectedSpecId, setSelectedSpecId] = useState<string | undefined>(
    undefined,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [deleteVersionId, setDeleteVersionId] = useState<string | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [specActionError, setSpecActionError] = useState<string | null>(null);
  const {
    specs,
    isLoading: isSpecsLoading,
    error: specsError,
    uploadSpecFile,
    deleteVersion,
  } = useSpecs();

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
          `${getApiBaseUrl()}${HEALTH_CHECKS_API_BASE_PATH}/repositories/${repository.id}/state`,
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

        if (payload.latestJob) {
          setCurrentJob(payload.latestJob);
          if (payload.latestJob.result) {
            setHealthData(payload.latestJob.result);
          }
        }

        if (payload.latestResult) {
          setHealthData(payload.latestResult);
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
    const activeJob = currentJob;
    if (!activeJob) {
      return;
    }

    if (activeJob.status === "succeeded" || activeJob.status === "failed") {
      return;
    }

    let cancelled = false;

    const pollJob = async () => {
      try {
        const response = await fetch(
          `${getApiBaseUrl()}${HEALTH_CHECKS_API_BASE_PATH}/jobs/${activeJob.id}`,
          {
            credentials: "include",
          },
        );

        if (!response.ok || cancelled) {
          return;
        }

        const payload = (await response.json()) as {
          job: HealthCheckJobPayload;
        };
        if (cancelled) {
          return;
        }

        setCurrentJob(payload.job);

        if (payload.job.result) {
          setHealthData(payload.job.result);
        }
      } catch {
        if (!cancelled) {
          setJobError("Unable to refresh job status.");
        }
      }
    };

    const intervalId = window.setInterval(() => {
      void pollJob();
    }, 2000);

    void pollJob();

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [currentJob]);

  const linkedSpec = useMemo((): ApiSpec | null => {
    if (selectedSpecId) {
      const selected = mockApiSpecs.find((spec) => spec.id === selectedSpecId);
      if (selected) {
        return selected;
      }
    }

    if (!linkedSpecMeta) {
      return null;
    }

    return {
      id: linkedSpecMeta.specId,
      name: linkedSpecMeta.specName,
      version: "linked",
      uploadedAt: new Date(linkedSpecMeta.linkedAt),
      endpoints: healthData?.endpointUsage.length ?? 0,
      status: "active",
    };
  }, [healthData?.endpointUsage.length, linkedSpecMeta, selectedSpecId]);

  const repositoryVm = {
    id: repository?.id ?? "",
    name: repository?.name ?? "",
    fullName: repository?.fullName ?? "",
    url: repository?.url ?? "",
    provider: "github" as const,
    linkedAt: linkedSpecMeta ? new Date(linkedSpecMeta.linkedAt) : new Date(),
    lastHealthCheck: healthData ? new Date(healthData.checkedAt) : undefined,
    healthStatus:
      currentJob?.status === "running" || currentJob?.status === "queued"
        ? "checking"
        : healthData?.healthy
          ? "healthy"
          : healthData
            ? "issues"
            : "unchecked",
  };

  const isChecking =
    currentJob?.status === "queued" || currentJob?.status === "running";

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

  function getProviderIcon(provider: string) {
    switch (provider) {
      case "github":
        return <Github className="h-6 w-6" />;
      default:
        return <GitBranch className="h-6 w-6" />;
    }
  }

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
    setJobError(null);

    const specId = selectedSpecId ?? linkedSpecMeta?.specId;
    const selectedSpec = specId
      ? mockApiSpecs.find((spec) => spec.id === specId)
      : undefined;

    const specName =
      selectedSpec?.name ??
      (specId === linkedSpecMeta?.specId
        ? linkedSpecMeta?.specName
        : undefined);

    if (!specId || !specName) {
      setJobError("Link a specification before running a health check.");
      return;
    }

    try {
      const response = await fetch(
        `${getApiBaseUrl()}${HEALTH_CHECKS_API_BASE_PATH}/jobs`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            repositoryId: repository.id,
            repositoryName: repository.name,
            repositoryFullName: repository.fullName,
            specId,
            specName,
          }),
        },
      );

      const payload = (await response.json().catch(() => null)) as
        | JobResponse
        | { message?: string }
        | null;

      if (!response.ok) {
        setJobError(payload?.message ?? "Unable to start health check.");
        return;
      }

      setCurrentJob((payload as JobResponse).job);
      setSelectedSpecId(specId);
    } catch {
      setJobError("Unable to start health check.");
    }
  };

  const handleLinkSpec = async () => {
    if (!selectedSpecId) {
      return;
    }

    const selectedSpec = mockApiSpecs.find(
      (spec) => spec.id === selectedSpecId,
    );
    if (!selectedSpec) {
      setJobError("Selected specification could not be found.");
      return;
    }

    const autoRunOnLink =
      localStorage.getItem(AUTO_HEALTH_CHECK_SETTING_KEY) !== "false";

    setJobError(null);

    try {
      const response = await fetch(
        `${getApiBaseUrl()}${HEALTH_CHECKS_API_BASE_PATH}/repositories/${repository.id}/spec-link`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            repositoryName: repository.name,
            repositoryFullName: repository.fullName,
            specId: selectedSpec.id,
            specName: selectedSpec.name,
            autoRunHealthCheck: autoRunOnLink,
          }),
        },
      );

      const payload = (await response.json().catch(() => null)) as
        | {
            link: RepositorySpecLinkPayload;
            job: HealthCheckJobPayload | null;
            message?: string;
          }
        | { message?: string }
        | null;

      if (!response.ok) {
        setJobError(payload?.message ?? "Unable to link specification.");
        return;
      }

      const successPayload = payload as {
        link: RepositorySpecLinkPayload;
        job: HealthCheckJobPayload | null;
      };

      setLinkedSpecMeta(successPayload.link);
      setSelectedSpecId(successPayload.link.specId);
      setIsLinkDialogOpen(false);

      if (successPayload.job) {
        setCurrentJob(successPayload.job);
      }
    } catch {
      setJobError("Unable to link specification.");
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) {
      return;
    }

    const baseName = file.name;
    const newSpec = {
      id: String(Date.now()),
      name: baseName,
      version: `v${Math.floor(Math.random() * 9) + 1}.${Math.floor(
        Math.random() * 9,
      )}.${Math.floor(Math.random() * 9)}`,
      uploadedAt: new Date(),
      endpoints: 0,
      status: "active",
    } as ApiSpec;

    mockApiSpecs.push(newSpec);
    setSelectedSpecId(newSpec.id);
  };

  const openDeleteConfirm = (versionId: string) => {
    setDeleteVersionId(versionId);
    setIsDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = () => {
    if (!deleteSpecId) {
      return;
    }

    const index = mockApiSpecs.findIndex((spec) => spec.id === deleteSpecId);
    if (index !== -1) {
      mockApiSpecs.splice(index, 1);
      if (selectedSpecId === deleteSpecId) {
        setSelectedSpecId(undefined);
      }
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
                  {getHealthStatusBadge(repositoryVm.healthStatus)}
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
                    Linked:{" "}
                    {formatDistanceToNow(repositoryVm.linkedAt, {
                      addSuffix: true,
                    })}
                  </span>
                  {repositoryVm.lastHealthCheck ? (
                    <span>
                      Last checked:{" "}
                      {formatDistanceToNow(repositoryVm.lastHealthCheck, {
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
                    {linkedSpec ? "Change Spec" : "Link to Spec"}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Link to API Specification</DialogTitle>
                    <DialogDescription>
                      Select an OpenAPI specification to validate this
                      repository&apos;s API calls against.
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
                              onClick={() => setSelectedSpecId(spec.id)}
                            >
                              <FileJson className="h-4 w-4" />
                              <span>{spec.name}</span>
                              <span className="text-muted-foreground text-xs">
                                ({spec.activeVersion ?? "no active version"})
                              </span>
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
                    <div className="mt-3 flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleUploadClick}
                      >
                        <FileJson className="h-4 w-4 mr-2" />
                        Upload Spec
                      </Button>
                      <span className="text-sm text-muted-foreground self-center">
                        Upload a new version for this API (creates a new spec)
                      </span>
                    </div>
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
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setIsLinkDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button onClick={handleLinkSpec} disabled={!selectedSpecId}>
                      Link Specification
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Button onClick={handleCheckHealth} disabled={isChecking}>
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
                <Link to={`/spec/${linkedSpec.id}`} className="ml-auto">
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
              Click "Check Repo Health" to queue a scan job and validate API
              usage against the linked OpenAPI specification.
            </p>
            <Button onClick={handleCheckHealth}>
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
                {healthData.inconsistencies.length > 0 ? (
                  <span className="ml-2 px-1.5 py-0.5 text-xs font-medium bg-destructive text-destructive-foreground rounded-full">
                    {healthData.inconsistencies.length}
                  </span>
                ) : null}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="usage">
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="card-gradient rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Activity className="h-4 w-4 text-primary" />
                      <span className="text-xs text-muted-foreground">
                        Total API Calls
                      </span>
                    </div>
                    <p className="text-2xl font-bold font-mono text-foreground">
                      {healthData.totalApiCalls.toLocaleString()}
                    </p>
                  </div>
                  <div className="card-gradient rounded-lg border border-border p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      <span className="text-xs text-muted-foreground">
                        Endpoints Used
                      </span>
                    </div>
                    <p className="text-2xl font-bold font-mono text-success">
                      {healthData.endpointUsage.length}
                    </p>
                  </div>
                  <div className="card-gradient rounded-lg border border-success/30 p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      <span className="text-xs text-muted-foreground">
                        In Spec
                      </span>
                    </div>
                    <p className="text-2xl font-bold font-mono text-success">
                      {
                        healthData.endpointUsage.filter((entry) => entry.inSpec)
                          .length
                      }
                    </p>
                  </div>
                  <div className="card-gradient rounded-lg border border-warning/30 p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className="h-4 w-4 text-warning" />
                      <span className="text-xs text-muted-foreground">
                        Not In Spec
                      </span>
                    </div>
                    <p className="text-2xl font-bold font-mono text-warning">
                      {
                        healthData.endpointUsage.filter(
                          (entry) => !entry.inSpec,
                        ).length
                      }
                    </p>
                  </div>
                </div>

                <div className="card-gradient rounded-lg border border-border overflow-hidden">
                  <div className="px-6 py-4 border-b border-border">
                    <h2 className="text-lg font-semibold text-foreground">
                      Endpoint Usage
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      API calls detected in this repository
                    </p>
                  </div>
                  <div className="divide-y divide-border">
                    {healthData.endpointUsage
                      .slice()
                      .sort((a, b) => b.callCount - a.callCount)
                      .map((usage) => (
                        <div
                          key={`${usage.method}-${usage.endpoint}`}
                          className={cn(
                            "flex items-center gap-4 px-6 py-3.5",
                            !usage.inSpec && "bg-warning/5",
                          )}
                        >
                          {usage.inSpec ? (
                            <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                          )}
                          <MethodBadge method={usage.method} />
                          <span className="font-mono text-sm text-foreground flex-1 truncate">
                            {usage.endpoint}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {usage.callCount.toLocaleString()} calls
                          </span>
                          <span className="text-xs text-muted-foreground hidden sm:block">
                            {formatDistanceToNow(new Date(usage.lastCalledAt), {
                              addSuffix: true,
                            })}
                          </span>
                          {!usage.inSpec ? (
                            <Badge variant="warning" className="text-xs">
                              Not in spec
                            </Badge>
                          ) : null}
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="inconsistencies">
              {healthData.inconsistencies.length === 0 ? (
                <div className="card-gradient rounded-lg border border-success/30 p-12 text-center">
                  <CheckCircle2 className="h-12 w-12 text-success mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    No Inconsistencies Found
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    All API calls in this repository match the linked OpenAPI
                    specification.
                  </p>
                </div>
              ) : (
                <div className="card-gradient rounded-lg border border-border overflow-hidden">
                  <div className="px-6 py-4 border-b border-border">
                    <h2 className="text-lg font-semibold text-foreground">
                      Spec Inconsistencies
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Differences between repository API usage and OpenAPI
                      specification
                    </p>
                  </div>
                  <div className="divide-y divide-border">
                    {healthData.inconsistencies.map((inc) => (
                      <div
                        key={inc.id}
                        className={cn(
                          "flex items-start gap-4 px-6 py-4",
                          inc.severity === "error"
                            ? "bg-destructive/5"
                            : "bg-warning/5",
                        )}
                      >
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
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {inc.message}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        ) : null}

        {!linkedSpec &&
        healthData &&
        healthData.inconsistencies.length === 0 ? (
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
