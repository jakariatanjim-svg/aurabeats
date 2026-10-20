/**
 * YouTube-style search in the top bar, for Music and Video.
 *
 *  - PC (website, desktop layout): a search field in the bar; focusing it
 *    opens a dropdown right under it — the page stays as it is.
 *  - Phone screens and the Android app: a search icon; tapping it turns the
 *    screen into the search page (back arrow + field, keyboard up). Android
 *    Back closes it.
 *
 * The panel: your search history straight down (clock, remove ✕), then
 * "Trending searches". While typing: matching history + live suggestions
 * (↑/↓ + Enter). Nothing searches until Enter / a pick.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowUpLeft, History, Search, TrendingUp, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { useDebouncedValue } from "@/hooks/useFeed";
import { fetchSearchSuggestions } from "@/services/catalog";
import { cachedTrendingSearches, trendingSearches } from "@/services/trendingSearches";
import { searchHistory, useSearchHistory, type SearchMode } from "@/utils/searchHistory";
import { goPath, goSearch, useUrlQuery } from "@/utils/searchNav";
import type { RouteKey } from "@/routes";
import { isNative } from "@/services/video/net";

const PC_QUERY = "(min-width: 768px)";
/** PC = the website in the desktop layout (sidebar). The app always uses the phone search. */
export function usePcSearch(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(PC_QUERY);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => !isNative && window.matchMedia(PC_QUERY).matches,
    () => false,
  );
}

type Row = { kind: "history" | "suggest" | "trend"; text: string };

const videoIdIn = (s: string) => s.trim().match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/live\/|\/embed\/)([\w-]{11})/)?.[1] ?? null;

