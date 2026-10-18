const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const CLIENT = { clientName: "VISIONOS", clientVersion: "1.02", deviceMake: "Apple", deviceModel: "RealityDevice17,1", userAgent: UA, osName: "visionOS", osVersion: "26.5.23O471", hl: "en", gl: "US" };
const IDS = { rick: "dQw4w9WgXcQ", despacito: "kJQP7kiw5Fk", gangnam: "9bZkp7q19f0", mrbeast: "0e3GPea1Tyg", lofiLive: "jfKfPfyJRdk", long: "pRpeEdMmmQ0", bangla: "Hp7Ln6S0C5U" };
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
for (const [name, id] of Object.entries(IDS)) {
  try {
    const r = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": UA, "X-YouTube-Client-Name": "101", "X-YouTube-Client-Version": "1.02", Origin: "https://www.youtube.com" },
      body: JSON.stringify({ context: { client: CLIENT }, videoId: id, contentCheckOk: true, racyCheckOk: true }),
    });
    const d = await r.json();
    const ps = d.playabilityStatus || {};
    const sd = d.streamingData || {};
    const ad = (sd.adaptiveFormats || []).filter((f) => f.url);
    const vids = ad.filter((f) => f.mimeType.startsWith("video/"));
    const auds = ad.filter((f) => f.mimeType.startsWith("audio/"));
    const maxH = Math.max(0, ...vids.map((f) => f.height || 0));
    let line = `${name.padEnd(10)} http=${r.status} status=${ps.status} ${ps.reason ? "reason=" + ps.reason.slice(0, 60) : ""} video=${vids.length} audio=${auds.length} muxed=${(sd.formats || []).filter((f) => f.url).length} maxH=${maxH} hls=${!!sd.hlsManifestUrl} sigCipher=${(sd.adaptiveFormats || []).filter((f) => f.signatureCipher).length}`;
    const best = vids.sort((a, b) => (b.height || 0) - (a.height || 0))[0];
    const aud = auds[0];
    for (const [lbl, f] of [["v", best], ["a", aud]]) {
      if (!f) continue;
      const g = await fetch(f.url, { headers: { Range: "bytes=0-2000", "User-Agent": ANDROID_UA } });
      const g2 = await fetch(f.url.replace(/&range=[^&]*/, "") + "&range=0-500000");
      line += ` | ${lbl}${f.height || ""} range=${g.status} len=${(await g.arrayBuffer()).byteLength} qrange=${g2.status}`;
    }
    if (sd.hlsManifestUrl) { const h = await fetch(sd.hlsManifestUrl); line += ` | hls=${h.status}`; }
    console.log(line);
  } catch (e) { console.log(name, "ERR", String(e)); }
}
