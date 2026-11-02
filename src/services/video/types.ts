/** Shared shapes for Video mode, normalised from every provider. */

export interface VideoItem {
  id: string;
  title: string;
  author: string;
  authorId?: string;
  authorAvatar?: string;
  /** seconds; 0 = unknown or live */
  duration: number;
  views?: number;
  /** epoch ms */
  published?: number;
  publishedText?: string;
  live?: boolean;
  thumbnail: string;
  /** first lines of the description (search results) */
  snippet?: string;
}

export interface ChannelItem {
  kind: "channel";
  id: string;
  name: string;
  avatar?: string;
  subscribers?: string;
  videoCount?: string;
}

export type SearchItem = ({ kind: "video" } & VideoItem) | ChannelItem;

export interface VideoStream {
  url: string;
  mime: string; // full type incl. codecs
  height: number;
  fps?: number;
  bitrate?: number;
  label: string; // "1080p60"
  /** byte layout (YouTube's own streams): lets the player fetch in small pieces */
  layout?: StreamLayout;
}

/** Where a file's header and index are, so it can be played piece by piece. */
export interface StreamLayout {
  init: [number, number];
  index: [number, number];
  /** file size in bytes */
  size?: number;
  /** length in ms */
  durMs?: number;
}

export interface AudioStream {
  url: string;
  mime: string;
  bitrate?: number;
  layout?: StreamLayout;
  /** dubbed / extra language tracks */
  track?: { id: string; name: string; isDefault: boolean };
}

export interface CaptionTrack {
  url: string;
  lang: string;
  name: string;
  /** made by YouTube's speech recognition */
  auto?: boolean;
}

export interface MuxedStream {
  url: string;
  mime: string;
  height: number;
  label: string;
}

export interface StreamSet {
  /** provider id, e.g. "device", "piped:pipedapi.kavin.rocks" */
  source: string;
  video: VideoStream[];
  audio: AudioStream[];
  muxed: MuxedStream[];
  hls?: string;
  live: boolean;
}

export interface VideoDetails extends VideoItem {
  description: string;
  likes?: number;
  subscribers?: string;
  related: VideoItem[];
  streams: StreamSet;
  captions?: CaptionTrack[];
}

export interface ChannelPage {
  id: string;
  name: string;
  avatar?: string;
  banner?: string;
  subscribers?: string;
  description?: string;
  videos: VideoItem[];
  /** opaque continuation for more videos */
  next?: string;
}

export function thumbFor(id: string, q: "mq" | "hq" | "maxres" = "hq"): string {
  const file = q === "mq" ? "mqdefault" : q === "maxres" ? "maxresdefault" : "hqdefault";
  return `https://i.ytimg.com/vi/${id}/${file}.jpg`;
}

/** The video's own soundtrack (dubbed languages left out), or one chosen language. */
export function audioFor(list: AudioStream[], trackId?: string | null): AudioStream[] {
  if (trackId) {
    const t = list.filter((a) => a.track?.id === trackId);
    if (t.length) return t;
  }
  const d = list.filter((a) => !a.track || a.track.isDefault);
  return d.length ? d : list;
}

/** Distinct audio languages of a video (empty when it has only one). */
export function audioTracks(list: AudioStream[]): { id: string; name: string; isDefault: boolean }[] {
  const m = new Map<string, { id: string; name: string; isDefault: boolean }>();
  for (const a of list) if (a.track && !m.has(a.track.id)) m.set(a.track.id, a.track);
  return m.size > 1 ? [...m.values()].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)) : [];
}
