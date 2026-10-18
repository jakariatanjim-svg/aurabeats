/**
 * Video-mode public API. Strategy per environment:
 *
 *   APK      → on-device extraction (direct from YouTube, every quality,
 *              no ads), falling back to the ad-free proxy servers. Never the
 *              official player, so the app never shows ads.
 *   Web/PWA  → official YouTube player (iframe) for playback, because the
 *              browser can't reach YouTube's streams directly; video info
 *              comes from Invidious / Piped, then YouTube's oEmbed.
 *
 * The player reports a failing source back via `exclude`, so a dead server
 * is skipped transparently ("try another server").
 */
import { devicePlayer, deviceExtractionAvailable } from "./innertube";
import { http, isNative } from "./net";
import {
  EmptyChannelError,
  providerChannel,
  providerDetails,
  providerKey,
  providerSearch,
  providerTrending,
  race,
  type Provider,
  type SearchPage,
} from "./providers";
import { guessRegion } from "./settings";
import type { ChannelPage, VideoDetails, VideoItem } from "./types";
import { thumbFor } from "./types";

export type { SearchPage };

/* --------------------------- tiny TTL cache ----------------------------- */
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttl: number, fn: () => Promise<T>, keep: (v: T) => boolean = () => true): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await fn();
  if (keep(value)) cache.set(key, { at: Date.now(), value });
  return value;
}

/* ------------------------------- video ---------------------------------- */

/**
 * Details + streams. `exclude` lists sources that failed in the player, so
 * the next call returns a different one.
 */
export async function getVideo(id: string, exclude: string[] = []): Promise<VideoDetails> {
  const key = `v:${id}:${exclude.join(",")}`;
  return cached(key, 4 * 60 * 1000, async () => {
    if (deviceExtractionAvailable && !exclude.includes("device")) {
      try {
        const d = await devicePlayer(id);
        // Fill in related videos in the background-friendly way: the watch
        // page asks `getRelated` separately when this list is empty.
        return d;
      } catch {
        /* fall through to the servers */
      }
    }
    const { value } = await race((p) => providerDetails(p, id), { exclude, stagger: 700 });
    return value;
  });
}

/** Website: info only (playback is the YouTube player). */
export async function getVideoInfo(id: string): Promise<VideoDetails> {
  return cached(`info:${id}`, 10 * 60 * 1000, async () => {
    try {
      return (await race((p) => providerDetails(p, id, false), { stagger: 700, max: 6 })).value;
    } catch {
      return getVideoMeta(id);
    }
  });
}

/**
 * Title + channel name only, from YouTube's oEmbed. Used for the YouTube-player
 * fallback when no ad-free server answered at all.
 */
