/* ----------------------------------------------------------------------------
 * Ad-blocker detection (website only).
 *
 * Blockers (uBlock Origin, uBlock Origin Lite, Brave Shields, AdGuard…) stop
 * requests to Google's ad servers. We try to load two well-known ad scripts —
 * one of them is the very file YouTube's player uses to check for blockers —
 * and compare with a harmless control request so being offline isn't
 * mistaken for a blocker. A hidden "bait" element catches cosmetic blockers.
 * -------------------------------------------------------------------------- */

import { useEffect, useSyncExternalStore } from "react";

export type AdBlockState = "checking" | "on" | "off";

const AD_PROBES = [
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
  "https://static.doubleclick.net/instream/ad_status.js",
];
const CONTROL = "https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg";

let state: AdBlockState = "checking";
let running: Promise<void> | null = null;
const listeners = new Set<() => void>();
const set = (s: AdBlockState) => {
  state = s;
  listeners.forEach((l) => l());
};

function reachable(url: string, ms = 6000): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return fetch(`${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`, { mode: "no-cors", cache: "no-store", signal: ctl.signal })
    .then(() => true)
    .catch(() => false)
    .finally(() => clearTimeout(t));
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
    const [control, bait, ...ads] = await Promise.all([reachable(CONTROL), baitHidden(), ...AD_PROBES.map((u) => reachable(u))]);
    const blockedRequest = control && ads.some((ok) => !ok);
    set(blockedRequest || bait ? "on" : "off");
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
