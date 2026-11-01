/**
 * Website only: the official YouTube player may show ads, and a page can't
 * block them inside YouTube's iframe. A free blocker extension can, so we
 * explain how per browser (uBlock Origin Lite, Brave Shields, uBlock Origin).
 * Under the video: two status lights. Necessary: the AuraBeats extension
 * (computers). For best experience: an ad blocker (yellow when missing).
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, ExternalLink, Loader2, RefreshCw, ShieldAlert, ShieldCheck, Smartphone } from "lucide-react";
import { useAdBlock } from "./adblock";
import { cn } from "@/utils/cn";
import { useExtension } from "@/services/yt/extension";
import { routeToPath } from "@/routes";

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
      className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400"
      title="No ad blocker found. Recommended for the best experience — see below."
    >
      <ShieldAlert className="h-3 w-3" /> Ads not blocked
    </span>
  );
}

type Tone = "ok" | "warn" | "bad" | "wait";
const DOT: Record<Tone, string> = { ok: "bg-emerald-500", warn: "bg-amber-400", bad: "bg-red-500", wait: "bg-ink3 animate-pulse" };

function Light({ tone, group, name, value, action }: { tone: Tone; group: string; name: string; value: string; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", DOT[tone], tone === "ok" && "shadow-[0_0_0_3px_rgb(16_185_129/0.18)]")} />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="text-[10px] font-bold tracking-wide text-ink3 uppercase">{group}</p>
        <p className="truncate text-[13px] font-semibold text-ink">
          {name} <span className="font-normal text-ink3">· {value}</span>
        </p>
      </div>
      {action}
    </div>
  );
}

/** Computers with a Chromium browser can use the AuraBeats extension. */
const extensionPossible = () => typeof window !== "undefined" && matchMedia("(pointer: fine)").matches && !/Firefox\//.test(navigator.userAgent);

/** Under the video: Necessary (extension) and For best experience (ad blocker). */
export function AdBlockTip() {
  const { state, recheck } = useAdBlock();
  const ext = useExtension();
  const [open, setOpen] = useState(false);
  const showExt = extensionPossible();

  return (
    <div className="blur-panel divide-y divide-line overflow-hidden rounded-2xl p-0">
      {showExt && (
        <Light
          tone={ext.connected ? "ok" : "bad"}
          group="Necessary"
          name="AuraBeats extension"
          value={ext.connected ? "Connected" : "Not installed"}
          action={
            !ext.connected && (
              <a href={routeToPath("settings")} data-nav="true" className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-bold text-ink hover:bg-ink/[0.05]">
                Install
              </a>
            )
          }
        />
      )}
      <Light
        tone={state === "on" ? "ok" : state === "checking" ? "wait" : "warn"}
        group="For best experience"
        name="Ad blocker"
        value={state === "on" ? "Active" : state === "checking" ? "Checking…" : "Not found"}
        action={
          state === "off" && (
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex shrink-0 items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs font-bold text-ink hover:bg-ink/[0.05]">
              How <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
            </button>
          )
        }
      />
      {open && state === "off" && (
        <div className="space-y-3 p-3.5">
          <AdBlockSteps />
          <button type="button" onClick={recheck} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-xs font-bold text-ink hover:bg-ink/[0.05]">
            <RefreshCw className="h-3.5 w-3.5" /> Check again
          </button>
        </div>
      )}
    </div>
  );
}
