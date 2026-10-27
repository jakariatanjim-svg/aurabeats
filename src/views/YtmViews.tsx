/** Music mode, signed in to YouTube: your YouTube Music playlists and their songs. */
import { ArrowLeft, ListMusic, Play } from "lucide-react";
import type { Track } from "@/types";
import { usePlayer } from "@/hooks/usePlayer";
import { useYtPaged } from "@/hooks/useYtPaged";
import { Button, SectionHeader } from "@/components/ui";
import { EmptyState, ErrorState } from "@/components/states";
import { TrackRow } from "@/components/TrackList";
import { useBackHandler } from "@/utils/backStack";
import { LoadMore } from "@/views/video/YtViews";
import { ytmPlaylists, ytmPlaylistSongs, type YtmPage, type YtmPlaylist } from "@/services/yt/music";

function Cover({ src, className }: { src?: string; className: string }) {
  return src ? (
    <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className={`${className} object-cover`} />
  ) : (
    <span className={`${className} flex items-center justify-center bg-accent/15 text-accent`}>
      <ListMusic className="h-1/3 w-1/3" />
    </span>
  );
}

export function YtmPlaylistsSection({ onOpen }: { onOpen: (p: YtmPlaylist) => void }) {
  const list = useYtPaged<YtmPlaylist, YtmPage<YtmPlaylist>>("ytm-playlists", async () => ({ items: await ytmPlaylists() }), (p) => p.items);
  return (
    <section>
      <SectionHeader title="YouTube Music playlists" icon={<ListMusic className="h-4 w-4 text-accent" />} />
      {list.items.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {list.items.map((p) => (
            <button key={p.id} type="button" onClick={() => onOpen(p)} className="focus-ring group blur-panel p-3 text-left">
              <Cover src={p.thumbnail} className="aspect-square w-full rounded-xl transition-transform duration-300 group-hover:scale-[1.02]" />
              <p className="mt-2 truncate text-sm font-bold text-ink">{p.title}</p>
              {p.subtitle && <p className="truncate text-[11px] text-ink3">{p.subtitle}</p>}
            </button>
          ))}
        </div>
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.refresh} />
      ) : list.loading || !list.started ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton aspect-square rounded-2xl" />
          ))}
        </div>
      ) : (
        <EmptyState title="No YouTube Music playlists" />
      )}
    </section>
  );
}

export function YtmPlaylistDetail({ pl, onBack }: { pl: YtmPlaylist; onBack: () => void }) {
  const { playAll } = usePlayer();
  useBackHandler(true, onBack);
  const list = useYtPaged<Track, YtmPage<Track>>(`ytm-pl:${pl.id}`, (c) => ytmPlaylistSongs(pl.id, c), (p) => p.items);

  return (
    <div className="space-y-6 pb-4">
      <Button variant="ghost" onClick={onBack} className="-ml-2" aria-label="Back">
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <div className="blur-panel flex flex-col gap-5 p-5 sm:flex-row sm:items-end">
        <Cover src={pl.thumbnail} className="mx-auto aspect-square w-36 shrink-0 rounded-2xl shadow-xl sm:mx-0 sm:w-40" />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="text-[10px] font-bold tracking-[0.2em] text-ink3 uppercase">YouTube Music</p>
          <h2 className="mt-1 text-3xl font-black tracking-tight text-ink">{pl.title}</h2>
          {pl.subtitle && <p className="mt-1 text-xs text-ink3">{pl.subtitle}</p>}
          {list.items.length > 0 && (
            <Button className="mt-4" onClick={() => playAll(list.items, 0)}>
              <Play className="h-4 w-4 fill-current" /> Play all
            </Button>
          )}
        </div>
      </div>
      {list.items.length ? (
        <>
          <div className="blur-panel p-2">
            {list.items.map((t, i) => (
              <TrackRow key={t.id} track={t} context={list.items} index={i} />
            ))}
          </div>
          <LoadMore st={list} onMore={list.more} />
        </>
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={list.refresh} />
      ) : list.loading || !list.started ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton h-14 rounded-xl" />
          ))}
        </div>
      ) : (
        <EmptyState title="This playlist is empty" />
      )}
    </div>
  );
}
