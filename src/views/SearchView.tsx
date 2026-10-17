import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  Music2, Mic2, Search as SearchIcon, X, History, ArrowUpLeft,
  Flame, Headphones, SlidersHorizontal, Piano, Dumbbell, Clapperboard,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { useDebouncedValue, useFeed } from "@/hooks/useFeed";
import { searchYTMusic, searchOtherSources, fetchSearchSuggestions } from "@/services/catalog";
import { TrackRow, TrackRowSkeleton } from "@/components/TrackList";
import { Chip, SectionHeader, Spinner } from "@/components/ui";
import { EmptyState, ErrorState } from "@/components/states";
import { storage } from "@/utils/storage";
import { usePlayer } from "@/hooks/usePlayer";
import type { Track } from "@/types";

const RECENT_KEY = "searchRecent";

const DISCOVER = [
  { label: "Trending Now", icon: Flame, query: "trending hits 2026", gradient: "from-orange-500/80 to-red-600/80" },
  { label: "Lofi Chill", icon: Headphones, query: "lofi chill beats", gradient: "from-indigo-500/80 to-violet-700/80" },
  { label: "Deep House", icon: SlidersHorizontal, query: "deep house music", gradient: "from-cyan-500/80 to-blue-700/80" },
  { label: "Piano Solo", icon: Piano, query: "piano solo instrumental", gradient: "from-slate-400/70 to-zinc-700/80" },
  { label: "Workout Mix", icon: Dumbbell, query: "workout motivation", gradient: "from-green-500/80 to-emerald-700/80" },
  { label: "Bollywood", icon: Clapperboard, query: "bollywood hits", gradient: "from-pink-500/80 to-rose-700/80" },
  { label: "Hip-Hop", icon: Mic2, query: "hip hop rap", gradient: "from-yellow-500/80 to-amber-700/80" },
  { label: "Classical", icon: Music2, query: "classical orchestra", gradient: "from-purple-500/80 to-fuchsia-700/80" },
  { label: "K-Pop", icon: Flame, query: "kpop hits 2026", gradient: "from-rose-400/80 to-pink-700/80" },
  { label: "Remix", icon: SlidersHorizontal, query: "remix 2026", gradient: "from-blue-400/80 to-indigo-700/80" },
  { label: "Slowed + Reverb", icon: Headphones, query: "slowed reverb songs", gradient: "from-teal-500/80 to-cyan-800/80" },
  { label: "Funk", icon: Music2, query: "funk music", gradient: "from-lime-500/80 to-green-800/80" },
];

