/**
 * Video pages for a signed-in YouTube account: YouTube's recommendations on
 * Home, subscriptions on Following, and the account's library.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Bookmark, Clock, ListVideo, Plus, RefreshCw, ThumbsUp, UserRound, X } from "lucide-react";
import { useVideoLibrary } from "@/hooks/useVideoLibrary";
import { dropYtLists, useYtPaged, type PagedState } from "@/hooks/useYtPaged";
import { usePlayer } from "@/hooks/usePlayer";
import { Avatar, VideoCard, VideoGrid, VideoGridSkeleton, VideoRow, VideoRowSkeleton } from "@/components/video/VideoCards";
import { NewPlaylistForm } from "@/components/video/YtActions";
import { Button, Chip, Modal, Spinner } from "@/components/ui";
import { EmptyState, ErrorState } from "@/components/states";
import { routeToPath } from "@/routes";
import { storage } from "@/utils/storage";
import { useBackHandler } from "@/utils/backStack";
import type { YtPage, YtPlaylist, YtVideo } from "@/services/yt/library";
import {
  loadSubscriptions,
  setInPlaylist,
  setSubscribed,
  useYtSubscriptions,
  setLiked,
  ytHistory,
  ytHome,
  ytLiked,
  ytPlaylists,
  ytPlaylistVideos,
  ytSubsFeed,
  ytWatchLater,
} from "@/services/yt/library";
import { useYtSession } from "@/services/yt/session";

const videosOf = (p: YtPage) => p.videos;

export function useProgressMap() {
  const lib = useVideoLibrary();
  return useMemo(() => {
    const m = new Map<string, number>();
    for (const h of lib.history) if (h.duration) m.set(h.id, h.position / h.duration);
    return m;
  }, [lib.history]);
}

/** Loads the next page when it scrolls into view (endless lists). */
export function LoadMore({ st, onMore }: { st: PagedState<unknown>; onMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const more = useRef(onMore);
  more.current = onMore;
  const can = !!st.next && !st.loading && !st.error;
  useEffect(() => {
    const el = ref.current;
    if (!el || !can) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && more.current(), { rootMargin: "900px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [can, st.items.length]);
  if (!st.next && !st.error) return null;
  return (
    <div ref={ref} className="flex justify-center py-6">
      {st.error ? (
        <Button variant="outline" onClick={onMore}>
          <RefreshCw className="h-4 w-4" /> Try again
        </Button>
      ) : (
        <Spinner />
      )}
    </div>
  );
}

/** One endless list of videos (cards or rows). */
function VideoList({
  name,
  load,
  rows,
  empty,
  action,
}: {
  name: string;
  load: (cursor?: string) => Promise<YtPage>;
  rows?: boolean;
  empty: string;
  action?: (v: YtVideo, remove: () => void) => ReactNode;
}) {
  const progress = useProgressMap();
  const list = useYtPaged<YtVideo>(name, load, videosOf);
  if (!list.items.length) {
    if (list.error) return <ErrorState message={list.error} onRetry={list.refresh} />;
    if (list.loading || !list.started) return rows ? <VideoRowSkeleton /> : <VideoGridSkeleton />;
    return <EmptyState title={empty} action={<Button variant="outline" onClick={list.refresh}>Refresh</Button>} />;
  }
  const items = rows ? (
    <div className="grid gap-3 lg:grid-cols-2">
      {list.items.map((v) => (
        <VideoRow key={v.id} v={v} progress={progress.get(v.id)} action={action?.(v, () => list.remove((x) => x.id === v.id))} />
      ))}
    </div>
  ) : (
    <VideoGrid>
      {list.items.map((v) => (
        <VideoCard key={v.id} v={v} progress={progress.get(v.id)} />
      ))}
    </VideoGrid>
  );
  return (
    <>
      {items}
      <LoadMore st={list} onMore={list.more} />
    </>
  );
}

/* --------------------------------- Home ---------------------------------- */

export function YtHome() {
  return <VideoList name="home" load={ytHome} empty="No recommendations yet" />;
}

/* ------------------------------- Following ------------------------------- */

const importKey = (sessionKey: string) => `ytacct:followsImported:${sessionKey}`;

/** One-time offer: subscribe to the channels followed on this device. */
function ImportFollows() {
  const session = useYtSession();
  const lib = useVideoLibrary();
  const subs = useYtSubscriptions();
  const { toast } = usePlayer();
  const [done, setDone] = useState(() => !!session && storage.get<boolean>(importKey(session.key), false));
  const [busy, setBusy] = useState<number | null>(null);
  if (!session || done || !subs.list) return null;
  const todo = lib.follows.filter((c) => !subs.list!.some((s) => s.id === c.id));
  if (!todo.length) return null;

  const finish = () => {
    storage.set(importKey(session.key), true);
    setDone(true);
  };
  const run = async () => {
    let ok = 0;
    for (let i = 0; i < todo.length; i++) {
      setBusy(i + 1);
      try {
        await setSubscribed({ id: todo[i].id, name: todo[i].name, avatar: todo[i].avatar }, true);
        ok++;
      } catch {
        /* keep going */
      }
    }
    setBusy(null);
    finish();
    dropYtLists("subs-feed");
    toast(ok === todo.length ? `Subscribed to ${ok} channels` : `Subscribed to ${ok} of ${todo.length} channels`, ok ? "success" : "error");
  };

  return (
    <section className="blur-panel flex flex-wrap items-center gap-3 rounded-2xl p-4">
      <div className="flex -space-x-2">
        {todo.slice(0, 4).map((c) => (
          <Avatar key={c.id} name={c.name} src={c.avatar} channelId={c.id} className="h-8 w-8 ring-2 ring-black/20" />
        ))}
      </div>
      <p className="min-w-0 flex-1 text-[13px] font-semibold text-ink">
        Subscribe to the {todo.length} channel{todo.length === 1 ? "" : "s"} you follow here?
      </p>
      <div className="flex gap-2">
        <Button variant="ghost" disabled={busy !== null} onClick={finish}>
          No thanks
        </Button>
        <Button disabled={busy !== null} onClick={() => void run()}>
          {busy !== null ? `${busy}/${todo.length}` : "Subscribe all"}
        </Button>
      </div>
    </section>
  );
}

export function YtFollowing() {
  const subs = useYtSubscriptions();
  const [manage, setManage] = useState(false);
  return (
    <div className="space-y-6">
      <ImportFollows />
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm font-bold text-ink">{subs.list ? `${subs.list.length} subscription${subs.list.length === 1 ? "" : "s"}` : "Subscriptions"}</p>
        <Chip active={manage} onClick={() => setManage((m) => !m)}>
          {manage ? "Done" : "Manage"}
        </Chip>
        <Chip
          onClick={() => {
            void loadSubscriptions(true);
            dropYtLists("subs-feed");
          }}
        >
          Refresh
        </Chip>
      </div>
      {manage && <ManageSubs />}
      <VideoList name="subs-feed" load={ytSubsFeed} empty="No new videos from your subscriptions" />
    </div>
  );
}

function ManageSubs() {
  const subs = useYtSubscriptions();
  const { toast } = usePlayer();
  if (!subs.list) return subs.error ? <ErrorState message={subs.error} onRetry={() => void loadSubscriptions(true)} /> : <VideoRowSkeleton count={3} />;
  if (!subs.list.length) return null;
  return (
    <div className="blur-panel max-h-[60vh] divide-y divide-line overflow-y-auto rounded-2xl">
      {subs.list.map((c) => (
        <div key={c.id} className="flex items-center gap-3 px-3.5 py-2.5">
          <a href={routeToPath(`channel:${c.id}`)} data-nav="true" className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar name={c.name} src={c.avatar} channelId={c.id} className="h-9 w-9" />
            <span className="truncate text-sm font-semibold text-ink">{c.name}</span>
          </a>
          <Button
            variant="outline"
            className="px-3 py-1.5 text-xs"
            onClick={() => void setSubscribed(c, false).then(() => dropYtLists("subs-feed"), (e) => toast((e as Error)?.message || "Couldn't reach YouTube", "error"))}
          >
            Unsubscribe
          </Button>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------- Library -------------------------------- */

type Tab = "history" | "later" | "liked" | "playlists";

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Remove"
      onClick={onClick}
      className="shrink-0 self-start rounded-full p-2 text-ink3 transition hover:bg-ink/[0.07] hover:text-ink"
    >
      <X className="h-4 w-4" />
    </button>
  );
}

/** X button: runs the YouTube edit, hides the row at once, puts it back on failure. */
function useRemover() {
  const { toast } = usePlayer();
  return (run: () => Promise<void>, hide: () => void, refresh: () => void) => () => {
    hide();
    run().catch((e) => {
      toast((e as Error)?.message || "Couldn't reach YouTube", "error");
      refresh();
    });
  };
}

export function YtLibrary() {
  const session = useYtSession();
  const [tab, setTab] = useState<Tab>("history");
  const [openPl, setOpenPl] = useState<YtPlaylist | null>(null);
  const remover = useRemover();

  const chip = (t: Tab, icon: ReactNode, label: string) => (
    <Chip
      active={tab === t}
      onClick={() => {
        setTab(t);
        setOpenPl(null);
      }}
    >
      <span className="flex items-center gap-1.5">
        {icon} {label}
      </span>
    </Chip>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {chip("history", <Clock className="h-3.5 w-3.5" />, "History")}
        {chip("later", <Bookmark className="h-3.5 w-3.5" />, "Watch later")}
        {chip("liked", <ThumbsUp className="h-3.5 w-3.5" />, "Liked")}
        {chip("playlists", <ListVideo className="h-3.5 w-3.5" />, "Playlists")}
        {session?.channelId && (
          <a
            href={routeToPath(`channel:${session.channelId}`)}
            data-nav="true"
            className="ab-chip focus-ring glass-inset flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-ink/[0.03] px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap text-ink2 transition-all duration-200 hover:border-accent/60 hover:text-ink"
          >
            <UserRound className="h-3.5 w-3.5" /> Your channel
          </a>
        )}
      </div>

      {tab === "history" && <VideoList key="history" name="history" load={ytHistory} rows empty="Nothing watched yet" />}
      {tab === "later" && (
        <VideoList
          key="later"
          name="later"
          load={ytWatchLater}
          rows
          empty="No saved videos"
          action={(v, hide) => <RemoveBtn onClick={remover(() => setInPlaylist("WL", v.id, false), hide, () => dropYtLists("later"))} />}
        />
      )}
      {tab === "liked" && (
        <VideoList
          key="liked"
          name="liked"
          load={ytLiked}
          rows
          empty="No liked videos"
          action={(v, hide) => <RemoveBtn onClick={remover(() => setLiked(v.id, false), hide, () => dropYtLists("liked"))} />}
        />
      )}
      {tab === "playlists" &&
        (openPl ? (
          <PlaylistDetail pl={openPl} onBack={() => setOpenPl(null)} />
        ) : (
          <Playlists onOpen={setOpenPl} />
        ))}
    </div>
  );
}

function Playlists({ onOpen }: { onOpen: (p: YtPlaylist) => void }) {
  const list = useYtPaged<YtPlaylist>("playlists", async () => ({ videos: [], playlists: await ytPlaylists(), channels: [] }), (p) => p.playlists);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="mr-auto text-sm font-bold text-ink">{list.started && !list.loading ? `${list.items.length} playlist${list.items.length === 1 ? "" : "s"}` : ""}</p>
        <Button variant="outline" className="text-xs" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5" /> New playlist
        </Button>
      </div>
      {list.items.length ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
          {list.items.map((p) => (
            <button key={p.id} type="button" onClick={() => onOpen(p)} className="focus-ring group text-left">
              <div className="relative aspect-video overflow-hidden rounded-2xl bg-ink/10">
                {p.thumbnail && (
                  <img src={p.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                )}
                <span className="absolute inset-y-0 right-0 flex w-2/5 flex-col items-center justify-center gap-1 bg-black/65 text-[11px] font-bold text-white backdrop-blur-sm">
                  <ListVideo className="h-4 w-4" />
                  {p.countText}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-[13px] font-semibold text-ink">{p.title}</p>
            </button>
          ))}
        </div>
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.refresh} />
      ) : list.loading || !list.started ? (
        <VideoGridSkeleton count={4} />
      ) : (
        <EmptyState title="No playlists" />
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="New playlist">
        {creating && <NewPlaylistForm onDone={() => setCreating(false)} />}
      </Modal>
    </div>
  );
}

function PlaylistDetail({ pl, onBack }: { pl: YtPlaylist; onBack: () => void }) {
  const remover = useRemover();
  useBackHandler(true, onBack);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onBack} className="-ml-2" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <p className="truncate text-base font-bold text-ink">{pl.title}</p>
      </div>
      <VideoList
        name={`pl:${pl.id}`}
        load={(c) => ytPlaylistVideos(pl.id, c)}
        rows
        empty="This playlist is empty"
        action={(v, hide) => <RemoveBtn onClick={remover(() => setInPlaylist(pl.id, v.id, false), hide, () => dropYtLists(`pl:${pl.id}`))} />}
      />
    </div>
  );
}
