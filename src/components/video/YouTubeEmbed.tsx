/**
 * Official YouTube player (iframe) — the website's video player. Browsers
 * can't fetch YouTube's streams directly, so this is the reliable option with
 * every quality. YouTube may show ads in it; a website can't block ads inside
 * YouTube's iframe, but a browser extension (uBlock Origin) can — see
 * AdBlockTip. The Android app never uses this player.
 *
 * Uses the IFrame API's postMessage protocol directly (no extra script) to
 * follow time / state for history, autoplay-next and pausing music.
 */
import { useEffect, useRef } from "react";

const ORIGIN = "https://www.youtube-nocookie.com";

export function YouTubeEmbed({
  id,
  startAt = 0,
  onPlayStart,
  onTime,
  onEnded,
}: {
  id: string;
  startAt?: number;
  onPlayStart?: () => void;
  onTime?: (t: number, duration: number) => void;
  onEnded?: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const cbs = useRef({ onPlayStart, onTime, onEnded });
  cbs.current = { onPlayStart, onTime, onEnded };

  useEffect(() => {
    let duration = 0;
    let state = -1;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== ORIGIN || e.source !== frame.current?.contentWindow) return;
      let data: { event?: string; info?: { currentTime?: number; duration?: number; playerState?: number } };
      try {
        data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      const info = data?.info;
      if (!info || (data.event !== "infoDelivery" && data.event !== "initialDelivery")) return;
      if (typeof info.duration === "number" && info.duration > 0) duration = info.duration;
      if (typeof info.currentTime === "number") cbs.current.onTime?.(info.currentTime, duration);
      if (typeof info.playerState === "number" && info.playerState !== state) {
        state = info.playerState;
        if (state === 1) cbs.current.onPlayStart?.();
        if (state === 0) cbs.current.onEnded?.();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Subscribe to player events once the iframe has loaded.
  const listen = () => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    const send = () => w.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), ORIGIN);
    send();
    setTimeout(send, 1000); // the player may not be ready on the first one
  };

  const params = new URLSearchParams({
    autoplay: "1",
    playsinline: "1",
    rel: "0",
    enablejsapi: "1",
    origin: window.location.origin,
    ...(startAt > 1 ? { start: String(Math.floor(startAt)) } : {}),
  });

  return (
    <div className="relative aspect-video w-full overflow-hidden bg-black sm:rounded-2xl">
      <iframe
        ref={frame}
        key={id}
        src={`${ORIGIN}/embed/${id}?${params}`}
        title="YouTube video player"
        onLoad={listen}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen; web-share"
        allowFullScreen
        // YouTube refuses to play (error 153) without a referrer.
        referrerPolicy="strict-origin-when-cross-origin"
        className="absolute inset-0 h-full w-full border-0"
      />
    </div>
  );
}
