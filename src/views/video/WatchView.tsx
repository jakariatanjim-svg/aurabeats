import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { layerRefs, watchLayer, useWatchLayer } from "@/components/video/watchLayer";
import { requestVideoDownload } from "@/services/videoDownload";
import { ChevronDown, Download, ExternalLink, RefreshCw, Share2, ShieldCheck } from "lucide-react";
import { FollowButton, LikeButton, SaveButton } from "@/components/video/YtActions";
import { cn } from "@/utils/cn";
import { formatCount, relativeTime } from "@/utils/format";
import { usePlayer } from "@/hooks/usePlayer";
import { useVideoLibrary, videoLibrary } from "@/hooks/useVideoLibrary";
import { findInSearch, getVideo, getVideoInfo, getVideoMeta, mergeInfo, relatedFallback, relatedFor } from "@/services/video/api";
import { videoHint } from "@/services/video/hints";
import { takeHandoffStart } from "@/utils/watchVideo";
import { isNative } from "@/services/video/net";
import { providerLabel, reportPlayback } from "@/services/video/providers";
import { getVideoSettings } from "@/services/video/settings";
import type { VideoDetails, VideoItem } from "@/services/video/types";
import { VideoPlayer } from "@/components/video/VideoPlayer";
import { dock, dockRefs, useDock } from "@/components/video/dock";
import { AdBadge, AdBlockTip } from "@/components/video/AdBlockTip";
import { Avatar, VideoRow, VideoRowSkeleton } from "@/components/video/VideoCards";
import { Button, Skeleton } from "@/components/ui";
import { ErrorState } from "@/components/states";
import { routeToPath, type RouteKey } from "@/routes";

