/* ----------------------------------------------------------------------------
 * Ad-blocker detection (website only).
 *
 * Tested with real uBlock Origin Lite, uBlock Origin and Brave Shields:
 *  - some ad URLs are blocked outright → the request fails;
 *  - others (adsbygoogle.js, ad_status.js, pagead/id) are NOT blocked but
 *    swapped for the blocker's own harmless stand-in file. That "succeeds", so
 *    a plain "did it load?" check misses it. A cross-origin no-cors response
 *    is always type "opaque"; a swapped one comes back as "basic"/extension URL.
 * A harmless control request makes sure being offline isn't read as a blocker,
 * and a hidden "bait" element catches cosmetic-only blockers.
 * -------------------------------------------------------------------------- */

import { useEffect, useSyncExternalStore } from "react";

export type AdBlockState = "checking" | "on" | "off";

const PROBES: { url: string; method: "GET" | "HEAD" }[] = [
  { url: "https://static.doubleclick.net/instream/ad_status.js", method: "GET" },
  { url: "https://www.youtube.com/api/stats/ads?ver=2", method: "GET" },
  { url: "https://www.youtube.com/pagead/paralleladview", method: "GET" },
  { url: "https://googleads.g.doubleclick.net/pagead/id", method: "GET" },
  { url: "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js", method: "HEAD" },
  { url: "https://imasdk.googleapis.com/js/sdkloader/ima3.js", method: "HEAD" },
];
const CONTROL = "https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg";

let state: AdBlockState = "checking";
let running: Promise<void> | null = null;
const listeners = new Set<() => void>();
const set = (s: AdBlockState) => {
  state = s;
  listeners.forEach((l) => l());
};

type Probe = "ok" | "blocked" | "swapped" | "timeout";
async function probe(url: string, method: "GET" | "HEAD"): Promise<Probe> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 7000);
  const bust = `${url}${url.includes("?") ? "&" : "?"}_=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  try {
    const r = await fetch(bust, { method, mode: "no-cors", cache: "no-store", credentials: "omit", signal: ctl.signal });
    const swapped = r.type !== "opaque" || /^(chrome|moz|safari-web)-extension:|^data:/.test(r.url);
    return swapped ? "swapped" : "ok";
  } catch {
    return ctl.signal.aborted ? "timeout" : "blocked";
  } finally {
    clearTimeout(t);
  }
}

function baitHidden(): Promise<boolean> {
  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.className = "adsbox ad-banner adsbygoogle pub_300x250 textAd ad-placement";
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:300px;height:250px;pointer-events:none;";
    el.innerHTML = "&nbsp;";
    document.body.appendChild(el);
    setTimeout(() => {
      const cs = getComputedStyle(el);
      const hidden = el.offsetHeight === 0 || cs.display === "none" || cs.visibility === "hidden";
      el.remove();
      resolve(hidden);
    }, 400);
  });
}

/** Runs the check (once at a time). `force` re-checks, e.g. after installing. */
export function checkAdBlock(force = false): Promise<void> {
  if (running && !force) return running;
  if (force) set("checking");
  running = (async () => {
    const [control, bait, ...ads] = await Promise.all([probe(CONTROL, "GET"), baitHidden(), ...PROBES.map((p) => probe(p.url, p.method))]);
    const hit = ads.some((r) => r === "blocked" || r === "swapped");
    set((control === "ok" && hit) || bait ? "on" : "off");
  })();
  return running;
}

export function useAdBlock(): { state: AdBlockState; recheck: () => void } {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
  useEffect(() => {
    void checkAdBlock();
    // Back from installing an extension / changing Shields → check again.
    const onVis = () => document.visibilityState === "visible" && state === "off" && void checkAdBlock(true);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return { state: s, recheck: () => void checkAdBlock(true) };
}

/** Non-React read (the player only needs the latest value). */
export const adBlockState = () => state;
