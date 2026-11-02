/**
 * What a video adds around the picture: chapters ("In this video"), the
 * creator's end-screen suggestions and info cards (the "i" button). The watch
 * page loads them; both players show them. Also a small "seek to" channel so
 * a chapter tapped on the page moves whichever player is showing the video.
 */
import { useSyncExternalStore } from "react";

export interface Chapter {
  t: number; // start, seconds
  title: string;
  thumb?: string;
}

export type LinkKind = "video" | "playlist" | "channel" | "link";

export interface EndItem {
  kind: LinkKind;
  /** video / channel id, or the address for links */
  target: string;
  playlist?: string;
  title: string;
  meta?: string;
  image?: string;
  /** position as fractions of the picture */
  left: number;
  top: number;
  width: number;
  aspect: number; // width / height
  start: number; // seconds
  end: number;
}

export interface InfoCard {
  kind: LinkKind;
  target: string;
  title: string;
  meta?: string;
  image?: string;
  teaser?: string;
  at: number; // seconds: when its teaser shows
}

export interface VideoExtras {
  chapters: Chapter[];
  ends: EndItem[];
  cards: InfoCard[];
}

const EMPTY: VideoExtras = { chapters: [], ends: [], cards: [] };
const store = new Map<string, VideoExtras>();
const subs = new Set<() => void>();

export function setVideoExtras(id: string, part: Partial<VideoExtras>): void {
  const cur = store.get(id) ?? EMPTY;
  const nx: VideoExtras = {
    chapters: part.chapters ?? cur.chapters,
    ends: part.ends ?? cur.ends,
    cards: part.cards ?? cur.cards,
  };
  store.set(id, nx);
  if (store.size > 20) store.delete(store.keys().next().value!);
  subs.forEach((f) => f());
}

export function useVideoExtras(id: string | null | undefined): VideoExtras {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => (id ? (store.get(id) ?? EMPTY) : EMPTY),
    () => EMPTY,
  );
}

/** The chapter playing at `t` (if the video has chapters). */
export function chapterAt(chapters: Chapter[], t: number): Chapter | undefined {
  let c: Chapter | undefined;
  for (const x of chapters) if (x.t <= t + 0.25) c = x;
  return c;
}

/* ------------------------------- seek requests ----------------------------- */

const seekSubs = new Set<(t: number) => void>();
export function onSeekRequest(fn: (t: number) => void): () => void {
  seekSubs.add(fn);
  return () => seekSubs.delete(fn);
}
export function requestSeek(t: number): void {
  seekSubs.forEach((f) => f(t));
}

/* --------------------------- chapters in a description --------------------- */

/** "0:00 Intro" lines, the way YouTube makes chapters from a description. */
export function chaptersFromDescription(desc: string): Chapter[] {
  const atStart = /^[^\w(]*\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*[-–—:|.]?\s*(.+)$/;
  const atEnd = /^(.+?)\s*[-–—:|]?\s*\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?$/;
  const out: Chapter[] = [];
  for (const raw of desc.split("\n")) {
    const line = raw.trim();
    let stamp: string;
    let title: string;
    const a = atStart.exec(line);
    if (a) [stamp, title] = [a[1], a[2]];
    else {
      const b = atEnd.exec(line);
      if (!b) continue;
      [stamp, title] = [b[2], b[1]];
    }
    const t = stamp.split(":").map(Number).reduce((x, y) => x * 60 + y, 0);
    const name = title.replace(/^[-–—:|.\s]+|[-–—:|\s]+$/g, "").trim();
    if (!name || name.length > 120) continue;
    if (out.length && t <= out[out.length - 1].t) continue;
    out.push({ t, title: name });
  }
  // YouTube's rule: starts at 0:00 and has at least three
  return out.length >= 3 && out[0].t === 0 ? out : [];
}
