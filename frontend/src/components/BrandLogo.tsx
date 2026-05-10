import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface BrandLogoProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function BrandLogo({ size = "md", className }: BrandLogoProps) {
  const containerSizes = {
    sm: "w-10 h-10 rounded-lg",
    md: "w-10 h-10 rounded-lg",
    lg: "w-12 h-12 rounded-xl",
  };

  const iconSizes = {
    sm: "h-5 w-5",
    md: "h-5 w-5",
    lg: "h-6 w-6",
  };

  const textSizes = {
    sm: "text-xl",
    md: "text-xl",
    lg: "text-2xl",
  };

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className={cn(
          "flex items-center justify-center bg-primary/10 glow",
          containerSizes[size],
        )}
      >
        <ShieldCheck className={cn("text-primary", iconSizes[size])} />
      </div>
      <div>
        <p className={cn("font-bold text-foreground leading-tight", textSizes[size])}>
          API Sentinel
        </p>
        <p className="text-xs text-muted-foreground">Zero-Trust API Verifier</p>
      </div>
    </div>
  );
}
