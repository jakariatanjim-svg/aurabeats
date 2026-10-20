import { useEffect, useRef, type ReactNode } from "react";
import { Heart, Loader2, Play, RefreshCw } from "lucide-react";
import { useDiscoverFeed } from "@/hooks/useDiscoverFeed";
import { FeedCard, FeedCardSkeleton } from "@/components/FeedCard";
import { IconButton } from "@/components/ui";
import { ErrorState } from "@/components/states";
import { usePlayer } from "@/hooks/usePlayer";

/** One column on phones (like the YouTube app), more as the screen grows. */
const GRID = "grid grid-cols-1 gap-x-4 gap-y-7 min-[560px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4";

export function HomeView(_props: { onNavigate?: (r: "radio" | "search") => void }) {
  const { playAll, favorites, history } = usePlayer();

  const feed = useDiscoverFeed(favorites, history);
  const hasFavourites = favorites.length > 0;

  // Infinite scroll: load the next page when the end of the feed comes near.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(feed.loadMore);
  loadMoreRef.current = feed.loadMore;
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMoreRef.current();
      },
      { rootMargin: "900px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [feed.done]);

  return (
    <div className="space-y-10 pb-12">
      {/* For you — infinite, from favourites (= subscriptions) + listening */}
      <section>
        <FeedHeader
          icon={<Heart className="h-5 w-5 fill-current text-rose-500" />}
          title="For you"
          subtitle={hasFavourites ? "Songs like the ones you hearted" : "Built only from songs you heart"}
          onPlayAll={feed.items.length ? () => playAll(feed.items, 0) : undefined}
          onRefresh={hasFavourites ? feed.refresh : undefined}
        />

        {!hasFavourites && (
          <div className="blur-panel glass-inset mb-6 flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-500/12 text-rose-500">
              <Heart className="h-5 w-5" />
            </span>
            <p className="text-[13px] leading-snug text-ink2 sm:text-sm">
              Tap <Heart className="inline h-3.5 w-3.5 -translate-y-px text-rose-500" /> on songs you like. For you then fills up with
              songs like them and more from those artists — nothing else.
            </p>
          </div>
        )}

        {feed.error && feed.items.length === 0 ? (
          <ErrorState message={feed.error} onRetry={feed.refresh} />
        ) : (
          <>
            <div className={GRID}>
              {feed.items.map((t) => (
                <FeedCard key={t.id} track={t} context={feed.items} />
              ))}
              {feed.loading && Array.from({ length: feed.items.length ? 3 : 6 }).map((_, i) => <FeedCardSkeleton key={`s${i}`} />)}
            </div>
            <div ref={sentinelRef} className="h-px" />
            {!feed.loading && !feed.done && feed.items.length > 0 && (
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={() => void feed.loadMore()}
                  className="rounded-full border border-line px-5 py-2 text-sm font-semibold text-ink2 transition hover:border-accent hover:text-accent"
                >
                  Load more
                </button>
              </div>
            )}
            {feed.loading && feed.items.length > 0 && (
              <div className="mt-6 flex justify-center text-ink3">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            )}
            {feed.done && feed.items.length > 0 && (
              <p className="mt-10 text-center text-xs text-ink3">
                You're all caught up
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function FeedHeader({
  icon,
  title,
  subtitle,
  onPlayAll,
  onRefresh,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onPlayAll?: () => void;
  onRefresh?: () => void;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-xl font-black tracking-tight text-ink sm:text-2xl">
          {icon}
          <span data-tip={subtitle}>{title}</span>
        </h2>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {onRefresh && (
          <IconButton onClick={onRefresh} aria-label={`Refresh ${title}`} size="sm">
            <RefreshCw className="h-4 w-4" />
          </IconButton>
        )}
        {onPlayAll && (
          <button
            type="button"
            onClick={onPlayAll}
            className="inline-flex items-center gap-1.5 ab-primary rounded-full px-3.5 py-1.5 text-xs font-bold transition hover:opacity-90 active:scale-95"
          >
            <Play className="h-3 w-3 fill-current" />
            Play all
          </button>
        )}
      </div>
    </div>
  );
}
