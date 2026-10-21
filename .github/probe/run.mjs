import { startSender, startReceiver, startNearby, newCode } from "./sync.mjs";
const big = { favorites: Array.from({ length: 1500 }, (_, i) => ({ id: "t" + i, title: "Song " + i + " " + Math.random().toString(36), artist: "Artist " + (i % 97) })) };
const T0 = Date.now();
const log = (...a) => console.log(((Date.now() - T0) / 1000).toFixed(2) + "s", ...a);
const payload = async () => ({ data: big, summary: { favorites: 1500 } });

async function codeFlow() {
  const t = Date.now();
  await new Promise((resolve) => {
    let stopR = () => {};
    let started = false;
    const stopS = startSender("PC", payload, (s) => {
      if (s.phase === "connecting") log("CODE shown after", Date.now() - t, "ms:", s.code);
      if (s.phase === "waiting" && !started) {
        started = true;
        log("CODE relay ready after", Date.now() - t, "ms");
        stopR = startReceiver(s.code, "Phone", (r) => {
          if (r.phase === "received") log("CODE received match=", JSON.stringify(r.data) === JSON.stringify(big), "total ms", Date.now() - t);
          if (r.phase === "error") { log("CODE R error", r.message); stopS(); resolve(); }
        });
      }
      if (s.phase === "sent") { setTimeout(() => { stopS(); stopR(); resolve(); }, 300); }
      if (s.phase === "error") { log("CODE S error", s.message); resolve(); }
    });
  });
}

async function nearbyFlow() {
  const t = Date.now();
  await new Promise((resolve) => {
    let bId = null, stops = [];
    const done = () => { stops.forEach((f) => f()); A.stop(); B.stop(); resolve(); };
    setTimeout(() => { log("NEARBY timeout"); done(); }, 60000);
    const A = startNearby("Windows PC", (e) => {
      if (e.type === "error") { log("A error", e.message); done(); }
      if (e.type === "status") log("A", e.phase, Date.now() - t, "ms");
      if (e.type === "peers") {
        log("A sees", JSON.stringify(e.peers.map((p) => p.name)));
        const b = e.peers.find((p) => p.name === "Android phone");
        if (b && !bId) { bId = b.id; A.offer(b.id); log("A offered"); }
      }
      if (e.type === "accepted") {
        log("A accepted by", e.by.name, "code", e.code);
        stops.push(startSender("Windows PC", payload, (s) => { if (s.phase === "sent") { log("A sent"); setTimeout(done, 300); } if (s.phase === "error") log("A S err", s.message); }, e.code));
      }
    });
    const B = startNearby("Android phone", async (e) => {
      if (e.type === "error") { log("B error", e.message); done(); }
      if (e.type === "peers") log("B sees", JSON.stringify(e.peers.map((p) => p.name)));
      if (e.type === "offer") {
        log("B got offer from", e.from.name);
        const code = await B.accept(e.from.id);
        log("B code", code);
        stops.push(startReceiver(code, "Android phone", (r) => {
          if (r.phase === "received") log("NEARBY received from", r.device, "match=", JSON.stringify(r.data) === JSON.stringify(big), "total ms", Date.now() - t);
          if (r.phase === "error") log("B R err", r.message);
        }));
      }
    });
  });
}
await codeFlow();
await nearbyFlow();
process.exit(0);
