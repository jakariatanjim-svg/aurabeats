import { useMemo, useRef, useState } from "react";
import { Bookmark, Clock, History, Sparkles, Rss, Trash2, Users, X } from "lucide-react";
import { useFeed } from "@/hooks/useFeed";
import { useVideoLibrary, videoLibrary } from "@/hooks/useVideoLibrary";
import { followingFeed, recommendedVideos } from "@/services/video/api";
import type { VideoItem } from "@/services/video/types";
import { Avatar, VideoCard, VideoGrid, VideoGridSkeleton, VideoRow } from "@/components/video/VideoCards";
import { Button, Chip, SectionHeader } from "@/components/ui";
import { EmptyState, ErrorState } from "@/components/states";
import { routeToPath, type RouteKey } from "@/routes";
import { openSearch } from "@/utils/searchNav";
import { useYtSession } from "@/services/yt/session";
import { YtFollowing, YtHome, YtLibrary } from "./YtViews";

function useProgress() {
  const lib = useVideoLibrary();
  return useMemo(() => {
    const m = new Map<string, number>();
    for (const h of lib.history) if (h.duration) m.set(h.id, h.position / h.duration);
    return m;
  }, [lib.history]);
}

function useFollowingFeed() {
  const lib = useVideoLibrary();
  const ids = lib.follows.map((c) => c.id);
  const key = `video:following:${ids.slice().sort().join(",")}`;
  return {
    ids,
    feed: useFeed<VideoItem[]>(key, () => followingFeed(ids), { enabled: ids.length > 0, ttl: 15 * 60 * 1000 }),
  };
}

/* --------------------------------- Home ---------------------------------- */

export function VideoHomeView(props: { onNavigate: (r: RouteKey) => void }) {
  return useYtSession() ? <YtHome /> : <LocalHome {...props} />;
}

/** Guest mode: built from what you watched and the channels you follow. */
function LocalHome({ onNavigate }: { onNavigate: (r: RouteKey) => void }) {
  const lib = useVideoLibrary();
  const progress = useProgress();
  const { ids, feed } = useFollowingFeed();

  // Recommended: only from what you watched + channels you follow.
  const seeds = lib.history.slice(0, 6);
  const recKey = `video:rec:${seeds.map((h) => h.id).join(",")}:${ids.slice().sort().join(",")}`;
  const shownFollow = (feed.data ?? []).slice(0, 8).map((v) => v.id);
  const rec = useFeed<VideoItem[]>(recKey, () => recommendedVideos(seeds, ids, shownFollow), {
    enabled: seeds.length > 0 || ids.length > 0,
    ttl: 20 * 60 * 1000,
  });
  // Keep the previous list on screen while a new one loads (no blank flash).
  const lastRec = useRef<VideoItem[] | null>(null);
  if (rec.data?.length) lastRec.current = rec.data;
  const recList = rec.data?.length ? rec.data : lastRec.current;

  const continueWatching = lib.history
    .filter((h) => h.duration > 0 && h.position > 30 && h.position < h.duration - 30)
    .slice(0, 4);

  return (
    <div className="space-y-10">
      {continueWatching.length > 0 && (
        <section>
          <SectionHeader title="Continue watching" icon={<History className="h-5 w-5 text-accent" />} />
          <VideoGrid>
            {continueWatching.map((v) => (
              <VideoCard key={v.id} v={v} progress={progress.get(v.id)} />
            ))}
          </VideoGrid>
        </section>
      )}

      {ids.length > 0 ? (
        <section>
          <SectionHeader
            title="New from your channels"
            icon={<Rss className="h-5 w-5 text-accent" />}
            action={
              <Button variant="ghost" className="shrink-0 text-xs whitespace-nowrap" onClick={() => onNavigate("video-subs")}>
                See all
              </Button>
            }
          />
          {feed.data ? (
            <VideoGrid>
              {feed.data.slice(0, 8).map((v) => (
                <VideoCard key={v.id} v={v} progress={progress.get(v.id)} />
              ))}
            </VideoGrid>
          ) : feed.error ? (
            <ErrorState message={feed.error} onRetry={feed.refresh} />
          ) : (
            <VideoGridSkeleton count={4} />
          )}
        </section>
      ) : (
        <section className="blur-panel flex items-start gap-3 rounded-2xl p-4">
          <Users className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <p className="text-[13px] leading-relaxed text-ink2">
            <b className="text-ink">Follow channels</b> to see their newest videos here — saved on this device, no account needed.
            Tap <b className="text-ink">Follow</b> under any video or on a channel page.
          </p>
        </section>
      )}

      {(seeds.length > 0 || ids.length > 0) && (
        <section>
          <SectionHeader title="Recommended for you" icon={<Sparkles className="h-5 w-5 text-accent" />} />
          {recList ? (
            <VideoGrid>
              {recList.map((v) => (
                <VideoCard key={v.id} v={v} progress={progress.get(v.id)} />
              ))}
            </VideoGrid>
          ) : rec.error ? (
            <ErrorState message={rec.error} onRetry={rec.refresh} />
          ) : (
            <VideoGridSkeleton />
          )}
        </section>
      )}
      {seeds.length === 0 && ids.length === 0 && (
        <EmptyState
          title="Try searching to get started"
          hint="Your home feed is built only from videos you watch and channels you follow."
          action={<Button onClick={openSearch}>Search</Button>}
        />
      )}
    </div>
  );
}

