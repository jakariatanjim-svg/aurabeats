/**
 * Shorts: full-height vertical videos, one per screen. Swipe / scroll /
 * mouse wheel / ↑ ↓ for the next or previous one; ← → seek inside it.
 * Phones: full screen above the bottom bar, like the YouTube app.
 * Computers: a centered vertical player with the buttons beside it.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, Maximize, MessageSquare, Minimize, Pause, Play, RotateCcw, RotateCw, MoreVertical, Share2, ThumbsUp, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/utils/cn";
import { formatCount, formatTime } from "@/utils/format";
import { usePlayer } from "@/hooks/usePlayer";
import { isNative } from "@/services/video/net";
import { getVideoAspect, getVideoMeta } from "@/services/video/api";
import { ShareSheet, shareNative } from "@/components/ShareSheet";
import { ShortsSource, takeShortsStart, type ShortItem } from "@/services/yt/shorts";
import { getWatchExtras, watchExtrasAvailable } from "@/services/yt/watch";
import { likedNow, loadLike, setLiked, subscribeLikes } from "@/services/yt/library";
import { useYtSession } from "@/services/yt/session";
import { dropYtLists } from "@/hooks/useYtPaged";
import { videoLibrary } from "@/hooks/useVideoLibrary";
import { dock } from "@/components/video/dock";
import { watchLayer } from "@/components/video/watchLayer";
import { EmbedShort, NativeShort, type ShortHandle } from "@/components/video/ShortPlayers";
import { CommentsSheet } from "@/components/video/Comments";
import { ShortMenu } from "./ShortMenu";
import { heldTooSoon } from "@/utils/keyRepeat";
import { FollowButton } from "@/components/video/YtActions";
import { Avatar } from "@/components/video/VideoCards";
import { Spinner } from "@/components/ui";
import { EmptyState } from "@/components/states";
import { routeToPath } from "@/routes";

function useWide() {
  const q = "(min-width: 768px)";
  const [ok, setOk] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setOk(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return ok;
}

export function ShortsView() {
  const wide = useWide();
  const { isPlaying, pause } = usePlayer();
  const [items, setItems] = useState<ShortItem[]>([]);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(false);
  const src = useRef<ShortsSource | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const handle = useRef<ShortHandle>(null);
  const [seekFx, setSeekFx] = useState<{ side: "l" | "r"; secs: number; key: number } | null>(null);

  // computers: full screen like YouTube's — the menu, search and side bar
  // go away and the Short fills the screen (F, double-click or the button)
  const [full, setFull] = useState(false);
  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => {});
    setFull((f) => !f);
  }, []);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => {
      document.removeEventListener("fullscreenchange", on);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  // keep the same Short in view when the size changes
  useEffect(() => {
    const el = box.current;
    if (el) requestAnimationFrame(() => (el.scrollTop = active * el.clientHeight));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full]);

  // one video at a time: the music and any other video stop
  useEffect(() => {
    if (isPlaying) pause();
    if (isNative) watchLayer.close();
    else dock.close();
    // only on opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = useCallback(async () => {
    if (!src.current || busy || ended) return;
    setBusy(true);
    const got = await src.current.more().catch(() => [] as ShortItem[]);
    setItems((cur) => {
      const ids = new Set(cur.map((s) => s.id));
      return [...cur, ...got.filter((s) => !ids.has(s.id))];
    });
    if (!got.length) setEnded(true);
    setBusy(false);
  }, [busy, ended]);

  useEffect(() => {
    const start = takeShortsStart();
    src.current = new ShortsSource(start ? start.list.slice(start.index) : undefined);
    void loadMore();
    // first page only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (items.length && active >= items.length - 3) void loadMore();
  }, [active, items.length, loadMore]);

  const go = useCallback((dir: 1 | -1) => {
    const el = box.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollTop + dir * el.clientHeight, behavior: "smooth" });
  }, []);

  const onScroll = () => {
    const el = box.current;
    if (!el || !el.clientHeight) return;
    const i = Math.round(el.scrollTop / el.clientHeight);
    if (i !== active) {
      setActive(i);
      setSeekFx(null);
    }
  };

  // seeking adds up on repeated / held presses (5 → 10 → 15 s)
  const seek = useCallback((step: number) => {
    handle.current?.seekBy(step);
    const now = Date.now();
    const side = step < 0 ? "l" : "r";
    setSeekFx((f) => ({ side, secs: f && f.side === side && now - f.key < 1000 ? f.secs + Math.abs(step) : Math.abs(step), key: now }));
  }, []);
  useEffect(() => {
    if (!seekFx) return;
    const t = setTimeout(() => setSeekFx(null), 700);
    return () => clearTimeout(t);
  }, [seekFx]);

  // keyboard: ↑ ↓ change the Short, ← → seek, Space / K pause, M mute.
  // Capture phase, so the music shortcuts underneath don't also react.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // a video page on top (app) or an open dialog / sheet owns the keys
      if (watchLayer.get().mode === "full" || document.querySelector("[role=dialog]")) return;
      const k = e.key.toLowerCase();
      if (["arrowleft", "arrowright", "j", "l"].includes(k) && heldTooSoon(e)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (k === "arrowdown") go(1);
      else if (k === "arrowup") go(-1);
      else if (k === "arrowleft") seek(-5);
      else if (k === "arrowright") seek(5);
      else if (k === "j") seek(-10);
      else if (k === "l") seek(10);
      else if (k === " " || k === "k") handle.current?.toggle();
      else if (k === "m") setMuted((m) => !m);
      else if (k === "f" && wide) toggleFull();
      else if (k === "escape" && full && !document.fullscreenElement) setFull(false);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, seek, wide, full, toggleFull]);

  // mouse wheel / touchpad: exactly one Short per gesture
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (Math.abs(e.deltaY) < 12 || now - last < 450) return;
      last = now;
      go(e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [go]);

  const view = (
    <div
      className={cn(
        wide && full
          ? "fixed inset-0 z-[78] bg-black text-white"
          : wide
            ? "relative mx-auto h-[calc(100dvh-8.5rem)] w-full"
            : "fixed inset-x-0 top-0 bottom-[calc(var(--sa-bottom)+4.95rem)] z-40 bg-black",
      )}
    >
      <div ref={box} onScroll={onScroll} className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((s, i) => (
          <Slide
            key={s.id}
            s={s}
            wide={wide}
            full={wide && full}
            onFull={toggleFull}
            active={i === active}
            near={Math.abs(i - active) <= 1}
            muted={muted}
            setMuted={setMuted}
            handle={i === active ? handle : undefined}
            seekFx={i === active ? seekFx : null}
            onSeek={seek}
          />
        ))}
        {!items.length && (busy || !ended) && (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        )}
        {!items.length && ended && !busy && (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState title="No Shorts right now" />
          </div>
        )}
      </div>

      {wide && items.length > 0 && (
        <div className="absolute top-1/2 right-2 flex -translate-y-1/2 flex-col gap-3">
          <RoundBtn label="Previous Short" onClick={() => go(-1)} disabled={active === 0} dark={full}>
            <ChevronUp className="h-6 w-6" />
          </RoundBtn>
          <RoundBtn label="Next Short" onClick={() => go(1)} dark={full}>
            <ChevronDown className="h-6 w-6" />
          </RoundBtn>
        </div>
      )}
    </div>
  );
  // phones: over the whole screen (above the top bar, below the bottom bar)
  return wide ? view : createPortal(view, document.body);
}

function RoundBtn({ label, onClick, disabled, dark, children }: { label: string; onClick: () => void; disabled?: boolean; dark?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-12 w-12 items-center justify-center rounded-full transition disabled:opacity-30",
        dark ? "bg-white/10 text-white hover:bg-white/20" : "bg-ink/[0.08] text-ink hover:bg-ink/15",
      )}
    >
      {children}
    </button>
  );
}

interface Meta {
  title?: string;
  author?: string;
  authorId?: string;
  authorAvatar?: string;
  likes?: number;
  commentsToken?: string;
  commentCount?: string;
}

function useShortMeta(s: ShortItem, on: boolean): Meta {
  const [m, setM] = useState<Meta>({ title: s.title, author: s.author, authorId: s.authorId });
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const fill = (x: Meta) => alive && setM((cur) => ({ ...x, ...Object.fromEntries(Object.entries(cur).filter(([, v]) => v !== undefined && v !== "")) }));
    if (watchExtrasAvailable()) {
      getWatchExtras(s.id)
        .then((x) => fill({ title: x.title, author: x.author, authorId: x.authorId, authorAvatar: x.authorAvatar, likes: x.likes, commentsToken: x.commentsToken, commentCount: x.commentCount }))
        .catch(() => getVideoMeta(s.id).then((x) => fill({ title: x.title, author: x.author })).catch(() => {}));
    } else {
      getVideoMeta(s.id)
        .then((x) => fill({ title: x.title, author: x.author, authorId: x.authorId }))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [s.id, on]);
  return m;
}

function Slide({
  s,
  wide,
  full,
  onFull,
  active,
  near,
  muted,
  setMuted,
  handle,
  seekFx,
  onSeek,
}: {
  s: ShortItem;
  wide: boolean;
  full: boolean;
  onFull: () => void;
  active: boolean;
  near: boolean;
  muted: boolean;
  setMuted: (m: boolean) => void;
  handle?: React.RefObject<ShortHandle | null>;
  seekFx: { side: "l" | "r"; secs: number; key: number } | null;
  onSeek: (s: number) => void;
}) {
  const meta = useShortMeta(s, near);
  const [st, setSt] = useState({ playing: false, time: 0, duration: 0, failed: undefined as string | undefined });
  const [comments, setComments] = useState(false);
  const [flash, setFlash] = useState<{ icon: "play" | "pause"; key: number } | null>(null);
  const lastTap = useRef(0);
  const pointer = useRef("touch");
  const recorded = useRef(false);
  const [menu, setMenu] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!active) setMenu(null);
  }, [active]);

  useEffect(() => {
    if (!active) setSt({ playing: false, time: 0, duration: 0, failed: undefined });
  }, [active]);

  // never music and a Short at once: whichever started last keeps playing
  const { isPlaying: musicOn, pause: pauseMusic } = usePlayer();
  const was = useRef({ music: musicOn, short: false });
  useEffect(() => {
    const w = was.current;
    if (active && musicOn && !w.music && st.playing) handle?.current?.pause();
    else if (active && st.playing && !w.short && musicOn) pauseMusic();
    was.current = { music: musicOn, short: active && st.playing };
  }, [active, musicOn, st.playing, handle, pauseMusic]);

  // remember it in the watch history once it really played
  useEffect(() => {
    if (!active || recorded.current || st.time < 2 || !meta.title) return;
    recorded.current = true;
    videoLibrary.recordProgress({ id: s.id, title: meta.title, author: meta.author ?? "", authorId: meta.authorId, duration: Math.round(st.duration), thumbnail: thumb(s) }, st.time);
  }, [active, st.time, st.duration, meta, s]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(t);
  }, [flash]);

  const tap = (e: React.MouseEvent<HTMLDivElement>) => {
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    // double tap on the sides = ±10 s: phones only. A mouse click just pauses / plays.
    if (pointer.current !== "mouse" && now - lastTap.current < 300 && (x < 0.33 || x > 0.67)) {
      onSeek(x < 0.5 ? -10 : 10);
      lastTap.current = now;
      return;
    }
    lastTap.current = now;
    setFlash({ icon: st.playing ? "pause" : "play", key: now });
    handle?.current?.toggle();
  };

  const shareUrl = `https://www.youtube.com/shorts/${s.id}`;
  const [shareOpen, setShareOpen] = useState(false);
  // app: the phone's share sheet; website: our own pop-up
  const share = async () => {
    if (!(await shareNative({ title: meta.title, url: shareUrl }))) setShareOpen(true);
  };

  const Player = isNative ? NativeShort : EmbedShort;
  const progress = st.duration ? Math.min(1, st.time / st.duration) : 0;

  // The picture's real shape, so there are no black bars: on computers the
  // player takes the video's shape (wider for a wider video, like YouTube);
  // on phones a vertical-ish video fills the screen, a wide one fits.
  const ar = useAspect(s.id, near);
  const frameAr = Math.min(16 / 9, Math.max(9 / 16, ar));
  const cover = wide || ar <= 0.8;
  const mediaStyle: React.CSSProperties = cover
    ? { width: `max(100cqw, calc(100cqh * ${ar}))`, height: `max(100cqh, calc(100cqw / ${ar}))` }
    : { width: `min(100cqw, calc(100cqh * ${ar}))`, height: `min(100cqh, calc(100cqw / ${ar}))` };
  // computers: the player's height leaves room for the title under it
  const infoRoom = full ? "4.75rem" : "5.25rem";
  const frameH = `min(calc(100cqh - ${infoRoom} - 1rem), calc((100cqw - 7rem) / ${frameAr}))`;

  const frame = (
    <div
      className={cn("group/frame relative overflow-hidden bg-black [container-type:size]", wide ? "w-full rounded-2xl" : "h-full w-full")}
      style={wide ? { height: frameH } : undefined}
    >
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" style={mediaStyle}>
        <img src={thumb(s)} alt="" className={cn("absolute inset-0 h-full w-full object-cover", active && st.time > 0 && "opacity-0")} />
        {active && (
          <Player
            ref={handle}
            id={s.id}
            muted={muted}
            onState={(x) => setSt({ playing: x.playing, time: x.time, duration: x.duration, failed: x.failed })}
          />
        )}
      </div>
      {/* taps: pause / play, double tap on the sides = ±10 s; double-click = full screen */}
      <div
        className="absolute inset-0"
        onPointerDown={(e) => (pointer.current = e.pointerType)}
        onClick={tap}
        onDoubleClick={() => wide && pointer.current === "mouse" && onFull()}
      />

      {active && st.failed && (
        <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-2xl bg-black/70 p-4 text-center text-xs text-white">
          {st.failed}
          <a href={routeToPath(`watch:${s.id}`)} data-nav="true" className="mt-2 block font-bold text-accent">
            Open as a video
          </a>
        </div>
      )}

      {flash && (
        <span key={flash.key} className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="animate-fade-in rounded-full bg-black/50 p-4 text-white">
            {flash.icon === "play" ? <Play className="h-8 w-8 fill-current" /> : <Pause className="h-8 w-8 fill-current" />}
          </span>
        </span>
      )}
      {seekFx && (
        <span
          key={seekFx.key}
          className={cn(
            "pointer-events-none absolute top-1/2 flex -translate-y-1/2 animate-fade-in items-center gap-1 rounded-full bg-black/55 px-4 py-2 text-sm font-bold text-white",
            seekFx.side === "l" ? "left-[10%]" : "right-[10%]",
          )}
        >
          {seekFx.side === "l" ? <RotateCcw className="h-4 w-4" /> : <RotateCw className="h-4 w-4" />} {seekFx.secs} seconds
        </span>
      )}

      {wide ? (
        /* computers: small controls on top, only while the mouse is over it */
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/45 to-transparent p-3 pb-8 text-white opacity-0 transition-opacity duration-200 group-hover/frame:opacity-100 focus-within:opacity-100">
          <div className="pointer-events-auto flex items-center gap-1">
            <button type="button" aria-label={st.playing ? "Pause" : "Play"} onClick={() => handle?.current?.toggle()} className="rounded-full p-2 hover:bg-white/15">
              {st.playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
            </button>
            <button type="button" aria-label={muted ? "Unmute" : "Mute"} onClick={() => setMuted(!muted)} className="rounded-full p-2 hover:bg-white/15">
              {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
          </div>
          <button
            type="button"
            aria-label={full ? "Exit full screen" : "Full screen"}
            title={full ? "Exit full screen (f)" : "Full screen (f)"}
            onClick={onFull}
            className="pointer-events-auto rounded-full p-2 hover:bg-white/15"
          >
            {full ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
          </button>
        </div>
      ) : (
        <>
          {/* phones: sound button, who / what and the buttons over the video, like the YouTube app */}
          <button
            type="button"
            aria-label={muted ? "Unmute" : "Mute"}
            onClick={() => setMuted(!muted)}
            className="absolute top-[calc(var(--sa-top)+0.75rem)] right-3 rounded-full bg-black/40 p-2.5 text-white"
          >
            {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-3 pt-16 pb-4 text-white">
            <div className="pointer-events-auto pr-16">
              <Who meta={meta} />
              {meta.title && <p className="mt-2 line-clamp-2 text-sm leading-snug">{meta.title}</p>}
            </div>
          </div>
          <div className="absolute right-2 bottom-24 flex flex-col items-center gap-4 text-white">
            <Actions id={s.id} meta={meta} onComments={() => setComments(true)} onShare={share} onMore={setMenu} overlay />
          </div>
        </>
      )}

      {/* progress */}
      {active && <ShortSeekBar progress={progress} duration={st.duration} onSeek={(t) => handle?.current?.seekTo(t)} />}
    </div>
  );

  return (
    <section className={cn("relative flex h-full snap-start snap-always items-center justify-center select-none", wide && "gap-4 py-2 [container-type:size]")}>
      {wide ? (
        <>
          {/* computers: nothing over the picture — channel and title sit
              under it, the buttons beside it, level with its bottom */}
          <div className="grid grid-cols-[auto_auto] gap-x-4">
            <div style={{ width: `calc(${frameH} * ${frameAr})` }}>{frame}</div>
            <div className="flex flex-col items-center gap-4 self-end">
              <Actions id={s.id} meta={meta} onComments={() => setComments(true)} onShare={share} onMore={setMenu} dark={full} />
            </div>
            <div className={cn("mt-3 min-w-0 px-1", full ? "text-white" : "text-ink")} style={{ width: `calc(${frameH} * ${frameAr})` }}>
              <Who meta={meta} dark={full} />
              {meta.title && <p className={cn("mt-1.5 line-clamp-2 text-sm leading-snug", full ? "text-white/85" : "text-ink2")}>{meta.title}</p>}
            </div>
          </div>
        </>
      ) : (
        frame
      )}

      {menu && active && <ShortMenu handle={handle?.current ?? null} anchor={menu} sheet={!wide} onClose={() => setMenu(null)} />}
      {meta.commentsToken && <CommentsSheet token={meta.commentsToken} count={meta.commentCount} open={comments} onClose={() => setComments(false)} side={wide} />}
      {!isNative && <ShareSheet open={shareOpen} onClose={() => setShareOpen(false)} target={{ title: meta.title, url: shareUrl }} />}
    </section>
  );
}

/** Channel picture, name and Subscribe. */
function Who({ meta, dark }: { meta: Meta; dark?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {meta.authorId ? (
        <a href={routeToPath(`channel:${meta.authorId}`)} data-nav="true" className="flex min-w-0 items-center gap-2">
          <Avatar name={meta.author ?? ""} src={meta.authorAvatar} channelId={meta.authorId} className="h-8 w-8 shrink-0" />
          <span className={cn("truncate text-sm font-bold", dark && "text-white")}>{meta.author}</span>
        </a>
      ) : (
        <span className="truncate text-sm font-bold">{meta.author}</span>
      )}
      {meta.authorId && <FollowButton ch={{ id: meta.authorId, name: meta.author ?? "", avatar: meta.authorAvatar }} className="h-8 shrink-0 px-3 text-xs" />}
    </div>
  );
}

/** The video's width / height (vertical until known). */
function useAspect(id: string, on: boolean) {
  const [ar, setAr] = useState(9 / 16);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    void getVideoAspect(id, 9 / 16).then((r) => alive && setAr(r));
    return () => {
      alive = false;
    };
  }, [id, on]);
  return ar;
}

