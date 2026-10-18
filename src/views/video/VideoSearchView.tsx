import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { History, Search as SearchIcon, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { useDebouncedValue } from "@/hooks/useFeed";
import { fetchSearchSuggestions } from "@/services/catalog";
import { parseVideoId, searchVideos } from "@/services/video/api";
import type { SearchItem } from "@/services/video/types";
import { ChannelRow, VideoCard, VideoGrid, VideoGridSkeleton } from "@/components/video/VideoCards";
import { Button, Spinner } from "@/components/ui";
import { EmptyState, ErrorState } from "@/components/states";
import { session, storage } from "@/utils/storage";
import type { RouteKey } from "@/routes";

const RECENT_KEY = "videoSearchRecent";

/** Results survive opening a video and coming back. */
interface Saved {
  q: string;
  items: SearchItem[];
  next?: string;
  source: string;
}
let memo: Saved | null = null;

export function VideoSearchView({ onNavigate }: { onNavigate: (r: RouteKey) => void }) {
  const restored = memo ?? session.get<Saved | null>("videoSearch", null);
  const [query, setQuery] = useState(restored?.q ?? "");
  const [typed, setTyped] = useState(restored?.q ?? "");
  const [submitted, setSubmitted] = useState(restored?.q ?? "");
  const [results, setResults] = useState<Saved | null>(restored);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>(() => storage.get<string[]>(RECENT_KEY, []));
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const typedTrim = typed.trim();
  const debounced = useDebouncedValue(typedTrim, 120);

  useEffect(() => {
    if (!restored) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setActive(-1);
    if (!debounced || debounced === submitted) {
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
  }, [debounced, submitted]);

  const rows = useMemo(() => {
    const t = typedTrim.toLowerCase();
    if (!t || typedTrim === submitted) {
      // empty box: show recent searches
      return t ? [] : recent.slice(0, 8).map((text) => ({ text, recent: true }));
    }
    const fromRecent = recent.filter((r) => r.toLowerCase().startsWith(t) && r.toLowerCase() !== t).slice(0, 3);
    const seen = new Set(fromRecent.map((r) => r.toLowerCase()));
    return [
      ...fromRecent.map((text) => ({ text, recent: true })),
      ...suggestions.filter((x) => !seen.has(x.toLowerCase()) && x.toLowerCase() !== t).map((text) => ({ text, recent: false })),
    ].slice(0, 10);
  }, [typedTrim, submitted, recent, suggestions]);
  const listOpen = open && rows.length > 0;

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, []);

  const save = (s: Saved) => {
    memo = s;
    session.set("videoSearch", { ...s, items: s.items.slice(0, 60) });
    setResults(s);
  };

  const run = useCallback(
    (term: string) => {
      const t = term.trim();
      setOpen(false);
      setActive(-1);
      inputRef.current?.blur();
      if (!t) return;
      const vid = parseVideoId(t);
      if (vid) {
        onNavigate(`watch:${vid}`);
        return;
      }
      setQuery(t);
      setTyped(t);
      setSubmitted(t);
      const nextRecent = [t, ...recent.filter((r) => r !== t)].slice(0, 12);
      setRecent(nextRecent);
      storage.set(RECENT_KEY, nextRecent);
      setLoading(true);
      setError(null);
      setResults(null);
      document.getElementById("ab-scroll")?.scrollTo({ top: 0 });
      searchVideos(t)
        .then((r) => save({ q: t, items: r.items, next: r.next, source: r.source }))
        .catch((e: unknown) => setError(e instanceof Error ? e.message : "Search failed"))
        .finally(() => setLoading(false));
    },
    [recent, onNavigate],
  );

  const loadMore = useCallback(() => {
    if (!results?.next || more) return;
    setMore(true);
    searchVideos(results.q, results.next, results.source)
      .then((r) => {
        const seen = new Set(results.items.map((i) => `${i.kind}:${i.id}`));
        save({
          ...results,
          items: [...results.items, ...r.items.filter((i) => !seen.has(`${i.kind}:${i.id}`))],
          next: r.next,
        });
      })
      .catch(() => save({ ...results, next: undefined }))
      .finally(() => setMore(false));
  }, [results, more]);

  // infinite scroll
  useEffect(() => {
    const el = document.getElementById("ab-scroll");
    if (!el || !results?.next) return;
    const onScroll = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) loadMore();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [results, loadMore]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!rows.length) return;
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const n = rows.length;
      const next = e.key === "ArrowDown" ? (active + 1 >= n ? -1 : active + 1) : active - 1 < -1 ? n - 1 : active - 1;
      setActive(next);
      setQuery(next === -1 ? typed : rows[next].text);
    } else if (e.key === "Escape") {
      if (listOpen) {
        e.preventDefault();
        if (active !== -1) setQuery(typed);
        setActive(-1);
        setOpen(false);
      } else inputRef.current?.blur();
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    run(query);
  };

  const removeRecent = (item: string) => {
    const next = recent.filter((r) => r !== item);
    setRecent(next);
    storage.set(RECENT_KEY, next);
  };

  const channels = results?.items.filter((i) => i.kind === "channel") ?? [];
  const videos = results?.items.filter((i) => i.kind === "video") ?? [];

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-20 -mx-4 px-4 py-3 sm:-mx-8 sm:px-8">
        <div ref={boxRef} className="relative mx-auto max-w-2xl">
          <form
            role="search"
            onSubmit={onSubmit}
            className="blur-panel glass-inset flex items-center gap-2 rounded-full p-1 pl-4 focus-within:ring-2 focus-within:ring-accent/50"
          >
            <SearchIcon className="h-5 w-5 shrink-0 text-ink3" />
            <input
              ref={inputRef}
              type="search"
              role="combobox"
              aria-expanded={listOpen}
              aria-controls="video-suggestions"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setTyped(e.target.value);
                setActive(-1);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => {
                setOpen(false);
                setActive(-1);
              }}
              onKeyDown={onKeyDown}
              placeholder="Search YouTube or paste a link"
              aria-label="Search videos"
              className="min-w-0 flex-1 bg-transparent py-3 text-[15px] font-semibold text-ink outline-none placeholder:text-ink3 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setQuery("");
                  setTyped("");
                  inputRef.current?.focus();
                }}
                className="rounded-full p-2 text-ink3 hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            )}
            {loading ? (
              <Spinner className="mx-2.5 h-4 w-4" />
            ) : (
              <button
                type="submit"
                aria-label="Search"
                onMouseDown={(e) => e.preventDefault()}
                className="rounded-full p-2.5 text-ink2 transition hover:bg-ink/[0.07] hover:text-ink"
              >
                <SearchIcon className="h-5 w-5" />
              </button>
            )}
          </form>

          {listOpen && (
            <div
              id="video-suggestions"
              role="listbox"
              className="blur-panel surface-raised absolute top-full right-0 left-0 z-30 mt-2 animate-fade-in overflow-hidden rounded-2xl py-1.5 shadow-2xl"
            >
              {rows.map((row, i) => (
                <div
                  key={`${row.recent ? "r" : "s"}:${row.text}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => run(row.text)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 px-4 py-2.5 text-[15px] text-ink transition-colors",
                    i === active ? "bg-ink/[0.12]" : "hover:bg-ink/[0.06]",
                  )}
                >
                  {row.recent ? <History className="h-4 w-4 shrink-0 text-ink3" /> : <SearchIcon className="h-4 w-4 shrink-0 text-ink3" />}
                  <span className={cn("min-w-0 flex-1 truncate", row.recent && "text-accent")}>{row.text}</span>
                  {row.recent && (
                    <button
                      type="button"
                      aria-label={`Remove ${row.text}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeRecent(row.text);
                      }}
                      className="shrink-0 rounded-full p-1 text-ink3 hover:bg-ink/[0.08] hover:text-ink"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {loading && <VideoGridSkeleton />}
      {error && <ErrorState message={error} onRetry={() => run(submitted)} />}
      {!loading && !error && !results && (
        <EmptyState
          title="Search YouTube"
          hint="Press Enter to search. You can also paste any YouTube link (video, Shorts or live) to open it right away."
        />
      )}
      {results && !loading && (
        <>
          {channels.length > 0 && (
            <div className="space-y-1">
              {channels.slice(0, 3).map((c) => c.kind === "channel" && <ChannelRow key={c.id} c={c} />)}
            </div>
          )}
          {videos.length === 0 && channels.length === 0 ? (
            <EmptyState title={`No results for “${results.q}”`} hint="Try different words." />
          ) : (
            <VideoGrid>
              {videos.map((v) => v.kind === "video" && <VideoCard key={v.id} v={v} />)}
            </VideoGrid>
          )}
          {results.next && (
            <div className="flex justify-center py-2">
              {more ? <Spinner /> : <Button variant="outline" onClick={loadMore}>Load more</Button>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
