/**
 * The search term lives in the address bar (/search?q=… and
 * /video/search?q=…) so back / forward and shared links work, and the top-bar
 * search box and the results page stay in sync.
 */
import { useSyncExternalStore } from "react";
import { searchHistory, type SearchMode } from "@/utils/searchHistory";

export function searchPath(mode: SearchMode, q = ""): string {
  const base = mode === "video" ? "/video/search" : "/search";
  return q.trim() ? `${base}?q=${encodeURIComponent(q.trim())}` : base;
}

/** Opens the results page for `q` (and remembers it in the history). */
export function goSearch(mode: SearchMode, q: string, opts: { replace?: boolean } = {}) {
  const t = q.trim();
  if (!t) return;
  searchHistory.add(t, mode);
  goPath(searchPath(mode, t), opts.replace);
}

/** pushState (or replaceState) + tell the shell. */
export function goPath(path: string, replace = false) {
  if (replace) window.history.replaceState(null, "", path);
  else if (window.location.pathname + window.location.search !== path) {
    if (window.location.pathname === "/") window.history.replaceState(null, "", "/home");
    window.history.pushState(null, "", path);
  }
  // The shell and the results page follow the address bar via popstate.
  window.dispatchEvent(new PopStateEvent("popstate"));
}

const readQ = () => new URLSearchParams(window.location.search).get("q")?.trim() ?? "";
const subscribe = (cb: () => void) => {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
};

/** The `q` of the current address, re-rendering on navigation. */
export function useUrlQuery(): string {
  return useSyncExternalStore(subscribe, readQ, () => "");
}

/** Focus the top-bar search (opens the phone search sheet). */
export function openSearch() {
  window.dispatchEvent(new Event("ab:open-search"));
}
