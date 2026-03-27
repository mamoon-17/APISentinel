import { Shield } from "lucide-react";
import { Link } from "react-router-dom";
import { StatusIndicator } from "./StatusIndicator";
import NotificationsPopover from "./NotificationsPopover";
import SettingsDialog from "./SettingsDialog";

export function Header() {
  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container flex h-16 items-center justify-between">
        <Link to="/dashboard" className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 glow">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground">API Sentinel</h1>
            <p className="text-xs text-muted-foreground">
              Zero-Trust API Verifier
            </p>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/10 border border-success/20">
            <StatusIndicator status="valid" size="sm" pulse />
            <span className="text-xs font-medium text-success">
              Proxy Active
            </span>
          </div>

          <NotificationsPopover />
          <SettingsDialog />
        </div>
      </div>
    </header>
  );
}

