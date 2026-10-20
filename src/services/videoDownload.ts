/**
 * Video downloads.
 *
 *  - Website: one click opens YouTubePrint with the video already detected
 *    (MP4 with sound, up to 4K) — the same "replace the domain" trick the MP3
 *    button uses.
 *  - Android app: downloads inside the app. The phone fetches the streams it
 *    already uses for playback and the native VideoSaver plugin joins picture
 *    + sound into one MP4 in Download/AuraBeats/Videos. APKs built before the plugin
 *    existed fall back to the website.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { isNative } from "@/services/video/net";
import type { StreamSet } from "@/services/video/types";

export const videoSiteUrl = (id: string) => `https://www.youtubeprint.com/watch?v=${encodeURIComponent(id)}`;

interface VideoSaverPlugin {
  download(o: {
    id: string;
    videoUrl: string;
    audioUrl?: string;
    fileName: string;
    mime: string;
    userAgent: string;
    /** written into the file: cover picture (first URL that loads), title, artist */
    thumbUrls?: string[];
    title?: string;
    artist?: string;
    /** sub-folder of Download/AuraBeats */
    folder?: "Music" | "Videos";
    /** songs: centre square of the 16:9 thumbnail */
    squareCover?: boolean;
  }): Promise<void>;
  cancel(o: { id: string }): Promise<void>;
  open(o: { uri: string; mime: string }): Promise<void>;
  addListener(event: "progress", fn: (d: { id: string; phase: "download" | "merge"; done: number; total: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: "done", fn: (d: { id: string; uri: string; name: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: "error", fn: (d: { id: string; message: string; cancelled: boolean }) => void): Promise<PluginListenerHandle>;
}

const VideoSaver = registerPlugin<VideoSaverPlugin>("VideoSaver");

export const inAppVideoDownload = isNative && Capacitor.isPluginAvailable("VideoSaver");

/* ------------------------------ formats ---------------------------------- */

export interface DlOption {
  key: string;
  height: number;
  label: string; // "1080p"
  ext: "mp4" | "webm";
  mime: string;
  video: string;
  audio?: string;
  bytes?: number;
}

const clen = (url?: string) => {
  if (!url) return 0;
  const m = url.match(/[?&]clen=(\d+)/);
  return m ? Number(m[1]) : 0;
};

export function downloadOptions(s: StreamSet): DlOption[] {
  const best = <T extends { bitrate?: number }>(xs: T[]) => [...xs].sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
  const aac = best(s.audio.filter((a) => a.mime.startsWith("audio/mp4")));
  const opus = best(s.audio.filter((a) => a.mime.startsWith("audio/webm")));
  const out = new Map<number, DlOption>();

  const add = (o: DlOption) => {
    const cur = out.get(o.height);
    // prefer MP4 at the same height (plays everywhere)
    if (!cur || (cur.ext === "webm" && o.ext === "mp4")) out.set(o.height, o);
  };

  for (const v of s.video) {
    if (!v.height || v.height < 240) continue;
    const label = `${v.height}p${v.fps && v.fps > 30 ? v.fps : ""}`;
    if (/avc1/.test(v.mime) && aac) {
      add({ key: `mp4-${v.height}`, height: v.height, label, ext: "mp4", mime: "video/mp4", video: v.url, audio: aac.url, bytes: clen(v.url) + clen(aac.url) });
    } else if (/vp0?9/.test(v.mime) && v.mime.startsWith("video/webm") && opus && v.height > 1080) {
      add({ key: `webm-${v.height}`, height: v.height, label, ext: "webm", mime: "video/webm", video: v.url, audio: opus.url, bytes: clen(v.url) + clen(opus.url) });
    }
  }
  for (const m of s.muxed) {
    if (m.mime.startsWith("video/mp4") && !out.has(m.height)) {
      add({ key: `muxed-${m.height}`, height: m.height, label: `${m.height}p`, ext: "mp4", mime: "video/mp4", video: m.url, bytes: clen(m.url) || undefined });
    }
  }
  return [...out.values()].sort((a, b) => b.height - a.height);
}

/* ------------------------------ job store -------------------------------- */

export interface DlJob {
  id: string;
  kind: "video" | "audio";
  videoId: string;
  title: string;
  label: string;
  mime: string;
  status: "running" | "merging" | "done" | "error";
  done: number;
  total: number;
  uri?: string;
  error?: string;
}

let jobs: DlJob[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const patch = (id: string, p: Partial<DlJob>) => {
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...p } : j));
  emit();
};

export const downloadJobs = {
  subscribe(fn: () => void) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  get: () => jobs,
  dismiss(id: string) {
    jobs = jobs.filter((j) => j.id !== id);
    emit();
  },
};

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  void VideoSaver.addListener("progress", (d) =>
    patch(d.id, { done: d.done, total: d.total, status: d.phase === "merge" ? "merging" : "running" }),
  );
  void VideoSaver.addListener("done", (d) => patch(d.id, { status: "done", uri: d.uri, done: 1, total: 1 }));
  void VideoSaver.addListener("error", (d) => {
    if (d.cancelled) downloadJobs.dismiss(d.id);
    else patch(d.id, { status: "error", error: d.message });
  });
}

