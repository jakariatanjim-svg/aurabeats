/**
 * Plays a YouTube stream file piece by piece, like YouTube's own player.
 *
 * A plain <video src> asks the server for the whole file in one request, and
 * YouTube slows such requests down after the first ~10 MB — so even 1080p
 * kept stopping to load while the video downloaded at a crawl. Here the file
 * is fetched in small pieces (≤ 4 MB, the `range` parameter YouTube's player
 * uses) into a MediaSource: always about a minute ahead of the playhead,
 * old parts dropped, and a seek jumps straight to the right piece.
 *
 * The file's index (MP4 "sidx" box or WebM "Cues") tells where each few-second
 * piece starts. If anything is missing — no index, the browser can't play the
 * format this way, or the server refuses the request — the caller simply
 * falls back to the plain file address (the old way).
 */
import type { StreamLayout } from "@/services/video/types";

interface Seg {
  s: number; // first byte
  e: number; // last byte
  t0: number; // seconds
  t1: number;
}

const AHEAD = 60; // seconds kept loaded in front of the playhead
// a separate sound player keeps more: it is small, and it carries on
// playing in the background (app minimised) with fewer requests
const AHEAD_SOUND = 300;
const BEHIND = 30; // seconds kept behind it
const MAX_REQ = 8 * 1024 * 1024; // YouTube slows single requests past ~10 MB

/** Set once the server has refused a piece request: don't try again this visit. */
let refused = false;

export function chunkedPossible(mime: string, layout?: StreamLayout): boolean {
  return !refused && !!layout && typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(mime) && (/mp4/.test(mime) || /webm/.test(mime));
}

