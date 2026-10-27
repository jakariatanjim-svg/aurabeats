/**
 * "Saved" songs: the hearted songs on this device (guest), or — signed in to
 * YouTube — your YouTube Music liked songs (plus hearted songs from other
 * sources, which YouTube can't like).
 */
import { useMemo } from "react";
import type { Track } from "@/types";
import { usePlayer } from "@/hooks/usePlayer";
import { useYtSession } from "@/services/yt/session";
import { loadLikedSongs, useLikedSongs } from "@/services/yt/music";

export interface SavedSongs {
  signedIn: boolean;
  tracks: Track[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useSavedSongs(): SavedSongs {
  const { favorites } = usePlayer();
  const session = useYtSession();
  const liked = useLikedSongs(!!session);
  return useMemo(() => {
    if (!session) return { signedIn: false, tracks: favorites, loading: false, error: null, refresh: () => undefined };
    const mine = liked.key === session.key ? liked : null;
    const likedList = (mine?.list ?? []).filter((t) => mine?.over.get(t.id) !== false);
    const others = favorites.filter((t) => t.source !== "youtube");
    return {
      signedIn: true,
      tracks: [...likedList, ...others],
      loading: !mine?.list && (mine?.loading ?? true),
      error: mine?.error ?? null,
      refresh: () => void loadLikedSongs(true),
    };
  }, [session, liked, favorites]);
}
