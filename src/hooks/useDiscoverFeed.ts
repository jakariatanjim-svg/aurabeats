import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildFeedJobs, looksLikeMusic, rankPage, trackKey, type FeedJob } from "@/services/discover";
import type { Track } from "@/types";

interface FeedState {
  sig: string;
  /** favourites already turned into jobs */
  seeded: Set<string>;
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
  // Only hearted songs shape the feed.
  const sig = useMemo(() => favorites.slice(0, 30).map((t) => t.id).join(","), [favorites]);

  const signalsRef = useRef({ favorites, history });
  signalsRef.current = { favorites, history };

  const fresh = (): FeedState => {
    const { favorites: f, history: h } = signalsRef.current;
    return {
      sig,
      seeded: new Set(f.map((t) => t.id)),
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
      if (added === 0 && st.items.length === 0 && st.done && st.jobs.length > 0) {
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

  // Favourites changed → update in place, never blank the list.
  //  • a new heart: its songs-like-this jobs jump the queue and run now; the
  //    results slot in near the top, everything already shown stays.
  //  • an un-heart: nothing visible changes (no reload for a removal).
  useEffect(() => {
    const st = stateRef.current;
    if (st.sig === sig) return;
    const { favorites: f } = signalsRef.current;
    st.sig = sig;
    // The first heart (or a feed that never loaded) simply starts fresh.
    if (st.items.length === 0 && !busyRef.current) {
      stateRef.current = fresh();
      cache = null;
      setDone(false);
      setError(null);
      void loadMore();
      return;
    }
    const added = f.filter((t) => !st.seeded.has(t.id));
    for (const t of f) {
      st.seeded.add(t.id);
      st.seen.add(t.id);
      st.seen.add(trackKey(t));
    }
    cache = st;
    if (!added.length) return;
    const jobs = buildFeedJobs(added).filter((j) => !st.jobs.some((x) => x.key === j.key));
    if (!jobs.length) return;
    // Remaining queue: the new jobs first, the rest after.
    st.jobs = [...st.jobs.slice(0, st.next), ...jobs, ...st.jobs.slice(st.next)];
    st.done = false;
    setDone(false);
    void (async () => {
      const results = await Promise.all(jobs.slice(0, 2).map((job) => job.run().then((tracks) => ({ weight: job.weight + 2, tracks })).catch(() => ({ weight: job.weight, tracks: [] as Track[] }))));
      if (stateRef.current !== st) return;
      // These two ran now: take them out of the queue.
      const ran = new Set(jobs.slice(0, 2).map((j) => j.key));
      st.jobs = st.jobs.filter((j, i) => i < st.next || !ran.has(j.key));
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
      const page = rankPage(groups, []).slice(0, 8);
      if (!page.length) return;
      const at = Math.min(st.items.length, 4);
      st.items = [...st.items.slice(0, at), ...page, ...st.items.slice(at)];
      cache = st;
      setItems(st.items);
    })();
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