/** Largest thumbnail first; YouTube has no maxres one for some uploads. */
const thumbUrls = (id: string) => ["maxresdefault", "sddefault", "hqdefault"].map((n) => `https://i.ytimg.com/vi/${id}/${n}.jpg`);

const safeName = (s: string) =>
  s
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "video";

export async function startVideoDownload(videoId: string, title: string, opt: DlOption, author?: string): Promise<void> {
  wire();
  const { DEVICE_UA } = await import("@/services/video/innertube");
  const id = `${videoId}-${opt.key}-${Date.now().toString(36)}`;
  jobs = [{ id, kind: "video", videoId, title, label: opt.label, mime: opt.mime, status: "running", done: 0, total: opt.bytes ?? 0 }, ...jobs];
  emit();
  try {
    await VideoSaver.download({
      id,
      videoUrl: opt.video,
      audioUrl: opt.audio,
      fileName: `${safeName(title)} (${opt.label}).${opt.ext}`,
      mime: opt.mime,
      userAgent: DEVICE_UA,
      thumbUrls: thumbUrls(videoId),
      title,
      artist: author,
      folder: "Videos",
    });
  } catch (e) {
    patch(id, { status: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

export const audioSiteUrl = (id: string) => `https://www.youtubemz.com/watch?v=${encodeURIComponent(id)}`;

/**
 * APK: a song straight to Download/AuraBeats/Music as .m4a — YouTube's own
 * audio (AAC, best bitrate), no conversion, nothing to tap on a website —
 * with its cover art, title and artist inside the file.
 */
export async function startAudioDownload(videoId: string, title: string, artist = ""): Promise<void> {
  wire();
  const name = artist ? `${artist} - ${title}` : title;
  const id = `${videoId}-audio-${Date.now().toString(36)}`;
  jobs = [{ id, kind: "audio", videoId, title: name, label: "M4A", mime: "audio/mp4", status: "running", done: 0, total: 0 }, ...jobs];
  emit();
  try {
    const { devicePlayer, DEVICE_UA } = await import("@/services/video/innertube");
    const s = (await devicePlayer(videoId)).streams;
    const aac = [...s.audio.filter((a) => a.mime.startsWith("audio/mp4"))].sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
    if (!aac) throw new Error("no audio stream");
    patch(id, { total: clen(aac.url) });
    await VideoSaver.download({
      id,
      videoUrl: aac.url,
      fileName: `${safeName(name)}.m4a`,
      mime: "audio/mp4",
      userAgent: DEVICE_UA,
      thumbUrls: thumbUrls(videoId),
      title,
      artist,
      folder: "Music",
      squareCover: true,
    });
  } catch (e) {
    patch(id, { status: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

export const cancelVideoDownload = (id: string) => VideoSaver.cancel({ id }).catch(() => downloadJobs.dismiss(id));
export const openDownloadedVideo = (j: DlJob) => (j.uri ? VideoSaver.open({ uri: j.uri, mime: j.mime }) : Promise.reject(new Error("no file")));

/* ------------------------------ entry point ------------------------------ */

export interface VideoRequest {
  id: string;
  title: string;
  author?: string;
  streams?: StreamSet;
}

let request: VideoRequest | null = null;
const reqSubs = new Set<() => void>();
export const videoRequest = {
  subscribe(fn: () => void) {
    reqSubs.add(fn);
    return () => reqSubs.delete(fn);
  },
  get: () => request,
  close() {
    request = null;
    reqSubs.forEach((f) => f());
  },
};

export function openVideoSite(id: string) {
  window.open(videoSiteUrl(id), "_blank", "noopener,noreferrer");
}

/** "Download video" everywhere: in-app picker on the APK, the site elsewhere. */
export function requestVideoDownload(r: VideoRequest) {
  if (!inAppVideoDownload) {
    openVideoSite(r.id);
    return;
  }
  request = r;
  reqSubs.forEach((f) => f());
}
