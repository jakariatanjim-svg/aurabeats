// src/services/deviceSync.ts
var BROKERS = ["wss://broker.emqx.io:8084/mqtt", "wss://broker.hivemq.com:8884/mqtt"];
var ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
var CODE_LEN = 8;
var CHUNK = 24 * 1024;
var SESSION_MS = 10 * 60 * 1e3;
function newCode() {
  const r = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  return Array.from(r, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
function cleanCode(s) {
  return s.toUpperCase().split("").filter((c) => ALPHABET.includes(c)).join("").slice(0, CODE_LEN);
}
var prettyCode = (c) => `${c.slice(0, 4)}-${c.slice(4)}`;
var enc = new TextEncoder();
var dec = new TextDecoder();
async function deriveKey(code) {
  const base = await crypto.subtle.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("aurabeats-sync-v1"), iterations: 1e5, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}
async function topicFor(code) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`aurabeats-topic:${code}`)));
  return `aurabeats/s1/${Array.from(h.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
async function seal(key, msg) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(msg))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}
async function open(key, bytes) {
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    return JSON.parse(dec.decode(pt));
  } catch {
    return null;
  }
}
async function pipe(data, stream) {
  const buf = await new Response(new Blob([data]).stream().pipeThrough(stream)).arrayBuffer();
  return new Uint8Array(buf);
}
var gzip = (d) => pipe(d, new CompressionStream("gzip"));
var gunzip = (d) => pipe(d, new DecompressionStream("gzip"));
function toB64(b) {
  let s = "";
  for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768));
  return btoa(s);
}
function fromB64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function utf8Field(s) {
  const b = enc.encode(s);
  const out = new Uint8Array(2 + b.length);
  out[0] = b.length >> 8;
  out[1] = b.length & 255;
  out.set(b, 2);
  return out;
}
function packet(type, ...parts) {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const lenBytes = [];
  let x = len;
  do {
    let byte = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) byte |= 128;
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
var Mqtt = class {
  ws;
  buf = new Uint8Array(0);
  ping;
  pid = 1;
  ready;
  onMessage = () => {
  };
  closed = false;
  constructor(url) {
    this.ws = new WebSocket(url, ["mqtt"]);
    this.ws.binaryType = "arraybuffer";
    this.ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), 8e3);
      this.ws.onopen = () => {
        const id = `ab-${Math.random().toString(36).slice(2, 12)}`;
        this.send(packet(16, utf8Field("MQTT"), new Uint8Array([4, 2, 0, 60]), utf8Field(id)));
      };
      this.ws.onmessage = (e) => {
        const chunk = new Uint8Array(e.data);
        const merged = new Uint8Array(this.buf.length + chunk.length);
        merged.set(this.buf);
        merged.set(chunk, this.buf.length);
        this.buf = merged;
        this.drain((type, body) => {
          if (type === 2) {
            clearTimeout(t);
            if (body[1] === 0) {
              this.ping = setInterval(() => this.send(new Uint8Array([192, 0])), 3e4);
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
  drain(onControl) {
    for (; ; ) {
      if (this.buf.length < 2) return;
      let mul = 1;
      let len = 0;
      let i = 1;
      let byte;
      do {
        if (i >= this.buf.length) return;
        byte = this.buf[i++];
        len += (byte & 127) * mul;
        mul *= 128;
      } while (byte & 128);
      if (this.buf.length < i + len) return;
      const header = this.buf[0];
      const type = header >> 4;
      const body = this.buf.slice(i, i + len);
      this.buf = this.buf.slice(i + len);
      if (type === 3) {
        const tl = body[0] << 8 | body[1];
        const topic = dec.decode(body.slice(2, 2 + tl));
        const qos = header >> 1 & 3;
        const start = 2 + tl + (qos ? 2 : 0);
        this.onMessage(topic, body.slice(start));
      } else onControl(type, body);
    }
  }
  send(b) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(b);
  }
  subscribe(topic) {
    const id = this.pid++;
    this.send(packet(130, new Uint8Array([id >> 8, id & 255]), utf8Field(topic), new Uint8Array([0])));
  }
  publish(topic, payload) {
    this.send(packet(48, utf8Field(topic), payload));
  }
  close() {
    this.closed = true;
    clearInterval(this.ping);
    try {
      this.send(new Uint8Array([224, 0]));
      this.ws.close();
    } catch {
    }
  }
};
var Relay = class {
  clients = [];
  live = /* @__PURE__ */ new Set();
  topics = [];
  seen = /* @__PURE__ */ new Set();
  dead = false;
  onMessage = () => {
  };
  connect() {
    this.clients = BROKERS.map((u) => new Mqtt(u));
    return new Promise((resolve, reject) => {
      let failed = 0;
      for (const c of this.clients) {
        c.onMessage = (topic, payload) => {
          const k = `${topic}:${payload.length}:${toB64(payload.slice(0, 18))}`;
          if (this.seen.has(k)) return;
          this.seen.add(k);
          if (this.seen.size > 5e3) this.seen.clear();
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
          }
        );
      }
    });
  }
  subscribe(topic) {
    this.topics.push(topic);
    this.live.forEach((c) => c.subscribe(topic));
  }
  publish(topic, payload) {
    this.live.forEach((c) => !c.closed && c.publish(topic, payload));
  }
  close() {
    this.dead = true;
    this.clients.forEach((c) => c.close());
  }
};
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function startSender(device, getPayload, onStatus, code = newCode()) {
  let stopped = false;
  const relay = new Relay();
  const expiresAt = Date.now() + SESSION_MS;
  let expiry;
  let chunks = [];
  (async () => {
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
      const sendChunks = async (idx, device2) => {
        for (let n = 0; n < idx.length && !stopped; n++) {
          relay.publish(down, await seal(key, { t: "chunk", i: idx[n], d: chunks[idx[n]] }));
          onStatus({ phase: "sending", code, expiresAt, device: device2, progress: (n + 1) / idx.length });
          await sleep(40);
        }
      };
      relay.onMessage = async (_topic, payload) => {
        const m = await open(key, payload);
        if (!m || stopped) return;
        if (m.t === "hello" && !busy && Date.now() - lastSend > 8e3) {
          busy = true;
          sentTo = m.device;
          try {
            const p = await getPayload();
            const packed = await gzip(enc.encode(JSON.stringify(p.data)));
            chunks = [];
            for (let i = 0; i < packed.length; i += CHUNK) chunks.push(toB64(packed.subarray(i, i + CHUNK)));
            relay.publish(down, await seal(key, { t: "meta", device, total: chunks.length, size: packed.length, summary: p.summary }));
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
function startReceiver(rawCode, device, onStatus) {
  const code = cleanCode(rawCode);
  let stopped = false;
  const relay = new Relay();
  const timers = [];
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
      let meta = null;
      const parts = /* @__PURE__ */ new Map();
      let lastProgress = Date.now();
      let done = false;
      const say = async (m) => relay.publish(up, await seal(key, m));
      void (async () => {
        for (let n = 0; n < 12 && !meta && !stopped; n++) {
          await say({ t: "hello", device });
          await sleep(2e3);
        }
        if (!meta && !stopped) {
          onStatus({ phase: "error", message: "No device answered. Check the code and keep Send open on the other device." });
          relay.close();
        }
      })();
      const watchdog = setInterval(() => {
        if (!meta || done || stopped) return;
        if (Date.now() - lastProgress > 3500) {
          const missing = Array.from({ length: meta.total }, (_, i) => i).filter((i) => !parts.has(i));
          if (missing.length) void say({ t: "need", missing: missing.slice(0, 200) });
          lastProgress = Date.now();
        }
      }, 1e3);
      timers.push(watchdog);
      const finish = async () => {
        done = true;
        clearInterval(watchdog);
        const bytes = new Uint8Array(meta.size);
        let o = 0;
        for (let i = 0; i < meta.total; i++) {
          const b = fromB64(parts.get(i));
          bytes.set(b, o);
          o += b.length;
        }
        const data = JSON.parse(dec.decode(await gunzip(bytes)));
        await say({ t: "got" });
        await sleep(300);
        await say({ t: "got" });
        onStatus({ phase: "received", device: meta.device, data, summary: meta.summary });
        relay.close();
      };
      relay.onMessage = async (_topic, payload) => {
        const m = await open(key, payload);
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
function deviceName(isApp) {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iPhone" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "Linux" : "";
  const kind = /Android|iPhone/i.test(ua) ? "phone" : "PC";
  return `${os ? `${os} ${kind}` : "Device"}${isApp ? " (app)" : ""}`;
}
var IP_SOURCES = [
  ["https://api.ipify.org?format=json", async (r) => (await r.json()).ip],
  ["https://ipv4.icanhazip.com/", async (r) => (await r.text()).trim()],
  ["https://api4.my-ip.io/v2/ip.txt", async (r) => (await r.text()).trim().split(/\s/)[0]]
];
async function publicIp() {
  return new Promise((resolve, reject) => {
    let failed = 0;
    for (const [url, read] of IP_SOURCES) {
      fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6e3) }).then((r) => r.ok ? read(r) : Promise.reject(new Error(String(r.status)))).then((ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? resolve(ip) : Promise.reject(new Error("bad ip"))).catch(() => ++failed === IP_SOURCES.length && reject(new Error("Couldn't check which network this device is on.")));
    }
  });
}
var hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
function startNearby(name, onEvent) {
  const id = Math.random().toString(36).slice(2, 10);
  const relay = new Relay();
  const peers = /* @__PURE__ */ new Map();
  let stopped = false;
  let send = () => {
  };
  let ecdh = null;
  let beat;
  const list = () => onEvent({ type: "peers", peers: [...peers.values()].map((p) => ({ id: p.id, name: p.name })) });
  const codeWith = async (peerId) => {
    const p = peers.get(peerId);
    if (!p || !ecdh) throw new Error("That device is gone.");
    const theirs = await crypto.subtle.importKey("raw", fromB64(p.pub), { name: "ECDH", namedCurve: "P-256" }, false, []);
    const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: theirs }, ecdh.privateKey, 256);
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([...enc.encode("aurabeats-nearby:"), ...new Uint8Array(bits)])));
    return Array.from(h.slice(0, CODE_LEN), (b) => ALPHABET[b % ALPHABET.length]).join("");
  };
  (async () => {
    onEvent({ type: "status", phase: "connecting" });
    try {
      const [ip, pair] = await Promise.all([
        publicIp(),
        crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"])
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
        const m = await open(roomKey, payload);
        if (!m || stopped || m.id === id) return;
        if (m.t === "here") {
          const known = peers.get(m.id);
          peers.set(m.id, { id: m.id, name: m.name, pub: m.pub, seen: Date.now() });
          if (!known || known.name !== m.name) {
            list();
            if (!known) send({ t: "here", id, name, pub });
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
        for (const [k, p] of peers) if (now - p.seen > 1e4) changed = peers.delete(k) || changed;
        if (changed) list();
      }, 3e3);
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
    }
  };
}
export {
  CODE_LEN,
  SESSION_MS,
  cleanCode,
  deviceName,
  newCode,
  prettyCode,
  startNearby,
  startReceiver,
  startSender
};
