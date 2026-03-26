import { cn } from "@/lib/utils";
import { HttpMethod } from "@/types/api";

interface MethodBadgeProps {
  method: HttpMethod;
}

const methodStyles: Record<HttpMethod, string> = {
  GET: "bg-success/20 text-success border-success/30",
  POST: "bg-primary/20 text-primary border-primary/30",
  PUT: "bg-warning/20 text-warning border-warning/30",
  PATCH: "bg-warning/20 text-warning border-warning/30",
  DELETE: "bg-destructive/20 text-destructive border-destructive/30",
};

export function MethodBadge({ method }: MethodBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center px-2 py-0.5 text-xs font-mono font-semibold rounded border min-w-[60px]",
        methodStyles[method],
      )}
    >
      {method}
    </span>
  );
}

