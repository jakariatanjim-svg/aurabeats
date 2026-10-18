/**
 * Website only: the official YouTube player may show ads, and a page can't
 * block them inside YouTube's iframe. A free blocker extension can, so we
 * explain how in two steps. Dismissing shrinks it to a one-line reminder.
 */
import { useState } from "react";
import { ExternalLink, ShieldCheck, Smartphone, X } from "lucide-react";
import { storage } from "@/utils/storage";
import { cn } from "@/utils/cn";

export const UBLOCK_LINKS = [
  {
    browser: "Chrome · Edge · Brave",
    name: "uBlock Origin Lite",
    url: "https://chromewebstore.google.com/detail/ublock-origin-lite/ddkjiahejlhfcafbddmgiahcphecmpfh",
  },
  {
    browser: "Firefox (PC & Android)",
    name: "uBlock Origin",
    url: "https://addons.mozilla.org/firefox/addon/ublock-origin/",
  },
] as const;

const KEY = "video:adTipCollapsed";

function Links({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {UBLOCK_LINKS.map((l) => (
        <a
          key={l.url}
          href={l.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-xs font-bold text-white transition hover:brightness-110"
        >
          {l.name}
          <span className="font-semibold opacity-80">· {l.browser}</span>
          <ExternalLink className="h-3 w-3" />
        </a>
      ))}
    </div>
  );
}

/** The full how-to (also used in Settings). */
export function AdBlockSteps({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-2.5 text-[12px] leading-relaxed text-ink2", className)}>
      <ol className="list-decimal space-y-1 pl-4">
        <li>Install the free uBlock Origin extension for your browser:</li>
      </ol>
      <Links />
      <ol start={2} className="list-decimal space-y-1 pl-4">
        <li>Reload this page. YouTube ads are now blocked on AuraBeats (and on youtube.com too).</li>
      </ol>
      <p className="flex items-start gap-1.5 text-[11px] text-ink3">
        <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          On a phone: Firefox for Android supports uBlock Origin. Or use the <b className="text-ink2">AuraBeats Android app</b>,
          where videos play with no ads at all.
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
          Seeing ads? <b className="text-accent">Block them free with uBlock Origin →</b>
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
        a free browser extension can. It takes a few seconds:
      </p>
      <AdBlockSteps />
    </div>
  );
}