export function SearchView() {
  const [query, setQuery] = useState("");
  const { settings } = usePlayer();
  const [view, setView] = useState<"ytmusic" | "sources">(
    () => (settings.rememberSearchTab ? storage.get("lastSearchTab", "ytmusic") : "ytmusic") as "ytmusic" | "sources"
  );
  const [recent, setRecent] = useState<string[]>(() => storage.get<string[]>(RECENT_KEY, []));
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  /** What the user actually typed. `query` (the input's text) changes while
   *  arrowing through suggestions; suggestions keep following `typed`. */
  const [typed, setTyped] = useState("");
  /** Keyboard-highlighted suggestion row (-1 = none, input shows `typed`). */
  const [active, setActive] = useState(-1);
  const [visibleCount, setVisibleCount] = useState(20);

  /** The term actually searched — only changes on Enter / picking a suggestion
   *  or chip, never while typing (YouTube-style). */
  const [submitted, setSubmitted] = useState("");

  const inputRef = useRef<HTMLInputElement | null>(null);
  const suggestRef = useRef<HTMLDivElement | null>(null);

  const typedTrimmed = typed.trim();
  const suggestDebounced = useDebouncedValue(typedTrimmed, 120);
  const enabled = submitted.length > 0;

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setVisibleCount(20); }, [submitted]);

  useEffect(() => {
    setActive(-1);
    if (!suggestDebounced || suggestDebounced === submitted) { setSuggestions([]); return; }
    // Keep the previous list on screen until the new one arrives (no flicker
    // while typing), but never show it for a different, empty result.
    let alive = true;
    fetchSearchSuggestions(suggestDebounced)
      .then((r) => { if (alive) setSuggestions(r); })
      .catch(() => { if (alive) setSuggestions([]); });
    return () => { alive = false; };
  }, [suggestDebounced, submitted]);

  /** Dropdown rows: matching recent searches first (YouTube shows your
   *  history on top), then live suggestions. */
  const rows = useMemo(() => {
    const t = typedTrimmed.toLowerCase();
    if (!t || typedTrimmed === submitted) return [] as { text: string; recent: boolean }[];
    const fromRecent = recent
      .filter((r) => r.toLowerCase().startsWith(t) && r.toLowerCase() !== t)
      .slice(0, 3);
    const seen = new Set(fromRecent.map((r) => r.toLowerCase()));
    const live = suggestions.filter((x) => !seen.has(x.toLowerCase()) && x.toLowerCase() !== t);
    return [
      ...fromRecent.map((text) => ({ text, recent: true })),
      ...live.map((text) => ({ text, recent: false })),
    ].slice(0, 10);
  }, [typedTrimmed, submitted, recent, suggestions]);

  const listOpen = showSuggestions && rows.length > 0;

  // Close the suggestion list on any outside tap / click (pointer events
  // cover touch as well as mouse).
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (!suggestRef.current?.contains(e.target as Node)) setShowSuggestions(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, []);

  // Mobile: closing the keyboard (e.g. Android back) keeps the input focused,
  // which used to leave the suggestion list hanging. Treat a keyboard that
  // slides away as leaving the field.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let last = vv.height;
    const onResize = () => {
      const grew = vv.height - last > 120;
      last = vv.height;
      if (grew && document.activeElement === inputRef.current) inputRef.current?.blur();
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  const ytFeed = useFeed<Track[]>(
    `search:yt:${submitted}`,
    () => searchYTMusic(submitted, 100),
    { enabled: enabled && view === "ytmusic", ttl: 10 * 60 * 1000 },
  );

  const otherFeed = useFeed<Track[]>(
    `search:other:${submitted}`,
    () => searchOtherSources(submitted, 80),
    { enabled: enabled && view === "sources", ttl: 10 * 60 * 1000 },
  );

  const activeFeed = view === "ytmusic" ? ytFeed : otherFeed;
  const allTracks = activeFeed.data ?? [];
  const displayed = allTracks.slice(0, visibleCount);

  const remember = (v: string) => {
    const next = [v.trim(), ...recent].filter((s, i, a) => s && a.indexOf(s) === i).slice(0, 10);
    setRecent(next);
    storage.set(RECENT_KEY, next);
  };

  /** Runs a search: closes suggestions and drops focus so the mobile keyboard hides. */
  const runSearch = (term: string) => {
    const t = term.trim();
    setShowSuggestions(false);
    setSuggestions([]);
    inputRef.current?.blur();
    setActive(-1);
    if (!t) return;
    setQuery(t);
    setTyped(t);
    setSubmitted(t);
    remember(t);
    document.getElementById("ab-scroll")?.scrollTo({ top: 0 });
  };

  /** ↑ / ↓ walk the list (the input previews the row, as on YouTube),
   *  Enter searches it, Esc goes back to what was typed. */
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (rows.length === 0) return;
      e.preventDefault(); // keep the caret where it is
      if (!showSuggestions) { setShowSuggestions(true); return; }
      const n = rows.length;
      // Cycle: -1 (typed text) → 0 … n-1 → back to -1
      const next = e.key === "ArrowDown"
        ? (active + 1 >= n ? -1 : active + 1)
        : (active - 1 < -1 ? n - 1 : active - 1);
      setActive(next);
      setQuery(next === -1 ? typed : rows[next].text);
      return;
    }
    if (e.key === "Escape") {
      if (listOpen) {
        e.preventDefault();
        if (active !== -1) setQuery(typed);
        setActive(-1);
        setShowSuggestions(false);
      } else {
        inputRef.current?.blur();
      }
    }
  };

  const removeRecent = (item: string) => {
    const next = recent.filter((r) => r !== item);
    setRecent(next);
    storage.set(RECENT_KEY, next);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    runSearch(query);
  };

  useEffect(() => {
    if (!activeFeed.data) return;
    const el = document.getElementById("ab-scroll");
    if (!el) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (scrollHeight - scrollTop - clientHeight < 400) {
        setVisibleCount((c) => Math.min(c + 20, activeFeed.data!.length));
      }
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [activeFeed.data]);

  return (
    <div className="space-y-6 pb-4">
      <section className="space-y-4">
        {/* Search bar */}
        <div className="sticky top-0 z-20 -mx-4 px-4 py-3 sm:-mx-8 sm:px-8">
          <div className="relative mx-auto max-w-2xl" ref={suggestRef}>
            <form role="search" onSubmit={onSubmit} className="blur-panel glass-inset flex items-center gap-2 rounded-full p-1 pl-4 focus-within:ring-2 focus-within:ring-accent/50">
              <SearchIcon className="h-5 w-5 shrink-0 text-ink3" />
              <input
                ref={inputRef}
                type="search"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={listOpen}
                aria-controls="search-suggestions"
                aria-activedescendant={listOpen && active >= 0 ? `search-sugg-${active}` : undefined}
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setTyped(e.target.value); setActive(-1); setShowSuggestions(true); }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => { setShowSuggestions(false); setActive(-1); }}
                onKeyDown={onKeyDown}
                placeholder="Search songs, artists, lyrics..."
                aria-label="Search"
                className="min-w-0 flex-1 bg-transparent py-3 text-[15px] font-semibold text-ink outline-none placeholder:text-ink3 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
              />
              {query && (
                <button type="button" aria-label="Clear" onMouseDown={(e) => e.preventDefault()} onClick={() => { setQuery(""); setTyped(""); setActive(-1); inputRef.current?.focus(); }} className="rounded-full p-2 text-ink3 hover:text-ink">
                  <X className="h-5 w-5" />
                </button>
              )}
              {enabled && activeFeed.loading ? (
                <Spinner className="mx-2.5 h-4 w-4" />
              ) : (
                <button type="submit" aria-label="Search" onMouseDown={(e) => e.preventDefault()} className="rounded-full p-2.5 text-ink2 transition hover:bg-ink/[0.07] hover:text-ink active:scale-95">
                  <SearchIcon className="h-5 w-5" />
                </button>
              )}
            </form>

            {listOpen && (
              <div
                id="search-suggestions"
                role="listbox"
                aria-label="Search suggestions"
                className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-2xl py-1.5 blur-panel surface-raised shadow-2xl animate-fade-in"
              >
                {rows.map((row, i) => (
                  <div
                    key={`${row.recent ? "r" : "s"}:${row.text}`}
                    id={`search-sugg-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => runSearch(row.text)}
                    className={cn(
                      "group flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-[15px] text-ink transition-colors",
                      i === active ? "bg-ink/[0.12]" : "hover:bg-ink/[0.06]",
                    )}
                  >
                    {row.recent
                      ? <History className="h-4 w-4 shrink-0 text-ink3" />
                      : <SearchIcon className="h-4 w-4 shrink-0 text-ink3" />}
                    <span className={cn("min-w-0 flex-1 truncate", row.recent && "text-accent")}>
                      <Highlight text={row.text} typed={typedTrimmed} />
                    </span>
                    {row.recent ? (
                      <button
                        type="button"
                        aria-label={`Remove ${row.text} from recent searches`}
                        onClick={(e) => { e.stopPropagation(); removeRecent(row.text); }}
                        className="shrink-0 rounded-full p-1 text-ink3 opacity-70 transition hover:bg-ink/[0.08] hover:text-ink hover:opacity-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Fill in "${row.text}"`}
                        title="Fill in"
                        onClick={(e) => {
                          e.stopPropagation();
                          setQuery(row.text + " ");
                          setTyped(row.text + " ");
                          setActive(-1);
                          inputRef.current?.focus();
                        }}
                        className="shrink-0 rounded-full p-1 text-ink3 opacity-60 transition hover:bg-ink/[0.08] hover:text-ink hover:opacity-100"
                      >
                        <ArrowUpLeft className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 pt-1">
          {([
            { key: "ytmusic" as const, label: "YT Music", icon: Music2 },
            { key: "sources" as const, label: "Other Sources", icon: Mic2 },
          ]).map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" onClick={() => {
              setView(key);
              if (settings.rememberSearchTab) storage.set("lastSearchTab", key);
            }}
              className={cn(
                "focus-ring inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition active:scale-95",
                view === key
                  ? "bg-accent text-white shadow-[0_8px_24px_-14px_var(--glow)]"
                  : "border border-line bg-ink/[0.03] text-ink3 hover:text-ink",
              )}>
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </div>
      </section>

      {/* Empty state */}
      {!enabled && (
        <div className="space-y-8 animate-fade-in pt-2">
          {recent.length > 0 && (
            <section>
              <SectionHeader title="Recent searches" icon={<History className="h-5 w-5 text-accent" />} />
              <div className="flex flex-wrap gap-2">
                {recent.map((item) => <Chip key={item} onClick={() => runSearch(item)}>{item}</Chip>)}
              </div>
            </section>
          )}
          <section>
            <SectionHeader title="Browse" />
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
              {DISCOVER.map(({ label, icon: Icon, query: q, gradient }) => (
                <button key={label} onClick={() => runSearch(q)}
                  className={cn("group relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br h-20 sm:h-24 text-left shadow-lg transition-all hover:brightness-110 hover:scale-[1.02] active:scale-[0.97]", gradient)}>
                  <div className="absolute inset-0 bg-black/20 transition group-hover:bg-black/10 rounded-xl" />
                  <div className="relative z-10 flex h-full flex-col justify-end gap-1.5 p-3">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/20 ring-1 ring-white/25">
                      <Icon className="h-3.5 w-3.5 text-white" strokeWidth={2.25} />
                    </span>
                    <span className="text-xs font-bold tracking-tight text-white drop-shadow">{label}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Results */}
      {enabled && (
        <section className="space-y-4 animate-fade-in">
          <div className="flex items-end justify-between">
            <h2 className="text-xl font-black tracking-tight text-ink sm:text-2xl">
              {view === "ytmusic" ? "YouTube Music" : "Other Sources"}
            </h2>
            {allTracks.length > 0 && (
              <span className="rounded-full border border-line bg-ink/[0.05] px-3 py-1 text-xs font-bold text-ink3">
                {allTracks.length} found
              </span>
            )}
          </div>

          {activeFeed.error && !activeFeed.data ? (
            <ErrorState message={activeFeed.error} onRetry={activeFeed.refresh} />
          ) : activeFeed.loading && !activeFeed.data ? (
            <TrackRowSkeleton rows={8} />
          ) : allTracks.length === 0 ? (
            <EmptyState title={`No results for "${submitted}"`} hint="Try another keyword or switch tabs." />
          ) : (
            <div className="blur-panel glass-inset overflow-hidden rounded-2xl p-1.5 sm:p-2">
              {displayed.map((track, i) => (
                <TrackRow key={track.id} track={track} context={allTracks} index={i} />
              ))}
              {activeFeed.loading && <div className="flex justify-center p-6"><Spinner /></div>}
              {!activeFeed.loading && allTracks.length > 0 && visibleCount >= allTracks.length && (
                <p className="py-4 text-center text-xs text-ink3">
                  {allTracks.length} tracks loaded
                </p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** YouTube style: the part you typed stays regular, the completion is bold. */
function Highlight({ text, typed }: { text: string; typed: string }) {
  const t = typed.toLowerCase();
  if (t && text.toLowerCase().startsWith(t)) {
    return (
      <>
        <span className="font-normal">{text.slice(0, typed.length)}</span>
        <span className="font-bold">{text.slice(typed.length)}</span>
      </>
    );
  }
  return <span className="font-semibold">{text}</span>;
}
