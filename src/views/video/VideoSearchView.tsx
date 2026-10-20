import { searchVideos } from "@/services/video/api";
import type { SearchItem } from "@/services/video/types";
import { ChannelRow, VideoCard, VideoGrid, VideoGridSkeleton } from "@/components/video/VideoCards";
import { Button, Spinner } from "@/components/ui";
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
  const videos = items.filter((i) => i.kind === "video");

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
      {q && list.items && (
        <>
          {channels.length > 0 && (
            <div className="space-y-1">
              {channels.slice(0, 3).map((c) => c.kind === "channel" && <ChannelRow key={c.id} c={c} />)}
            </div>
          )}
          {videos.length === 0 && channels.length === 0 ? (
            <EmptyState title={`No results for “${q}”`} hint="Try different words." />
          ) : (
            <VideoGrid>
              {videos.map((v) => v.kind === "video" && <VideoCard key={v.id} v={v} />)}
            </VideoGrid>
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
