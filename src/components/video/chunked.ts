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
const BEHIND = 30; // seconds kept behind it
const MAX_REQ = 4 * 1024 * 1024;

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

/**
 * Attaches a piece-by-piece source to `el`. Resolves with a stop function, or
 * rejects (before touching the element) if this file can't be played that way.
 */
export async function attachChunked(
  el: HTMLMediaElement,
  url: string,
  mime: string,
  layout: StreamLayout,
  onFail: (why: string) => void,
  /** where playback will start (saves loading the beginning first) */
  startHint: () => number = () => el.currentTime,
): Promise<() => void> {
  const isMp4 = /mp4/.test(mime);
  const durS = (layout.durMs ?? 0) / 1000;
  // header + index first (also proves the server accepts piece requests)
  let init: ArrayBuffer;
  let segs: Seg[];
  try {
    const [i0, i1] = layout.init;
    const [x0, x1] = layout.index;
    if (x0 === i1 + 1) {
      const both = await getRange(url, i0, x1);
      init = both.slice(0, i1 - i0 + 1);
      const idx = both.slice(x0 - i0);
      segs = isMp4 ? parseSidx(idx, x0) : [];
      if (!isMp4) {
        const head = webmHead(init);
        segs = head && layout.size ? parseCues(idx, head, layout.size, durS) : [];
      }
    } else {
      const [a, b] = await Promise.all([getRange(url, i0, i1), getRange(url, x0, x1)]);
      init = a;
      if (isMp4) segs = parseSidx(b, x0);
      else {
        const head = webmHead(init);
        segs = head && layout.size ? parseCues(b, head, layout.size, durS) : [];
      }
    }
  } catch (e) {
    if (e instanceof TypeError) refused = true; // blocked by the browser (no permission to read)
    throw e;
  }
  if (!segs.length) throw new Error("no index");

  const ms = new MediaSource();
  const objUrl = URL.createObjectURL(ms);
  let alive = true;
  let sb: SourceBuffer | null = null;
  let next = 0; // next piece to fetch
  let ctrl: AbortController | null = null;
  let busy = false;
  let fails = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const waitIdle = () =>
    new Promise<void>((res) => {
      if (!sb || !sb.updating) return res();
      sb.addEventListener("updateend", () => res(), { once: true });
    });
  const append = async (data: ArrayBuffer) => {
    await waitIdle();
    if (!alive || !sb) return;
    sb.appendBuffer(data);
    await waitIdle();
  };
  const segAt = (t: number) => {
    const i = segs.findIndex((g) => g.t1 > t + 0.05);
    return i === -1 ? segs.length : i;
  };
  const bufferedEnd = (t: number) => {
    const b = el.buffered;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.3 && b.end(i) >= t) return b.end(i);
    return t;
  };
  const trim = async () => {
    if (!sb || !sb.buffered.length) return;
    const cut = el.currentTime - BEHIND;
    const start = sb.buffered.start(0);
    if (cut - start > 5) {
      await waitIdle();
      if (alive && sb) {
        sb.remove(start, cut);
        await waitIdle();
      }
    }
  };

  const pump = async () => {
    if (!alive || busy || !sb) return;
    busy = true;
    try {
      while (alive) {
        const t = el.currentTime;
        const end = bufferedEnd(t);
        if (next < segs.length && segs[next].t1 <= end - 0.1) next = segAt(end); // already have it
        if (next >= segs.length) {
          if (ms.readyState === "open" && end >= segs[segs.length - 1].t1 - 0.5) {
            await waitIdle();
            if (alive && ms.readyState === "open") ms.endOfStream();
          }
          break;
        }
        if (end - t > AHEAD) break;
        // one request: this piece plus following ones up to MAX_REQ
        let last = next;
        while (last + 1 < segs.length && segs[last + 1].e - segs[next].s < MAX_REQ) last++;
        const from = next;
        ctrl = new AbortController();
        let data: ArrayBuffer;
        try {
          data = await getRange(url, segs[from].s, segs[last].e, ctrl.signal);
          fails = 0;
        } catch (e) {
          if (!alive) break;
          if ((e as DOMException)?.name === "AbortError") continue; // a seek: start again from the new spot
          if (++fails >= 4) {
            onFail(`stream stopped loading (${e instanceof Error ? e.message : "network"})`);
            alive = false;
            break;
          }
          await new Promise((r) => setTimeout(r, 800 * fails));
          continue;
        }
        if (!alive || next !== from) continue; // a seek moved us meanwhile
        await trim();
        try {
          await append(data);
        } catch (e) {
          if ((e as DOMException)?.name === "QuotaExceededError") {
            await trim();
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          throw e;
        }
        next = last + 1;
      }
    } catch (e) {
      if (alive) onFail(`stream error (${e instanceof Error ? e.message : "?"})`);
    } finally {
      busy = false;
      ctrl = null;
    }
  };
  const tick = () => {
    clearTimeout(timer);
    void pump();
    timer = setTimeout(tick, 1000);
  };
  const onSeeking = () => {
    const t = el.currentTime;
    const want = segAt(bufferedEnd(t));
    if (want !== next) {
      next = want;
      ctrl?.abort();
    }
    // (after the end, appending again re-opens the source by itself)
    tick();
  };

  ms.addEventListener(
    "sourceopen",
    () => {
      if (!alive) return;
      try {
        sb = ms.addSourceBuffer(mime);
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
      void append(init)
        .then(() => {
          next = segAt(Math.max(el.currentTime, startHint() || 0));
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
    ctrl?.abort();
    el.removeEventListener("seeking", onSeeking);
    el.removeEventListener("timeupdate", tick);
    if (el.src === objUrl) {
      el.removeAttribute("src");
      el.load();
    }
    URL.revokeObjectURL(objUrl);
  };
}
