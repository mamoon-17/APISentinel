import { User as UserIcon } from "lucide-react";
import type { SessionUser } from "@/hooks/use-session";
import { cn } from "@/lib/utils";

interface UserBadgeProps {
  user: SessionUser;
  onClick?: () => void;
  className?: string;
}

function getDisplayName(user: SessionUser): string {
  if (user.name && user.name.trim().length > 0) {
    return user.name;
  }
  return user.login;
}

function getInitial(user: SessionUser): string {
  const source = (user.name?.trim() || user.login || "?").trim();
  return source.charAt(0).toUpperCase();
}

export function UserBadge({ user, onClick, className }: UserBadgeProps) {
  const name = getDisplayName(user);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border border-border bg-card/40 hover:bg-muted/50 transition-colors",
        className,
      )}
      aria-label={`Open settings for ${name}`}
    >
      {user.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt={name}
          className="h-7 w-7 rounded-full object-cover ring-1 ring-border"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="h-7 w-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-semibold">
          {getInitial(user) || <UserIcon className="h-4 w-4" />}
        </div>
      )}
      <span className="hidden sm:inline text-sm font-medium text-foreground max-w-[140px] truncate">
        {name}
      </span>
    </button>
  );
}

export default UserBadge;
