import { useEffect, useState } from "react";
import { Bell, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRequestLogs, type RequestLogEntry } from "@/hooks/use-dashboard";

const POLL_INTERVAL_MS = 30_000;
const SEEN_NOTIFICATIONS_KEY = "apisentinel_seen_notification_set_v1";

function notificationIcon(item: RequestLogEntry) {
  if (item.jobStatus === "failed") {
    return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />;
  }
  if (item.inconsistencyCount > 0) {
    return <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />;
  }
  return null;
}

function notificationBadge(item: RequestLogEntry): {
  label: string;
  variant: "error" | "warning" | "muted";
} {
  if (item.jobStatus === "failed") {
    return { label: "Failed", variant: "error" };
  }
  if (item.inconsistencyCount > 0) {
    return { label: "Issues", variant: "warning" };
  }
  return { label: "Info", variant: "muted" };
}

export function NotificationsPopover() {
  const [open, setOpen] = useState(false);
  const [notifyEnabled] = useState<boolean>(() => {
    try {
      const val = localStorage.getItem("cg_notify_complete");
      return val === null || val === "true";
    } catch {
      return true;
    }
  });

  // Always fetch so we have data to show; enabled flag only controls the dot
  const { logs, isLoading, refetch } = useRequestLogs(20);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [seenNotificationSet, setSeenNotificationSet] = useState<string>(() => {
    try {
      return localStorage.getItem(SEEN_NOTIFICATIONS_KEY) ?? "";
    } catch {
      return "";
    }
  });

  // Poll for new notifications
  useEffect(() => {
    const id = setInterval(() => {
      void refetch();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refetch]);

  // Show items with issues regardless of toggle; toggle only controls the bell dot
  const items = logs
    .filter(
      (r) =>
        !dismissed.has(r.id) &&
        (r.jobStatus === "failed" || r.inconsistencyCount > 0),
    )
    .slice(0, 8);

  const currentNotificationSet = items.map((item) => item.id).join("|");
  const hasNotifications =
    notifyEnabled &&
    items.length > 0 &&
    currentNotificationSet !== seenNotificationSet;

  useEffect(() => {
    if (!open || currentNotificationSet.length === 0) {
      return;
    }

    setSeenNotificationSet(currentNotificationSet);
    try {
      localStorage.setItem(SEEN_NOTIFICATIONS_KEY, currentNotificationSet);
    } catch {
      // Ignore storage failures; the in-memory state still clears the dot.
    }
  }, [currentNotificationSet, open]);

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen || currentNotificationSet.length === 0) {
      return;
    }

    setSeenNotificationSet(currentNotificationSet);
    try {
      localStorage.setItem(SEEN_NOTIFICATIONS_KEY, currentNotificationSet);
    } catch {
      // Ignore storage failures; the in-memory state still clears the dot.
    }
  }

  function handleClear() {
    setDismissed(new Set(logs.map((l) => l.id)));
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {hasNotifications ? (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-destructive rounded-full animate-pulse" />
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-80">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Notifications</h3>
          {items.length > 0 ? (
            <button
              className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors"
              onClick={handleClear}
            >
              Clear all
            </button>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5 max-h-[320px] overflow-y-auto">
          {isLoading && logs.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No new notifications
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-muted/40 transition-colors"
              >
                <div className="mt-0.5">{notificationIcon(item)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {item.repositoryFullName}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {item.specName ? `Spec: ${item.specName}` : "No spec"}
                    {item.inconsistencyCount > 0
                      ? ` · ${item.inconsistencyCount} issue${item.inconsistencyCount !== 1 ? "s" : ""}`
                      : ""}
                  </p>
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                    {formatDistanceToNow(new Date(item.timestamp), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
                <Badge
                  variant={notificationBadge(item).variant}
                  className="text-[10px] shrink-0"
                >
                  {notificationBadge(item).label}
                </Badge>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default NotificationsPopover;
