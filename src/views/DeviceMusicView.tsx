import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, Play, RefreshCw, Search, Shuffle, Smartphone } from "lucide-react";
import { usePlayer } from "@/hooks/usePlayer";
import { Button, IconButton } from "@/components/ui";
import { EmptyState } from "@/components/states";
import { TrackRow } from "@/components/TrackList";
import { cachedDeviceSongs, listDeviceSongs } from "@/services/deviceMusic";
import { storage } from "@/utils/storage";
import { shuffleArray } from "@/utils/format";
import type { Track } from "@/types";

const PAGE = 150;

/** Android app: every song already on the phone, loaded automatically. */
export function DeviceMusicView() {
  const { playAll } = usePlayer();
  const [tracks, setTracks] = useState<Track[] | null>(cachedDeviceSongs);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">(cachedDeviceSongs ? "ready" : "loading");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);

  const load = useCallback(async (ask: boolean) => {
    setState((s) => (cachedDeviceSongs ? s : "loading"));
    try {
      const r = await listDeviceSongs(ask);
      if (!r.granted) {
        setState("denied");
        return;
      }
      setTracks(r.tracks);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  // First visit asks for access once by itself; later visits just read.
  useEffect(() => {
    const asked = storage.get("deviceMusic:asked", false);
    storage.set("deviceMusic:asked", true);
    void load(!asked);
  }, [load]);

  const list = useMemo(() => {
    const all = tracks ?? [];
    const s = q.trim().toLowerCase();
    if (!s) return all;
    return all.filter((t) => `${t.title} ${t.artist} ${t.album ?? ""}`.toLowerCase().includes(s));
  }, [tracks, q]);

  return (
    <div className="space-y-5 pb-4">
      <div className="blur-panel flex flex-col gap-5 p-5 sm:flex-row sm:items-end">
        <div
          className="mx-auto flex aspect-square w-32 shrink-0 items-center justify-center rounded-2xl shadow-xl sm:mx-0 sm:w-36"
          style={{ backgroundImage: "linear-gradient(135deg, var(--c-accent), var(--c-accent2))" }}
        >
          <Smartphone className="h-12 w-12 text-white/90 drop-shadow" />
        </div>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <h2 className="text-3xl font-black tracking-tight text-ink">On this device</h2>
          {tracks && (
            <p className="mt-1 text-xs text-ink3">
              {tracks.length} {tracks.length === 1 ? "song" : "songs"}
            </p>
          )}
          {list.length > 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
              <Button onClick={() => playAll(list, 0)}>
                <Play className="h-4 w-4 fill-current" /> Play all
              </Button>
              <Button variant="outline" onClick={() => playAll(shuffleArray(list), 0)}>
                <Shuffle className="h-4 w-4" /> Shuffle
              </Button>
              <IconButton aria-label="Rescan" onClick={() => void load(false)}>
                <RefreshCw className="h-4 w-4" />
              </IconButton>
            </div>
          )}
        </div>
      </div>

      {state === "denied" ? (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <FolderOpen className="h-10 w-10 text-ink3" />
          <p className="text-[15px] font-semibold text-ink" data-tip="AuraBeats only reads your songs; nothing is uploaded">
            Allow access to your music
          </p>
          <Button onClick={() => void load(true)}>Allow</Button>
        </div>
      ) : state === "error" ? (
        <EmptyState title="Couldn't read songs on this phone" />
      ) : state === "loading" && !tracks ? (
        <div className="blur-panel space-y-2 p-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-ink/[0.06]" />
          ))}
        </div>
      ) : (tracks?.length ?? 0) === 0 ? (
        <EmptyState title="No songs found on this phone" />
      ) : (
        <>
          <label className="glass-inset flex items-center gap-2 rounded-full border border-line px-4 py-2.5">
            <Search className="h-4 w-4 text-ink3" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setShown(PAGE);
              }}
              placeholder="Find a song"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink3"
            />
          </label>
          {list.length === 0 ? (
            <EmptyState title="No matches" />
          ) : (
            <div className="blur-panel p-2">
              {list.slice(0, shown).map((t, i) => (
                <TrackRow key={t.id} track={t} context={list} index={i} />
              ))}
              {shown < list.length && (
                <div className="flex justify-center py-3">
                  <button
                    type="button"
                    onClick={() => setShown((n) => n + PAGE)}
                    className="rounded-full border border-line px-5 py-2 text-sm font-semibold text-ink2 transition hover:border-accent hover:text-accent"
                  >
                    Show more
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
