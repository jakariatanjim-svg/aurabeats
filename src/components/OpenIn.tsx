/**
 * Small "Play in YouTube" / "Play in YouTube Music" links, tucked in quietly.
 * Videos and Shorts: YouTube. Songs: both (most songs are on both). Songs
 * from other sources get a search on YouTube / YouTube Music instead.
 */
import { Disc3, ExternalLink, Play } from "lucide-react";
import { cn } from "@/utils/cn";

const Glyph = () => <Play className="h-3 w-3 fill-current text-[#ff0033]" />;
const MusicGlyph = () => <Disc3 className="h-3 w-3 text-[#ff0033]" />;

function Pill({ href, music, children, dark }: { href: string; music?: boolean; children: string; dark?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap transition",
        dark ? "border-white/20 text-white/85 hover:bg-white/10" : "border-line text-ink2 hover:bg-ink/[0.06] hover:text-ink",
      )}
    >
      {music ? <MusicGlyph /> : <Glyph />}
      {children}
      <ExternalLink className="h-2.5 w-2.5 opacity-60" />
    </a>
  );
}

export function OpenIn({
  kind,
  id,
  query,
  className,
  dark,
}: {
  kind: "video" | "short" | "song";
  /** YouTube video id, when known */
  id?: string | null;
  /** songs without a YouTube id: what to search for */
  query?: string;
  className?: string;
  dark?: boolean;
}) {
  const q = encodeURIComponent(query ?? "");
  const yt = id ? (kind === "short" ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`) : `https://www.youtube.com/results?search_query=${q}`;
  const ytm = id ? `https://music.youtube.com/watch?v=${id}` : `https://music.youtube.com/search?q=${q}`;
  if (!id && !query) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <Pill href={yt} dark={dark}>
        Play in YouTube
      </Pill>
      {kind === "song" && (
        <Pill href={ytm} music dark={dark}>
          Play in YouTube Music
        </Pill>
      )}
    </span>
  );
}
