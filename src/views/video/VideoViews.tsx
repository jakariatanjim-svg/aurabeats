import { useMemo, useRef, useState } from "react";
import { ArrowLeft, Bookmark, Clock, History, ListVideo, Sparkles, Rss, ThumbsUp, Trash2, Users, X } from "lucide-react";
import { useFeed } from "@/hooks/useFeed";
import { useVideoLibrary, videoLibrary } from "@/hooks/useVideoLibrary";
import { followingFeed, recommendedVideos } from "@/services/video/api";
import type { VideoItem } from "@/services/video/types";
import { Avatar, VideoCard, VideoGrid, VideoGridSkeleton, VideoRow } from "@/components/video/VideoCards";
import { Button, Chip, SectionHeader } from "@/components/ui";
import { EmptyState, ErrorState } from "@/components/states";
import { routeToPath, type RouteKey } from "@/routes";
import { openSearch } from "@/utils/searchNav";
import { playlistVideos, syncAccount, useYtAccount, type YtPlaylist } from "@/services/ytAccount";

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

export function VideoHomeView({ onNavigate }: { onNavigate: (r: RouteKey) => void }) {
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
  const acc = useYtAccount();
  const [src, setSrc] = useState<"yt" | "local">("yt");
  if (!acc.signedIn) return <LocalFollowing />;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Chip active={src === "yt"} onClick={() => setSrc("yt")}>
          YouTube · {acc.subs.length}
        </Chip>
        <Chip active={src === "local"} onClick={() => setSrc("local")}>
          On this device
        </Chip>
      </div>
      {src === "yt" ? <AccountFollowing /> : <LocalFollowing {...props} />}
    </div>
  );
}

/** Subscriptions of the signed-in YouTube account (app). */
function AccountFollowing() {
  const acc = useYtAccount();
  const progress = useProgress();
  const [channels, setChannels] = useState(false);
  const [limit, setLimit] = useState(24);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm font-bold text-ink">
          {acc.subs.length} subscription{acc.subs.length === 1 ? "" : "s"}
        </p>
        <Chip active={channels} onClick={() => setChannels((m) => !m)}>
          {channels ? "Done" : "Channels"}
        </Chip>
        <Chip onClick={() => void syncAccount()}>{acc.syncing ? "Syncing…" : "Refresh"}</Chip>
      </div>

      {channels && (
        <div className="blur-panel divide-y divide-line rounded-2xl">
          {acc.subs.map((c) => (
            <a key={c.id} href={routeToPath(`channel:${c.id}`)} data-nav="true" className="flex items-center gap-3 px-3.5 py-2.5 hover:bg-ink/[0.04]">
              <Avatar name={c.name} src={c.avatar} channelId={c.id} className="h-9 w-9" />
              <span className="truncate text-sm font-semibold text-ink">{c.name}</span>
            </a>
          ))}
        </div>
      )}

      {acc.subsFeed.length ? (
        <>
          <VideoGrid>
            {acc.subsFeed.slice(0, limit).map((v) => (
              <VideoCard key={v.id} v={v} progress={progress.get(v.id)} />
            ))}
          </VideoGrid>
          {acc.subsFeed.length > limit && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setLimit((l) => l + 24)}>
                Show more
              </Button>
            </div>
          )}
        </>
      ) : acc.syncing ? (
        <VideoGridSkeleton />
      ) : (
        <EmptyState title="No new videos from your subscriptions" action={<Button onClick={() => void syncAccount()}>Refresh</Button>} />
      )}
    </div>
  );
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
  const lib = useVideoLibrary();
  const progress = useProgress();
  const acc = useYtAccount();
  const [tab, setTab] = useState<"history" | "later" | "liked" | "playlists">(lib.later.length && !lib.history.length ? "later" : "history");
  const [openPl, setOpenPl] = useState<YtPlaylist | null>(null);
  const accountTab = tab === "liked" || tab === "playlists";

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
        {acc.signedIn && (
          <>
            <Chip active={tab === "liked"} onClick={() => setTab("liked")}>
              <span className="flex items-center gap-1.5">
                <ThumbsUp className="h-3.5 w-3.5" /> Liked · {acc.liked.length}
              </span>
            </Chip>
            <Chip
              active={tab === "playlists"}
              onClick={() => {
                setTab("playlists");
                setOpenPl(null);
              }}
            >
              <span className="flex items-center gap-1.5">
                <ListVideo className="h-3.5 w-3.5" /> Playlists · {acc.playlists.length}
              </span>
            </Chip>
          </>
        )}
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

      {accountTab ? (
        tab === "liked" ? (
          acc.liked.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {acc.liked.map((v) => (
                <VideoRow key={v.id} v={v} progress={progress.get(v.id)} />
              ))}
            </div>
          ) : (
            <EmptyState title={acc.syncing ? "Loading…" : "No liked videos"} />
          )
        ) : openPl ? (
          <PlaylistDetail pl={openPl} onBack={() => setOpenPl(null)} progress={progress} />
        ) : acc.playlists.length ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
            {acc.playlists.map((p) => (
              <button key={p.id} type="button" onClick={() => setOpenPl(p)} className="focus-ring group text-left">
                <div className="relative aspect-video overflow-hidden rounded-2xl bg-ink/10">
                  {p.thumbnail && <img src={p.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />}
                  <span className="absolute inset-y-0 right-0 flex w-2/5 flex-col items-center justify-center gap-1 bg-black/65 text-[11px] font-bold text-white backdrop-blur-sm">
                    <ListVideo className="h-4 w-4" />
                    {p.countText}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-[13px] font-semibold text-ink">{p.title}</p>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title={acc.syncing ? "Loading…" : "No playlists"} />
        )
      ) : list.length === 0 ? (
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

/** Videos of one of the account's playlists. */
function PlaylistDetail({ pl, onBack, progress }: { pl: YtPlaylist; onBack: () => void; progress: Map<string, number> }) {
  const feed = useFeed<VideoItem[]>(`account:pl:${pl.id}`, () => playlistVideos(pl.id), { ttl: 15 * 60 * 1000 });
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onBack} className="-ml-2">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <p className="truncate text-base font-bold text-ink">{pl.title}</p>
      </div>
      {feed.data ? (
        feed.data.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {feed.data.map((v) => (
              <VideoRow key={v.id} v={v} progress={progress.get(v.id)} />
            ))}
          </div>
        ) : (
          <EmptyState title="This playlist is empty" />
        )
      ) : feed.error ? (
        <ErrorState message={feed.error} onRetry={feed.refresh} />
      ) : (
        <VideoGridSkeleton count={4} />
      )}
    </div>
  );
}