export async function getVideoMeta(id: string): Promise<VideoDetails> {
  return cached(`meta:${id}`, 60 * 60 * 1000, async () => {
    const watch = `https://www.youtube.com/watch?v=${id}`;
    const o = await http<{ title?: string; author_name?: string }>(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`,
      { timeout: 8000 },
    );
    if (!o?.title) throw new Error("no info");
    return {
      id,
      title: o.title,
      author: o.author_name || "",
      duration: 0,
      thumbnail: thumbFor(id),
      description: "",
      related: [],
      streams: { source: "embed", video: [], audio: [], muxed: [], live: false },
    };
  });
}

/** Related videos for the APK path (device extraction has none). */
export async function getRelated(id: string): Promise<VideoItem[]> {
  return cached(`rel:${id}`, 15 * 60 * 1000, async () => {
    const { value } = await race((p) => providerDetails(p, id), { stagger: 900, max: 5 });
    return value.related;
  });
}

/* ------------------------------ discover -------------------------------- */

export function getTrending(region = guessRegion()): Promise<VideoItem[]> {
  return cached(`trend:${region}`, 30 * 60 * 1000, async () => {
    try {
      return (await race((p) => providerTrending(p, region), { stagger: 600, max: 6 })).value;
    } catch (err) {
      if (region !== "US") return (await race((p) => providerTrending(p, "US"), { stagger: 600, max: 6 })).value;
      throw err;
    }
  });
}

export interface SearchResult extends SearchPage {
  /** keep paging on the same server */
  source: string;
}

let lastSearchProvider: Provider | null = null;
export async function searchVideos(q: string, cursor?: string, source?: string): Promise<SearchResult> {
  return cached(`s:${q}:${cursor ?? ""}`, 10 * 60 * 1000, async () => {
    if (cursor && source && lastSearchProvider && providerKey(lastSearchProvider) === source) {
      const page = await providerSearch(lastSearchProvider, q, cursor);
      return { ...page, source };
    }
    const { value, provider } = await race((p) => providerSearch(p, q), { stagger: 700, max: 6 });
    lastSearchProvider = provider;
    return { ...value, source: providerKey(provider) };
  });
}

let lastChannelProvider: Provider | null = null;
export async function getChannel(id: string, cursor?: string, source?: string): Promise<ChannelPage & { source: string }> {
  return cached(`c:${id}:${cursor ?? ""}`, 15 * 60 * 1000, async () => {
    if (cursor && source && lastChannelProvider && providerKey(lastChannelProvider) === source) {
      return { ...(await providerChannel(lastChannelProvider, id, cursor)), source };
    }
    // Servers that know the channel but return no videos still give us the
    // header (banner, avatar, description) — keep the richest one.
    let partial: ChannelPage | null = null;
    const keep = (c: ChannelPage) => {
      const filled = (x: ChannelPage) => [x.avatar, x.banner, x.description, x.subscribers].filter(Boolean).length;
      if (!partial || filled(c) > filled(partial)) partial = c;
    };
    const withHeader = (c: ChannelPage): ChannelPage => {
      const h = partial as ChannelPage | null;
      return h
        ? { ...c, name: c.name || h.name, avatar: c.avatar || h.avatar, banner: c.banner || h.banner, description: c.description || h.description, subscribers: c.subscribers || h.subscribers }
        : c;
    };
    try {
      const { value, provider } = await race(
        (p) =>
          providerChannel(p, id).catch((e: unknown) => {
            if (e instanceof EmptyChannelError) keep(e.partial);
            throw e;
          }),
        { stagger: 800, max: 6 },
      );
      lastChannelProvider = provider;
      return { ...withHeader(value), source: providerKey(provider) };
    } catch (err) {
      // No server had videos: the channel's RSS still gives the latest uploads.
      const rss = await channelRss(id).catch(() => null);
      if (rss?.videos.length) return { ...withHeader({ id, name: rss.name, videos: rss.videos }), source: "rss" };
      if (partial) return { ...(partial as ChannelPage), source: "partial" };
      throw err;
    }
  }, (c) => c.videos.length > 0);
}

/* --------------------------- following feed ----------------------------- */

const NS = {
  atom: "http://www.w3.org/2005/Atom",
  yt: "http://www.youtube.com/xml/schemas/2015",
  media: "http://search.yahoo.com/mrss/",
};

/** Latest uploads straight from YouTube's public RSS — always fresh. */
export async function channelRss(channelId: string): Promise<{ name: string; videos: VideoItem[] }> {
  return cached(`rss:${channelId}`, 15 * 60 * 1000, async () => {
    const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
    // youtube.com sends no CORS headers: native HTTP in the app, proxy on web.
    const xml = await http<string>(url, { timeout: 9000 }, "text", isNative ? "never" : "only");
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const feedTitle = doc.getElementsByTagNameNS(NS.atom, "title")[0]?.textContent || "";
    const videos: VideoItem[] = [];
    for (const e of Array.from(doc.getElementsByTagNameNS(NS.atom, "entry"))) {
      const id = e.getElementsByTagNameNS(NS.yt, "videoId")[0]?.textContent;
      if (!id) continue;
      const link = e.getElementsByTagNameNS(NS.atom, "link")[0]?.getAttribute("href") || "";
      if (link.includes("/shorts/")) continue; // keep the feed to real videos
      const views = e.getElementsByTagNameNS(NS.media, "statistics")[0]?.getAttribute("views");
      const published = e.getElementsByTagNameNS(NS.atom, "published")[0]?.textContent;
      videos.push({
        id,
        title: e.getElementsByTagNameNS(NS.atom, "title")[0]?.textContent || "",
        author: e.getElementsByTagNameNS(NS.atom, "name")[0]?.textContent || feedTitle,
        authorId: channelId,
        duration: 0,
        views: views ? Number(views) : undefined,
        published: published ? Date.parse(published) : undefined,
        thumbnail: thumbFor(id),
      });
    }
    if (!videos.length && !feedTitle) throw new Error("empty feed");
    return { name: feedTitle, videos };
  });
}

async function latestFor(channelId: string): Promise<VideoItem[]> {
  try {
    return (await channelRss(channelId)).videos;
  } catch {
    return (await getChannel(channelId)).videos;
  }
}

/** Merged newest-first feed of all followed channels. */
export async function followingFeed(channelIds: string[]): Promise<VideoItem[]> {
  const ids = channelIds.slice(0, 60);
  const out: VideoItem[] = [];
  let i = 0;
  const worker = async () => {
    while (i < ids.length) {
      const id = ids[i++];
      try {
        out.push(...(await latestFor(id)));
      } catch {
        /* skip that channel */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, ids.length) }, worker));
  const seen = new Set<string>();
  return out
    .filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)))
    .sort((a, b) => (b.published ?? 0) - (a.published ?? 0));
}

/** Extract an 11-char video id from a pasted link, if any. */
export function parseVideoId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/live\/|\/embed\/)([\w-]{11})/);
  return m ? m[1] : null;
}
