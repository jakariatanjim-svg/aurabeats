import { useState } from "react";
import { Music2, Mic2 } from "lucide-react";
import { cn } from "@/utils/cn";
import { searchOtherSourcesPage } from "@/services/catalog";
import { searchTracksPage } from "@/services/youtube";
import { TrackRow, TrackRowSkeleton } from "@/components/TrackList";
import { Button, Spinner } from "@/components/ui";
import { EmptyState, ErrorState } from "@/components/states";
import { storage } from "@/utils/storage";
import { useUrlQuery } from "@/utils/searchNav";
import { usePlayer } from "@/hooks/usePlayer";
import { usePagedSearch } from "@/hooks/usePagedSearch";
import type { Track } from "@/types";

const norm = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Music search results. The search itself happens in the top bar; the term
 * comes from the address (/search?q=…). YouTube Music is the default; the
 * other catalogues load only when you open the "Other Sources" tab. Both
 * keep loading more as you scroll, for as long as there are results.
 */
export function SearchView() {
  const submitted = useUrlQuery();
  const { settings } = usePlayer();
  const [view, setView] = useState<"ytmusic" | "sources">(
    () => (settings.rememberSearchTab ? storage.get("lastSearchTab", "ytmusic") : "ytmusic") as "ytmusic" | "sources"
  );
  const enabled = submitted.length > 0;

  const list = usePagedSearch<Track>(
    enabled ? `music:${view}:${submitted}` : null,
    view === "ytmusic"
      ? (cursor) => searchTracksPage(submitted, cursor).then((r) => ({ items: r.tracks, next: r.next }))
      : (cursor) => searchOtherSourcesPage(submitted, cursor),
    view === "ytmusic" ? (t) => t.id : (t) => `${norm(t.title)}|${norm(t.artist)}`,
  );
  const tracks = list.items ?? [];

  if (!enabled) {
    return (
      <EmptyState
        title="Search music"
        hint="Use the search at the top — your recent and trending searches show up there."
      />
    );
  }

  return (
    <div className="space-y-4 pb-4">
      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {([
          { key: "ytmusic" as const, label: "YT Music", icon: Music2 },
          { key: "sources" as const, label: "Other Sources", icon: Mic2 },
        ]).map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" onClick={() => {
            setView(key);
            if (settings.rememberSearchTab) storage.set("lastSearchTab", key);
          }}
            className={cn(
              "focus-ring inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition active:scale-95",
              view === key
                ? "bg-accent text-white shadow-[0_8px_24px_-14px_var(--glow)]"
                : "border border-line bg-ink/[0.03] text-ink3 hover:text-ink",
            )}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      <section className="space-y-4 animate-fade-in">
        <h2 className="text-xl font-black tracking-tight text-ink sm:text-2xl">
          {view === "ytmusic" ? "YouTube Music" : "Other Sources"}
        </h2>

        {list.error && !list.items ? (
          <ErrorState message={list.error} onRetry={list.retry} />
        ) : !list.items ? (
          <TrackRowSkeleton rows={8} />
        ) : tracks.length === 0 ? (
          <EmptyState title={`No results for "${submitted}"`} hint="Try another keyword or switch tabs." />
        ) : (
          <div className="blur-panel glass-inset overflow-hidden rounded-2xl p-1.5 sm:p-2">
            {tracks.map((track, i) => (
              <TrackRow key={track.id} track={track} context={tracks} index={i} />
            ))}
            <div ref={list.sentinel} />
            {list.more && <div className="flex justify-center p-5"><Spinner /></div>}
            {list.moreError && (
              <div className="flex justify-center p-4">
                <Button variant="outline" onClick={list.loadMore}>Try again</Button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
