/**
 * Captions for the app / extension player: YouTube's caption tracks (from the
 * player answer) fetched as json3 and drawn over the picture.
 */
import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";
import { storage } from "@/utils/storage";
import { fetchCaptionText } from "@/services/video/innertube";
import type { CaptionTrack } from "@/services/video/types";

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export function parseJson3(raw: string): Cue[] {
  let data: { events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[] };
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const cues: Cue[] = [];
  for (const e of data.events ?? []) {
    if (!e.segs) continue;
    const text = e.segs.map((s) => s.utf8 ?? "").join("").trim();
    if (!text) continue;
    const start = (e.tStartMs ?? 0) / 1000;
    cues.push({ start, end: start + (e.dDurationMs ?? 2000) / 1000, text });
  }
  return cues;
}

/** The track to show for a saved language choice. */
export function pickTrack(tracks: CaptionTrack[], lang: string | null): CaptionTrack | undefined {
  if (!lang) return undefined;
  const exact = tracks.filter((t) => t.lang === lang);
  const near = exact.length ? exact : tracks.filter((t) => t.lang.split("-")[0] === lang.split("-")[0]);
  return near.find((t) => !t.auto) ?? near[0];
}

/** Last caption choice: a language, or null = off. */
export const savedCcLang = (): string | null => storage.get<string | null>("video:cc", null);
export const saveCcLang = (l: string | null) => storage.set("video:cc", l);

/** Caption lines for the chosen track (empty while loading / off). */
export function useCaptionCues(track: CaptionTrack | undefined): Cue[] {
  const [cues, setCues] = useState<Cue[]>([]);
  const url = track?.url;
  useEffect(() => {
    setCues([]);
    if (!url) return;
    let alive = true;
    fetchCaptionText(url)
      .then((t) => alive && setCues(parseJson3(t)))
      .catch(() => alive && setCues([]));
    return () => {
      alive = false;
    };
  }, [url]);
  return cues;
}

export function CaptionText({ cues, time, raised }: { cues: Cue[]; time: number; raised?: boolean }) {
  const now = cues.filter((c) => time >= c.start && time < c.end);
  if (!now.length) return null;
  const lines = now
    .map((c) => c.text)
    .join("\n")
    .split("\n")
    .filter(Boolean)
    .slice(-2);
  return (
    <div className={cn("pointer-events-none absolute inset-x-0 flex justify-center px-4 transition-[bottom] duration-200", raised ? "bottom-20" : "bottom-6")}>
      <p className="max-w-[90%] rounded-md bg-black/75 px-2.5 py-1 text-center text-[clamp(13px,2.2vw,22px)] leading-snug font-medium whitespace-pre-line text-white">
        {lines.join("\n")}
      </p>
    </div>
  );
}
