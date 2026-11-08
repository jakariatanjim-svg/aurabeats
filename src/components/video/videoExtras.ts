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
  /** YouTube's preview-picture sheets (seek bar hover / drag) */
  storyboard?: string;
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
    storyboard: part.storyboard ?? cur.storyboard,
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

/* ------------------------------ preview pictures --------------------------- */

export interface StoryFrame {
  url: string;
  w: number;
  h: number;
  /** position of the frame in its sheet */
  x: number;
  y: number;
  /** sheet width (px) */
  sheetW: number;
}

interface StoryLevel {
  w: number;
  h: number;
  count: number;
  cols: number;
  rows: number;
  interval: number; // ms, 0 = spread over the whole video
  name: string;
  sigh: string;
  url: string;
}

const levelCache = new Map<string, StoryLevel | null>();

/** The preview sheets level closest to a small thumbnail (about 160 px wide). */
function storyLevel(spec: string): StoryLevel | null {
  if (levelCache.has(spec)) return levelCache.get(spec)!;
  let best: StoryLevel | null = null;
  try {
    const [base, ...levels] = spec.split("|");
    levels.forEach((raw, i) => {
      const [w, h, count, cols, rows, interval, name, sigh] = raw.split("#");
      const l: StoryLevel = {
        w: Number(w),
        h: Number(h),
        count: Number(count),
        cols: Number(cols),
        rows: Number(rows),
        interval: Number(interval),
        name: name ?? "",
        sigh: sigh ?? "",
        url: base.replace("$L", String(i)),
      };
      if (!l.w || !l.h || !l.count || !l.cols || !l.rows) return;
      if (!best || (l.w <= 200 && l.w > best.w) || (best.w > 200 && l.w < best.w)) best = l;
    });
  } catch {
    best = null;
  }
  levelCache.set(spec, best);
  if (levelCache.size > 20) levelCache.delete(levelCache.keys().next().value!);
  return best;
}

/** The preview picture for moment `t` of a video `dur` seconds long. */
export function storyFrame(spec: string | undefined, t: number, dur: number): StoryFrame | null {
  if (!spec || !dur) return null;
  const l = storyLevel(spec);
  if (!l) return null;
  const per = l.cols * l.rows;
  const idx = Math.max(0, Math.min(l.count - 1, l.interval > 0 ? Math.floor((t * 1000) / l.interval) : Math.floor((t / dur) * l.count)));
  const sheet = Math.floor(idx / per);
  const k = idx % per;
  const name = l.name.replace("$M", String(sheet));
  const url = `${l.url.replace("$N", name)}${l.sigh ? `${l.url.includes("?") ? "&" : "?"}sigh=${encodeURIComponent(l.sigh)}` : ""}`;
  return { url, w: l.w, h: l.h, x: (k % l.cols) * l.w, y: Math.floor(k / l.cols) * l.h, sheetW: l.cols * l.w };
}
