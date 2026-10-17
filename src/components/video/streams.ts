/** Picks playable streams + quality ladder for the current device. */
import type { AudioStream, MuxedStream, StreamSet, VideoStream } from "@/services/video/types";

let probe: HTMLVideoElement | null = null;
export function canPlay(mime: string): boolean {
  if (typeof document === "undefined") return false;
  probe ??= document.createElement("video");
  try {
    return probe.canPlayType(mime) !== "";
  } catch {
    return false;
  }
}

/** Lower is better. H.264 is hardware-decoded everywhere (battery-friendly);
 *  VP9 is needed above 1080p; AV1 last (often software-decoded on phones). */
function codecRank(mime: string): number {
  if (/avc1/.test(mime)) return 0;
  if (/vp0?9/.test(mime)) return 1;
  if (/av01/.test(mime)) return 2;
  return 3;
}

export interface Quality {
  height: number;
  label: string;
  /** dual mode */
  video?: VideoStream;
  /** single mode */
  muxed?: MuxedStream;
}

export interface Plan {
  mode: "dual" | "single" | "hls";
  qualities: Quality[]; // best first
  audio?: AudioStream;
  hls?: string;
}

export function hlsSupported(): boolean {
  return canPlay("application/vnd.apple.mpegurl");
}

export function makePlan(s: StreamSet): Plan | null {
  if (s.live) {
    if (s.hls && hlsSupported()) return { mode: "hls", qualities: [], hls: s.hls };
    const muxed = s.muxed.filter((m) => canPlay(m.mime));
    if (muxed.length) return { mode: "single", qualities: muxed.map((m) => ({ height: m.height, label: m.label, muxed: m })) };
    return null;
  }

  const audio = s.audio
    .filter((a) => canPlay(a.mime))
    .sort((a, b) => {
      // Prefer Opus (better quality per bit), then bitrate.
      const ao = /opus/.test(a.mime) ? 1 : 0;
      const bo = /opus/.test(b.mime) ? 1 : 0;
      return bo - ao || (b.bitrate ?? 0) - (a.bitrate ?? 0);
    })[0];

  const byHeight = new Map<number, VideoStream>();
  for (const v of s.video) {
    if (!v.height || !canPlay(v.mime)) continue;
    const cur = byHeight.get(v.height);
    if (
      !cur ||
      codecRank(v.mime) < codecRank(cur.mime) ||
      (codecRank(v.mime) === codecRank(cur.mime) && (v.fps ?? 0) > (cur.fps ?? 0))
    ) {
      byHeight.set(v.height, v);
    }
  }
  const videoQualities = [...byHeight.values()]
    .sort((a, b) => b.height - a.height)
    .map((v) => ({ height: v.height, label: v.label.replace(/\s.*$/, ""), video: v }));

  if (audio && videoQualities.length) return { mode: "dual", qualities: videoQualities, audio };

  const muxed = s.muxed.filter((m) => canPlay(m.mime)).sort((a, b) => b.height - a.height);
  if (muxed.length) return { mode: "single", qualities: muxed.map((m) => ({ height: m.height, label: m.label, muxed: m })) };
  if (s.hls && hlsSupported()) return { mode: "hls", qualities: [], hls: s.hls };
  return null;
}

/** Height that fits the player on this screen/connection (capped at 1080p). */
export function autoHeight(el: HTMLElement | null): number {
  const w = (el?.clientWidth || window.innerWidth) * Math.min(window.devicePixelRatio || 1, 2);
  let h = Math.round((w * 9) / 16);
  const c = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (c?.saveData) h = Math.min(h, 480);
  else if (c?.effectiveType && /(^|-)2g/.test(c.effectiveType)) h = Math.min(h, 240);
  else if (c?.effectiveType === "3g") h = Math.min(h, 480);
  return Math.min(Math.max(h, 360), 1080);
}

/** Highest quality not above `max` (or the lowest one if all are above). */
export function pickQuality(qualities: Quality[], max: number): number {
  const i = qualities.findIndex((q) => q.height <= max);
  return i === -1 ? qualities.length - 1 : i;
}
