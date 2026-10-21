const Real = globalThis.WebSocket;
let n = 0;
globalThis.WebSocket = class extends Real {
  constructor(url, p) {
    super(url, p);
    const id = (++n) + (url.includes("emqx") ? "E" : "H");
    const origSend = this.send.bind(this);
    this.send = (b) => { const u = new Uint8Array(b.buffer ? b : b); console.log("  ws", id, "SEND type", u[0] >> 4, "hdr", u[0].toString(16), "len", u.length); return origSend(b); };
    this.addEventListener("message", (e) => { const u = new Uint8Array(e.data); console.log("  ws", id, "RECV type", u[0] >> 4, "bytes", Array.from(u.slice(0, 6)).join(","), "len", u.length, typeof e.data, e.data?.constructor?.name); });
    this.addEventListener("close", (e) => console.log("  ws", id, "CLOSE", e.code, e.reason));
  }
};
