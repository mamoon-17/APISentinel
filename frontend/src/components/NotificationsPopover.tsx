import React from "react";
import { Bell } from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { mockRequestLogs } from "@/data/mockData";

function timeAgo(date: Date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

export function NotificationsPopover() {
  // pick recent items with violations or non-valid status
  const items = mockRequestLogs
    .filter(
      (r) => r.status !== "valid" || (r.violations && r.violations.length > 0),
    )
    .slice(0, 6);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-destructive rounded-full" />
        </Button>
      </PopoverTrigger>

      <PopoverContent>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">Notifications</h3>
          <button
            className="text-xs text-muted-foreground hover:underline"
            onClick={() => {
              // simple clear behaviour: nothing persisted in this demo
              // we could show a toast, but keep it simple
            }}
          >
            Clear
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {items.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              No new notifications
            </div>
          ) : (
            items.map((it) => (
              <div key={it.id} className="flex items-start gap-3">
                <div className="text-xs font-medium uppercase text-muted-foreground">
                  {it.method}
                </div>
                <div className="flex-1">
                  <div className="text-sm">{it.endpoint}</div>
                  <div className="text-xs text-muted-foreground">
                    {timeAgo(new Date(it.timestamp))} • {it.status}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default NotificationsPopover;

