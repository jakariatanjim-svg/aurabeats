import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, BookmarkCheck, ChevronDown, ExternalLink, RefreshCw, Share2, ShieldCheck, ThumbsUp, MonitorPlay } from "lucide-react";
import { cn } from "@/utils/cn";
import { formatCount, relativeTime } from "@/utils/format";
import { usePlayer } from "@/hooks/usePlayer";
import { useVideoLibrary, videoLibrary } from "@/hooks/useVideoLibrary";
import { getRelated, getVideo, getVideoMeta } from "@/services/video/api";
import { providerLabel, reportPlayback } from "@/services/video/providers";
import { getVideoSettings } from "@/services/video/settings";
import type { VideoDetails, VideoItem } from "@/services/video/types";
import { VideoPlayer } from "@/components/video/VideoPlayer";
import { YouTubeEmbed } from "@/components/video/YouTubeEmbed";
import { Avatar, VideoRow, VideoRowSkeleton } from "@/components/video/VideoCards";
import { Button, Skeleton } from "@/components/ui";
import { ErrorState } from "@/components/states";
import { routeToPath, type RouteKey } from "@/routes";

export function WatchView({ id, onNavigate }: { id: string; onNavigate: (r: RouteKey) => void }) {
  const { isPlaying, toggle, toast } = usePlayer();
  const lib = useVideoLibrary();
  const [details, setDetails] = useState<VideoDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exclude, setExclude] = useState<string[]>([]);
  const [nonce, setNonce] = useState(0);
  // Info stays on screen while servers are switched or the YouTube player is used.
  const [meta, setMeta] = useState<VideoDetails | null>(null);
  // Official YouTube player: fallback when no ad-free server can play this video.
  const [embed, setEmbed] = useState(false);
  const [startAt, setStartAt] = useState(() => {
    const p = videoLibrary.positionOf(id);
    const h = videoLibrary.get().history.find((x) => x.id === id);
    // resume unless it was (nearly) finished
    return h && h.duration && p > h.duration - 20 ? 0 : p > 15 ? p : 0;
  });
  const [related, setRelated] = useState<VideoItem[] | null>(null);
  const [descOpen, setDescOpen] = useState(false);
  const lastSave = useRef(0);
  const lastT = useRef(0);

  // load / reload (server switch)
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
        if (!alive) return;
        if (getVideoSettings().embedFallback) setEmbed(true);
        else setError(e instanceof Error ? e.message : "Could not load this video");
      });
    return () => {
      alive = false;
    };
  }, [id, exclude, embed, nonce]);

  // YouTube player without any server info → title/channel from YouTube's oEmbed.
  useEffect(() => {
    if (!embed || meta) return;
    let alive = true;
    getVideoMeta(id)
      .then((m) => alive && setMeta(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [embed, meta, id]);

  // On-device extraction has no related list → ask a server for it.
  useEffect(() => {
    if (related || (details ? details.related.length : !embed)) return;
    let alive = true;
    getRelated(id)
      .then((r) => alive && setRelated(r))
      .catch(() => alive && setRelated([]));
    return () => {
      alive = false;
    };
  }, [details, id, related, embed]);

  const onFatal = useCallback(
    (reason: string, at: number) => {
      if (!details) return;
      if (reason !== "user") reportPlayback(details.streams.source, false);
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

  const switchToEmbed = () => {
    setStartAt(lastT.current || startAt);
    setDetails(null);
    setEmbed(true);
  };
  const tryAdFree = () => {
    setStartAt(lastT.current || startAt);
    setExclude([]);
    setEmbed(false);
    setNonce((n) => n + 1);
  };

  const upNext = useMemo(() => {
    const recent = new Set(lib.history.slice(0, 30).map((h) => h.id));
    return (related ?? []).find((v) => !recent.has(v.id) && !v.live) ?? related?.[0];
  }, [related, lib.history]);

  const onEnded = useCallback(() => {
    if (info?.title) videoLibrary.recordProgress(info, info.duration);
    if (getVideoSettings().autoplayNext && upNext) onNavigate(`watch:${upNext.id}`);
  }, [info, upNext, onNavigate]);

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

  const following = videoLibrary.isFollowing(info?.authorId);
  const saved = lib.later.some((v) => v.id === id);
  const progressOf = (vid: string) => {
    const h = lib.history.find((x) => x.id === vid);
    return h && h.duration ? h.position / h.duration : undefined;
  };

  if (error && !details) {
    return (
      <div className="mx-auto max-w-xl space-y-3 pt-6">
        <ErrorState message={`${error}. Age-restricted or private videos can't be played without signing in.`} onRetry={tryAdFree} />
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
    <div className="gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
      <div className="min-w-0">
        {/* Player: edge-to-edge and sticky on phones, like the YouTube app */}
        <div className="sticky top-0 z-20 -mx-4 -mt-4 bg-black sm:static sm:mx-0 sm:mt-0 sm:bg-transparent">
          {embed ? (
            <YouTubeEmbed id={id} startAt={startAt} onPlayStart={pauseMusic} onTime={onTime} onEnded={onEnded} />
          ) : details ? (
            <VideoPlayer
              key={details.streams.source}
              details={details}
              startAt={startAt}
              musicPlaying={isPlaying}
              onPlayStart={onPlayStart}
              onTime={onTime}
              onEnded={onEnded}
              onFatal={onFatal}
            />
          ) : (
            <div className="relative aspect-video w-full overflow-hidden bg-black sm:rounded-2xl">
              <img src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`} alt="" className="h-full w-full object-cover opacity-50" />
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-xs font-bold text-white">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Finding the best ad-free stream…
                </span>
              </span>
            </div>
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
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 font-semibold text-amber-600 dark:text-amber-400"
                    title="No ad-free server could play this video, so the official YouTube player is used. YouTube may show ads in it."
                  >
                    <MonitorPlay className="h-3 w-3" /> YouTube player · may show ads
                  </span>
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
                  <Avatar name={info.author} src={info.authorAvatar} className="h-10 w-10" />
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-bold text-ink">{info.author}</span>
                    {info.subscribers && <span className="block truncate text-xs text-ink3">{info.subscribers}</span>}
                  </span>
                </a>
                {info.authorId && (
                  <Button
                    variant={following ? "outline" : "solid"}
                    onClick={() =>
                      videoLibrary.toggleFollow({ id: info.authorId!, name: info.author, avatar: info.authorAvatar })
                    }
                  >
                    {following ? "Following" : "Follow"}
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {info.likes !== undefined && (
                  <span className="glass-inset inline-flex items-center gap-1.5 rounded-full border border-line bg-ink/[0.03] px-3.5 py-2 text-xs font-semibold text-ink2">
                    <ThumbsUp className="h-3.5 w-3.5" /> {formatCount(info.likes)}
                  </span>
                )}
                <Button variant="outline" className="px-3.5 text-xs" onClick={() => videoLibrary.toggleLater(info)}>
                  {saved ? <BookmarkCheck className="h-3.5 w-3.5 text-accent" /> : <Bookmark className="h-3.5 w-3.5" />}
                  {saved ? "Saved" : "Watch later"}
                </Button>
                <Button variant="outline" className="px-3.5 text-xs" onClick={share}>
                  <Share2 className="h-3.5 w-3.5" /> Share
                </Button>
                {embed ? (
                  <Button variant="outline" className="px-3.5 text-xs" onClick={tryAdFree} title="Look for an ad-free server again">
                    <ShieldCheck className="h-3.5 w-3.5" /> Try ad-free
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      className="px-3.5 text-xs"
                      onClick={() => onFatal("user", lastT.current)}
                      title="Use a different ad-free server"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Another server
                    </Button>
                    <Button
                      variant="outline"
                      className="px-3.5 text-xs"
                      onClick={switchToEmbed}
                      title="Official YouTube player: every quality, but YouTube may show ads"
                    >
                      <MonitorPlay className="h-3.5 w-3.5" /> YouTube player
                    </Button>
                  </>
                )}
              </div>

              {info.description && (
                <button
                  type="button"
                  onClick={() => setDescOpen((o) => !o)}
                  className="blur-panel block w-full rounded-2xl p-3.5 text-left"
                >
                  <p className={cn("text-[13px] leading-relaxed whitespace-pre-wrap break-words text-ink2", !descOpen && "line-clamp-3")}>
                    <Linkified text={info.description} />
                  </p>
                  <span className="mt-1.5 flex items-center gap-1 text-xs font-bold text-ink">
                    {descOpen ? "Show less" : "Show more"}
                    <ChevronDown className={cn("h-3.5 w-3.5 transition", descOpen && "rotate-180")} />
                  </span>
                </button>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-5 w-4/5" />
              <Skeleton className="h-3.5 w-1/3" />
              <div className="flex items-center gap-3 pt-1">
                <Skeleton className="h-10 w-10 rounded-full!" />
                <Skeleton className="h-4 w-40" />
              </div>
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
  );
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
