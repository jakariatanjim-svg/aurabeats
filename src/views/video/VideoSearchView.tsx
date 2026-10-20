import { useCallback, useEffect, useState } from "react";
import { searchVideos } from "@/services/video/api";
import type { SearchItem } from "@/services/video/types";
import { ChannelRow, VideoCard, VideoGrid, VideoGridSkeleton } from "@/components/video/VideoCards";
import { Button, Spinner } from "@/components/ui";
import { EmptyState, ErrorState } from "@/components/states";
import { session } from "@/utils/storage";
import { useUrlQuery } from "@/utils/searchNav";

/** Results survive opening a video and coming back. */
interface Saved {
  q: string;
  items: SearchItem[];
  next?: string;
  source: string;
}
let memo: Saved | null = null;

/**
 * Video search results. The search box is in the top bar; the term comes
 * from the address (/video/search?q=…).
 */
export function VideoSearchView() {
  const q = useUrlQuery();
  const [results, setResults] = useState<Saved | null>(() => {
    const r = memo ?? session.get<Saved | null>("videoSearch", null);
    return r && r.q === q ? r : null;
  });
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const save = (s: Saved) => {
    memo = s;
    session.set("videoSearch", { ...s, items: s.items.slice(0, 60) });
    setResults(s);
  };

  useEffect(() => {
    if (!q) {
      setResults(null);
      return;
    }
    if (results?.q === q && !error) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setResults(null);
    searchVideos(q)
      .then((r) => alive && save({ q, items: r.items, next: r.next, source: r.source }))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Search failed"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, nonce]);

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

  const channels = results?.items.filter((i) => i.kind === "channel") ?? [];
  const videos = results?.items.filter((i) => i.kind === "video") ?? [];

  return (
    <div className="space-y-6">
      {loading && <VideoGridSkeleton />}
      {error && <ErrorState message={error} onRetry={() => setNonce((n) => n + 1)} />}
      {!q && (
        <EmptyState
          title="Search YouTube"
          hint="Use the search at the top. You can also paste any YouTube link (video, Shorts or live) there to open it right away."
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
