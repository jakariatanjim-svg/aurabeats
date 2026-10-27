/**
 * Advanced export / import: the WHOLE app in one file.
 *
 * The normal backup (backup.ts) carries the library and settings only. This
 * one carries everything AuraBeats keeps, so a fresh install — e.g. after the
 * app's signing key changed and it had to be uninstalled — becomes exactly
 * what it was:
 *
 *   - every saved value (library, history, settings, this device's own
 *     choices, the YouTube sign-in) — only rebuildable caches are left out
 *   - the offline songs themselves (the audio, not just the list)
 *
 * In-app video downloads already sit in the phone's Download folder and
 * survive an uninstall, so they are not copied (they would make the file
 * huge).
 *
 * File format (only AuraBeats reads it; no size limit, read piece by piece
 * so even gigabytes never sit in memory at once):
 *
 *   "ABFULL01"
 *   record*: u32 header length · header JSON · u64 payload length · payload
 *
 *   1st record  { type: "manifest", … }   payload = JSON of the saved values
 *   then        { type: "media", … }      payload = one song's audio
 *   last        { type: "end", media }
 */
import { Capacitor } from "@capacitor/core";
import { db, type OfflineEntry } from "@/utils/db";
import { isCacheKey, lsKeys, NS, summarize } from "@/utils/backup";
import { isNative } from "@/services/video/net";
import { removeOfflineFile } from "@/services/videoDownload";

const MAGIC = "ABFULL01";
const CHUNK = 3 * 1024 * 1024; // bytes per piece written / read on the phone
const enc = new TextEncoder();
const dec = new TextDecoder();

export interface FullManifest {
  type: "manifest";
  app: "AuraBeats";
  kind: "full-backup";
  version: 1;
  at: string;
  from: "app" | "web";
  appVersion: string;
  media: number;
  mediaBytes: number;
}

interface MediaHeader {
  type: "media";
  id: string;
  track: OfflineEntry["track"];
  savedAt: number;
  name: string;
  mime: string;
}

export type Progress = (text: string) => void;

/* ------------------------------- helpers -------------------------------- */

const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};
const u64 = (n: number) => {
  const b = new Uint8Array(8);
  const v = new DataView(b.buffer);
  v.setUint32(0, n % 2 ** 32, true);
  v.setUint32(4, Math.floor(n / 2 ** 32), true);
  return b;
};

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const extOf = (mime: string) =>
  /mpeg|mp3/.test(mime) ? "mp3" : /webm/.test(mime) ? "webm" : /ogg|opus/.test(mime) ? "ogg" : /wav/.test(mime) ? "wav" : "m4a";
const mimeOf = (name: string) => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ext === "mp3" ? "audio/mpeg" : ext === "webm" ? "audio/webm" : ext === "ogg" || ext === "opus" ? "audio/ogg" : ext === "wav" ? "audio/wav" : "audio/mp4";
};
const safeName = (s: string) => s.replace(/[^\w.-]+/g, "_").slice(0, 120) || "song.m4a";

/** Everything in localStorage except caches that rebuild themselves. */
function collectAll(): Record<string, string> {
  const data: Record<string, string> = {};
  for (const full of lsKeys()) {
    if (!full.startsWith(NS) || isCacheKey(full)) continue;
    const v = localStorage.getItem(full);
    if (v !== null) data[full.slice(NS.length)] = v;
  }
  return data;
}

/* -------------------------------- writing ------------------------------- */

interface Sink {
  write(part: Uint8Array | Blob): Promise<void>;
  finish(): Promise<string>;
}

