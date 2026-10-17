import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildFeedJobs, looksLikeMusic, rankPage, trackKey, type FeedJob } from "@/services/discover";
import type { Track } from "@/types";

interface FeedState {
  sig: string;
  jobs: FeedJob[];
  next: number;
  items: Track[];
  seen: Set<string>;
  done: boolean;
}

/** Survives leaving and re-opening Discover (same session, same signals). */
let cache: FeedState | null = null;

const JOBS_PER_PAGE = 3;
const MIN_NEW_PER_PAGE = 8;

/**
 * Infinite, YouTube-style recommendation feed driven by favourites (= subscriptions)
 * and listening history. `exclude` holds tracks already shown elsewhere on the page.
 */
export function useDiscoverFeed(favorites: Track[], history: Track[], exclude: Track[] = []) {
  // Only the signals that change recommendations — not every history tick.
  const sig = useMemo(
    () =>
      [
        favorites.slice(0, 30).map((t) => t.id).join(","),
        history.slice(0, 12).map((t) => t.artist).join(","),
      ].join("#"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [favorites],
  );

  const signalsRef = useRef({ favorites, history });
  signalsRef.current = { favorites, history };

  const fresh = (): FeedState => {
    const { favorites: f, history: h } = signalsRef.current;
    return {
      sig,
      jobs: buildFeedJobs(f, h),
      next: 0,
      items: [],
      seen: new Set(f.flatMap((t) => [t.id, trackKey(t)])),
      done: false,
    };
  };

  const stateRef = useRef<FeedState>(cache && cache.sig === sig ? cache : fresh());
  const [items, setItems] = useState<Track[]>(stateRef.current.items);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(stateRef.current.done);
  const busyRef = useRef(false);

  // Hide anything already shown above the feed (e.g. the Trending section).
  const excludeKeys = useMemo(() => new Set(exclude.flatMap((t) => [t.id, trackKey(t)])), [exclude]);

  const loadMore = useCallback(async () => {
    const st = stateRef.current;
    if (busyRef.current || st.done) return;
    busyRef.current = true;
    setLoading(true);
    setError(null);

    let added = 0;
    let rounds = 0;
    try {
      // Keep pulling jobs until this page has enough new songs.
      while (added < MIN_NEW_PER_PAGE && st.next < st.jobs.length && rounds < 3) {
        rounds++;
        const batch = st.jobs.slice(st.next, st.next + JOBS_PER_PAGE);
        st.next += batch.length;
        const results = await Promise.all(
          batch.map((job) => job.run().then((tracks) => ({ weight: job.weight, tracks })).catch(() => ({ weight: job.weight, tracks: [] as Track[] }))),
        );
        if (stateRef.current !== st) return; // signals changed meanwhile
        const groups = results.map((g) => ({
          weight: g.weight,
          tracks: g.tracks.filter((t) => {
            const k = trackKey(t);
            if (st.seen.has(t.id) || st.seen.has(k) || !looksLikeMusic(t)) return false;
            st.seen.add(t.id);
            st.seen.add(k);
            return true;
          }),
        }));
        const page = rankPage(groups, st.items.slice(-3).map((t) => t.artist));
        st.items = [...st.items, ...page];
        added += page.length;
      }
      if (st.next >= st.jobs.length) st.done = true;
      if (added === 0 && st.items.length === 0 && st.done) {
        setError("Couldn't load music right now. Check your connection and try again.");
      }
      cache = st;
      setItems(st.items);
      setDone(st.done);
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }, []);

  // Favourites changed → rebuild the recommendations from scratch.
  useEffect(() => {
    if (stateRef.current.sig === sig) return;
    stateRef.current = fresh();
    cache = null;
    setItems([]);
    setDone(false);
    setError(null);
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, loadMore]);

  // First page.
  useEffect(() => {
    if (stateRef.current.items.length === 0) void loadMore();
  }, [loadMore]);

  const refresh = useCallback(() => {
    stateRef.current = fresh();
    cache = null;
    setItems([]);
    setDone(false);
    setError(null);
    busyRef.current = false;
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMore, sig]);

  const visible = useMemo(
    () => (excludeKeys.size ? items.filter((t) => !excludeKeys.has(t.id) && !excludeKeys.has(trackKey(t))) : items),
    [items, excludeKeys],
  );

  return { items: visible, loading, error, done, loadMore, refresh };
}
