// Online check: are the download + search paths alive right now?
const out = (s) => console.log(`::warning::${s}`);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
async function player(id) {
  const r = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA, "X-YouTube-Client-Name": "101", "X-YouTube-Client-Version": "1.02", Origin: "https://www.youtube.com" },
    body: JSON.stringify({ context: { client: { clientName: "VISIONOS", clientVersion: "1.02", deviceMake: "Apple", deviceModel: "RealityDevice17,1", userAgent: UA, osName: "visionOS", osVersion: "26.5.23O471", hl: "en", gl: "BD" } }, videoId: id, contentCheckOk: true, racyCheckOk: true }),
  });
  return r.json();
}
for (const id of ["dQw4w9WgXcQ", "kJQP7kiw5Fk"]) {
  try {
    const d = await player(id);
    const st = d.playabilityStatus?.status;
    const ad = d.streamingData?.adaptiveFormats ?? [];
    const withUrl = ad.filter((f) => f.url);
    const aac = withUrl.filter((f) => f.mimeType.startsWith("audio/mp4")).sort((a, b) => b.bitrate - a.bitrate)[0];
    const avc = withUrl.filter((f) => f.mimeType.includes("avc1")).sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
    out(`player ${id}: ${st} ${d.playabilityStatus?.reason ?? ""} | adaptive ${ad.length}, with direct url ${withUrl.length}, best aac ${aac?.bitrate ?? "-"}, best avc1 ${avc?.qualityLabel ?? "-"}`);
    for (const [n, f] of [["audio", aac], ["video", avc]]) {
      if (!f) continue;
      const r = await fetch(f.url, { headers: { Range: "bytes=0-1048575", "User-Agent": UA } });
      const b = await r.arrayBuffer();
      out(`  range ${n}: HTTP ${r.status}, ${b.byteLength} bytes`);
    }
  } catch (e) {
    out(`player ${id}: ERROR ${e}`);
  }
}
for (const n of ["maxresdefault", "sddefault", "hqdefault"]) {
  const r = await fetch(`https://i.ytimg.com/vi/dQw4w9WgXcQ/${n}.jpg`);
  out(`thumb ${n}: HTTP ${r.status} ${(await r.arrayBuffer()).byteLength} bytes`);
}
for (const base of ["https://pipedapi.ducks.party", "https://api.piped.private.coffee"]) {
  for (const filter of ["music_songs", "all"]) {
    try {
      const q = encodeURIComponent("arijit singh");
      const p1 = await (await fetch(`${base}/search?q=${q}&filter=${filter}`)).json();
      let line = `piped ${base.replace("https://", "")} ${filter}: p1 ${p1.items?.length ?? 0} next=${Boolean(p1.nextpage)}`;
      let next = p1.nextpage;
      for (let i = 2; i <= 4 && next; i++) {
        const p = await (await fetch(`${base}/nextpage/search?q=${q}&filter=${filter}&nextpage=${encodeURIComponent(next)}`)).json();
        line += ` | p${i} ${p.items?.length ?? 0}`;
        next = p.nextpage;
      }
      out(line);
    } catch (e) {
      out(`piped ${base} ${filter}: ERROR ${e}`);
    }
  }
}
