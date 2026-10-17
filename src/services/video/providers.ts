/**
 * Ad-free public YouTube front-ends: Invidious and Piped.
 *
 * Both re-serve YouTube videos through their own proxy (so links are not
 * bound to anyone's IP) and send CORS headers, which makes them usable from a
 * plain website / PWA without a backend of our own. Neither ever inserts ads.
 *
 * Instances come and go, so the list is discovered at runtime from the
 * projects' public instance registries (cached for 6 h), merged with a
 * built-in list, and ordered by what worked last time on this device.
 */
import { storage } from "@/utils/storage";
import { http } from "./net";
import { getVideoSettings } from "./settings";
import type { ChannelItem, ChannelPage, SearchItem, StreamSet, VideoDetails, VideoItem } from "./types";
import { thumbFor } from "./types";

export type ProviderKind = "invidious" | "piped";
export interface Provider {
  kind: ProviderKind;
  base: string; // API base, no trailing slash
}

// Ordered by what actually played in a real browser (checked Oct 2026).
// Many big instances have since disabled their API or stream proxy, so the
// list is short; runtime discovery + scoring keeps it up to date.
const BUILTIN: Provider[] = [
  { kind: "piped", base: "https://pipedapi.ducks.party" },
  { kind: "invidious", base: "https://invidious.f5.si" },
  { kind: "piped", base: "https://api.piped.private.coffee" },
  { kind: "piped", base: "https://pipedapi.reallyaweso.me" },
  { kind: "piped", base: "https://pipedapi.darkness.services" },
  { kind: "piped", base: "https://pipedapi.orangenet.cc" },
  { kind: "piped", base: "https://pipedapi.drgns.space" },
  { kind: "piped", base: "https://api.piped.yt" },
];

/** Instances that answer but have their API / streams disabled. */
const BLOCKED = /inv\.nadeko\.net|nadeko\.ygg|yewtu\.be|nerdvpn|tiekoetter|chocolatemoo53|thepixora|pipedapi\.kavin\.rocks|adminforge|leptons/;

const DISCOVERY_KEY = "video:instances";
const SCORE_KEY = "video:instanceScore";
const DISCOVERY_TTL = 6 * 60 * 60 * 1000;

const clean = (u: string) => u.trim().replace(/\/+$/, "");
const keyOf = (p: Provider) => `${p.kind}:${p.base}`;

let discovered: Provider[] = storage.get<{ at: number; list: Provider[] } | null>(DISCOVERY_KEY, null)?.list ?? [];
let discovering: Promise<void> | null = null;
const score: Record<string, number> = storage.get<Record<string, number>>(SCORE_KEY, {});

function discover(): Promise<void> {
  const cached = storage.get<{ at: number; list: Provider[] } | null>(DISCOVERY_KEY, null);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL) return Promise.resolve();
  if (discovering) return discovering;
  discovering = (async () => {
    const found: Provider[] = [];
    const [inv, piped] = await Promise.allSettled([
      http<[string, { api?: boolean; cors?: boolean; type?: string; uri?: string }][]>(
        "https://api.invidious.io/instances.json?sort_by=health",
        { timeout: 8000 },
      ),
      http<{ api_url?: string; up_to_date?: boolean }[]>("https://piped-instances.kavin.rocks/", { timeout: 8000 }),
    ]);
    if (inv.status === "fulfilled" && Array.isArray(inv.value)) {
      for (const [, info] of inv.value) {
        if (info?.type === "https" && info.api && info.cors !== false && info.uri) found.push({ kind: "invidious", base: clean(info.uri) });
      }
    }
    if (piped.status === "fulfilled" && Array.isArray(piped.value)) {
      for (const i of piped.value) if (i?.api_url) found.push({ kind: "piped", base: clean(i.api_url) });
    }
    if (found.length) {
      discovered = found.slice(0, 30);
      storage.set(DISCOVERY_KEY, { at: Date.now(), list: discovered });
    }
  })()
    .catch(() => {})
    .finally(() => {
      discovering = null;
    });
  return discovering;
}

