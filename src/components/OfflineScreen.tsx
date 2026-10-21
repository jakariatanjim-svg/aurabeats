/**
 * Shown instead of pages that need the internet (Discover, search, video)
 * while the device is offline, like YouTube's "You're offline" page. Your
 * library, offline songs, history and Settings keep working; the page comes
 * back by itself when the connection does.
 */
import { useState } from "react";
import { Download, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui";
import { usePlayer } from "@/hooks/usePlayer";
import { cn } from "@/utils/cn";
import type { RouteKey } from "@/routes";

export function OfflineScreen({ onNavigate }: { onNavigate: (r: RouteKey) => void }) {
  const { offlineTracks } = usePlayer();
  const [shake, setShake] = useState(0);
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <span key={shake} className={cn("flex h-20 w-20 items-center justify-center rounded-full bg-ink/[0.05] text-ink3", shake && "animate-[shake_0.4s_ease]")}>
        <WifiOff className="h-9 w-9" />
      </span>
      <div>
        <h2 className="text-xl font-black text-ink">You're offline</h2>
        <p className="mt-1 text-[13px] text-ink3">Check your connection and try again.</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          onClick={() => {
            if (navigator.onLine) window.location.reload();
            else setShake((n) => n + 1);
          }}
        >
          <RefreshCw className="h-4 w-4" /> Retry
        </Button>
        {offlineTracks.length > 0 && (
          <Button variant="outline" onClick={() => onNavigate("downloads")}>
            <Download className="h-4 w-4" /> Offline songs ({offlineTracks.length})
          </Button>
        )}
      </div>
    </div>
  );
}
