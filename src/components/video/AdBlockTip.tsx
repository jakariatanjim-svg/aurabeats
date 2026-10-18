/**
 * Website only: the official YouTube player may show ads, and a page can't
 * block them inside YouTube's iframe. A free blocker extension can, so we
 * explain how per browser (uBlock Origin Lite, Brave Shields, uBlock Origin). Dismissing shrinks it to a one-line reminder.
 */
import { useState } from "react";
import { ExternalLink, ShieldCheck, Smartphone, X } from "lucide-react";
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

function Option({ title, mine, children }: { title: string; mine: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-xl border p-3", mine ? "border-accent/60 bg-accent/[0.06]" : "border-line")}>
      <p className="mb-1.5 flex items-center gap-2 text-[12px] font-black text-ink">
        {title}
        {mine && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-white">Your browser</span>}
      </p>
      <div className="space-y-2 text-[12px] leading-relaxed text-ink2">{children}</div>
    </div>
  );
}

/** The full how-to (also used in Settings). Your browser's option comes first. */
export function AdBlockSteps({ className }: { className?: string }) {
  const b = detectBrowser();
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

  return (
    <div className={cn("space-y-2.5", className)}>
      {options.map((o) => o.node)}
      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink3">
        <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          On a phone, Brave and Firefox block ads too. Or use the <b className="text-ink2">AuraBeats Android app</b>, where
          videos play with no ads at all.
        </span>
      </p>
    </div>
  );
}

export function AdBlockTip() {
  const [collapsed, setCollapsed] = useState(() => storage.get<boolean>(KEY, false));
  const set = (v: boolean) => {
    setCollapsed(v);
    storage.set(KEY, v);
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => set(false)}
        className="flex w-full items-center gap-1.5 rounded-2xl border border-line px-3.5 py-2.5 text-left text-xs text-ink3 transition hover:text-ink"
      >
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        <span>
          Seeing ads? <b className="text-accent">Block them for free →</b>
        </span>
      </button>
    );
  }

  return (
    <div className="blur-panel relative rounded-2xl p-4">
      <button
        type="button"
        onClick={() => set(true)}
        aria-label="Hide tip"
        className="absolute top-2.5 right-2.5 rounded-full p-1.5 text-ink3 transition hover:text-ink"
      >
        <X className="h-4 w-4" />
      </button>
      <p className="flex items-center gap-2 pr-8 text-sm font-black text-ink">
        <ShieldCheck className="h-4 w-4 text-emerald-500" /> Watch without ads
      </p>
      <p className="mt-1 mb-3 text-[12px] leading-relaxed text-ink3">
        Videos on the website play in YouTube's official player, so YouTube may show ads. A website can't block them, but
        your browser can, for free, in a few seconds:
      </p>
      <AdBlockSteps />
    </div>
  );
}