function customProvider(): Provider | null {
  const url = clean(getVideoSettings().customServer || "");
  if (!/^https?:\/\//.test(url)) return null;
  // Piped API hosts usually have "api" in the name; Invidious serves /api/v1.
  return { kind: /piped|\/\/api\./i.test(url) ? "piped" : "invidious", base: url };
}

/** Ordered candidate list: custom server, then by past success. */
export async function providers(): Promise<Provider[]> {
  void discover(); // refresh in the background; never block playback on it
  const seen = new Set<string>();
  const all: Provider[] = [];
  const push = (p: Provider) => {
    const k = keyOf(p);
    if (!seen.has(k)) {
      seen.add(k);
      all.push(p);
    }
  };
  const custom = customProvider();
  if (custom) push(custom);
  [...BUILTIN, ...discovered]
    .filter((p) => !BLOCKED.test(p.base))
    .map((p, i) => ({ p, s: (score[keyOf(p)] ?? 0) - i * 0.01 }))
    .sort((a, b) => b.s - a.s)
    .forEach(({ p }) => push(p));
  return all;
}

function bump(k: string, delta: number) {
  score[k] = Math.max(-8, Math.min(12, (score[k] ?? 0) + delta));
  storage.set(SCORE_KEY, score);
}
const mark = (p: Provider, ok: boolean) => bump(keyOf(p), ok ? 1 : -1);

/**
 * The player reports whether a source's streams actually played. This counts
 * far more than answering the API: several servers return video info fine but
 * their stream proxy is broken.
 */
export function reportPlayback(source: string, ok: boolean) {
  if (source.includes(":") && source !== "device") bump(source, ok ? 3 : -4);
}

/**
 * Runs `task` against providers in staggered waves; first success wins.
 * `filter` limits to one kind; `exclude` skips sources that already failed.
 */
export async function race<T>(
  task: (p: Provider) => Promise<T>,
  opts: { exclude?: string[]; kinds?: ProviderKind[]; stagger?: number; max?: number } = {},
): Promise<{ value: T; provider: Provider }> {
  const list = (await providers())
    .filter((p) => !opts.kinds || opts.kinds.includes(p.kind))
    .filter((p) => !opts.exclude?.includes(keyOf(p)))
    .slice(0, opts.max ?? 8);
  if (!list.length) throw new Error("No servers left to try");
  const stagger = opts.stagger ?? 900;

  return new Promise((resolve, reject) => {
    let settled = false;
    let failed = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    list.forEach((p, i) => {
      timers.push(
        setTimeout(() => {
          if (settled) return;
          task(p)
            .then((value) => {
              mark(p, true);
              if (settled) return;
              settled = true;
              timers.forEach(clearTimeout);
              resolve({ value, provider: p });
            })
            .catch(() => {
              mark(p, false);
              failed++;
              if (!settled && failed === list.length) {
                settled = true;
                reject(new Error("All ad-free servers are busy right now"));
              }
            });
        }, i * stagger),
      );
    });
  });
}

export const providerKey = keyOf;
export function providerLabel(source: string): string {
  if (source === "device") return "on this device";
  const host = source.replace(/^\w+:/, "").replace(/^https?:\/\//, "");
  return host;
}

/* ------------------------------ helpers -------------------------------- */

const abs = (base: string, u?: string) => (!u ? "" : u.startsWith("/") ? `${base}${u}` : u);

function parseCount(v: unknown): number | undefined {
  if (typeof v === "number") return v >= 0 ? v : undefined;
  if (typeof v !== "string") return undefined;
  const m = v.replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return undefined;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(parseFloat(m[1]) * mult);
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, (_m, href: string, text: string) => (text.startsWith("http") ? href : text))
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function bestThumb(list: { url: string; width?: number }[] | undefined, want = 176): string | undefined {
  if (!list?.length) return undefined;
  const sorted = [...list].sort((a, b) => Math.abs((a.width ?? 0) - want) - Math.abs((b.width ?? 0) - want));
  const u = sorted[0]?.url;
  return u?.startsWith("//") ? `https:${u}` : u;
}

const idFromPipedUrl = (u?: string) => (u || "").match(/[?&]v=([\w-]{11})/)?.[1] || (u || "").match(/\/(?:watch\/|shorts\/)?([\w-]{11})$/)?.[1] || "";
const chanFromPipedUrl = (u?: string) => (u || "").split("/channel/")[1]?.split(/[/?]/)[0];

/* ---------------------------- normalisers ------------------------------ */

interface InvVideo {
  type?: string;
  videoId: string;
  title: string;
  author?: string;
  authorId?: string;
  authorThumbnails?: { url: string; width?: number }[];
  lengthSeconds?: number;
  viewCount?: number;
  viewCountText?: string;
  published?: number;
  publishedText?: string;
  liveNow?: boolean;
  isUpcoming?: boolean;
}

function invItem(v: InvVideo): VideoItem | null {
  if (!v?.videoId || !v.title || v.isUpcoming) return null;
  return {
    id: v.videoId,
    title: v.title,
    author: v.author || "",
    authorId: v.authorId,
    authorAvatar: bestThumb(v.authorThumbnails, 88),
    duration: v.lengthSeconds || 0,
    views: v.viewCount ?? parseCount(v.viewCountText),
    published: v.published ? v.published * 1000 : undefined,
    publishedText: v.publishedText,
    live: Boolean(v.liveNow),
    thumbnail: thumbFor(v.videoId),
  };
}

interface PipedStream {
  url?: string;
  type?: string;
  title?: string;
  thumbnail?: string;
  uploaderName?: string;
  uploaderUrl?: string;
  uploaderAvatar?: string;
  duration?: number;
  views?: number;
  uploaded?: number;
  uploadedDate?: string;
  isShort?: boolean;
}

function pipedItem(s: PipedStream): VideoItem | null {
  if (s.type && s.type !== "stream") return null;
  const id = idFromPipedUrl(s.url);
  if (!id || !s.title) return null;
  return {
    id,
    title: s.title,
    author: s.uploaderName || "",
    authorId: chanFromPipedUrl(s.uploaderUrl),
    authorAvatar: s.uploaderAvatar || undefined,
    duration: s.duration && s.duration > 0 ? s.duration : 0,
    views: s.views && s.views > 0 ? s.views : undefined,
    published: s.uploaded && s.uploaded > 0 ? s.uploaded : undefined,
    publishedText: s.uploadedDate,
    live: s.duration === -1,
    thumbnail: thumbFor(id),
  };
}

const items = <T,>(arr: (T | null)[]): T[] => arr.filter((x): x is T => x !== null);

/* ------------------------------ details -------------------------------- */

async function invDetails(p: Provider, id: string): Promise<VideoDetails> {
  type F = { url: string; type: string; bitrate?: string | number; resolution?: string; qualityLabel?: string; fps?: number; size?: string; audioTrack?: { audioIsDefault?: boolean } };
  const d = await http<
    InvVideo & {
      description?: string;
      likeCount?: number;
      subCountText?: string;
      hlsUrl?: string;
      formatStreams?: F[];
      adaptiveFormats?: F[];
      recommendedVideos?: InvVideo[];
      error?: string;
    }
  >(`${p.base}/api/v1/videos/${id}?local=true`, { timeout: 9000 });
  if (d.error) throw new Error(d.error);
  const h = (f: F) => parseInt(f.resolution || f.qualityLabel || f.size?.split("x")[1] || "0", 10) || 0;
  const streams: StreamSet = {
    source: keyOf(p),
    live: Boolean(d.liveNow),
    hls: d.hlsUrl ? abs(p.base, d.hlsUrl) : undefined,
    video: (d.adaptiveFormats ?? [])
      .filter((f) => f.type?.startsWith("video/") && f.url)
      .map((f) => ({ url: abs(p.base, f.url), mime: f.type, height: h(f), fps: f.fps, bitrate: Number(f.bitrate) || undefined, label: f.qualityLabel || `${h(f)}p` })),
    audio: (d.adaptiveFormats ?? [])
      .filter((f) => f.type?.startsWith("audio/") && f.url && f.audioTrack?.audioIsDefault !== false)
      .map((f) => ({ url: abs(p.base, f.url), mime: f.type, bitrate: Number(f.bitrate) || undefined })),
    muxed: (d.formatStreams ?? [])
      .filter((f) => f.url)
      .map((f) => ({ url: abs(p.base, f.url), mime: f.type, height: h(f) || 360, label: f.qualityLabel || `${h(f) || 360}p` })),
  };
  assertPlayable(streams);
  const base = invItem(d);
  if (!base) throw new Error("bad response");
  return {
    ...base,
    description: d.description || "",
    likes: d.likeCount,
    subscribers: d.subCountText ? (/[a-z]{3}/i.test(d.subCountText) ? d.subCountText : `${d.subCountText} subscribers`) : undefined,
    related: items((d.recommendedVideos ?? []).map(invItem)),
    streams,
  };
}

async function pipedDetails(p: Provider, id: string): Promise<VideoDetails> {
  type PS = { url: string; mimeType?: string; codec?: string; format?: string; quality?: string; videoOnly?: boolean; bitrate?: number; height?: number; fps?: number; audioTrackType?: string };
  const d = await http<{
    title: string;
    description?: string;
    uploader?: string;
    uploaderUrl?: string;
    uploaderAvatar?: string;
    uploaderSubscriberCount?: number;
    uploadDate?: string;
    duration?: number;
    views?: number;
    likes?: number;
    livestream?: boolean;
    hls?: string;
    videoStreams?: PS[];
    audioStreams?: PS[];
    relatedStreams?: PipedStream[];
    error?: string;
    message?: string;
  }>(`${p.base}/streams/${id}`, { timeout: 9000 });
  if (d.error || !d.title) throw new Error(d.message || d.error || "bad response");
  const mime = (s: PS) => (s.mimeType ? (s.codec ? `${s.mimeType}; codecs="${s.codec}"` : s.mimeType) : "video/mp4");
  const height = (s: PS) => s.height || parseInt(s.quality || "0", 10) || 0;
  // Skip "LBRY" (Odysee) entries: Piped's YouTube→Odysee mapping is often
  // wrong and points at an unrelated video.
  const vids = (d.videoStreams ?? []).filter((s) => !/^LBRY/i.test(s.quality || "") && !/odycdn|lbry/i.test(s.url || ""));
  const streams: StreamSet = {
    source: keyOf(p),
    live: Boolean(d.livestream),
    hls: d.hls || undefined,
    video: vids.filter((s) => s.videoOnly && s.url).map((s) => ({ url: s.url, mime: mime(s), height: height(s), fps: s.fps, bitrate: s.bitrate, label: s.quality || `${height(s)}p` })),
    audio: (d.audioStreams ?? [])
      .filter((s) => s.url && (!s.audioTrackType || s.audioTrackType === "ORIGINAL"))
      .map((s) => ({ url: s.url, mime: mime(s), bitrate: s.bitrate })),
    muxed: vids.filter((s) => !s.videoOnly && s.url).map((s) => ({ url: s.url, mime: mime(s), height: height(s) || 360, label: s.quality || "360p" })),
  };
  assertPlayable(streams);
  const subs = d.uploaderSubscriberCount;
  return {
    id,
    title: d.title,
    author: d.uploader || "",
    authorId: chanFromPipedUrl(d.uploaderUrl),
    authorAvatar: d.uploaderAvatar,
    duration: d.duration && d.duration > 0 ? d.duration : 0,
    views: d.views,
    published: d.uploadDate ? Date.parse(d.uploadDate) || undefined : undefined,
    live: Boolean(d.livestream),
    thumbnail: thumbFor(id),
    description: stripHtml(d.description || ""),
    likes: d.likes && d.likes > 0 ? d.likes : undefined,
    subscribers: subs && subs > 0 ? `${Intl.NumberFormat("en", { notation: "compact" }).format(subs)} subscribers` : undefined,
    related: items((d.relatedStreams ?? []).map(pipedItem)),
    streams,
  };
}

function assertPlayable(s: StreamSet) {
  if (s.live ? !s.hls : !(s.muxed.length || (s.video.length && s.audio.length))) throw new Error("no playable streams");
}

export function providerDetails(p: Provider, id: string): Promise<VideoDetails> {
  return p.kind === "piped" ? pipedDetails(p, id) : invDetails(p, id);
}

/* ------------------------------- feeds --------------------------------- */

export async function providerTrending(p: Provider, region: string): Promise<VideoItem[]> {
  if (p.kind === "piped") {
    const r = await http<PipedStream[]>(`${p.base}/trending?region=${region}`, { timeout: 8000 });
    const out = items((Array.isArray(r) ? r : []).map(pipedItem));
    if (!out.length) throw new Error("empty");
    return out;
  }
  const r = await http<InvVideo[]>(`${p.base}/api/v1/trending?region=${region}`, { timeout: 8000 });
  let out = items((Array.isArray(r) ? r : []).map(invItem));
  if (!out.length) {
    // Many instances disabled trending; "popular" is the next best thing.
    const pop = await http<InvVideo[]>(`${p.base}/api/v1/popular`, { timeout: 8000 });
    out = items((Array.isArray(pop) ? pop : []).map(invItem));
  }
  if (!out.length) throw new Error("empty");
  return out;
}

export interface SearchPage {
  items: SearchItem[];
  next?: string;
}

export async function providerSearch(p: Provider, q: string, cursor?: string): Promise<SearchPage> {
  if (p.kind === "piped") {
    const url = cursor
      ? `${p.base}/nextpage/search?q=${encodeURIComponent(q)}&filter=all&nextpage=${encodeURIComponent(cursor)}`
      : `${p.base}/search?q=${encodeURIComponent(q)}&filter=all`;
    const r = await http<{ items?: (PipedStream & { name?: string; subscribers?: number; videos?: number })[]; nextpage?: string }>(url, { timeout: 9000 });
    const out: SearchItem[] = [];
    for (const it of r.items ?? []) {
      if (it.type === "channel") {
        const id = chanFromPipedUrl(it.url);
        if (id) out.push({ kind: "channel", id, name: it.name || "", avatar: it.thumbnail, subscribers: it.subscribers && it.subscribers > 0 ? `${Intl.NumberFormat("en", { notation: "compact" }).format(it.subscribers)} subscribers` : undefined });
      } else {
        const v = pipedItem(it);
        if (v) out.push({ kind: "video", ...v });
      }
    }
    if (!out.length && !cursor) throw new Error("empty");
    return { items: out, next: r.nextpage || undefined };
  }
  const page = cursor ? Number(cursor) : 1;
  const r = await http<(InvVideo & { authorVerified?: boolean; subCountText?: string; subCount?: number; videoCount?: number })[]>(
    `${p.base}/api/v1/search?q=${encodeURIComponent(q)}&page=${page}&type=all`,
    { timeout: 9000 },
  );
  const out: SearchItem[] = [];
  for (const it of Array.isArray(r) ? r : []) {
    if (it.type === "channel" && it.authorId) {
      const subs = it.subCount ? `${Intl.NumberFormat("en", { notation: "compact" }).format(it.subCount)} subscribers` : it.subCountText;
      out.push({ kind: "channel", id: it.authorId, name: it.author || "", avatar: bestThumb(it.authorThumbnails, 176), subscribers: subs });
    } else if (it.type === "video") {
      const v = invItem(it);
      if (v) out.push({ kind: "video", ...v });
    }
  }
  if (!out.length && page === 1) throw new Error("empty");
  return { items: out, next: out.length ? String(page + 1) : undefined };
}

/**
 * Thrown when a server knows the channel but returns no videos (Piped's new
 * tabbed channel format often leaves `relatedStreams` empty). The race moves
 * on to the next server; the header info is kept as a last resort.
 */
export class EmptyChannelError extends Error {
  constructor(public partial: ChannelPage) {
    super("No videos from this server");
  }
}

const compact = (n: number) => Intl.NumberFormat("en", { notation: "compact" }).format(n);

export async function providerChannel(p: Provider, id: string, cursor?: string): Promise<ChannelPage> {
  if (p.kind === "piped") {
    if (cursor) {
      const r = await http<{ relatedStreams?: PipedStream[]; nextpage?: string }>(`${p.base}/nextpage/channel/${id}?nextpage=${encodeURIComponent(cursor)}`, { timeout: 9000 });
      return { id, name: "", videos: items((r.relatedStreams ?? []).map(pipedItem)), next: r.nextpage || undefined };
    }
    const r = await http<{ name?: string; avatarUrl?: string; bannerUrl?: string; description?: string; subscriberCount?: number; relatedStreams?: PipedStream[]; nextpage?: string }>(`${p.base}/channel/${id}`, { timeout: 9000 });
    if (!r.name) throw new Error("bad response");
    const page: ChannelPage = {
      id,
      name: r.name,
      avatar: r.avatarUrl,
      banner: r.bannerUrl,
      description: r.description,
      subscribers: r.subscriberCount && r.subscriberCount > 0 ? `${compact(r.subscriberCount)} subscribers` : undefined,
      videos: items((r.relatedStreams ?? []).map((s) => pipedItem({ ...s, uploaderName: s.uploaderName || r.name, uploaderUrl: s.uploaderUrl || `/channel/${id}`, uploaderAvatar: s.uploaderAvatar || r.avatarUrl }))),
      next: r.nextpage || undefined,
    };
    if (!page.videos.length) throw new EmptyChannelError({ ...page, next: undefined });
    return page;
  }
  const videosUrl = `${p.base}/api/v1/channels/${id}/videos${cursor ? `?continuation=${encodeURIComponent(cursor)}` : ""}`;
  if (cursor) {
    const vids = await http<{ videos?: InvVideo[]; continuation?: string }>(videosUrl, { timeout: 9000 });
    return { id, name: "", videos: items((vids.videos ?? []).map(invItem)), next: vids.continuation || undefined };
  }
  type Info = { author?: string; authorThumbnails?: { url: string; width?: number }[]; authorBanners?: { url: string; width?: number }[]; subCount?: number; description?: string; error?: string };
  const [vidsR, infoR] = await Promise.allSettled([
    http<{ videos?: InvVideo[]; continuation?: string }>(videosUrl, { timeout: 9000 }),
    http<Info>(`${p.base}/api/v1/channels/${id}`, { timeout: 9000 }),
  ]);
  const vids = vidsR.status === "fulfilled" ? vidsR.value : {};
  const info: Info = infoR.status === "fulfilled" ? infoR.value : {};
  const name = info.author || vids.videos?.[0]?.author || "";
  if (!name) throw new Error("bad response");
  const page: ChannelPage = {
    id,
    name,
    avatar: bestThumb(info.authorThumbnails, 176),
    banner: bestThumb(info.authorBanners, 1280),
    description: info.description,
    subscribers: info.subCount ? `${compact(info.subCount)} subscribers` : undefined,
    videos: items((vids.videos ?? []).map((v) => invItem({ ...v, authorThumbnails: v.authorThumbnails ?? info.authorThumbnails }))),
    next: vids.continuation || undefined,
  };
  if (!page.videos.length) throw new EmptyChannelError({ ...page, next: undefined });
  return page;
}

export type { ChannelItem };
