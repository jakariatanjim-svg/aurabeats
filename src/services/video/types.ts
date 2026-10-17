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
}

export interface AudioStream {
  url: string;
  mime: string;
  bitrate?: number;
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
