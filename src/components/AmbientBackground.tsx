/**
 * Liquid Glass: the living light behind the whole app — soft colour clouds
 * that slowly drift and turn, a faint sweep of light and a fine grain, so it
 * looks like light behind frosted glass rather than a flat picture. In Music
 * the colours follow the song playing; Video has its own cinema colours.
 * Styles live in the Liquid Glass theme (themes/liquid.css), so nothing of it
 * runs with Material.
 */
import { useEffect, useRef } from "react";
import { usePlayer } from "@/hooks/usePlayer";
import { useTheme } from "@/hooks/useTheme";
import { songPalette } from "@/utils/songPalette";

export function AmbientBackground() {
  const { current } = usePlayer();
  const { theme } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const art = current ? current.artwork || current.artworkLarge : undefined;
  const id = current?.id;
  useEffect(() => {
    const el = ref.current;
    if (!el || theme !== "liquid") return;
    if (!id) {
      for (const n of [1, 2, 3]) el.style.removeProperty(`--amb-song-${n}`);
      return;
    }
    let alive = true;
    void songPalette.of(art, id).then((c) => {
      if (!alive) return;
      c.slice(0, 3).forEach((rgb, i) => el.style.setProperty(`--amb-song-${i + 1}`, `rgb(${rgb.join(" ")})`));
    });
    return () => {
      alive = false;
    };
  }, [id, art, theme]);
  if (theme !== "liquid") return null;
  return (
    <div ref={ref} className="ab-ambient" aria-hidden="true">
      <i className="ab-amb ab-amb-1" />
      <i className="ab-amb ab-amb-2" />
      <i className="ab-amb ab-amb-3" />
      <i className="ab-amb ab-amb-4" />
    </div>
  );
}