/* ------------------------------- Following ------------------------------- */

export function VideoSubsView(props: { onNavigate?: (r: RouteKey) => void }) {
  return useYtSession() ? <YtFollowing /> : <LocalFollowing {...props} />;
}

/** Channels followed on this device (guest mode). */
function LocalFollowing(_props: { onNavigate?: (r: RouteKey) => void }) {
  const lib = useVideoLibrary();
  const progress = useProgress();
  const { ids, feed } = useFollowingFeed();
  const [manage, setManage] = useState(false);
  const [limit, setLimit] = useState(24);

  if (!ids.length) {
    return (
      <EmptyState
        title="Not following any channels yet"
        hint="Search for a channel or open any video and tap Follow. Their newest uploads will show up here, straight from YouTube — no account needed."
        action={<Button onClick={openSearch}>Find channels</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm font-bold text-ink">
          {ids.length} channel{ids.length === 1 ? "" : "s"}
        </p>
        <Chip active={manage} onClick={() => setManage((m) => !m)}>
          {manage ? "Done" : "Manage"}
        </Chip>
        <Chip onClick={feed.refresh}>Refresh</Chip>
      </div>

      {manage && (
        <div className="blur-panel divide-y divide-line rounded-2xl">
          {lib.follows.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <a href={routeToPath(`channel:${c.id}`)} data-nav="true" className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={c.name} src={c.avatar} channelId={c.id} className="h-9 w-9" />
                <span className="truncate text-sm font-semibold text-ink">{c.name}</span>
              </a>
              <Button variant="outline" className="px-3 py-1.5 text-xs" onClick={() => videoLibrary.toggleFollow(c)}>
                Unfollow
              </Button>
            </div>
          ))}
        </div>
      )}

      {feed.data ? (
        <>
          <VideoGrid>
            {feed.data.slice(0, limit).map((v) => (
              <VideoCard key={v.id} v={v} progress={progress.get(v.id)} />
            ))}
          </VideoGrid>
          {feed.data.length > limit && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setLimit((l) => l + 24)}>
                Show more
              </Button>
            </div>
          )}
        </>
      ) : feed.error ? (
        <ErrorState message={feed.error} onRetry={feed.refresh} />
      ) : (
        <VideoGridSkeleton />
      )}
    </div>
  );
}

/* -------------------------------- Library -------------------------------- */

export function VideoLibraryView() {
  return useYtSession() ? <YtLibrary /> : <LocalLibrary />;
}

function LocalLibrary() {
  const lib = useVideoLibrary();
  const progress = useProgress();
  const [tab, setTab] = useState<"history" | "later">(lib.later.length && !lib.history.length ? "later" : "history");

  const list: VideoItem[] = tab === "history" ? lib.history : lib.later;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={tab === "history"} onClick={() => setTab("history")}>
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> History · {lib.history.length}
          </span>
        </Chip>
        <Chip active={tab === "later"} onClick={() => setTab("later")}>
          <span className="flex items-center gap-1.5">
            <Bookmark className="h-3.5 w-3.5" /> Watch later · {lib.later.length}
          </span>
        </Chip>
        {tab === "history" && lib.history.length > 0 && (
          <Button
            variant="ghost"
            className="ml-auto text-xs"
            onClick={() => videoLibrary.clearHistory()}
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </Button>
        )}
      </div>

      {list.length === 0 ? (
        <EmptyState
          title={tab === "history" ? "Nothing watched yet" : "No saved videos"}
          hint={tab === "history" ? "Videos you watch appear here, with where you left off." : "Tap “Watch later” under any video to save it here."}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {list.map((v) => (
            <VideoRow
              key={v.id}
              v={v}
              progress={progress.get(v.id)}
              action={
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => (tab === "history" ? videoLibrary.removeHistory(v.id) : videoLibrary.toggleLater(v))}
                  className="shrink-0 self-start rounded-full p-2 text-ink3 transition hover:bg-ink/[0.07] hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