export function WatchView({ id, onNavigate }: { id: string; onNavigate: (r: RouteKey) => void }) {
  const { isPlaying, toggle, toast } = usePlayer();
  const lib = useVideoLibrary();
  const [details, setDetails] = useState<VideoDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Why each stream source failed during playback (shown if all of them do).
  const failNotes = useRef<string[]>([]);
  useEffect(() => {
    failNotes.current = [];
  }, [id]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [nonce, setNonce] = useState(0);
  // Info stays on screen while servers are switched (and is all the website needs).
  const [meta, setMeta] = useState<VideoDetails | null>(null);
  // Website: always the official YouTube player (browsers can't reach the
  // streams directly). The app plays ad-free streams and never uses it.
  const embed = !isNative;
  const [startAt, setStartAt] = useState(() => {
    const handoff = takeHandoffStart(id); // "Watch video" from the music player
    if (handoff !== null) return handoff;
    const p = videoLibrary.positionOf(id);
    const h = videoLibrary.get().history.find((x) => x.id === id);
    // resume unless it was (nearly) finished
    return h && h.duration && p > h.duration - 20 ? 0 : p > 15 ? p : 0;
  });
  const [related, setRelated] = useState<VideoItem[] | null>(null);
  const [descOpen, setDescOpen] = useState(false);
  const lastSave = useRef(0);
  const lastT = useRef(0);

  // App: ad-free streams (on-device, then servers). Reloads on server switch.
  useEffect(() => {
    if (embed) return;
    let alive = true;
    setError(null);
    getVideo(id, exclude)
      .then((d) => {
        if (!alive) return;
        setDetails(d);
        setMeta(d);
        if (d.related.length) setRelated(d.related);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Could not load this video");
      });
    return () => {
      alive = false;
    };
  }, [id, exclude, embed, nonce]);

  // Website: the player starts right away; info fills in from every source
  // in parallel, fastest first:
  //   card you tapped / watch history (instant) → oEmbed title + channel
  //   (~60 ms) → search result: views, date, channel, first lines (~0.5 s)
  //   → full description, likes, subscribers from a server (when YouTube
  //   lets it open the video — often it doesn't).
  const [fullPending, setFullPending] = useState(embed);
  useEffect(() => {
    if (!embed) return;
    let alive = true;
    const merge = (m: Partial<VideoDetails> | null | undefined) => {
      if (alive && m) setMeta((prev) => mergeInfo(id, prev, m));
    };
    const known = videoHint(id) ?? videoLibrary.get().history.find((x) => x.id === id);
    merge(known);
    setFullPending(true);

    let gotRelated = false;
    const setUpNext = (r: VideoItem[]) => {
      if (!alive || gotRelated || !r.length) return;
      gotRelated = true;
      setRelated(r);
    };

    const titled = known?.title
      ? Promise.resolve({ title: known.title, author: known.author })
      : getVideoMeta(id)
          .then((m) => (merge(m), { title: m.title, author: m.author }))
          .catch(() => null);
    if (known?.title) getVideoMeta(id).then(merge).catch(() => {});

    const full = getVideoInfo(id)
      .then((d) => {
        merge(d);
        setUpNext(d.related);
      })
      .catch(() => {})
      .finally(() => alive && setFullPending(false));

    titled.then((t) => {
      if (!alive || !t?.title) return;
      findInSearch(id, t.title).then(merge).catch(() => {});
      // Up next from search right away; the server's own list wins if it is faster.
      relatedFallback(id, t.title, t.author)
        .then(setUpNext)
        .catch(() => full.then(() => alive && !gotRelated && setRelated([])));
    });
    return () => {
      alive = false;
    };
  }, [embed, id]);

  // On-device extraction has no related list → ask a server for it.
  useEffect(() => {
    if (related || !details || details.related.length) return;
    let alive = true;
    relatedFor(id, details.title, details.author)
      .then((r) => alive && setRelated(r))
      .catch(() => alive && setRelated([]));
    return () => {
      alive = false;
    };
  }, [details, id, related]);

  const onFatal = useCallback(
    (reason: string, at: number) => {
      if (!details) return;
      if (reason !== "user") {
        reportPlayback(details.streams.source, false);
        failNotes.current = [...failNotes.current, `${details.streams.source === "device" ? "phone stream" : details.streams.source}: ${reason}`].slice(-4);
      }
      setStartAt(at || lastT.current);
      setExclude((x) => [...x, details.streams.source]);
      setDetails(null);
      toast("Switching to another ad-free server…", "info");
    },
    [details, toast],
  );

  const info = details ?? meta;
  const onTime = useCallback(
    (t: number, dur: number) => {
      lastT.current = t;
      if (!info || info.live || !info.title) return;
      const now = Date.now();
      if (now - lastSave.current > 5000) {
        lastSave.current = now;
        videoLibrary.recordProgress({ ...info, duration: info.duration || Math.round(dur) }, t);
      }
    },
    [info],
  );

  const retry = () => {
    setStartAt(lastT.current || startAt);
    setExclude([]);
    failNotes.current = [];
    setNonce((n) => n + 1);
  };

  const upNext = useMemo(() => {
    const recent = new Set(lib.history.slice(0, 30).map((h) => h.id));
    return (related ?? []).find((v) => !recent.has(v.id) && !v.live) ?? related?.[0];
  }, [related, lib.history]);

  const onEnded = useCallback(() => {
    if (info?.title) videoLibrary.recordProgress(info, info.duration);
    if (getVideoSettings().autoplayNext && upNext) {
      watchLayer.autoplayNext(); // a miniplayer stays a miniplayer
      onNavigate(`watch:${upNext.id}`);
    }
  }, [info, upNext, onNavigate]);

  // App: the miniplayer bar shows what is playing.
  useEffect(() => {
    if (!embed && info?.title) watchLayer.setInfo(info.title, info.author ?? "");
  }, [embed, info?.title, info?.author]);
  const layer = useWatchLayer();
  const mini = !embed && layer.mode === "mini";

  // Website: hand info + "next" to the shared player; it calls back on end.
  useEffect(() => {
    if (embed) dock.setMeta(info ?? null, upNext ?? null);
  }, [embed, info, upNext]);
  useEffect(() => {
    if (embed) dockRefs.onEnded = onEnded;
  });
  const { theater, id: dockId, aspect: dockAspect } = useDock();
  const isLg = useMinWidth(1024);
  const isSm = useMinWidth(640);
  const wide = embed && theater && isLg;

  // The player takes the video's shape (vertical, 4:3, wide…) like YouTube,
  // within limits so it never pushes the page off the screen. The picture
  // inside always fits whole (black bars, never cropped).
  const [appAspect, setAppAspect] = useState(16 / 9);
  useEffect(() => setAppAspect(16 / 9), [id]);
  const onAspect = useCallback((r: number) => {
    if (r > 0 && Number.isFinite(r)) setAppAspect((cur) => (Math.abs(cur - r) > 0.01 ? r : cur));
  }, []);
  const ar = embed ? (dockId === id ? dockAspect : 16 / 9) : appAspect;
  const clampAr = (lo: number, hi: number) => ({ aspectRatio: String(Math.min(hi, Math.max(lo, ar))) });
  const slotStyle = wide ? clampAr(0.5, 2.4) : isSm ? clampAr(4 / 3, 2.4) : clampAr(0.8, 2.4);
  const slotClass = wide ? "mx-auto max-h-[calc(100dvh-8.5rem)] w-full" : isSm ? "max-h-[calc(100dvh-9rem)] w-full sm:rounded-2xl" : "max-h-[62dvh] w-full";

  const pauseMusic = useCallback(() => {
    if (isPlaying) toggle();
  }, [isPlaying, toggle]);

  const reported = useRef("");
  const onPlayStart = useCallback(() => {
    pauseMusic();
    const src = details?.streams.source;
    if (src && reported.current !== `${id}:${src}`) {
      reported.current = `${id}:${src}`;
      reportPlayback(src, true);
    }
  }, [pauseMusic, details, id]);

  const share = async () => {
    const url = `https://www.youtube.com/watch?v=${id}`;
    try {
      if (navigator.share) await navigator.share({ title: info?.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast("Link copied", "success");
      }
    } catch {
      /* cancelled */
    }
  };

  const progressOf = (vid: string) => {
    const h = lib.history.find((x) => x.id === vid);
    return h && h.duration ? h.position / h.duration : undefined;
  };

  if (error && !details) {
    return (
      <div className="mx-auto max-w-xl space-y-3 pt-6">
        <ErrorState message={[...failNotes.current, error].join(" • ")} onRetry={retry} />
        <a
          href={`https://www.youtube.com/watch?v=${id}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-1.5 text-xs font-semibold text-ink3 hover:text-accent"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Open on youtube.com instead
        </a>
      </div>
    );
  }

  return (
    <>
    {/* Theater mode (desktop): full-width black stage above the columns */}
    {wide && (
      <div className="-mx-4 -mt-4 mb-5 bg-black sm:-mx-8">
        <PlayerSlot id={id} startAt={startAt} className={slotClass} style={slotStyle} />
      </div>
    )}
    <div className="gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
      <div className="min-w-0">
        {/* Player: edge-to-edge and sticky on phones, like the YouTube app */}
        <div className={cn("sticky top-0 z-20 -mx-4 -mt-4 bg-black sm:static sm:mx-0 sm:mt-0 sm:bg-transparent", wide && "hidden")}>
          {embed ? (
            !wide && <PlayerSlot id={id} startAt={startAt} className={slotClass} style={slotStyle} />
          ) : (
            <LayerSlot host={layer.host} className={slotClass} style={slotStyle}>
            {details ? (
            <VideoPlayer
              key={details.streams.source}
              details={details}
              startAt={startAt}
              musicPlaying={isPlaying}
              onPlayStart={onPlayStart}
              onTime={onTime}
              onEnded={onEnded}
              onFatal={onFatal}
              mini={mini}
              onDrag={(ph, dy, v) => layerRefs.drag?.(ph, dy, v)}
              onAspect={onAspect}
            />
          ) : (
            <div className="relative h-full w-full overflow-hidden bg-black sm:rounded-2xl">
              <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" className="h-full w-full object-cover opacity-50" />
              {!mini && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-xs font-bold text-white">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Finding the best ad-free stream…
                  </span>
                </span>
              )}
            </div>
          )}
            </LayerSlot>
          )}
        </div>

        {/* Info */}
        <div className="mt-3.5 space-y-3">
          {info ? (
            <>
              <h1 className="text-[17px] leading-snug font-black tracking-tight text-ink sm:text-xl">{info.title}</h1>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink3">
                {info.views !== undefined && <span>{formatCount(info.views)} views</span>}
                {info.published && <span>· {relativeTime(info.published)}</span>}
                {embed ? (
                  <AdBadge />
                ) : details ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 font-semibold text-emerald-500"
                    title={`Streaming ${providerLabel(details.streams.source)}`}
                  >
                    <ShieldCheck className="h-3 w-3" /> Ad-free · {providerLabel(details.streams.source)}
                  </span>
                ) : null}
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={info.authorId ? routeToPath(`channel:${info.authorId}`) : undefined}
                  data-nav="true"
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <Avatar name={info.author} src={info.authorAvatar} channelId={info.authorId} className="h-10 w-10" />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-bold text-ink">{info.author}</span>
                    {info.subscribers && <span className="block truncate text-xs text-ink3">{info.subscribers}</span>}
                  </span>
                </a>
                {info.authorId && <FollowButton ch={{ id: info.authorId, name: info.author, avatar: info.authorAvatar }} />}
              </div>

              <div className="flex flex-wrap gap-2">
                <LikeButton id={id} likes={info.likes} />
                <SaveButton v={info} />
                <Button variant="outline" className="px-3.5 text-xs" onClick={share}>
                  <Share2 className="h-3.5 w-3.5" /> Share
                </Button>
                <Button
                  variant="outline"
                  className="px-3.5 text-xs"
                  onClick={() => requestVideoDownload({ id, title: info.title, author: info.author, streams: details?.streams })}
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </Button>
                {!embed && (
                  <Button
                    variant="outline"
                    className="px-3.5 text-xs"
                    onClick={() => onFatal("user", lastT.current)}
                    title="Use a different ad-free server"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Another server
                  </Button>
                )}
              </div>

              {(info.description || info.snippet) ? (
                <button
                  type="button"
                  onClick={() => setDescOpen((o) => !o)}
                  className="blur-panel block w-full rounded-2xl p-3.5 text-left"
                >
                  <p className={cn("text-[13px] leading-relaxed whitespace-pre-wrap break-words text-ink2", !descOpen && "line-clamp-3")}>
                    <Linkified text={info.description || info.snippet || ""} />
                  </p>
                  <span className="mt-1.5 flex items-center gap-1 text-xs font-bold text-ink">
                    {descOpen ? "Show less" : "Show more"}
                    <ChevronDown className={cn("h-3.5 w-3.5 transition", descOpen && "rotate-180")} />
                  </span>
                </button>
              ) : embed && fullPending ? (
                <div className="blur-panel space-y-2 rounded-2xl p-3.5">
                  <Skeleton className="h-3 w-11/12" />
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-3 w-2/5" />
                </div>
              ) : null}

              {embed && <AdBlockTip />}
            </>
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-5 w-4/5" />
              <Skeleton className="h-3.5 w-1/3" />
              <div className="flex items-center gap-3 pt-1">
                <Skeleton className="h-10 w-10 rounded-full!" />
                <Skeleton className="h-4 w-40" />
              </div>
              {embed && <AdBlockTip />}
            </div>
          )}
        </div>
      </div>

      {/* Related */}
      <aside className="mt-6 min-w-0 lg:mt-0">
        <h2 className="mb-3 text-sm font-black text-ink">Up next</h2>
        {related === null ? (
          <VideoRowSkeleton count={8} />
        ) : related.length === 0 ? (
          <p className="text-xs text-ink3">No suggestions right now.</p>
        ) : (
          <div className="space-y-3">
            {related.slice(0, 30).map((v) => (
              <VideoRow key={v.id} v={v} progress={progressOf(v.id)} />
            ))}
          </div>
        )}
      </aside>
    </div>
    </>
  );
}

/**
 * App: reserves the player's spot on the page; the player itself lives in the
 * watch layer's host (so the miniplayer can move it without a reload).
 */
function LayerSlot({ host, children, className, style }: { host: HTMLElement | null; children: ReactNode; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    layerRefs.slot = ref.current;
    return () => {
      if (layerRefs.slot === ref.current) layerRefs.slot = null;
    };
  }, []);
  return (
    <>
      <div ref={ref} className={cn("bg-black", className)} style={style} />
      {host && createPortal(children, host)}
    </>
  );
}

/** Reserves the player's spot; the shared YouTube player positions itself over it. */
function PlayerSlot({ id, startAt, className, style }: { id: string; startAt: number; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    dock.claim(id, startAt, el);
    return () => dock.release(el);
    // startAt only matters for the first claim
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return (
    <div ref={ref} className={cn("relative overflow-hidden bg-black", className)} style={style}>
      <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" className="h-full w-full object-cover opacity-60" />
    </div>
  );
}

function useMinWidth(px: number) {
  const q = `(min-width: ${px}px)`;
  const [ok, setOk] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setOk(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [q]);
  return ok;
}

/** Turns URLs in a description into links (opened outside the app). */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a
            key={i}
            href={p}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="font-semibold text-accent break-all hover:underline"
          >
            {p.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
