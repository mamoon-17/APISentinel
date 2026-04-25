import React, { useState, useEffect } from "react";
import { Settings as SettingsIcon, LogOut } from "lucide-react";
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

export function SettingsDialog() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [notifyOnComplete, setNotifyOnComplete] = useState<boolean>(true);
  const [autoHealthCheckOnLink, setAutoHealthCheckOnLink] =
    useState<boolean>(true);
  const apiBaseUrl =
    import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

  useEffect(() => {
    try {
      const notify = localStorage.getItem("cg_notify_complete");
      const autoCheck = localStorage.getItem("cg_auto_health_check_on_link");
      if (notify !== null) setNotifyOnComplete(notify === "true");
      if (autoCheck !== null) setAutoHealthCheckOnLink(autoCheck === "true");
    } catch (e) {
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
    } catch (e) {
      // ignore
    }
  }, [notifyOnComplete, autoHealthCheckOnLink]);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await fetch(`${apiBaseUrl}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch (_error) {
      // Keep client logout flow resilient even if API is unreachable.
    } finally {
      localStorage.clear();
      setOpen(false);
      navigate("/", { replace: true });
      setIsLoggingOut(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <SettingsIcon className="h-4 w-4" />
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure your preferences</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-6">
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