const thumb = (s: ShortItem) => s.thumbnail ?? `https://i.ytimg.com/vi/${s.id}/oar2.jpg`;

function Actions({
  id,
  meta,
  onComments,
  onShare,
  onMore,
  overlay,
  dark,
}: {
  id: string;
  meta: Meta;
  onComments: () => void;
  onShare: () => void;
  onMore: (r: DOMRect) => void;
  overlay?: boolean;
  /** computers, full screen: on black */
  dark?: boolean;
}) {
  const session = useYtSession();
  const liked = useSyncExternalStore(subscribeLikes, () => likedNow(id), () => likedNow(id));
  useEffect(() => {
    if (session) void loadLike(id).catch(() => undefined);
  }, [session, id]);
  const pill = cn("flex h-12 w-12 items-center justify-center rounded-full transition", overlay ? "bg-black/35" : dark ? "bg-white/10 text-white hover:bg-white/20" : "bg-ink/[0.08] hover:bg-ink/15");
  return (
    <>
      <button
        type="button"
        aria-label="Like"
        aria-pressed={!!liked}
        disabled={!session}
        onClick={() => void setLiked(id, !liked).then(() => dropYtLists("liked")).catch(() => undefined)}
        className="flex flex-col items-center gap-1 text-xs font-bold disabled:cursor-default"
      >
        <span className={pill}>
          <ThumbsUp className={cn("h-6 w-6", liked && "fill-current")} />
        </span>
        {meta.likes !== undefined ? formatCount(meta.likes) : "Like"}
      </button>
      {meta.commentsToken && (
        <button type="button" aria-label="Comments" onClick={onComments} className="flex flex-col items-center gap-1 text-xs font-bold">
          <span className={pill}>
            <MessageSquare className="h-6 w-6" />
          </span>
          {meta.commentCount ?? ""}
        </button>
      )}
      <button type="button" aria-label="Share" onClick={onShare} className="flex flex-col items-center gap-1 text-xs font-bold">
        <span className={pill}>
          <Share2 className="h-6 w-6" />
        </span>
        Share
      </button>
      <button type="button" aria-label="More options" onClick={(e) => onMore(e.currentTarget.getBoundingClientRect())} className="flex flex-col items-center gap-1 text-xs font-bold">
        <span className={pill}>
          <MoreVertical className="h-6 w-6" />
        </span>
      </button>
    </>
  );
}

