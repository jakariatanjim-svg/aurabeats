/**
 * Channel avatars / banners straight from Google's image CDN.
 *
 * Piped and Invidious hand out images through their own proxies
 * (piped-proxy.example/…?host=yt3.ggpht.com, invidious.example/ggpht/…).
 * Those proxies are often slow or down — then every avatar fell back to the
 * channel's initials ("T" for T-Series). yt3.ggpht.com / i.ytimg.com serve
 * the same files to any browser or WebView, quickly and without a proxy.
 */
const GOOGLE_IMG = /(^|\.)(ggpht\.com|ytimg\.com|googleusercontent\.com)$/i;

export function directImg(u?: string | null): string | undefined {
  if (!u) return undefined;
  const raw = u.startsWith("//") ? `https:${u}` : u;
  let url: URL;
  try {
    url = new URL(raw, "https://relative.invalid");
  } catch {
    return undefined;
  }
  // Piped: https://<proxy>/<path>?host=yt3.ggpht.com
  const host = url.searchParams.get("host");
  if (host && GOOGLE_IMG.test(host)) {
    url.searchParams.delete("host");
    const q = url.searchParams.toString();
    return `https://${host}${url.pathname}${q ? `?${q}` : ""}`;
  }
  // Invidious: /ggpht/<path> → yt3.ggpht.com, /vi/<id>/… → i.ytimg.com
  const gg = url.pathname.match(/^\/ggpht(\/.+)$/);
  if (gg) return `https://yt3.ggpht.com${gg[1]}`;
  if (url.pathname.startsWith("/vi/") && !GOOGLE_IMG.test(url.hostname)) return `https://i.ytimg.com${url.pathname}`;
  if (url.hostname === "relative.invalid") return undefined;
  return url.href;
}

/* ----------------------- remembered channel avatars ---------------------- *
 * Some lists carry no avatar at all (the followed-channels feed is built
 * from YouTube's RSS). Every avatar seen anywhere is remembered per channel
 * on this device, so those cards still show the real picture.
 */
const AV_KEY = "ab:avatars";
const AV_MAX = 800;
let avatars: Record<string, string> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function avatarMap(): Record<string, string> {
  if (!avatars) {
    try {
      avatars = JSON.parse(localStorage.getItem(AV_KEY) || "{}") as Record<string, string>;
    } catch {
      avatars = {};
    }
  }
  return avatars;
}

export function rememberAvatar(channelId?: string, url?: string): void {
  const u = directImg(url);
  if (!channelId || !u) return;
  const m = avatarMap();
  if (m[channelId] === u) return;
  delete m[channelId]; // re-insert = most recent
  m[channelId] = u;
  const keys = Object.keys(m);
  for (const k of keys.slice(0, Math.max(0, keys.length - AV_MAX))) delete m[k];
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AV_KEY, JSON.stringify(m));
    } catch {
      /* storage full — memory copy still works */
    }
  }, 1500);
}

export function avatarFor(channelId?: string): string | undefined {
  return channelId ? avatarMap()[channelId] : undefined;
}