export function TopSearch({
  mode,
  route,
  onNavigate,
  className,
}: {
  mode: SearchMode;
  route: RouteKey;
  onNavigate: (r: RouteKey) => void;
  className?: string;
}) {
  const pc = usePcSearch();
  const onResults = route === (mode === "video" ? "video-search" : "search");
  const urlQ = useUrlQuery();
  const shownQ = onResults ? urlQ : "";

  const [text, setText] = useState(shownQ);
  const [typed, setTyped] = useState(shownQ);
  const [active, setActive] = useState(-1);
  const [panel, setPanel] = useState(false); // desktop dropdown
  const [sheet, setSheet] = useState(false); // phone full-screen search
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [trending, setTrending] = useState<string[]>(() => cachedTrendingSearches(mode));
  const deskInput = useRef<HTMLInputElement>(null);
  const sheetInput = useRef<HTMLInputElement>(null);
  const deskBox = useRef<HTMLDivElement>(null);
  const sheetPushed = useRef(false);

  const all = useSearchHistory();
  const history = useMemo(() => all.filter((e) => e.mode === mode).map((e) => e.q), [all, mode]);

  // The field shows the current results' term, and empties elsewhere.
  useEffect(() => {
    setText(shownQ);
    setTyped(shownQ);
    setActive(-1);
  }, [shownQ, mode]);

  const open = panel || sheet;
  const typedT = typed.trim();
  const debounced = useDebouncedValue(typedT, 120);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    trendingSearches(mode).then((t) => alive && setTrending(t));
    return () => {
      alive = false;
    };
  }, [open, mode]);

  useEffect(() => {
    setActive(-1);
    if (!open || !debounced || videoIdIn(debounced)) {
      setSuggestions([]);
      return;
    }
    let alive = true;
    fetchSearchSuggestions(debounced)
      .then((r) => alive && setSuggestions(r))
      .catch(() => alive && setSuggestions([]));
    return () => {
      alive = false;
    };
  }, [debounced, open]);

  const rows = useMemo<Row[]>(() => {
    const t = typedT.toLowerCase();
    if (!t) {
      return [
        ...history.slice(0, 12).map((text) => ({ kind: "history" as const, text })),
        ...trending
          .filter((x) => !history.slice(0, 12).some((h) => h.toLowerCase() === x.toLowerCase()))
          .slice(0, 8)
          .map((text) => ({ kind: "trend" as const, text })),
      ];
    }
    const fromHistory = history.filter((h) => h.toLowerCase().startsWith(t) && h.toLowerCase() !== t).slice(0, 3);
    const seen = new Set(fromHistory.map((h) => h.toLowerCase()));
    return [
      ...fromHistory.map((text) => ({ kind: "history" as const, text })),
      ...suggestions
        .filter((s) => !seen.has(s.toLowerCase()) && s.toLowerCase() !== t)
        .map((text) => ({ kind: "suggest" as const, text })),
    ].slice(0, 12);
  }, [typedT, history, trending, suggestions]);

  // Desktop: close on any outside tap.
  useEffect(() => {
    if (!panel) return;
    const onDown = (e: PointerEvent) => {
      if (!deskBox.current?.contains(e.target as Node)) setPanel(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [panel]);

  // "Find channels" etc. elsewhere in the app open this search.
  useEffect(() => {
    const onOpen = () => {
      if (window.matchMedia(PC_QUERY).matches && !isNative) deskInput.current?.focus();
      else setSheet(true);
    };
    window.addEventListener("ab:open-search", onOpen);
    return () => window.removeEventListener("ab:open-search", onOpen);
  }, []);

  // Phone sheet: one history entry so Android back closes it.
  useEffect(() => {
    if (!sheet) return;
    window.history.pushState({ abSearch: 1 }, "", window.location.href);
    sheetPushed.current = true;
    const onPop = () => {
      sheetPushed.current = false;
      setSheet(false);
    };
    window.addEventListener("popstate", onPop);
    const t = window.setTimeout(() => sheetInput.current?.focus(), 30);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.clearTimeout(t);
    };
  }, [sheet]);

  const closeSheet = () => {
    if (sheetPushed.current) window.history.back();
    else setSheet(false);
  };

  const reset = () => {
    setText(shownQ);
    setTyped(shownQ);
    setActive(-1);
  };

  const run = (term: string) => {
    const t = term.trim();
    setActive(-1);
    setPanel(false);
    deskInput.current?.blur();
    sheetInput.current?.blur();
    if (!t) return;
    // From the phone sheet, the results reuse the sheet's history entry so a
    // single Back returns to where you searched from.
    const replace = sheet && sheetPushed.current;
    sheetPushed.current = false;
    setSheet(false);
    const vid = mode === "video" ? videoIdIn(t) : null;
    if (vid) {
      if (replace) goPath(`/watch/${vid}`, true);
      else onNavigate(`watch:${vid}`);
      return;
    }
    setText(t);
    setTyped(t);
    goSearch(mode, t, { replace });
  };

  const fill = (t: string) => {
    setText(t + " ");
    setTyped(t + " ");
    setActive(-1);
    (sheet ? sheetInput : deskInput).current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      run(text);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!rows.length) return;
      e.preventDefault();
      if (!open) setPanel(true);
      const n = rows.length;
      const next = e.key === "ArrowDown" ? (active + 1 >= n ? -1 : active + 1) : active - 1 < -1 ? n - 1 : active - 1;
      setActive(next);
      setText(next === -1 ? typed : rows[next].text);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (sheet) closeSheet();
      else {
        setPanel(false);
        reset();
        deskInput.current?.blur();
      }
    }
  };

  const placeholder = mode === "video" ? "Search YouTube or paste a link" : "Search songs, artists, albums";

  const field = (ref: React.RefObject<HTMLInputElement | null>, big?: boolean) => (
    <input
      ref={ref}
      type="search"
      role="combobox"
      aria-expanded={open && rows.length > 0}
      aria-autocomplete="list"
      enterKeyHint="search"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      value={text}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        setTyped(e.target.value);
        setActive(-1);
        if (!sheet) setPanel(true);
      }}
      onFocus={() => !sheet && setPanel(true)}
      onKeyDown={onKeyDown}
      className={cn(
        "min-w-0 flex-1 bg-transparent font-medium text-ink outline-none placeholder:text-ink3 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden",
        big ? "py-2.5 text-[16px]" : "py-2 text-[14px]",
      )}
    />
  );

  const clearBtn = (ref: React.RefObject<HTMLInputElement | null>) =>
    text ? (
      <button
        type="button"
        aria-label="Clear"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setText("");
          setTyped("");
          setActive(-1);
          ref.current?.focus();
        }}
        className="shrink-0 rounded-full p-1.5 text-ink3 hover:bg-ink/[0.07] hover:text-ink"
      >
        <X className="h-4 w-4" />
      </button>
    ) : null;

  const list = (
    <SearchRows
      rows={rows}
      active={active}
      typed={typedT}
      onPick={run}
      onFill={fill}
      onRemove={(t) => searchHistory.remove(t, mode)}
    />
  );

  return (
    <>
      {/* PC: field in the bar, dropdown under it */}
      {pc && (
        <>
      <div ref={deskBox} className={cn("relative w-full max-w-[36rem]", className)}>
        <div
          className={cn(
            "glass-inset flex items-center gap-2 rounded-full border border-line/80 bg-ink/[0.03] pr-1.5 pl-4 transition",
            panel && "border-accent/60 ring-2 ring-accent/25",
          )}
        >
          <Search className="h-4 w-4 shrink-0 text-ink3" />
          {field(deskInput)}
          {clearBtn(deskInput)}
          <button
            type="button"
            aria-label="Search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(text)}
            className="shrink-0 rounded-full p-1.5 text-ink2 hover:bg-ink/[0.07] hover:text-ink"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
        {panel && rows.length > 0 && (
          <div className="blur-panel surface-raised absolute top-full right-0 left-0 z-[70] mt-2 max-h-[min(70vh,34rem)] animate-fade-in overflow-y-auto rounded-2xl py-2 shadow-2xl">
            {list}
          </div>
        )}
      </div>

        </>
      )}

      {/* Phone / tablet */}
      {pc ? null : onResults && shownQ ? (
        <button
          type="button"
          onClick={() => setSheet(true)}
          className="focus-ring glass-inset flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line/80 bg-ink/[0.03] px-3.5 py-2 text-left text-[14px] font-medium text-ink"
        >
          <Search className="h-4 w-4 shrink-0 text-ink3" />
          <span className="truncate">{shownQ}</span>
        </button>
      ) : (
        <button
          type="button"
          aria-label="Search"
          onClick={() => setSheet(true)}
          className="focus-ring ml-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-ink2 transition hover:text-ink"
        >
          <Search className="h-[18px] w-[18px]" />
        </button>
      )}

      {sheet && !pc &&
        createPortal(
          <div
            role="dialog"
            aria-label="Search"
            className="bg-base fixed inset-0 z-[90] flex animate-fade-in flex-col pt-[calc(var(--sa-top)+0.5rem)] pr-[var(--sa-right)] pb-[var(--sa-bottom)] pl-[var(--sa-left)]"
          >
            <div className="flex items-center gap-1.5 px-2 pb-2">
              <button
                type="button"
                aria-label="Back"
                onClick={closeSheet}
                className="shrink-0 rounded-full p-2.5 text-ink hover:bg-ink/[0.07]"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="flex min-w-0 flex-1 items-center gap-1 rounded-full bg-ink/[0.07] pr-1 pl-4">
                {field(sheetInput, true)}
                {clearBtn(sheetInput)}
              </div>
              <button
                type="button"
                aria-label="Search"
                onClick={() => run(text)}
                className="shrink-0 rounded-full p-2.5 text-ink2 hover:bg-ink/[0.07] hover:text-ink"
              >
                <Search className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6">{list}</div>
          </div>,
          document.body,
        )}
    </>
  );
}

