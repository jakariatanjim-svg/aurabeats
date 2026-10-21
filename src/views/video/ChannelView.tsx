import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/utils/cn";
import { useVideoLibrary, videoLibrary } from "@/hooks/useVideoLibrary";
import { getChannel } from "@/services/video/api";
import type { ChannelPage } from "@/services/video/types";
import { Avatar, VideoCard, VideoGrid, VideoGridSkeleton } from "@/components/video/VideoCards";
import { Button, Skeleton, Spinner } from "@/components/ui";
import { EmptyState, ErrorState } from "@/components/states";

export function ChannelView({ id }: { id: string }) {
  useVideoLibrary(); // re-render on follow changes
  const [page, setPage] = useState<(ChannelPage & { source: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    getChannel(id)
      .then((p) => alive && setPage(p))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Could not load channel"));
    return () => {
      alive = false;
    };
  }, [id, nonce]);

  const loadMore = () => {
    if (!page?.next || more) return;
    setMore(true);
    getChannel(id, page.next, page.source)
      .then((p) => {
        const seen = new Set(page.videos.map((v) => v.id));
        setPage({ ...page, videos: [...page.videos, ...p.videos.filter((v) => !seen.has(v.id))], next: p.next });
      })
      .catch(() => setPage({ ...page, next: undefined }))
      .finally(() => setMore(false));
  };

  if (error && !page) return <ErrorState message={error} onRetry={() => setNonce((n) => n + 1)} />;

  const following = videoLibrary.isFollowing(id);

  return (
    <div className="space-y-6">
      {page?.banner && (
        <div className="-mx-4 -mt-4 aspect-[5/1] overflow-hidden sm:mx-0 sm:mt-0 sm:aspect-[6/1] sm:rounded-2xl">
          <img src={page.banner} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4">
        {page ? (
          <Avatar name={page.name} src={page.avatar} channelId={id} className="h-20 w-20 text-xl sm:h-24 sm:w-24" />
        ) : (
          <Skeleton className="h-20 w-20 rounded-full! sm:h-24 sm:w-24" />
        )}
        <div className="min-w-0 flex-1">
          {page ? (
            <>
              <h1 className="truncate text-2xl font-black tracking-tight text-ink">{page.name}</h1>
              {page.subscribers && <p className="text-sm text-ink3">{page.subscribers}</p>}
            </>
          ) : (
            <>
              <Skeleton className="h-6 w-48" />
              <Skeleton className="mt-2 h-4 w-28" />
            </>
          )}
        </div>
        {page && (
          <div className="flex items-center gap-2">
            <Button
              variant={following ? "outline" : "solid"}
              onClick={() => videoLibrary.toggleFollow({ id, name: page.name, avatar: page.avatar })}
            >
              {following ? "Following" : "Follow"}
            </Button>
            <a
              href={`https://www.youtube.com/channel/${id}`}
              target="_blank"
              rel="noreferrer"
              aria-label="Open on YouTube"
              className="rounded-full border border-line p-2.5 text-ink3 transition hover:text-ink"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        )}
      </div>

      {page?.description && (
        <button type="button" onClick={() => setDescOpen((o) => !o)} className="block w-full text-left">
          <p className={cn("max-w-3xl text-[13px] leading-relaxed whitespace-pre-wrap text-ink3", !descOpen && "line-clamp-2")}>
            {page.description}
          </p>
        </button>
      )}

      {page && !page.videos.length ? (
        <EmptyState
          title="Videos aren't available right now"
          hint="The servers couldn't list this channel's uploads. Try again in a moment."
          action={<Button variant="outline" onClick={() => setNonce((n) => n + 1)}>Try again</Button>}
        />
      ) : page ? (
        <>
          <VideoGrid>
            {page.videos.map((v) => (
              <VideoCard key={v.id} v={v} hideChannel />
            ))}
          </VideoGrid>
          {page.next && (
            <div className="flex justify-center">
              {more ? <Spinner /> : <Button variant="outline" onClick={loadMore}>Load more</Button>}
            </div>
          )}
        </>
      ) : (
        <VideoGridSkeleton />
      )}
    </div>
  );
}
