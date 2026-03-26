import { cn } from "@/lib/utils";
import { ValidationStatus } from "@/types/api";

interface StatusIndicatorProps {
  status: ValidationStatus;
  size?: "sm" | "md" | "lg";
  pulse?: boolean;
}

const statusStyles: Record<ValidationStatus, string> = {
  valid: "bg-success",
  warning: "bg-warning",
  error: "bg-destructive",
};

const sizeStyles: Record<NonNullable<StatusIndicatorProps["size"]>, string> = {
  sm: "w-2 h-2",
  md: "w-3 h-3",
  lg: "w-4 h-4",
};

export function StatusIndicator({
  status,
  size = "md",
  pulse = false,
}: StatusIndicatorProps) {
  return (
    <div className="relative flex items-center justify-center">
      <div
        className={cn(
          "rounded-full",
          statusStyles[status],
          sizeStyles[size],
          pulse && "animate-pulse-ring",
        )}
      />
      {pulse && (
        <div
          className={cn(
            "absolute rounded-full opacity-30",
            statusStyles[status],
            size === "sm" ? "w-4 h-4" : size === "md" ? "w-5 h-5" : "w-6 h-6",
          )}
        />
      )}
    </div>
  );
}