function SearchRows({
  rows,
  active,
  typed,
  onPick,
  onFill,
  onRemove,
}: {
  rows: Row[];
  active: number;
  typed: string;
  onPick: (t: string) => void;
  onFill: (t: string) => void;
  onRemove: (t: string) => void;
}) {
  const out: ReactNode[] = [];
  rows.forEach((row, i) => {
    if (row.kind === "trend" && (i === 0 || rows[i - 1].kind !== "trend")) {
      out.push(
        <p key="trend-h" className={cn("px-4 pb-1 text-[11px] font-bold tracking-[0.14em] text-ink3 uppercase", i > 0 ? "mt-3 border-t border-line pt-3" : "pt-1")}>
          Trending searches
        </p>,
      );
    }
    const Icon = row.kind === "history" ? History : row.kind === "trend" ? TrendingUp : Search;
    out.push(
      <div
        key={`${row.kind}:${row.text}`}
        role="option"
        aria-selected={i === active}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onPick(row.text)}
        className={cn(
          "group flex cursor-pointer items-center gap-3.5 px-4 py-2.5 text-[15px] text-ink transition-colors",
          i === active ? "bg-ink/[0.10]" : "hover:bg-ink/[0.06] active:bg-ink/[0.08]",
        )}
      >
        <Icon className={cn("h-[18px] w-[18px] shrink-0", row.kind === "trend" ? "text-accent" : "text-ink3")} />
        <span className="min-w-0 flex-1 truncate">
          <Highlight text={row.text} typed={typed} />
        </span>
        {row.kind === "history" ? (
          <button
            type="button"
            aria-label={`Remove “${row.text}” from search history`}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(row.text);
            }}
            className="shrink-0 rounded-full p-1.5 text-ink3 transition hover:bg-ink/[0.08] hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            aria-label={`Fill in “${row.text}”`}
            onClick={(e) => {
              e.stopPropagation();
              onFill(row.text);
            }}
            className="shrink-0 rounded-full p-1.5 text-ink3 opacity-70 transition hover:bg-ink/[0.08] hover:text-ink hover:opacity-100"
          >
            <ArrowUpLeft className="h-4 w-4" />
          </button>
        )}
      </div>,
    );
  });
  return <div role="listbox">{out}</div>;
}

/** YouTube style: the part you typed stays regular, the completion is bold. */
function Highlight({ text, typed }: { text: string; typed: string }) {
  const t = typed.toLowerCase();
  if (t && text.toLowerCase().startsWith(t)) {
    return (
      <>
        <span>{text.slice(0, typed.length)}</span>
        <span className="font-bold">{text.slice(typed.length)}</span>
      </>
    );
  }
  return <span>{text}</span>;
}
