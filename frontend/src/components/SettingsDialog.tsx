import { useEffect, useState } from "react";
import {
  Settings as SettingsIcon,
  LogOut,
  Github,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  getApiBaseUrl,
  type SessionState,
} from "@/hooks/use-session";

interface SettingsDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  session: SessionState | null;
  onSessionRefresh?: () => Promise<void> | void;
}

export function SettingsDialog({
  open: controlledOpen,
  onOpenChange,
  session,
  onSessionRefresh,
}: SettingsDialogProps) {
  const navigate = useNavigate();
  const [internalOpen, setInternalOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [linkBanner, setLinkBanner] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [notifyOnComplete, setNotifyOnComplete] = useState<boolean>(true);
  const [autoHealthCheckOnLink, setAutoHealthCheckOnLink] =
    useState<boolean>(true);
  const apiBaseUrl = getApiBaseUrl();

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    try {
      const notify = localStorage.getItem("cg_notify_complete");
      const autoCheck = localStorage.getItem("cg_auto_health_check_on_link");
      if (notify !== null) setNotifyOnComplete(notify === "true");
      if (autoCheck !== null) setAutoHealthCheckOnLink(autoCheck === "true");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("cg_notify_complete", String(notifyOnComplete));
      localStorage.setItem(
        "cg_auto_health_check_on_link",
        String(autoHealthCheckOnLink),
      );
    } catch {
      // ignore
    }
  }, [notifyOnComplete, autoHealthCheckOnLink]);

  // Surface ?github=... feedback and auto-open settings so users see the result
  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const status = params.get("github");
    if (!status) return;

    if (status === "linked") {
      setLinkBanner({ kind: "success", text: "GitHub connected." });
      setOpen(true);
    } else if (status === "already_linked") {
      setLinkBanner({
        kind: "error",
        text: "That GitHub account is already linked to another user.",
      });
      setOpen(true);
    } else if (status === "link_failed") {
      setLinkBanner({
        kind: "error",
        text: "Could not connect GitHub. Please try again.",
      });
      setOpen(true);
    }

    params.delete("github");
    const newSearch = params.toString();
    const newUrl =
      window.location.pathname +
      (newSearch ? `?${newSearch}` : "") +
      window.location.hash;
    window.history.replaceState({}, "", newUrl);
    void onSessionRefresh?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await fetch(`${apiBaseUrl}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Keep client logout flow resilient even if API is unreachable.
    } finally {
      localStorage.clear();
      setOpen(false);
      navigate("/", { replace: true });
      setIsLoggingOut(false);
    }
  }

  function handleConnectGithub() {
    window.location.href = `${apiBaseUrl}/auth/github/login?mode=link`;
  }

  async function handleDisconnectGithub() {
    setUnlinkError(null);
    setIsUnlinking(true);
    try {
      const response = await fetch(`${apiBaseUrl}/auth/github/unlink`, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        setUnlinkError(payload?.message ?? "Unable to disconnect GitHub");
        return;
      }

      setLinkBanner({ kind: "success", text: "GitHub disconnected." });
      await onSessionRefresh?.();
    } catch {
      setUnlinkError("Unable to disconnect GitHub");
    } finally {
      setIsUnlinking(false);
    }
  }

  const user = session?.user ?? null;
  const githubLinked = session?.githubLinked === true;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Open settings">
            <SettingsIcon className="h-4 w-4" />
          </Button>
        </DialogTrigger>
      )}

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Manage your account, connections, and preferences
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {user ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 p-3">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.name ?? user.login}
                  className="h-12 w-12 rounded-full object-cover ring-1 ring-border"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-12 w-12 rounded-full bg-primary/15 text-primary flex items-center justify-center text-base font-semibold">
                  {(user.name?.trim() || user.login || "?")
                    .charAt(0)
                    .toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {user.name?.trim() || user.login}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.login}
                </p>
              </div>
            </div>
          ) : null}

          {linkBanner ? (
            <div
              className={`flex items-start gap-2 rounded-md border p-3 text-xs ${
                linkBanner.kind === "success"
                  ? "border-success/40 bg-success/10 text-success"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}
            >
              {linkBanner.kind === "success" ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              )}
              <span>{linkBanner.text}</span>
            </div>
          ) : null}

          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Connections
            </p>

            <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="rounded-md p-2 bg-muted/50">
                  <Github className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground">
                      GitHub
                    </p>
                    {githubLinked ? (
                      <Badge variant="success" className="text-[10px]">
                        Connected
                      </Badge>
                    ) : (
                      <Badge variant="muted" className="text-[10px]">
                        Not connected
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {githubLinked
                      ? "Sync your repositories and detect API usage."
                      : "Connect to import and monitor your repositories."}
                  </p>
                  {unlinkError ? (
                    <p className="text-xs text-destructive mt-1">
                      {unlinkError}
                    </p>
                  ) : null}
                </div>
              </div>
              {githubLinked ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDisconnectGithub}
                  disabled={isUnlinking}
                >
                  {isUnlinking ? "Disconnecting..." : "Disconnect"}
                </Button>
              ) : (
                <Button size="sm" onClick={handleConnectGithub}>
                  <Github className="h-3.5 w-3.5 mr-1.5" /> Connect
                </Button>
              )}
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Preferences
            </p>

            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium mb-1">Notifications</p>
                <p className="text-xs text-muted-foreground">
                  Get notified when health checks and spec scans complete
                </p>
              </div>
              <Switch
                checked={notifyOnComplete}
                onCheckedChange={setNotifyOnComplete}
              />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium mb-1">
                  Run Health Check on Link
                </p>
                <p className="text-xs text-muted-foreground">
                  Automatically run health check when linking a spec to a
                  repository
                </p>
              </div>
              <Switch
                checked={autoHealthCheckOnLink}
                onCheckedChange={setAutoHealthCheckOnLink}
              />
            </div>
          </div>

          <Separator />

          <Button
            variant="destructive"
            className="w-full justify-start"
            onClick={handleLogout}
            disabled={isLoggingOut}
          >
            <LogOut className="h-4 w-4 mr-2" />
            {isLoggingOut ? "Logging out..." : "Log Out"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SettingsDialog;
