/**
 * Website → Settings → YouTube account: the AuraBeats Connector extension.
 * Download (with progress), install guide and connection status.
 */
import { useState } from "react";
import { CheckCircle2, ChevronDown, Copy, Download, Puzzle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/utils/cn";
import { usePlayer } from "@/hooks/usePlayer";
import { EXTENSION_VERSION, EXTENSION_ZIP, extensionOutdated, useExtension } from "@/services/yt/extension";

type Browser = "chrome" | "edge" | "brave" | "other";

function detectBrowser(): Browser {
  const nav = navigator as Navigator & { brave?: unknown; userAgentData?: { brands?: { brand: string }[] } };
  if (nav.brave) return "brave";
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "edge";
  const brands = nav.userAgentData?.brands?.map((b) => b.brand).join(" ") ?? "";
  if (/Chrom/.test(brands) || (/Chrome\//.test(ua) && !/Firefox|FxiOS|OPR\//.test(ua))) return "chrome";
  return "other";
}

/** Download a file with progress (0..1) and save it. */
async function downloadWithProgress(url: string, name: string, onProgress: (p: number) => void) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(total ? got / total : 0.5);
  }
  const blob = new Blob(chunks as BlobPart[], { type: "application/zip" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  onProgress(1);
}

export function ExtensionCard() {
  const ext = useExtension();
  const { toast } = usePlayer();
  const [progress, setProgress] = useState<number | null>(null);
  const [guide, setGuide] = useState(!ext.connected);
  const browser = detectBrowser();
  const page = browser === "edge" ? "edge://extensions" : browser === "brave" ? "brave://extensions" : "chrome://extensions";
  const outdated = ext.connected && extensionOutdated(ext.version);

  const download = async () => {
    setProgress(0);
    try {
      await downloadWithProgress(EXTENSION_ZIP, `aurabeats-extension-${EXTENSION_VERSION}.zip`, setProgress);
      setGuide(true);
    } catch (e) {
      toast((e as Error)?.message || "Download failed", "error");
    } finally {
      setTimeout(() => setProgress(null), 1200);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(page);
      toast("Copied — paste it in the address bar", "success");
    } catch {
      toast(page, "info");
    }
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-3">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", ext.connected ? "bg-emerald-500/15 text-emerald-500" : "bg-accent/15 text-accent")}>
          {ext.connected ? <CheckCircle2 className="h-4 w-4" /> : <Puzzle className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold text-ink">{ext.connected ? "Extension connected ✓" : "AuraBeats extension"}</p>
          <p className="truncate text-[12px] text-ink3">
            {outdated ? `v${ext.version} · update to v${EXTENSION_VERSION}` : ext.connected ? `v${ext.version ?? EXTENSION_VERSION}` : "Chrome · Edge · Brave"}
          </p>
        </div>
        <Button variant={ext.connected && !outdated ? "outline" : "solid"} className="shrink-0 text-xs" disabled={progress !== null} onClick={() => void download()}>
          {outdated ? <RefreshCw className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
          {progress !== null ? `${Math.round(progress * 100)}%` : outdated ? "Update" : "Download"}
        </Button>
      </div>
      {progress !== null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
          <div className="h-full rounded-full bg-accent transition-all duration-200" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      <InstallGuide open={guide} onToggle={() => setGuide((g) => !g)} page={page} browser={browser} onCopy={() => void copy()} />
    </div>
  );
}

function InstallGuide({ open, onToggle, page, browser, onCopy }: { open: boolean; onToggle: () => void; page: string; browser: Browser; onCopy: () => void }) {
  const devMode = browser === "edge" ? "Developer mode (left side)" : "Developer mode (top right)";
  const steps = [
    <>Download the extension and unzip it (keep the folder; don't delete it later).</>,
    <>
      Open{" "}
      <button type="button" onClick={onCopy} className="inline-flex items-center gap-1 rounded-md bg-ink/[0.07] px-1.5 py-0.5 font-mono text-[11px] text-ink">
        {page} <Copy className="h-3 w-3" />
      </button>{" "}
      in a new tab (copy, then paste in the address bar).
    </>,
    <>Turn on {devMode}.</>,
    <>
      Click <b className="text-ink">Load unpacked</b> and pick the unzipped folder.
    </>,
    <>Sign in on youtube.com in this browser (if you aren't already).</>,
    <>
      Reload this page. You'll see <b className="text-ink">Extension connected ✓</b>, then tap <b className="text-ink">Connect YouTube</b>.
    </>,
  ];
  return (
    <div className="rounded-2xl border border-line">
      <button type="button" onClick={onToggle} className="focus-ring flex w-full items-center justify-between gap-2 rounded-2xl px-3.5 py-2.5 text-left text-[13px] font-semibold text-ink">
        How to install
        <ChevronDown className={cn("h-4 w-4 text-ink3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-2.5 px-3.5 pb-3.5">
          {browser === "other" && <p className="text-[12px] font-semibold text-amber-500">Works in Chrome, Edge and Brave on a computer.</p>}
          <ol className="space-y-2">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-[12px] leading-relaxed text-ink2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-bold text-accent">{i + 1}</span>
                <span className="min-w-0">{s}</span>
              </li>
            ))}
          </ol>
          <p className="text-[11px] leading-relaxed text-ink3">
            Update: download again, unzip over the same folder, then press the reload button on the extension in {page}.
          </p>
        </div>
      )}
    </div>
  );
}
