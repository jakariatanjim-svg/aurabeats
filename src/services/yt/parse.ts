/**
 * Reads YouTube WEB responses (old "renderer" objects and the newer
 * "view model" ones) into AuraBeats' own shapes.
 */
import type { VideoItem } from "@/services/video/types";

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;

export function text(t: unknown): string {
  if (typeof t === "string") return t;
  if (!isObj(t)) return "";
  if (typeof t.simpleText === "string") return t.simpleText;
  if (typeof t.content === "string") return t.content;
  if (Array.isArray(t.runs)) return t.runs.map((r) => (isObj(r) && typeof r.text === "string" ? r.text : "")).join("");
  return "";
}

/** Every object stored under `key`, anywhere inside `root` (document order). */
export function findAll(root: unknown, key: string, out: Obj[] = []): Obj[] {
  if (Array.isArray(root)) for (const v of root) findAll(v, key, out);
  else if (isObj(root)) {
    for (const [k, v] of Object.entries(root)) {
      if (k === key && isObj(v)) out.push(v);
      else findAll(v, key, out);
    }
  }
  return out;
}

const fixUrl = (u: string) => (u.startsWith("//") ? `https:${u}` : u);

/** Best picture ≤ 720 px wide from thumbnails / sources lists. */
export function bestImage(root: unknown): string | undefined {
  const lists = [...findAll(root, "thumbnail"), ...findAll(root, "image")];
  const all: { url: string; width?: number }[] = [];
  const take = (arr: unknown) => {
    if (Array.isArray(arr)) for (const t of arr) if (isObj(t) && typeof t.url === "string") all.push({ url: t.url, width: Number(t.width) || 0 });
  };
  if (isObj(root)) {
    take(root.thumbnails);
    take(root.sources);
  }
  for (const l of lists) {
    take(l.thumbnails);
    take(l.sources);
  }
  if (!all.length) return undefined;
  const ok = all.filter((t) => !t.width || t.width <= 720);
  const pick = (ok.length ? ok : all).reduce((a, b) => ((b.width ?? 0) > (a.width ?? 0) ? b : a));
  return fixUrl(pick.url);
}

