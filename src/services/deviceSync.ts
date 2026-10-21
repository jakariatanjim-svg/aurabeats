/**
 * Device-to-device sync without an account or a server of our own.
 *
 * The sending device shows a short code. The receiving device types it in;
 * both then meet on free public MQTT relays (EMQX and HiveMQ, used together
 * so one being down doesn't matter) under a topic derived from the code.
 * Everything is end-to-end encrypted with AES-GCM using a key derived from
 * the code (PBKDF2), so the relays only ever see random bytes. Sessions are
 * short-lived (10 minutes) and nothing is stored anywhere but the devices.
 *
 * Pure browser APIs (WebSocket, WebCrypto, CompressionStream): no React, no
 * storage, so it also runs in Node for testing.
 */

const BROKERS = ["wss://broker.emqx.io:8084/mqtt", "wss://broker.hivemq.com:8884/mqtt"];
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L
export const CODE_LEN = 8;
const CHUNK = 24 * 1024; // bytes of compressed data per message
export const SESSION_MS = 10 * 60 * 1000;

/* --------------------------------- code ---------------------------------- */

export function newCode(): string {
  const r = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  return Array.from(r, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
/** Uppercase and keep only code characters (spaces, dashes, typos dropped). */
export function cleanCode(s: string): string {
  return s
    .toUpperCase()
    .split("")
    .filter((c) => ALPHABET.includes(c))
    .join("")
    .slice(0, CODE_LEN);
}
export const prettyCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;

/* -------------------------------- crypto --------------------------------- */

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(code: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("aurabeats-sync-v1"), iterations: 100_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function topicFor(code: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`aurabeats-topic:${code}`)));
  return `aurabeats/s1/${Array.from(h.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function seal(key: CryptoKey, msg: unknown): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(msg))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

async function open<T>(key: CryptoKey, bytes: Uint8Array): Promise<T | null> {
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    return null; // not ours / tampered
  }
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const buf = await new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(buf);
}
const gzip = (d: Uint8Array) => pipe(d, new CompressionStream("gzip"));
const gunzip = (d: Uint8Array) => pipe(d, new DecompressionStream("gzip"));

function toB64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ----------------------- minimal MQTT 3.1.1 over WS ---------------------- */

function utf8Field(s: string): Uint8Array {
  const b = enc.encode(s);
  const out = new Uint8Array(2 + b.length);
  out[0] = b.length >> 8;
  out[1] = b.length & 0xff;
  out.set(b, 2);
  return out;
}
function packet(type: number, ...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const lenBytes: number[] = [];
  let x = len;
  do {
    let byte = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) byte |= 0x80;
    lenBytes.push(byte);
  } while (x > 0);
  const out = new Uint8Array(1 + lenBytes.length + len);
  out[0] = type;
  out.set(lenBytes, 1);
  let o = 1 + lenBytes.length;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

class Mqtt {
  private ws: WebSocket;
  private buf = new Uint8Array(0);
  private ping: ReturnType<typeof setInterval> | undefined;
  private pid = 1;
  ready: Promise<void>;
  onMessage: (topic: string, payload: Uint8Array) => void = () => {};
  closed = false;

  constructor(url: string) {
    this.ws = new WebSocket(url, ["mqtt"]);
    this.ws.binaryType = "arraybuffer";
    this.ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), 8000);
      this.ws.onopen = () => {
        const id = `ab-${Math.random().toString(36).slice(2, 12)}`;
        // protocol "MQTT", level 4, clean session, keep-alive 60 s
        this.send(packet(0x10, utf8Field("MQTT"), new Uint8Array([4, 0x02, 0, 60]), utf8Field(id)));
      };
      this.ws.onmessage = (e) => {
        const chunk = new Uint8Array(e.data as ArrayBuffer);
        const merged = new Uint8Array(this.buf.length + chunk.length);
        merged.set(this.buf);
        merged.set(chunk, this.buf.length);
        this.buf = merged;
        this.drain((type, body) => {
          if (type === 2) {
            clearTimeout(t);
            if (body[1] === 0) {
              this.ping = setInterval(() => this.send(new Uint8Array([0xc0, 0])), 30_000);
              resolve();
            } else reject(new Error(`refused ${body[1]}`));
          }
        });
      };
      this.ws.onerror = () => reject(new Error("socket error"));
      this.ws.onclose = () => {
        this.closed = true;
        clearInterval(this.ping);
        reject(new Error("closed"));
      };
    });
  }

  private drain(onControl: (type: number, body: Uint8Array) => void) {
    for (;;) {
      if (this.buf.length < 2) return;
      let mul = 1;
      let len = 0;
      let i = 1;
      let byte: number;
      do {
        if (i >= this.buf.length) return;
        byte = this.buf[i++];
        len += (byte & 0x7f) * mul;
        mul *= 128;
      } while (byte & 0x80);
      if (this.buf.length < i + len) return;
      const header = this.buf[0];
      const type = header >> 4;
      const body = this.buf.slice(i, i + len);
      this.buf = this.buf.slice(i + len);
      if (type === 3) {
        const tl = (body[0] << 8) | body[1];
        const topic = dec.decode(body.slice(2, 2 + tl));
        const qos = (header >> 1) & 3; // we only use QoS 0
        const start = 2 + tl + (qos ? 2 : 0);
        this.onMessage(topic, body.slice(start));
      } else onControl(type, body);
    }
  }

  private send(b: Uint8Array) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(b);
  }
  subscribe(topic: string) {
    const id = this.pid++;
    this.send(packet(0x82, new Uint8Array([id >> 8, id & 0xff]), utf8Field(topic), new Uint8Array([0])));
  }
  publish(topic: string, payload: Uint8Array) {
    this.send(packet(0x30, utf8Field(topic), payload));
  }
  close() {
    this.closed = true;
    clearInterval(this.ping);
    try {
      this.send(new Uint8Array([0xe0, 0]));
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * Every broker at once; ready as soon as the FIRST one answers (the others
 * join when they connect), so a slow or blocked relay never delays the code.
 */
class Relay {
  private clients: Mqtt[] = [];
  private live = new Set<Mqtt>();
  private topics: string[] = [];
  private seen = new Set<string>();
  private dead = false;
  onMessage: (topic: string, payload: Uint8Array) => void = () => {};

  connect(): Promise<void> {
    this.clients = BROKERS.map((u) => new Mqtt(u));
    return new Promise((resolve, reject) => {
      let failed = 0;
      for (const c of this.clients) {
        c.onMessage = (topic, payload) => {
          // the same message arrives once per broker: keep the first
          const k = `${topic}:${payload.length}:${toB64(payload.slice(0, 18))}`;
          if (this.seen.has(k)) return;
          this.seen.add(k);
          if (this.seen.size > 5000) this.seen.clear();
          this.onMessage(topic, payload);
        };
        c.ready.then(
          () => {
            if (this.dead) return c.close();
            this.live.add(c);
            this.topics.forEach((t) => c.subscribe(t));
            resolve();
          },
          () => {
            c.close();
            if (++failed === this.clients.length) reject(new Error("Couldn't reach the sync relay. Check the internet connection."));
          },
        );
      }
    });
  }
  subscribe(topic: string) {
    this.topics.push(topic);
    this.live.forEach((c) => c.subscribe(topic));
  }
  publish(topic: string, payload: Uint8Array) {
    this.live.forEach((c) => !c.closed && c.publish(topic, payload));
  }
  close() {
    this.dead = true;
    this.clients.forEach((c) => c.close());
  }
}

/* -------------------------------- protocol ------------------------------- */

type Msg =
  | { t: "hello"; device: string }
  | { t: "meta"; device: string; total: number; size: number; summary: Record<string, number> }
  | { t: "chunk"; i: number; d: string }
  | { t: "need"; missing: number[] }
  | { t: "got" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type SenderStatus =
  | { phase: "connecting"; code: string; expiresAt: number }
  | { phase: "waiting"; code: string; expiresAt: number }
  | { phase: "sending"; code: string; expiresAt: number; device: string; progress: number }
  | { phase: "sent"; code: string; expiresAt: number; device: string }
  | { phase: "error"; message: string }
  | { phase: "expired" };

export interface Payload {
  data: unknown;
  summary: Record<string, number>;
}

/** Start sharing. Returns a stop function. */
export function startSender(device: string, getPayload: () => Promise<Payload>, onStatus: (s: SenderStatus) => void, code = newCode()): () => void {
  let stopped = false;
  const relay = new Relay();
  const expiresAt = Date.now() + SESSION_MS;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let chunks: string[] = [];

  (async () => {
    // The code is made on this device: show it at once, connect meanwhile.
    onStatus({ phase: "connecting", code, expiresAt });
    try {
      const [key, base] = await Promise.all([deriveKey(code), topicFor(code), relay.connect()]);
      if (stopped) return relay.close();
      const up = `${base}/r2s`;
      const down = `${base}/s2r`;
      relay.subscribe(up);
      onStatus({ phase: "waiting", code, expiresAt });
      expiry = setTimeout(() => {
        stopped = true;
        relay.close();
        onStatus({ phase: "expired" });
      }, SESSION_MS);

      let busy = false;
      let sentTo = "the other device";
      let lastSend = 0;
      const sendChunks = async (idx: number[], device: string) => {
        for (let n = 0; n < idx.length && !stopped; n++) {
          relay.publish(down, await seal(key, { t: "chunk", i: idx[n], d: chunks[idx[n]] } satisfies Msg));
          onStatus({ phase: "sending", code, expiresAt, device, progress: (n + 1) / idx.length });
          await sleep(40);
        }
      };

      relay.onMessage = async (_topic, payload) => {
        const m = await open<Msg>(key, payload);
        if (!m || stopped) return;
        if (m.t === "hello" && !busy && Date.now() - lastSend > 8000) {
          busy = true;
          sentTo = m.device;
          try {
            const p = await getPayload();
            const packed = await gzip(enc.encode(JSON.stringify(p.data)));
            chunks = [];
            for (let i = 0; i < packed.length; i += CHUNK) chunks.push(toB64(packed.subarray(i, i + CHUNK)));
            relay.publish(down, await seal(key, { t: "meta", device, total: chunks.length, size: packed.length, summary: p.summary } satisfies Msg));
            await sleep(150);
            await sendChunks(chunks.map((_, i) => i), m.device);
          } finally {
            busy = false;
            lastSend = Date.now();
          }
        } else if (m.t === "need" && chunks.length) {
          await sendChunks(m.missing.filter((i) => i >= 0 && i < chunks.length), sentTo);
        } else if (m.t === "got") {
          onStatus({ phase: "sent", code, expiresAt, device: sentTo });
        }
      };
    } catch (e) {
      if (!stopped) onStatus({ phase: "error", message: e instanceof Error ? e.message : String(e) });
      relay.close();
    }
  })();

  return () => {
    stopped = true;
    clearTimeout(expiry);
    relay.close();
  };
}

export type ReceiverStatus =
  | { phase: "connecting" }
  | { phase: "searching" }
  | { phase: "receiving"; device: string; progress: number }
  | { phase: "received"; device: string; data: unknown; summary: Record<string, number> }
  | { phase: "error"; message: string };

/** Connect with a code and receive the other device's data. Returns stop. */
export function startReceiver(rawCode: string, device: string, onStatus: (s: ReceiverStatus) => void): () => void {
  const code = cleanCode(rawCode);
  let stopped = false;
  const relay = new Relay();
  const timers: ReturnType<typeof setTimeout>[] = [];

  (async () => {
    if (code.length !== CODE_LEN) return onStatus({ phase: "error", message: "The code has 8 characters." });
    onStatus({ phase: "connecting" });
    try {
      const [key, base] = await Promise.all([deriveKey(code), topicFor(code), relay.connect()]);
      if (stopped) return relay.close();
      const up = `${base}/r2s`;
      const down = `${base}/s2r`;
      relay.subscribe(down);
      onStatus({ phase: "searching" });

      let meta: Extract<Msg, { t: "meta" }> | null = null;
      const parts = new Map<number, string>();
      let lastProgress = Date.now();
      let done = false;

      const say = async (m: Msg) => relay.publish(up, await seal(key, m));
      // Say hello until the sender answers (it may still be subscribing).
      void (async () => {
        for (let n = 0; n < 24 && !meta && !stopped; n++) {
          await say({ t: "hello", device });
          await sleep(1000);
        }
        if (!meta && !stopped) {
          onStatus({ phase: "error", message: "No device answered. Check the code and keep Send open on the other device." });
          relay.close();
        }
      })();
      // Ask again for anything missing when the stream stalls.
      const watchdog = setInterval(() => {
        if (!meta || done || stopped) return;
        if (Date.now() - lastProgress > 3500) {
          const missing = Array.from({ length: meta.total }, (_, i) => i).filter((i) => !parts.has(i));
          if (missing.length) void say({ t: "need", missing: missing.slice(0, 200) });
          lastProgress = Date.now();
        }
      }, 1000);
      timers.push(watchdog as unknown as ReturnType<typeof setTimeout>);

      const finish = async () => {
        done = true;
        clearInterval(watchdog);
        const bytes = new Uint8Array(meta!.size);
        let o = 0;
        for (let i = 0; i < meta!.total; i++) {
          const b = fromB64(parts.get(i)!);
          bytes.set(b, o);
          o += b.length;
        }
        const data = JSON.parse(dec.decode(await gunzip(bytes)));
        await say({ t: "got" });
        await sleep(300);
        await say({ t: "got" });
        onStatus({ phase: "received", device: meta!.device, data, summary: meta!.summary });
        relay.close();
      };

      relay.onMessage = async (_topic, payload) => {
        const m = await open<Msg>(key, payload);
        if (!m || stopped || done) return;
        if (m.t === "meta") {
          if (!meta || meta.size !== m.size) {
            meta = m;
            parts.clear();
          }
          onStatus({ phase: "receiving", device: m.device, progress: 0 });
          if (m.total === 0) void finish();
        } else if (m.t === "chunk" && meta) {
          parts.set(m.i, m.d);
          lastProgress = Date.now();
          onStatus({ phase: "receiving", device: meta.device, progress: parts.size / meta.total });
          if (parts.size === meta.total) void finish().catch(() => onStatus({ phase: "error", message: "The data arrived damaged. Try again." }));
        }
      };
    } catch (e) {
      if (!stopped) onStatus({ phase: "error", message: e instanceof Error ? e.message : String(e) });
      relay.close();
    }
  })();

  return () => {
    stopped = true;
    timers.forEach((t) => clearInterval(t));
    relay.close();
  };
}

/** "Android phone", "Windows PC", … for the other side's screen. */
export function deviceName(isApp: boolean): string {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "";
  const kind = /Android|iPhone/i.test(ua) ? "phone" : "PC";
  return `${os ? `${os} ${kind}` : "Device"}${isApp ? " (app)" : ""}`;
}

/* ------------------------- nearby (same Wi-Fi) --------------------------- */
/*
 * Browsers can't look around the local network, but devices on the same
 * Wi-Fi share one public internet address. So that address (hashed) is the
 * meeting room: devices with "Nearby" open announce themselves there, show
 * up by name, and one taps the other. The two then agree on a secret code
 * with an ECDH key exchange (never sent anywhere) and the normal encrypted
 * transfer runs with it. The receiving side always has to accept first.
 */

const IP_SOURCES: [string, (r: Response) => Promise<string>][] = [
  ["https://api.ipify.org?format=json", async (r) => ((await r.json()) as { ip: string }).ip],
  ["https://ipv4.icanhazip.com/", async (r) => (await r.text()).trim()],
  ["https://api4.my-ip.io/v2/ip.txt", async (r) => (await r.text()).trim().split(/\s/)[0]],
];

/** This network's public IPv4 address (first source that answers). */
async function publicIp(): Promise<string> {
  return new Promise((resolve, reject) => {
    let failed = 0;
    for (const [url, read] of IP_SOURCES) {
      fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) })
        .then((r) => (r.ok ? read(r) : Promise.reject(new Error(String(r.status)))))
        .then((ip) => (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? resolve(ip) : Promise.reject(new Error("bad ip"))))
        .catch(() => ++failed === IP_SOURCES.length && reject(new Error("Couldn't check which network this device is on.")));
    }
  });
}

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

export interface NearbyPeer {
  id: string;
  name: string;
}
export type NearbyEvent =
  | { type: "status"; phase: "connecting" | "ready" }
  | { type: "error"; message: string }
  | { type: "peers"; peers: NearbyPeer[] }
  /** someone wants to send their data here (answer with accept / decline) */
  | { type: "offer"; from: NearbyPeer }
  /** our offer was accepted: start sending with this code */
  | { type: "accepted"; by: NearbyPeer; code: string }
  | { type: "declined"; by: NearbyPeer };

type RoomMsg =
  | { t: "here"; id: string; name: string; pub: string }
  | { t: "bye"; id: string }
  | { t: "offer" | "accept" | "decline"; id: string; to: string };

export interface Nearby {
  offer(peerId: string): void;
  /** Accept an offer; resolves with the code to receive with. */
  accept(peerId: string): Promise<string>;
  decline(peerId: string): void;
  stop(): void;
}

/** Be visible to, and see, devices on the same network. */
export function startNearby(name: string, onEvent: (e: NearbyEvent) => void): Nearby {
  const id = Math.random().toString(36).slice(2, 10);
  const relay = new Relay();
  const peers = new Map<string, NearbyPeer & { pub: string; seen: number }>();
  let stopped = false;
  let send: (m: RoomMsg) => void = () => {};
  let ecdh: CryptoKeyPair | null = null;
  let beat: ReturnType<typeof setInterval> | undefined;

  const list = () => onEvent({ type: "peers", peers: [...peers.values()].map((p) => ({ id: p.id, name: p.name })) });

  /** Same 8-character code on both sides, from the ECDH shared secret. */
  const codeWith = async (peerId: string): Promise<string> => {
    const p = peers.get(peerId);
    if (!p || !ecdh) throw new Error("That device is gone.");
    const theirs = await crypto.subtle.importKey("raw", fromB64(p.pub) as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: theirs }, ecdh.privateKey, 256);
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([...enc.encode("aurabeats-nearby:"), ...new Uint8Array(bits)])));
    return Array.from(h.slice(0, CODE_LEN), (b) => ALPHABET[b % ALPHABET.length]).join("");
  };

  (async () => {
    onEvent({ type: "status", phase: "connecting" });
    try {
      const [ip, pair] = await Promise.all([
        publicIp(),
        crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]) as Promise<CryptoKeyPair>,
      ]);
      ecdh = pair;
      const pub = toB64(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
      const roomHash = hex(await crypto.subtle.digest("SHA-256", enc.encode(`aurabeats-room:${ip}`)));
      const roomKey = await crypto.subtle.importKey("raw", enc.encode(roomHash.slice(0, 32)), "AES-GCM", false, ["encrypt", "decrypt"]);
      await relay.connect();
      if (stopped) return relay.close();
      const topic = `aurabeats/n1/${roomHash.slice(32, 56)}`;
      relay.subscribe(topic);
      send = (m) => void seal(roomKey, m).then((b) => !stopped && relay.publish(topic, b));

      relay.onMessage = async (_t, payload) => {
        const m = await open<RoomMsg>(roomKey, payload);
        if (!m || stopped || m.id === id) return;
        if (m.t === "here") {
          const known = peers.get(m.id);
          peers.set(m.id, { id: m.id, name: m.name, pub: m.pub, seen: Date.now() });
          if (!known || known.name !== m.name) {
            list();
            if (!known) send({ t: "here", id, name, pub }); // say hi back at once
          }
        } else if (m.t === "bye") {
          if (peers.delete(m.id)) list();
        } else if (m.to === id) {
          const p = peers.get(m.id);
          if (!p) return;
          const who = { id: p.id, name: p.name };
          if (m.t === "offer") onEvent({ type: "offer", from: who });
          else if (m.t === "decline") onEvent({ type: "declined", by: who });
          else if (m.t === "accept") onEvent({ type: "accepted", by: who, code: await codeWith(p.id) });
        }
      };

      const hello = () => send({ t: "here", id, name, pub });
      hello();
      beat = setInterval(() => {
        hello();
        const now = Date.now();
        let changed = false;
        for (const [k, p] of peers) if (now - p.seen > 10_000) changed = peers.delete(k) || changed;
        if (changed) list();
      }, 3000);
      onEvent({ type: "status", phase: "ready" });
    } catch (e) {
      if (!stopped) onEvent({ type: "error", message: e instanceof Error ? e.message : String(e) });
      relay.close();
    }
  })();

  return {
    offer: (to) => send({ t: "offer", id, to }),
    accept: async (to) => {
      const code = await codeWith(to);
      send({ t: "accept", id, to });
      return code;
    },
    decline: (to) => send({ t: "decline", id, to }),
    stop: () => {
      if (stopped) return;
      send({ t: "bye", id });
      stopped = true;
      clearInterval(beat);
      setTimeout(() => relay.close(), 300);
    },
  };
}
