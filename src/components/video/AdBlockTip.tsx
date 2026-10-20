/**
 * Website only: the official YouTube player may show ads, and a page can't
 * block them inside YouTube's iframe. A free blocker extension can, so we
 * explain how per browser (uBlock Origin Lite, Brave Shields, uBlock Origin).
 * We detect whether a blocker is active: red warning if not, blue if yes.
 */
import { useState } from "react";
import { ExternalLink, Loader2, RefreshCw, ShieldAlert, ShieldCheck, Smartphone, X } from "lucide-react";
import { useAdBlock } from "./adblock";
import { storage } from "@/utils/storage";
import { cn } from "@/utils/cn";

type Browser = "chrome" | "edge" | "brave" | "firefox" | "other";

function detectBrowser(): Browser {
  if (typeof navigator === "undefined") return "other";
  if ((navigator as unknown as { brave?: unknown }).brave) return "brave";
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return "firefox";
  const phone = /Android|iPhone|iPad|Mobile/.test(ua);
  if (phone) return "other"; // extensions don't run in phone Chrome/Edge
  if (/Edg\//.test(ua)) return "edge";
  if (/Chrome\//.test(ua)) return "chrome";
  return "other";
}

const UBO_LITE = "https://chromewebstore.google.com/detail/ublock-origin-lite/ddkjiahejlhfcafbddmgiahcphecmpfh";
const UBO = "https://addons.mozilla.org/firefox/addon/ublock-origin/";

const KEY = "video:adTipCollapsed";

/** Always the newest GitHub release (no fixed tag), where the APK is attached. */
export const APP_DOWNLOAD_URL = "https://github.com/jakariatanjim-svg/aurabeats/releases/latest";

function LinkBtn({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-xs font-bold text-white transition hover:brightness-110"
    >
      {children} <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function Option({ title, mine, label = "Your browser", children }: { title: string; mine: boolean; label?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-xl border p-3", mine ? "border-accent/60 bg-accent/[0.06]" : "border-line")}>
      <p className="mb-1.5 flex items-center gap-2 text-[12px] font-black text-ink">
        {title}
        {mine && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-white">{label}</span>}
      </p>
      <div className="space-y-2 text-[12px] leading-relaxed text-ink2">{children}</div>
    </div>
  );
}

/** The full how-to (also used in Settings). Your browser's option comes first. */
export function AdBlockSteps({ className }: { className?: string }) {
  const b = detectBrowser();
  const android = typeof navigator !== "undefined" && /Android/.test(navigator.userAgent);
  const options = [
    {
      key: "chromium",
      mine: b === "chrome" || b === "edge",
      node: (
        <Option key="c" title="Chrome · Edge (computer)" mine={b === "chrome" || b === "edge"}>
          <p>Install the free uBlock Origin Lite extension, then reload this page.</p>
          <LinkBtn href={UBO_LITE}>Get uBlock Origin Lite</LinkBtn>
        </Option>
      ),
    },
    {
      key: "brave",
      mine: b === "brave",
      node: (
        <Option key="b" title="Brave · no extension needed" mine={b === "brave"}>
          <ol className="list-decimal space-y-0.5 pl-4">
            <li>
              Tap the <b className="text-ink">lion icon</b> (Brave Shields) in the address bar and make sure Shields are{" "}
              <b className="text-ink">Up</b> for this site.
            </li>
            <li>
              Set <b className="text-ink">Trackers &amp; ads blocking</b> to <b className="text-ink">Aggressive</b>. To do it for every site:
              Settings → Shields → Trackers &amp; ads blocking → Aggressive.
            </li>
            <li>Reload this page.</li>
          </ol>
        </Option>
      ),
    },
    {
      key: "firefox",
      mine: b === "firefox",
      node: (
        <Option key="f" title="Firefox · PC & Android" mine={b === "firefox"}>
          <p>Install the original uBlock Origin add-on, then reload this page.</p>
          <LinkBtn href={UBO}>Get uBlock Origin</LinkBtn>
        </Option>
      ),
    },
  ].sort((x, y) => Number(y.mine) - Number(x.mine));

  // Android phone without Brave/Firefox: the app is the easy way.
  const appFirst = android && b !== "brave" && b !== "firefox";
  const appCard = (
    <Option title="Android phone · AuraBeats app" mine={appFirst} label="Your device">
      <p>
        Install the free AuraBeats app: videos play with <b className="text-ink">no ads at all</b>, no extension needed.
        On the page that opens, tap <b className="text-ink">AuraBeats-….apk</b> under “Assets”, then open it to install.
      </p>
      <LinkBtn href={APP_DOWNLOAD_URL}>
        <Smartphone className="h-3.5 w-3.5" /> Download the Android app
      </LinkBtn>
    </Option>
  );

  return (
    <div className={cn("space-y-2.5", className)}>
      {appFirst && appCard}
      {options.map((o) => o.node)}
      {!appFirst && appCard}
    </div>
  );
}

/** Small status chip next to the video's views/date. */
export function AdBadge() {
  const { state } = useAdBlock();
  if (state === "checking") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-ink/5 px-2 py-0.5 text-[11px] font-semibold text-ink3">
        <Loader2 className="h-3 w-3 animate-spin" /> Checking ad blocker…
      </span>
    );
  }
  return state === "on" ? (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-blue-500/12 px-2 py-0.5 text-[11px] font-bold text-blue-500"
      title="An ad blocker is active in this browser, so YouTube's ads are blocked."
    >
      <ShieldCheck className="h-3 w-3" /> Extension detected · ad-free
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-red-500/12 px-2 py-0.5 text-[11px] font-bold text-red-500"
      title="No ad blocker found. YouTube's player may show ads — see how to block them below."
    >
      <ShieldAlert className="h-3 w-3" /> Ads not blocked
    </span>
  );
}

/**
 * Under the video: big red warning while no blocker is found (with the
 * per-browser how-to), a slim blue confirmation once one is detected.
 */
export function AdBlockTip() {
  const { state, recheck } = useAdBlock();
  const [collapsed, setCollapsed] = useState(() => storage.get<boolean>(KEY, false));
  const set = (v: boolean) => {
    setCollapsed(v);
    storage.set(KEY, v);
  };

  if (state === "checking") return null;

  if (state === "on") {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl border border-blue-500/40 bg-blue-500/10 px-4 py-3 text-[13px]">
        <ShieldCheck className="h-5 w-5 shrink-0 text-blue-500" />
        <p className="leading-snug text-ink2">
          <b className="text-blue-500">Extension detected.</b> YouTube's ads are blocked in this browser. Enjoy!
        </p>
      </div>
    );
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => set(false)}
        className="flex w-full items-center gap-2 rounded-2xl border border-red-500/50 bg-red-500/10 px-4 py-3 text-left text-[13px] font-bold text-red-500 transition hover:bg-red-500/15"
      >
        <ShieldAlert className="h-5 w-5 shrink-0" />
        <span className="flex-1">No ad blocker — YouTube will show ads.</span>
        <span className="text-xs underline underline-offset-2">Fix it free</span>
      </button>
    );
  }

  return (
    <div className="relative rounded-2xl border-2 border-red-500/60 bg-red-500/10 p-4 sm:p-5">
      <button
        type="button"
        onClick={() => set(true)}
        aria-label="Make smaller"
        className="absolute top-2.5 right-2.5 rounded-full p-1.5 text-red-500/80 transition hover:text-red-500"
      >
        <X className="h-4 w-4" />
      </button>
      <p className="flex items-center gap-2 pr-8 text-[15px] font-black text-red-500 sm:text-[1rem]">
        <ShieldAlert className="h-6 w-6 shrink-0" /> No ad blocker found — YouTube will show ads
      </p>
      <p className="mt-1.5 mb-3 text-[12.5px] leading-relaxed text-ink2">
        Videos on the website play in YouTube's official player, and a website isn't allowed to remove its ads. Your
        browser can, for free, in a few seconds:
      </p>
      <AdBlockSteps />
      <button
        type="button"
        onClick={recheck}
        className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-red-500/50 px-3.5 py-1.5 text-xs font-bold text-red-500 transition hover:bg-red-500/10"
      >
        <RefreshCw className="h-3.5 w-3.5" /> I've set it up — check again
      </button>
    </div>
  );
}
