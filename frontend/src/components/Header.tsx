import { useEffect, useState } from "react";
import { Shield } from "lucide-react";
import { Link } from "react-router-dom";
import { StatusIndicator } from "./StatusIndicator";
import NotificationsPopover from "./NotificationsPopover";
import SettingsDialog from "./SettingsDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function Header() {
  const [requiresLocalPassword, setRequiresLocalPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const apiBaseUrl =
    import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

  useEffect(() => {
    let isMounted = true;

    const checkSession = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/auth/me`, {
          credentials: "include",
        });

        if (!response.ok || !isMounted) {
          return;
        }

        const payload = (await response.json()) as {
          requiresLocalPassword?: boolean;
        };

        if (payload.requiresLocalPassword === true) {
          setRequiresLocalPassword(true);
        }
      } catch {
        // Ignore - session checks are best effort for UX gating.
      }
    };

    void checkSession();

    return () => {
      isMounted = false;
    };
  }, [apiBaseUrl]);

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);

    if (newPassword.length < 8) {
      setPasswordError("Password must be at least 8 characters");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`${apiBaseUrl}/auth/local/set-password`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          password: newPassword,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        setPasswordError(payload?.message ?? "Unable to set password");
        return;
      }

      setRequiresLocalPassword(false);
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setPasswordError("Unable to set password");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <Dialog open={requiresLocalPassword}>
        <DialogContent
          className="max-w-md [&>button]:hidden"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Set Your App Password</DialogTitle>
            <DialogDescription>
              You signed in with Google. Set a local password now so next time
              you can log in with either email/password or Google.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={handleSetPassword}>
            <div className="space-y-2">
              <Label htmlFor="required-new-password">New Password</Label>
              <Input
                id="required-new-password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={8}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="required-confirm-password">
                Confirm Password
              </Label>
              <Input
                id="required-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8}
                required
              />
            </div>

            {passwordError ? (
              <p className="text-xs text-destructive">{passwordError}</p>
            ) : null}

            <Button type="submit" className="w-full" disabled={isSaving}>
              {isSaving ? "Saving password..." : "Save Password"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container flex h-16 items-center justify-between">
          <Link to="/dashboard" className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 glow">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">
                API Sentinel
              </h1>
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
    </>
  );
}
