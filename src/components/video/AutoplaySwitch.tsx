/**
 * Autoplay on/off switch for the player's control bar (like YouTube's):
 * on → the next video starts when this one ends. Remembered on this device.
 */
import { Pause, Play } from "lucide-react";
import { setVideoSettings, useAutoplay } from "@/services/video/settings";
import { cn } from "@/utils/cn";

export function AutoplaySwitch({ className }: { className?: string }) {
  const on = useAutoplay();
  const label = on ? "Autoplay is on" : "Autoplay is off";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={label}
      aria-label={label}
      onClick={() => setVideoSettings({ autoplay: !on })}
      className={cn("flex h-10 w-12 shrink-0 items-center justify-center rounded-full active:scale-95", className)}
    >
      <span className={cn("relative h-3.5 w-9 rounded-full transition-colors", on ? "bg-white/70" : "bg-white/30")}>
        <span
          className={cn(
            "absolute top-1/2 left-0 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full shadow-md transition-transform duration-200",
            on ? "translate-x-4 bg-white text-black" : "-translate-x-0.5 bg-[#717171] text-white",
          )}
        >
          {on ? <Play className="h-2.5 w-2.5 fill-current" /> : <Pause className="h-2.5 w-2.5 fill-current" />}
        </span>
      </span>
    </button>
  );
}