export function parseDuration(s: string): number {
  if (!/^\d+(:\d+){0,2}$/.test(s.trim())) return 0;
  return s
    .trim()
    .split(":")
    .reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function parseCount(s: string): number | undefined {
  const m = s.replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return /no views/i.test(s) ? 0 : undefined;
  const mul = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(Number(m[1]) * mul);
}

/** First UC… channel id linked from inside `root`. */
function channelIdIn(root: unknown): string | undefined {
  for (const b of findAll(root, "browseEndpoint")) if (typeof b.browseId === "string" && b.browseId.startsWith("UC")) return b.browseId;
  return undefined;
}

/* --------------------------------- videos -------------------------------- */

function fromRenderer(r: Obj): VideoItem | null {
  const id = typeof r.videoId === "string" ? r.videoId : "";
  if (!id) return null;
  const byline = r.ownerText ?? r.shortBylineText ?? r.longBylineText;
  const lengthText = text(r.lengthText);
  let duration = Number(r.lengthSeconds) || parseDuration(lengthText);
  const overlay = findAll(r.thumbnailOverlays, "thumbnailOverlayTimeStatusRenderer")[0];
  if (!duration && overlay) duration = parseDuration(text(overlay.text));
  const badges = JSON.stringify(r.badges ?? []) + JSON.stringify(r.thumbnailOverlays ?? []);
  const live = /LIVE_NOW|"style":"LIVE"/.test(badges);
  const info = text(r.videoInfo); // playlists: "1.2M views • 3 years ago"
  const [infoViews, infoAgo] = info.split(/\s*•\s*/);
  const viewsText = text(r.viewCountText) || text(r.shortViewCountText) || infoViews || "";
  const avatarBox = r.channelThumbnailSupportedRenderers ?? r.channelThumbnail;
  return {
    id,
    title: text(r.title) || text(r.headline),
    author: text(byline),
    authorId: channelIdIn(byline),
    authorAvatar: avatarBox ? bestImage(avatarBox) : undefined,
    duration: live ? 0 : duration,
    views: viewsText ? parseCount(viewsText) : undefined,
    publishedText: text(r.publishedTimeText) || infoAgo || undefined,
    live,
    thumbnail: bestImage(r.thumbnail) ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    snippet: text(r.descriptionSnippet) || text(findAll(r.detailedMetadataSnippets, "snippetText")[0]) || undefined,
  };
}

function fromLockup(r: Obj): VideoItem | null {
  if (r.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO" || typeof r.contentId !== "string") return null;
  const id = r.contentId;
  const meta = findAll(r.metadata, "lockupMetadataViewModel")[0] ?? {};
  const rows = findAll(meta, "metadataRows")[0] as unknown;
  const parts: string[] = [];
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const ps = isObj(row) && Array.isArray(row.metadataParts) ? row.metadataParts : [];
      for (const p of ps) if (isObj(p)) parts.push(text(p.text));
    }
  } else {
    for (const row of findAll(meta, "contentMetadataViewModel")) {
      for (const p of findAll(row, "text")) parts.push(text(p));
    }
  }
  const badgeTexts = findAll(r.contentImage, "thumbnailBadgeViewModel").map((b) => text(b.text));
  const live = badgeTexts.some((t) => /^live$/i.test(t)) || /BADGE_STYLE_LIVE/.test(JSON.stringify(r.contentImage ?? {}));
  const durText = badgeTexts.find((t) => /^\d+(:\d+)+$/.test(t)) ?? "";
  const viewsPart = parts.find((p) => /views?|watching/i.test(p));
  const agoPart = parts.find((p) => /ago|streamed|premiered/i.test(p));
  const author = parts.find((p) => p && p !== viewsPart && p !== agoPart && !/^•$/.test(p)) ?? "";
  return {
    id,
    title: text(meta.title),
    author,
    authorId: channelIdIn(r.metadata),
    authorAvatar: bestImage(findAll(r.metadata, "avatarViewModel")[0]),
    duration: live ? 0 : parseDuration(durText),
    views: viewsPart ? parseCount(viewsPart) : undefined,
    publishedText: agoPart,
    live,
    thumbnail: bestImage(findAll(r.contentImage, "thumbnailViewModel")[0]) ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

/* --------------------------- playlists, channels -------------------------- */

export interface YtPlaylist {
  id: string;
  title: string;
  thumbnail?: string;
  countText?: string;
}

export interface YtChannel {
  id: string;
  name: string;
  avatar?: string;
}

function playlistFromLockup(r: Obj): YtPlaylist | null {
  if (r.contentType !== "LOCKUP_CONTENT_TYPE_PLAYLIST" || typeof r.contentId !== "string") return null;
  const meta = findAll(r.metadata, "lockupMetadataViewModel")[0] ?? {};
  const badge = findAll(r.contentImage, "thumbnailBadgeViewModel").map((b) => text(b.text)).find((t) => /\d/.test(t));
  return { id: r.contentId, title: text(meta.title), thumbnail: bestImage(findAll(r.contentImage, "thumbnailViewModel")[0]), countText: badge };
}

function playlistFromRenderer(r: Obj): YtPlaylist | null {
  if (typeof r.playlistId !== "string") return null;
  const thumb = r.thumbnail ?? (Array.isArray(r.thumbnails) ? r.thumbnails[0] : undefined);
  return { id: r.playlistId, title: text(r.title), thumbnail: thumb ? bestImage(thumb) : undefined, countText: text(r.videoCountShortText) || text(r.videoCountText) || undefined };
}

function channelFromRenderer(r: Obj): YtChannel | null {
  if (typeof r.channelId !== "string") return null;
  return { id: r.channelId, name: text(r.title), avatar: bestImage(r.thumbnail) };
}

/* ---------------------------------- pages --------------------------------- */

export interface YtPage {
  videos: (VideoItem & { setVideoId?: string })[];
  playlists: YtPlaylist[];
  channels: YtChannel[];
  next?: string;
}

const VIDEO_KEYS = new Set(["videoRenderer", "gridVideoRenderer", "playlistVideoRenderer", "compactVideoRenderer", "playlistPanelVideoRenderer"]);
const SKIP_KEYS = new Set(["reelShelfRenderer", "richShelfRenderer", "shortsLockupViewModel", "reelItemRenderer", "frameworkUpdates", "header", "topbar", "sidebar"]);

/** Collects everything listable from a browse response (first page or continuation). */
export function readPage(root: unknown): YtPage {
  const page: YtPage = { videos: [], playlists: [], channels: [] };
  const seen = new Set<string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isObj(node)) return;
    for (const [k, v] of Object.entries(node)) {
      if (!isObj(v) || SKIP_KEYS.has(k)) continue;
      if (VIDEO_KEYS.has(k)) {
        const item = fromRenderer(v);
        if (item && !seen.has(item.id)) {
          seen.add(item.id);
          page.videos.push(typeof v.setVideoId === "string" ? { ...item, setVideoId: v.setVideoId } : item);
        }
      } else if (k === "lockupViewModel") {
        const item = fromLockup(v);
        const pl = item ? null : playlistFromLockup(v);
        if (item && !seen.has(item.id)) {
          seen.add(item.id);
          page.videos.push(item);
        } else if (pl && !seen.has(pl.id)) {
          seen.add(pl.id);
          page.playlists.push(pl);
        }
      } else if (k === "gridPlaylistRenderer" || k === "playlistRenderer" || k === "compactPlaylistRenderer") {
        const pl = playlistFromRenderer(v);
        if (pl && !seen.has(pl.id)) {
          seen.add(pl.id);
          page.playlists.push(pl);
        }
      } else if (k === "channelRenderer" || k === "gridChannelRenderer") {
        const ch = channelFromRenderer(v);
        if (ch && !seen.has(ch.id)) {
          seen.add(ch.id);
          page.channels.push(ch);
        }
      } else if (k === "continuationItemRenderer") {
        const tok = findAll(v, "continuationCommand")[0]?.token;
        if (typeof tok === "string") page.next = tok;
      } else walk(v);
    }
  };
  walk(root);
  return page;
}
