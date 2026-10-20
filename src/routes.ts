/** Route keys are plain strings so playlists can be addressed as `playlist:<id>`. */
export type RouteKey =
  | "home"
  | "search"
  | "radio"
  | "library"
  | "favorites"
  | "history"
  | "settings"
  | "about"
  | "privacy"
  | "downloads"
  | "device"
  | `playlist:${string}`
  // Video mode (ad-free YouTube)
  | "video"
  | "video-search"
  | "video-subs"
  | "video-library"
  | `watch:${string}`
  | `channel:${string}`;

/** Video-mode routes; everything else is Music mode. */
export function isVideoRoute(route: RouteKey): boolean {
  return route === "video" || route.startsWith("video-") || route.startsWith("watch:") || route.startsWith("channel:");
}

export interface RouteMeta {
  key: RouteKey;
  label: string;
}

/* -------------------- clean slash URLs (History API) -------------------- *
 * Sections live on real paths — /home /search /radio /library /favorites
 * /history /settings /about /playlist/<id> — served by ONE index.html thanks
 * to public/_redirects (Cloudflare SPA fallback). Static assets keep working
 * (Cloudflare serves the real file first; the fallback only catches routes
 * that have no matching asset). On file:// (double-click offline) it degrades
 * gracefully to the Discover section without any URL mangling.
 * Deep-linkable, back/forward friendly, and every section can be audited
 * directly as a real path — no hash fragment weirdness.
 * ------------------------------------------------------------------------ */

export function routeToPath(route: RouteKey): string {
  if (route.startsWith("playlist:")) return `/playlist/${route.slice("playlist:".length)}`;
  if (route.startsWith("watch:")) return `/watch/${encodeURIComponent(route.slice("watch:".length))}`;
  if (route.startsWith("channel:")) return `/channel/${encodeURIComponent(route.slice("channel:".length))}`;
  if (route.startsWith("video-")) return `/video/${route.slice("video-".length)}`;
  return route === "home" ? "/home" : `/${route}`;
}

export function pathToRoute(pathname: string): RouteKey {
  const clean = (pathname || "/").replace(/\/+$/, "") || "/";
  if (clean === "/") return "home";
  if (clean.startsWith("/playlist/")) {
    const id = clean.slice("/playlist/".length);
    return id ? (`playlist:${id}` as RouteKey) : "library";
  }
  if (clean.startsWith("/watch/")) {
    const id = decodeURIComponent(clean.slice("/watch/".length));
    return id ? (`watch:${id}` as RouteKey) : "video";
  }
  if (clean.startsWith("/channel/")) {
    const id = decodeURIComponent(clean.slice("/channel/".length));
    return id ? (`channel:${id}` as RouteKey) : "video";
  }
  if (clean === "/video") return "video";
  if (clean.startsWith("/video/")) {
    const sub = clean.slice("/video/".length);
    return (["search", "subs", "library"].includes(sub) ? `video-${sub}` : "video") as RouteKey;
  }
  const key = clean.slice(1);
  const valid: RouteKey[] = ["home", "search", "radio", "library", "favorites", "history", "settings", "about", "privacy", "downloads", "device"];
  return valid.includes(key as RouteKey) ? (key as RouteKey) : "home";
}

export function routeLabel(route: RouteKey): string {
  if (route.startsWith("playlist:")) return "Playlist";
  if (route.startsWith("watch:")) return "Watch";
  if (route.startsWith("channel:")) return "Channel";
  switch (route) {
    case "video":
      return "Video";
    case "video-search":
      return "Search videos";
    case "video-subs":
      return "Following";
    case "video-library":
      return "Video library";
    case "home":
      return "Discover";
    case "search":
      return "Search";
    case "radio":
      return "Live Radio";
    case "library":
      return "Your Library";
    case "favorites":
      return "Favourites";
    case "history":
      return "Recently Played";
    case "device":
      return "On this device";
    case "settings":
      return "Settings";
    case "about":
      return "About AuraBeats";
    case "privacy":
      return "Privacy Policy";
    case "downloads":
      return "Downloads";
    default:
      return "AuraBeats";
  }
}
