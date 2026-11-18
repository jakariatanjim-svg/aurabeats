/** Artwork-coloured light wash, not a beat visualizer. Broad overlapping
 * gradients drift very slowly without hard ribbons, rays or orbiting dots.
 * CSS owns motion; pause and reduced-motion need no canvas or render loop.
 */
import { useEffect, useState, type CSSProperties } from "react";
import { songPalette, type Rgb } from "@/utils/songPalette";

export function SongAura({ id, art, playing, className }: { id: string; art?: string; playing: boolean; className?: string }) {
  const [palette, setPalette] = useState<{ id: string; colors: Rgb[] } | null>(null);
  useEffect(() => {
    let alive = true;
    void songPalette.of(art, id).then((colors) => {
      if (alive) setPalette({ id, colors });
    });
    return () => { alive = false; };
  }, [id, art]);
  const colors = palette?.id === id ? palette.colors : songPalette.fallback(id);
  const style = Object.fromEntries(colors.slice(0, 3).map((rgb, i) => [`--wash-${i + 1}`, `rgb(${rgb.join(" ")})`])) as CSSProperties;
  return (
    <div className={className} aria-hidden="true">
      <div className="ab-song-wash" data-playing={playing} style={style}>
        <i className="ab-wash-layer ab-wash-one" />
        <i className="ab-wash-layer ab-wash-two" />
      </div>
    </div>
  );
}
