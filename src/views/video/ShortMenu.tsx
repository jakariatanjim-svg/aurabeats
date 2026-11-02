/**
 * The ⋮ menu of a Short: quality, captions and playback speed, like YouTube's.
 * Rendered on <body> (the page has transforms) — a bottom sheet on phones,
 * a small pop-up next to the button on computers.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Gauge, Settings2, Subtitles } from "lucide-react";
import { cn } from "@/utils/cn";
import { useBackHandler, useEscape } from "@/utils/backStack";
import type { ShortHandle, ShortOptions } from "@/components/video/ShortPlayers";

type Page = "main" | "quality" | "captions" | "speed";

export function ShortMenu({ handle, anchor, sheet, onClose }: { handle: ShortHandle | null; anchor: DOMRect; sheet: boolean; onClose: () => void }) {
  const [page, setPage] = useState<Page>("main");
  const [o, setO] = useState<ShortOptions | null>(() => handle?.options() ?? null);
  useBackHandler(true, onClose);
  useEscape(true, onClose);
  const refresh = () => setO(handle?.options() ?? null);

  const rateLabel = (r: number) => (r === 1 ? "Normal" : `${r}x`);
  const qLabel = o ? (o.qualities.find((q) => q.id === o.quality)?.label ?? "Auto") : "Auto";
  const ccLabel = o?.caption ? (o.captions.find((c) => c.id === o.caption)?.label ?? o.caption) : "Off";

  const Row = ({ icon, label, value, onClick }: { icon: React.ReactNode; label: string; value: string; onClick: () => void }) => (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-ink/[0.06]">
      {icon}
      <span className="flex-1 font-semibold">{label}</span>
      <span className="text-ink3">{value}</span>
      <ChevronRight className="h-4 w-4 text-ink3" />
    </button>
  );
  const Pick = ({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) => (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-ink/[0.06]">
      <Check className={cn("h-4 w-4", !on && "invisible")} />
      <span className={cn(on && "font-bold")}>{label}</span>
    </button>
  );
  const Head = ({ title }: { title: string }) => (
    <button type="button" onClick={() => setPage("main")} className="flex w-full items-center gap-2 border-b border-line px-3 py-2.5 text-sm font-bold">
      <ChevronLeft className="h-5 w-5" /> {title}
    </button>
  );
  const done = () => {
    refresh();
    setPage("main");
    onClose();
  };

  const body = !o ? (
    <p className="px-4 py-4 text-sm text-ink3">Loading…</p>
  ) : page === "main" ? (
    <div className="py-1">
      {o.qualities.length > 1 && <Row icon={<Settings2 className="h-5 w-5" />} label="Quality" value={qLabel} onClick={() => setPage("quality")} />}
      {o.captions.length > 0 && <Row icon={<Subtitles className="h-5 w-5" />} label="Captions" value={ccLabel} onClick={() => setPage("captions")} />}
      <Row icon={<Gauge className="h-5 w-5" />} label="Playback speed" value={rateLabel(o.rate)} onClick={() => setPage("speed")} />
    </div>
  ) : page === "quality" ? (
    <div className="max-h-[50vh] overflow-y-auto pb-1">
      <Head title="Quality" />
      {o.qualities.map((q) => (
        <Pick key={q.id} on={q.id === o.quality} label={q.label} onClick={() => (handle?.setQuality(q.id), done())} />
      ))}
    </div>
  ) : page === "captions" ? (
    <div className="max-h-[50vh] overflow-y-auto pb-1">
      <Head title="Captions" />
      <Pick on={!o.caption} label="Off" onClick={() => (handle?.setCaption(null), done())} />
      {o.captions.map((c) => (
        <Pick key={c.id} on={c.id === o.caption} label={c.label} onClick={() => (handle?.setCaption(c.id), done())} />
      ))}
    </div>
  ) : (
    <div className="max-h-[50vh] overflow-y-auto pb-1">
      <Head title="Playback speed" />
      {o.rates.map((r) => (
        <Pick key={r} on={r === o.rate} label={rateLabel(r)} onClick={() => (handle?.setRate(r), done())} />
      ))}
    </div>
  );

  // computers: open to the left of the button, its bottom lined up with it
  const popStyle: React.CSSProperties = {
    right: Math.max(8, window.innerWidth - anchor.left + 8),
    bottom: Math.max(8, window.innerHeight - anchor.bottom),
  };

  return createPortal(
    <>
      <div className={cn("fixed inset-0 z-[79]", sheet ? "bg-black/40" : "bg-transparent")} onClick={onClose} />
      <div
        role="menu"
        className={cn(
          "blur-panel surface-raised fixed z-[80] overflow-hidden text-ink shadow-2xl",
          sheet ? "inset-x-0 bottom-0 rounded-t-2xl rounded-b-none pb-[calc(var(--sa-bottom)+0.5rem)]" : "w-64 rounded-xl border border-line",
        )}
        style={sheet ? undefined : popStyle}
      >
        {sheet && <div className="mx-auto mt-2 mb-1 h-1 w-9 rounded-full bg-ink/20" />}
        {body}
      </div>
    </>,
    document.body,
  );
}
