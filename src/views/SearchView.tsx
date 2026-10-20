import { useEffect, useState } from "react";
import { Music2, Mic2 } from "lucide-react";
import { cn } from "@/utils/cn";
import { useFeed } from "@/hooks/useFeed";
import { searchYTMusic, searchOtherSources } from "@/services/catalog";
import { TrackRow, TrackRowSkeleton } from "@/components/TrackList";
import { Spinner } from "@/components/ui";
import { EmptyState, ErrorState } from "@/components/states";
import { storage } from "@/utils/storage";
import { useUrlQuery } from "@/utils/searchNav";
import { usePlayer } from "@/hooks/usePlayer";
import type { Track } from "@/types";

/**
 * Music search results. The search itself happens in the top bar; the term
 * comes from the address (/search?q=…). YouTube Music is the default; the
 * other catalogues load only when you open the "Other Sources" tab.
 */
export function SearchView() {
  const submitted = useUrlQuery();
  const { settings } = usePlayer();
  const [view, setView] = useState<"ytmusic" | "sources">(
    () => (settings.rememberSearchTab ? storage.get("lastSearchTab", "ytmusic") : "ytmusic") as "ytmusic" | "sources"
  );
  const [visibleCount, setVisibleCount] = useState(20);
  const enabled = submitted.length > 0;

  useEffect(() => { setVisibleCount(20); }, [submitted, view]);

  const ytFeed = useFeed<Track[]>(
    `search:yt:${submitted}`,
    () => searchYTMusic(submitted, 100),
    { enabled: enabled && view === "ytmusic", ttl: 10 * 60 * 1000 },
  );

  const otherFeed = useFeed<Track[]>(
    `search:other:${submitted}`,
    () => searchOtherSources(submitted, 80),
    { enabled: enabled && view === "sources", ttl: 10 * 60 * 1000 },
  );

  const activeFeed = view === "ytmusic" ? ytFeed : otherFeed;
  const allTracks = activeFeed.data ?? [];
  const displayed = allTracks.slice(0, visibleCount);

  useEffect(() => {
    if (!activeFeed.data) return;
    const el = document.getElementById("ab-scroll");
    if (!el) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (scrollHeight - scrollTop - clientHeight < 400) {
        setVisibleCount((c) => Math.min(c + 20, activeFeed.data!.length));
      }
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [activeFeed.data]);

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

      {/* Results */}
      {(
        <section className="space-y-4 animate-fade-in">
          <div className="flex items-end justify-between">
            <h2 className="text-xl font-black tracking-tight text-ink sm:text-2xl">
              {view === "ytmusic" ? "YouTube Music" : "Other Sources"}
            </h2>
            {allTracks.length > 0 && (
              <span className="rounded-full border border-line bg-ink/[0.05] px-3 py-1 text-xs font-bold text-ink3">
                {allTracks.length} found
              </span>
            )}
          </div>

          {activeFeed.error && !activeFeed.data ? (
            <ErrorState message={activeFeed.error} onRetry={activeFeed.refresh} />
          ) : activeFeed.loading && !activeFeed.data ? (
            <TrackRowSkeleton rows={8} />
          ) : allTracks.length === 0 ? (
            <EmptyState title={`No results for "${submitted}"`} hint="Try another keyword or switch tabs." />
          ) : (
            <div className="blur-panel glass-inset overflow-hidden rounded-2xl p-1.5 sm:p-2">
              {displayed.map((track, i) => (
                <TrackRow key={track.id} track={track} context={allTracks} index={i} />
              ))}
              {activeFeed.loading && <div className="flex justify-center p-6"><Spinner /></div>}
              {!activeFeed.loading && allTracks.length > 0 && visibleCount >= allTracks.length && (
                <p className="py-4 text-center text-xs text-ink3">
                  {allTracks.length} tracks loaded
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