/** Website: the file is built from pieces (saved songs are referenced, not copied). */
function browserSink(name: string): Sink {
  const parts: BlobPart[] = [];
  return {
    async write(part) {
      parts.push(part as BlobPart);
    },
    async finish() {
      const url = URL.createObjectURL(new Blob(parts, { type: "application/octet-stream" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return name;
    },
  };
}

/** App: written straight to Documents/AuraBeats, a few MB at a time. */
async function phoneSink(name: string): Promise<Sink> {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const path = `AuraBeats/${name}`;
  let started = false;
  let buf: Uint8Array[] = [];
  let size = 0;
  const flush = async () => {
    if (!size && started) return;
    const all = new Uint8Array(size);
    let o = 0;
    for (const b of buf) {
      all.set(b, o);
      o += b.length;
    }
    buf = [];
    size = 0;
    const data = toBase64(all);
    if (!started) {
      await Filesystem.writeFile({ path, data, directory: Directory.Documents, recursive: true });
      started = true;
    } else await Filesystem.appendFile({ path, data, directory: Directory.Documents });
  };
  const push = async (b: Uint8Array) => {
    for (let i = 0; i < b.length; i += CHUNK) {
      const piece = b.subarray(i, i + CHUNK);
      buf.push(piece);
      size += piece.length;
      if (size >= CHUNK) await flush();
    }
  };
  return {
    async write(part) {
      if (part instanceof Blob) {
        for (let i = 0; i < part.size; i += CHUNK) await push(new Uint8Array(await part.slice(i, i + CHUNK).arrayBuffer()));
      } else await push(part);
    },
    async finish() {
      await flush();
      return `Documents/AuraBeats/${name}`;
    },
  };
}

async function writeRecord(sink: Sink, header: object, payload: Uint8Array | Blob) {
  const h = enc.encode(JSON.stringify(header));
  const n = payload instanceof Blob ? payload.size : payload.length;
  await sink.write(u32(h.length));
  await sink.write(h);
  await sink.write(u64(n));
  await sink.write(payload);
}

/** The audio of one saved song, or null when its file is gone. */
async function audioOf(e: OfflineEntry): Promise<{ data: Uint8Array | Blob; name: string; mime: string } | null> {
  if (e.blob) {
    const mime = e.blob.type || "audio/mp4";
    return { data: e.blob, name: safeName(`${e.id}.${extOf(mime)}`), mime };
  }
  if (!e.path) return null;
  try {
    const res = await fetch(Capacitor.convertFileSrc(e.path));
    if (!res.ok) return null;
    const data = new Uint8Array(await res.arrayBuffer());
    if (!data.length) return null;
    const name = safeName(decodeURIComponent(e.path.split("/").pop() || `${e.id}.m4a`));
    return { data, name, mime: mimeOf(name) };
  } catch {
    return null;
  }
}

/** Saves the whole app to one file; returns where it went. */
export async function exportFull(progress: Progress): Promise<string> {
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const name = `aurabeats-full-${stamp}.aurabeats`;
  const entries = await db.allEntries().catch(() => [] as OfflineEntry[]);
  const sink = isNative ? await phoneSink(name) : browserSink(name);

  const manifest: FullManifest = {
    type: "manifest",
    app: "AuraBeats",
    kind: "full-backup",
    version: 1,
    at: new Date().toISOString(),
    from: isNative ? "app" : "web",
    appVersion: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "",
    media: entries.length,
    mediaBytes: entries.reduce((n, e) => n + (e.blob?.size ?? e.bytes ?? 0), 0),
  };
  await sink.write(enc.encode(MAGIC));
  await writeRecord(sink, manifest, enc.encode(JSON.stringify(collectAll())));

  let done = 0;
  for (const e of entries) {
    progress(`Songs ${done + 1}/${entries.length}`);
    const a = await audioOf(e);
    if (!a) continue;
    const header: MediaHeader = { type: "media", id: e.id, track: e.track, savedAt: e.savedAt, name: a.name, mime: a.mime };
    await writeRecord(sink, header, a.data);
    done++;
  }
  await writeRecord(sink, { type: "end", media: done }, new Uint8Array(0));
  progress("Saving…");
  return sink.finish();
}

/* -------------------------------- reading ------------------------------- */

class Reader {
  pos = 0;
  constructor(readonly file: Blob) {}
  async bytes(n: number): Promise<Uint8Array> {
    const b = new Uint8Array(await this.file.slice(this.pos, this.pos + n).arrayBuffer());
    if (b.length !== n) throw new Error("file is cut short");
    this.pos += n;
    return b;
  }
  async header<T>(): Promise<{ header: T; size: number }> {
    const hl = new DataView((await this.bytes(4)).buffer).getUint32(0, true);
    if (hl > 16 * 1024 * 1024) throw new Error("bad file");
    const header = JSON.parse(dec.decode(await this.bytes(hl))) as T;
    const v = new DataView((await this.bytes(8)).buffer);
    const size = v.getUint32(0, true) + v.getUint32(4, true) * 2 ** 32;
    if (this.pos + size > this.file.size) throw new Error("file is cut short");
    return { header, size };
  }
}

export interface OpenedFull {
  manifest: FullManifest;
  data: Record<string, string>;
  /** counts for the "Restore?" question */
  summary: Record<string, number>;
  reader: Reader;
}

/** Reads the start of a file: is it a full backup, and what's in it. */
export async function openFull(file: Blob): Promise<OpenedFull> {
  const r = new Reader(file);
  if (dec.decode(await r.bytes(MAGIC.length)) !== MAGIC) throw new Error("not a full backup");
  const { header, size } = await r.header<FullManifest>();
  if (header.type !== "manifest" || header.app !== "AuraBeats" || header.kind !== "full-backup") throw new Error("not a full backup");
  const data = JSON.parse(dec.decode(await r.bytes(size))) as Record<string, string>;
  if (!data || typeof data !== "object") throw new Error("bad file");
  return { manifest: header, data, summary: summarize(data), reader: r };
}

/** One song from the file into this device's offline songs; returns its file (app). */
async function restoreSong(r: Reader, h: MediaHeader, size: number): Promise<string | undefined> {
  const start = r.pos;
  if (!isNative) {
    // the browser copies it into its database
    const blob = r.file.slice(start, start + size, h.mime || "audio/mp4");
    await db.putEntry({ id: h.id, track: h.track, blob, bytes: size, savedAt: h.savedAt || Date.now() });
    return undefined;
  }
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const path = `offline/${safeName(h.name)}`;
  let first = true;
  for (let i = 0; i < size || first; i += CHUNK) {
    const data = toBase64(await r.bytes(Math.min(CHUNK, size - i)));
    if (first) await Filesystem.writeFile({ path, data, directory: Directory.Data, recursive: true });
    else await Filesystem.appendFile({ path, data, directory: Directory.Data });
    first = false;
  }
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Data });
  await db.putEntry({ id: h.id, track: h.track, path: uri, bytes: size, savedAt: h.savedAt || Date.now() });
  return uri;
}

/**
 * This device becomes exactly the backup: its songs are written first, then
 * the saved values replace this device's. The caller reloads the app.
 */
export async function restoreFull(opened: OpenedFull, progress: Progress): Promise<void> {
  const { reader: r, manifest, data } = opened;
  const old = await db.allEntries().catch(() => [] as OfflineEntry[]);
  const restored = new Map<string, string | undefined>();
  let n = 0;
  while (r.pos < r.file.size) {
    const { header, size } = await r.header<{ type: string }>();
    if (header.type === "end") break;
    if (header.type === "media") {
      n++;
      progress(`Songs ${n}/${manifest.media}`);
      const h = header as MediaHeader;
      const start = r.pos;
      try {
        restored.set(h.id, await restoreSong(r, h, size));
      } catch {
        /* this song failed: keep going with the next one */
      }
      r.pos = start + size;
      continue;
    }
    r.pos += size; // something newer versions add: skip it
  }

  // songs this device had that the backup doesn't (and replaced files)
  progress("Finishing…");
  for (const e of old) {
    if (restored.has(e.id)) {
      if (e.path && e.path !== restored.get(e.id)) await removeOfflineFile(e.path);
      continue;
    }
    await db.deleteTrack(e.id).catch(() => {});
    if (e.path) await removeOfflineFile(e.path);
  }

  // the saved values: replaced as a whole
  for (const full of lsKeys()) if (full.startsWith(NS) && !isCacheKey(full)) localStorage.removeItem(full);
  for (const [k, v] of Object.entries(data)) {
    if (typeof v !== "string") continue;
    try {
      localStorage.setItem(NS + k, v);
    } catch {
      /* full: skip */
    }
  }
}
