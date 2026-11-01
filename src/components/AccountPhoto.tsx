/** A YouTube account / channel picture (a person icon if it won't load). */
import { useState } from "react";
import { UserRound } from "lucide-react";
import { cn } from "@/utils/cn";

export function Photo({ src, className }: { src?: string; className?: string }) {
  const [bad, setBad] = useState<string | null>(null);
  return src && bad !== src ? (
    <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBad(src)} className={cn("shrink-0 rounded-full object-cover", className)} />
  ) : (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent", className)}>
      <UserRound className="h-1/2 w-1/2" />
    </span>
  );
}
