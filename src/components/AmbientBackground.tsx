/** Accent-coloured Liquid Glass backdrop. This belongs to the app theme;
 * the full music player has its own artwork-coloured light (SongAura).
 */
import { useTheme } from "@/hooks/useTheme";

export function AmbientBackground() {
  const { theme } = useTheme();
  if (theme !== "liquid") return null;
  return (
    <div className="ab-ambient" aria-hidden="true">
      <i className="ab-amb ab-amb-1" />
      <i className="ab-amb ab-amb-2" />
      <i className="ab-amb ab-amb-3" />
    </div>
  );
}
