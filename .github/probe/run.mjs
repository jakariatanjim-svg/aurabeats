import { startSender, startReceiver, newCode } from "./sync.mjs";
const big = { favorites: Array.from({ length: 1500 }, (_, i) => ({ id: "t" + i, title: "Song number " + i + " " + Math.random().toString(36), artist: "Artist " + (i % 97) })) };
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
async function run(label, wrong) {
  const code = newCode();
  const t0 = Date.now();
  return new Promise((resolve) => {
    let stopR = () => {};
    const stopS = startSender("Test PC", async () => ({ data: big, summary: { favorites: 1500 } }), (s) => {
      if (s.phase !== "sending") log(label, "S", s.phase, s.message || "");
      if (s.phase === "waiting") {
        stopR = startReceiver(wrong ? newCode() : code, "Test phone", (r) => {
          if (r.phase === "receiving") return;
          log(label, "R", r.phase, r.message || "", r.device || "");
          if (r.phase === "received") {
            const ok = JSON.stringify(r.data) === JSON.stringify(big);
            log(label, "RESULT match=", ok, "ms=", Date.now() - t0, "size=", JSON.stringify(big).length);
          }
          if (r.phase === "error") { stopS(); resolve(); }
        });
      }
      if (s.phase === "sent") { log(label, "SENDER saw got"); setTimeout(() => { stopS(); stopR(); resolve(); }, 500); }
      if (s.phase === "error") { stopR(); resolve(); }
    });
  });
}
await run("OK", false);
await run("WRONG", true);
process.exit(0);
