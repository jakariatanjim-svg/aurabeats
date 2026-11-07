import { useEffect, useState } from "react";
import { searchVideos, searchVideosOnly } from "@/services/video/api";
import type { SearchItem, VideoItem } from "@/services/video/types";
import type { ShortItem } from "@/services/yt/shorts";
import { ShortTile, ShortsShelf } from "./ShortsRow";
import { ChannelRow, VideoCard, VideoGrid, VideoGridSkeleton } from "@/components/video/VideoCards";
import { Button, Chip, Spinner } from "@/components/ui";
import { EmptyState, ErrorState } from "@/components/states";
import { useUrlQuery } from "@/utils/searchNav";
import { usePagedSearch } from "@/hooks/usePagedSearch";

/**
 * Video search results. The search box is in the top bar; the term comes
 * from the address (/video/search?q=…). Like YouTube, more results keep
 * loading as you scroll, for as long as YouTube has them.
 */
export function VideoSearchView() {
  const q = useUrlQuery();
  // Continuation tokens only work on the server that issued them, so each
  // cursor carries its server: "source\ntoken".
  const list = usePagedSearch<SearchItem>(
    q ? `video:${q}` : null,
    async (cursor) => {
      const cut = cursor ? cursor.indexOf("\n") : -1;
      const r = cursor ? await searchVideos(q, cursor.slice(cut + 1), cursor.slice(0, cut)) : await searchVideos(q);
      return { items: r.items, next: r.next ? `${r.source}\n${r.next}` : undefined };
    },
    (i) => `${i.kind}:${i.id}`,
  );

  const items = list.items ?? [];
  const channels = items.filter((i) => i.kind === "channel");
  const all = items.filter((i): i is Extract<SearchItem, { kind: "video" }> => i.kind === "video");
  const isShort = (v: VideoItem) => !!v.short || /#shorts?\b/i.test(v.title);
  const videos = all.filter((v) => !isShort(v));

  // Shorts for the term, like YouTube: the ones in the results plus a
  // Shorts-only search; shown as a shelf (All) or a grid (Shorts)
  const [tab, setTab] = useState<"all" | "videos" | "shorts">("all");
  const [extra, setExtra] = useState<{ q: string; list: ShortItem[] } | null>(null);
  useEffect(() => {
    setTab("all");
    if (!q) return;
    let alive = true;
    searchVideosOnly(`${q} #shorts`)
      .then((l) => alive && setExtra({ q, list: l.filter((v) => isShort(v) || (v.duration > 0 && v.duration <= 180)).map(toShort) }))
      .catch(() => alive && setExtra({ q, list: [] }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const shorts: ShortItem[] | null = (() => {
    const fromResults = all.filter(isShort).map(toShort);
    if (!extra || extra.q !== q) return fromResults.length ? fromResults : null;
    const seen = new Set<string>();
    return [...fromResults, ...extra.list].filter((s) => !seen.has(s.id) && !!seen.add(s.id));
  })();

  return (
    <div className="space-y-6">
      {!q && (
        <EmptyState
          title="Search YouTube"
          hint="Use the search at the top. You can also paste any YouTube link (video, Shorts or live) there to open it right away."
        />
      )}
      {q && list.error && !list.items && <ErrorState message={list.error} onRetry={list.retry} />}
      {q && !list.items && !list.error && <VideoGridSkeleton />}
      {q && (
        <div className="flex gap-2">
          {(["all", "videos", "shorts"] as const).map((t) => (
            <Chip key={t} active={tab === t} onClick={() => setTab(t)} className="text-sm capitalize">
              {t}
            </Chip>
          ))}
        </div>
      )}
      {q && list.items && (
        <>
          {channels.length > 0 && (
            <div className="space-y-1">
              {channels.slice(0, 3).map((c) => c.kind === "channel" && <ChannelRow key={c.id} c={c} />)}
            </div>
          )}
          {tab === "shorts" ? (
            shorts?.length ? (
              <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] sm:gap-4">
                {shorts.map((s, i) => (
                  <ShortTile key={s.id} s={s} list={shorts} index={i} />
                ))}
              </div>
            ) : shorts ? (
              <EmptyState title={`No Shorts for “${q}”`} hint="Try different words." />
            ) : (
              <div className="flex justify-center py-8"><Spinner /></div>
            )
          ) : videos.length === 0 && channels.length === 0 && !shorts?.length ? (
            <EmptyState title={`No results for “${q}”`} hint="Try different words." />
          ) : (
            <>
              <VideoGrid>
                {videos.slice(0, tab === "all" ? 4 : undefined).map((v) => <VideoCard key={v.id} v={v} />)}
              </VideoGrid>
              {tab === "all" && shorts && shorts.length > 0 && <ShortsShelf list={shorts} />}
              {tab === "all" && videos.length > 4 && (
                <VideoGrid>
                  {videos.slice(4).map((v) => <VideoCard key={v.id} v={v} />)}
                </VideoGrid>
              )}
            </>
          )}
          <div ref={list.sentinel} />
          {list.more && <div className="flex justify-center py-4"><Spinner /></div>}
          {list.moreError && (
            <div className="flex justify-center py-2">
              <Button variant="outline" onClick={list.loadMore}>Try again</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const toShort = (v: VideoItem): ShortItem => ({
  id: v.id,
  title: v.title,
  author: v.author,
  authorId: v.authorId,
  views: v.views !== undefined ? `${Intl.NumberFormat("en", { notation: "compact" }).format(v.views)} views` : undefined,
});