/**
 * The Short's progress line, which can be used: hover (mouse) shows the time
 * under the pointer, click or drag (mouse or finger) moves the Short there.
 * It grows a little while hovered or held, like YouTube's.
 */
function ShortSeekBar({ progress, duration, onSeek }: { progress: number; duration: number; onSeek: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null); // 0..1 under the mouse
  const [drag, setDrag] = useState<number | null>(null); // 0..1 while held
  const [pending, setPending] = useState<number | null>(null); // let go here, waiting for the player
  useEffect(() => {
    if (pending === null) return;
    if (Math.abs(progress - pending) < 0.03) {
      setPending(null);
      return;
    }
    const t = setTimeout(() => setPending(null), 1500);
    return () => clearTimeout(t);
  }, [progress, pending]);
  const at = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !r.width) return 0;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };
  const usable = duration > 0;
  const shown = drag ?? pending ?? progress;
  const tip = drag ?? hover;
  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(progress * duration)}
      className={cn("group/seek absolute inset-x-0 bottom-0 z-[3] flex h-4 touch-none items-end", usable && "cursor-pointer")}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        if (!usable) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(at(e.clientX));
      }}
      onPointerMove={(e) => {
        if (!usable) return;
        const x = at(e.clientX);
        if (drag !== null) setDrag(x);
        else if (e.pointerType === "mouse") setHover(x);
      }}
      onPointerUp={(e) => {
        if (drag === null) return;
        const x = at(e.clientX);
        onSeek(x * duration);
        setPending(x);
        setDrag(null);
        if (e.pointerType !== "mouse") setHover(null);
      }}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => setHover(null)}
    >
      <div className={cn("relative w-full bg-white/25 transition-[height] duration-150", drag !== null ? "h-[6px]" : "h-[3px] group-hover/seek:h-[5px]")}>
        {hover !== null && drag === null && <div className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${hover * 100}%` }} />}
        <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${shown * 100}%` }} />
        {usable && (
          <span
            className={cn(
              "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow transition-transform duration-150",
              drag !== null ? "scale-125" : "scale-0 group-hover/seek:scale-100",
            )}
            style={{ left: `${shown * 100}%` }}
          />
        )}
      </div>
      {usable && tip !== null && (
        <span
          className="pointer-events-none absolute bottom-4 -translate-x-1/2 rounded-md bg-black/80 px-2 py-0.5 text-[12px] font-semibold text-white tabular-nums"
          style={{ left: `clamp(1.75rem, ${tip * 100}%, calc(100% - 1.75rem))` }}
        >
          {formatTime(tip * duration)}
        </span>
      )}
    </div>
  );
}