async function getRange(url: string, a: number, b: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  const r = await fetch(`${url}${url.includes("?") ? "&" : "?"}range=${a}-${b}`, { signal, credentials: "omit", cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.arrayBuffer();
}

/* --------------------------------- MP4 sidx -------------------------------- */

function parseSidx(buf: ArrayBuffer, at: number): Seg[] {
  const dv = new DataView(buf);
  // find the sidx box (normally first)
  let p = 0;
  while (p + 8 <= dv.byteLength) {
    const size = dv.getUint32(p);
    const type = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
    if (type === "sidx") break;
    if (size < 8) return [];
    p += size;
  }
  if (p + 8 > dv.byteLength) return [];
  const boxSize = dv.getUint32(p);
  const version = dv.getUint8(p + 8);
  let q = p + 12 + 4; // full box header + reference_ID
  const scale = dv.getUint32(q);
  q += 4;
  let ept: number;
  let first: number;
  if (version === 0) {
    ept = dv.getUint32(q);
    first = dv.getUint32(q + 4);
    q += 8;
  } else {
    ept = Number(dv.getBigUint64(q));
    first = Number(dv.getBigUint64(q + 8));
    q += 16;
  }
  q += 2;
  const count = dv.getUint16(q);
  q += 2;
  let off = at + p + boxSize + first;
  let t = ept;
  const segs: Seg[] = [];
  for (let i = 0; i < count && q + 12 <= dv.byteLength; i++) {
    const size = dv.getUint32(q) & 0x7fffffff;
    const dur = dv.getUint32(q + 4);
    q += 12;
    segs.push({ s: off, e: off + size - 1, t0: t / scale, t1: (t + dur) / scale });
    off += size;
    t += dur;
  }
  return segs;
}

/* --------------------------------- WebM Cues ------------------------------- */

function vint(dv: DataView, p: number, keepMarker: boolean): [number, number] {
  const first = dv.getUint8(p);
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  let v = keepMarker ? first : first & (0xff >> len);
  let allOnes = v === 0xff >> len;
  for (let i = 1; i < len; i++) {
    const b = dv.getUint8(p + i);
    if (b !== 0xff) allOnes = false;
    v = v * 256 + b;
  }
  return [!keepMarker && allOnes ? -1 : v, len];
}

function uintAt(dv: DataView, p: number, n: number): number {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + dv.getUint8(p + i);
  return v;
}

/** Segment data start and timecode scale from the WebM header. */
function webmHead(buf: ArrayBuffer): { dataStart: number; scale: number } | null {
  const dv = new DataView(buf);
  let p = 0;
  let dataStart = -1;
  let scale = 1_000_000;
  while (p < dv.byteLength - 2) {
    const [id, il] = vint(dv, p, true);
    const [size, sl] = vint(dv, p + il, false);
    const body = p + il + sl;
    if (id === 0x18538067) {
      // Segment: step inside
      dataStart = body;
      p = body;
      continue;
    }
    if (id === 0x1549a966) {
      // Info: look for TimecodeScale
      let q = body;
      const end = Math.min(dv.byteLength, body + size);
      while (q < end - 2) {
        const [cid, cl] = vint(dv, q, true);
        const [csz, csl] = vint(dv, q + cl, false);
        if (cid === 0x2ad7b1) scale = uintAt(dv, q + cl + csl, csz);
        q += cl + csl + Math.max(0, csz);
      }
    }
    if (size < 0) break;
    p = body + size;
  }
  return dataStart < 0 ? null : { dataStart, scale };
}

function parseCues(buf: ArrayBuffer, head: { dataStart: number; scale: number }, size: number, durS: number): Seg[] {
  const dv = new DataView(buf);
  const [id, il] = vint(dv, 0, true);
  if (id !== 0x1c53bb6b) return [];
  const [, sl] = vint(dv, il, false);
  let p = il + sl;
  const points: { t: number; pos: number }[] = [];
  while (p < dv.byteLength - 2) {
    const [cid, cl] = vint(dv, p, true);
    const [csz, csl] = vint(dv, p + cl, false);
    const body = p + cl + csl;
    if (cid === 0xbb) {
      let t = -1;
      let pos = -1;
      let q = body;
      while (q < body + csz) {
        const [eid, el] = vint(dv, q, true);
        const [esz, esl] = vint(dv, q + el, false);
        const eb = q + el + esl;
        if (eid === 0xb3) t = uintAt(dv, eb, esz);
        else if (eid === 0xb7) {
          let r = eb;
          while (r < eb + esz) {
            const [fid, fl] = vint(dv, r, true);
            const [fsz, fsl] = vint(dv, r + fl, false);
            if (fid === 0xf1 && pos < 0) pos = uintAt(dv, r + fl + fsl, fsz);
            r += fl + fsl + fsz;
          }
        }
        q = eb + esz;
      }
      if (t >= 0 && pos >= 0) points.push({ t: (t * head.scale) / 1e9, pos: head.dataStart + pos });
    }
    if (csz < 0) break;
    p = body + csz;
  }
  return points.map((c, i) => {
    const nx = points[i + 1];
    return { s: c.pos, e: nx ? nx.pos - 1 : size - 1, t0: c.t, t1: nx ? nx.t : Math.max(durS, c.t + 1) };
  });
}

/* ---------------------------------- loader -------------------------------- */

export interface ChunkTrack {
  url: string;
  mime: string;
  layout?: StreamLayout;
}

/** Header + piece list of one file (also proves the server accepts piece requests). */
async function prepare(t: ChunkTrack): Promise<{ init: ArrayBuffer; segs: Seg[] }> {
  const layout = t.layout!;
  const isMp4 = /mp4/.test(t.mime);
  const durS = (layout.durMs ?? 0) / 1000;
  const [i0, i1] = layout.init;
  const [x0, x1] = layout.index;
  let init: ArrayBuffer;
  let idx: ArrayBuffer;
  try {
    if (x0 === i1 + 1) {
      const both = await getRange(t.url, i0, x1);
      init = both.slice(0, i1 - i0 + 1);
      idx = both.slice(x0 - i0);
    } else {
      [init, idx] = await Promise.all([getRange(t.url, i0, i1), getRange(t.url, x0, x1)]);
    }
  } catch (e) {
    if (e instanceof TypeError) refused = true; // the browser wasn't allowed to read it
    throw e;
  }
  let segs: Seg[];
  if (isMp4) segs = parseSidx(idx, x0);
  else {
    const head = webmHead(init);
    segs = head && layout.size ? parseCues(idx, head, layout.size, durS) : [];
  }
  if (!segs.length) throw new Error("no index");
  return { init, segs };
}

/**
 * Feeds `el` from one MediaSource with every given file (picture + sound
 * together, like YouTube — one clock, nothing to keep in step). Resolves with
 * a stop function, or rejects before touching the element if this can't work.
 */
export async function attachChunked(
  el: HTMLMediaElement,
  tracks: ChunkTrack[],
  onFail: (why: string) => void,
  /** where playback will start (saves loading the beginning first) */
  startHint: () => number = () => el.currentTime,
): Promise<() => void> {
  const prepared = await Promise.all(tracks.map(prepare));
  const durS = Math.max(0, ...tracks.map((t) => (t.layout?.durMs ?? 0) / 1000));

  const ms = new MediaSource();
  const objUrl = URL.createObjectURL(ms);
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  interface Lane {
    t: ChunkTrack;
    segs: Seg[];
    init: ArrayBuffer;
    sb: SourceBuffer | null;
    next: number;
    ctrl: AbortController | null;
    busy: boolean;
    fails: number;
    done: boolean;
    video: boolean;
  }
  const lanes: Lane[] = tracks.map((t, i) => ({
    t,
    segs: prepared[i].segs,
    init: prepared[i].init,
    sb: null,
    next: 0,
    ctrl: null,
    busy: false,
    fails: 0,
    done: false,
    video: t.mime.startsWith("video/"),
  }));

  const waitIdle = (sb: SourceBuffer | null) =>
    new Promise<void>((res) => {
      if (!sb || !sb.updating) return res();
      sb.addEventListener("updateend", () => res(), { once: true });
    });
  const segAt = (l: Lane, t: number) => {
    const i = l.segs.findIndex((g) => g.t1 > t + 0.05);
    return i === -1 ? l.segs.length : i;
  };
  const bufEnd = (l: Lane, t: number) => {
    const b = l.sb?.buffered;
    if (b) for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.3 && b.end(i) >= t) return b.end(i);
    return t;
  };
  // how far ahead to keep loaded: a minute, but never more than the browser
  // will hold (a 4K minute is far bigger than a 1080p one)
  const aheadBytes = (l: Lane) => (l.video ? 90 : 12) * 1024 * 1024;
  const bytesAhead = (l: Lane, t: number) => {
    let n = 0;
    for (let i = segAt(l, t); i < l.next && i < l.segs.length; i++) n += l.segs[i].e - l.segs[i].s + 1;
    return n;
  };
  const trim = async (l: Lane, keep: number) => {
    const sb = l.sb;
    if (!sb || !sb.buffered.length) return;
    const cut = el.currentTime - keep;
    const start = sb.buffered.start(0);
    if (cut - start > 2) {
      await waitIdle(sb);
      if (alive) {
        sb.remove(start, cut);
        await waitIdle(sb);
      }
    }
  };
  const appendTo = async (l: Lane, data: ArrayBuffer) => {
    for (let attempt = 0; alive; attempt++) {
      await waitIdle(l.sb);
      if (!alive || !l.sb) return;
      try {
        l.sb.appendBuffer(data);
        await waitIdle(l.sb);
        return;
      } catch (e) {
        // browser buffer full: drop more of what was already watched, retry
        if ((e as DOMException)?.name !== "QuotaExceededError" || attempt > 20) throw e;
        await trim(l, attempt < 3 ? 10 : 2);
        await new Promise((r) => setTimeout(r, 700));
      }
    }
  };
  const maybeEnd = async () => {
    if (!lanes.every((l) => l.done) || ms.readyState !== "open") return;
    await Promise.all(lanes.map((l) => waitIdle(l.sb)));
    if (alive && ms.readyState === "open" && lanes.every((l) => l.done)) {
      try {
        ms.endOfStream();
      } catch {
        /* still busy: next tick */
      }
    }
  };

  const pump = async (l: Lane) => {
    if (!alive || l.busy || !l.sb) return;
    l.busy = true;
    try {
      while (alive) {
        const t = el.currentTime;
        const end = bufEnd(l, t);
        if (l.next < l.segs.length && l.segs[l.next].t1 <= end - 0.1) l.next = segAt(l, end); // already have it
        if (l.next >= l.segs.length) {
          l.done = end >= l.segs[l.segs.length - 1].t1 - 0.5;
          void maybeEnd();
          break;
        }
        l.done = false;
        if (end - t > (lanes.length === 1 && !l.video ? AHEAD_SOUND : AHEAD) || bytesAhead(l, t) > aheadBytes(l)) break;
        // one request: this piece plus the following ones up to MAX_REQ
        let last = l.next;
        while (last + 1 < l.segs.length && l.segs[last + 1].e - l.segs[l.next].s < MAX_REQ) last++;
        const from = l.next;
        l.ctrl = new AbortController();
        let data: ArrayBuffer;
        try {
          data = await getRange(l.t.url, l.segs[from].s, l.segs[last].e, l.ctrl.signal);
          l.fails = 0;
        } catch (e) {
          if (!alive) break;
          if ((e as DOMException)?.name === "AbortError") continue; // a seek: go again from the new spot
          if (++l.fails >= 4) {
            onFail(`stream stopped loading (${e instanceof Error ? e.message : "network"})`);
            alive = false;
            break;
          }
          await new Promise((r) => setTimeout(r, 800 * l.fails));
          continue;
        }
        if (!alive || l.next !== from) continue; // a seek moved us meanwhile
        await trim(l, BEHIND);
        await appendTo(l, data);
        l.next = last + 1;
      }
    } catch (e) {
      if (alive) {
        alive = false;
        onFail(`stream error (${e instanceof Error ? e.message : "?"})`);
      }
    } finally {
      l.busy = false;
      l.ctrl = null;
    }
  };
  const tick = () => {
    clearTimeout(timer);
    if (!alive) return;
    lanes.forEach((l) => void pump(l));
    timer = setTimeout(tick, 1000);
  };
  const onSeeking = () => {
    const t = el.currentTime;
    for (const l of lanes) {
      const want = segAt(l, bufEnd(l, t));
      if (want !== l.next) {
        l.next = want;
        l.ctrl?.abort();
      }
    }
    // (after the end, appending again re-opens the source by itself)
    tick();
  };

  ms.addEventListener(
    "sourceopen",
    () => {
      if (!alive) return;
      try {
        for (const l of lanes) l.sb = ms.addSourceBuffer(l.t.mime);
      } catch (e) {
        onFail(`format not supported (${e instanceof Error ? e.message : ""})`);
        return;
      }
      if (durS && !Number.isFinite(ms.duration)) {
        try {
          ms.duration = durS;
        } catch {
          /* set by the header */
        }
      }
      Promise.all(lanes.map((l) => appendTo(l, l.init)))
        .then(() => {
          const at = Math.max(el.currentTime, startHint() || 0);
          for (const l of lanes) l.next = segAt(l, at);
          tick();
        })
        .catch((e) => alive && onFail(`stream header failed (${e instanceof Error ? e.message : ""})`));
    },
    { once: true },
  );
  el.addEventListener("seeking", onSeeking);
  el.addEventListener("timeupdate", tick);
  el.src = objUrl;

  return () => {
    alive = false;
    clearTimeout(timer);
    lanes.forEach((l) => l.ctrl?.abort());
    el.removeEventListener("seeking", onSeeking);
    el.removeEventListener("timeupdate", tick);
    if (el.src === objUrl) {
      el.removeAttribute("src");
      el.load();
    }
    URL.revokeObjectURL(objUrl);
  };
}
