/**
 * Settings → History: everything you searched, watched and listened to.
 * All of it lives only on this device; remove single items or clear a list.
 */
import { useState } from "react";
import { Headphones, History, Music2, Search, Trash2, Tv, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { relativeTime } from "@/utils/format";
import { usePlayer } from "@/hooks/usePlayer";
import { useVideoLibrary, videoLibrary } from "@/hooks/useVideoLibrary";
import { searchHistory, useSearchHistory } from "@/utils/searchHistory";
import { goSearch } from "@/utils/searchNav";
import { routeToPath } from "@/routes";
import { Artwork, Button, SectionHeader } from "@/components/ui";
import { confirmAction } from "@/components/Confirm";

type Tab = "search" | "watch" | "listen";
const PAGE = 15;

export function HistorySection() {
  const [tab, setTab] = useState<Tab>("search");
  const [all, setAll] = useState(false);
  const searches = useSearchHistory();
  const { history: watched } = useVideoLibrary();
  const { history: listened, removeHistory, clearHistory, playNow } = usePlayer();

  const tabs: { key: Tab; label: string; icon: typeof Search; count: number }[] = [
    { key: "search", label: "Searches", icon: Search, count: searches.length },
    { key: "watch", label: "Watched", icon: Tv, count: watched.length },
    { key: "listen", label: "Listened", icon: Headphones, count: listened.length },
  ];
  const count = tabs.find((t) => t.key === tab)!.count;

  const clear = async () => {
    const what = tab === "search" ? "search history" : tab === "watch" ? "watch history" : "listening history";
    if (!(await confirmAction({ title: `Clear your ${what}?`, confirmLabel: "Clear" }))) return;
    if (tab === "search") searchHistory.clear();
    else if (tab === "watch") videoLibrary.clearHistory();
    else clearHistory();
  };

  const removeBtn = (label: string, onClick: () => void) => (
    <button
      type="button"
      aria-label={`Remove ${label}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className="shrink-0 rounded-full p-2 text-ink3 transition hover:bg-ink/[0.08] hover:text-ink"
    >
      <X className="h-4 w-4" />
    </button>
  );

  const rowCls = "flex min-w-0 items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-ink/[0.05]";

  return (
    <section>
      <SectionHeader title="History" subtitle="Stored only on this device" icon={<History className="h-4 w-4 text-accent" />} />
      <div className="blur-panel space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map(({ key, label, icon: Icon, count: n }) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setTab(key);
                setAll(false);
              }}
              className={cn(
                "focus-ring inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold transition active:scale-95",
                tab === key ? "bg-accent text-white" : "border border-line bg-ink/[0.03] text-ink3 hover:text-ink",
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
              <span className={cn("tabular-nums", tab === key ? "text-white/80" : "text-ink3")}>{n}</span>
            </button>
          ))}
          {count > 0 && (
            <Button variant="outline" onClick={clear} className="ml-auto border-rose-500/30 px-3 text-xs text-rose-400">
              <Trash2 className="h-3.5 w-3.5" /> Clear all
            </Button>
          )}
        </div>

        {count === 0 ? (
          <p className="py-6 text-center text-xs text-ink3">
            {tab === "search" ? "No searches yet." : tab === "watch" ? "No watched videos yet." : "No songs played yet."}
          </p>
        ) : (
          <div className="-mx-2">
            {tab === "search" &&
              searches.slice(0, all ? undefined : PAGE).map((e) => (
                <div
                  key={`${e.mode}:${e.q}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => goSearch(e.mode, e.q)}
                  onKeyDown={(k) => k.key === "Enter" && goSearch(e.mode, e.q)}
                  className={cn(rowCls, "cursor-pointer")}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-ink3">
                    {e.mode === "video" ? <Tv className="h-4 w-4" /> : <Music2 className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{e.q}</span>
                    <span className="block truncate text-[11px] text-ink3">
                      {e.mode === "video" ? "Video" : "Music"} · {relativeTime(e.at)}
                    </span>
                  </span>
                  {removeBtn(e.q, () => searchHistory.remove(e.q, e.mode))}
                </div>
              ))}

            {tab === "watch" &&
              watched.slice(0, all ? undefined : PAGE).map((v) => (
                <a key={v.id} href={routeToPath(`watch:${v.id}`)} data-nav="true" className={rowCls}>
                  <img
                    src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`}
                    alt=""
                    loading="lazy"
                    className="h-10 w-[4.5rem] shrink-0 rounded-lg bg-ink/10 object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{v.title}</span>
                    <span className="block truncate text-[11px] text-ink3">
                      {v.author} · {relativeTime(v.watchedAt)}
                    </span>
                  </span>
                  {removeBtn(v.title, () => videoLibrary.removeHistory(v.id))}
                </a>
              ))}

            {tab === "listen" &&
              listened.slice(0, all ? undefined : PAGE).map((t) => (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => playNow(t, listened)}
                  onKeyDown={(k) => k.key === "Enter" && playNow(t, listened)}
                  className={cn(rowCls, "cursor-pointer")}
                >
                  <Artwork src={t.artwork} fallbackSrc={t.artworkFallback} alt="" className="h-10 w-10 shrink-0" rounded="rounded-lg" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{t.title}</span>
                    <span className="block truncate text-[11px] text-ink3">{t.artist}</span>
                  </span>
                  {removeBtn(t.title, () => removeHistory(t.id))}
                </div>
              ))}

            {count > PAGE && (
              <button
                type="button"
                onClick={() => setAll((a) => !a)}
                className="mt-1 w-full rounded-xl py-2 text-xs font-bold text-accent hover:bg-ink/[0.04]"
              >
                {all ? "Show less" : `Show all ${count}`}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
