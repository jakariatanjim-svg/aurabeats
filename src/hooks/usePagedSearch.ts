import { useCallback, useEffect, useRef, useState } from "react";

export interface Page<T> {
  items: T[];
  next?: string;
}

interface State<T> {
  key: string;
  items: T[];
  next?: string;
  at: number;
}

// Results survive opening a song / video and coming back.
const memo = new Map<string, State<unknown>>();
const TTL = 15 * 60 * 1000;

/**
 * Endless results, the YouTube way: the first page shows right away, and
 * the next one loads by itself when you scroll near the end — for as long
 * as the server has more. No fixed result count anywhere.
 */
export function usePagedSearch<T>(
  key: string | null,
  fetchPage: (cursor?: string) => Promise<Page<T>>,
  idOf: (item: T) => string,
) {
  const fresh = (k: string | null) => {
    const hit = k ? (memo.get(k) as State<T> | undefined) : undefined;
    return hit && Date.now() - hit.at < TTL ? hit : null;
  };
  const [state, setState] = useState<State<T> | null>(() => fresh(key));
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState(false);
  const [nonce, setNonce] = useState(0);

  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const idRef = useRef(idOf);
  idRef.current = idOf;
  const stateRef = useRef(state);
  const keyRef = useRef(key);
  keyRef.current = key;
  const busy = useRef(false);
  const force = useRef(false);

  const commit = (s: State<T>) => {
    memo.delete(s.key);
    memo.set(s.key, s as State<unknown>);
    while (memo.size > 16) memo.delete(memo.keys().next().value as string);
    stateRef.current = s;
    setState(s);
  };

  /** Fetch pages from `cursor` until something new arrives (duplicates are skipped). */
  const collect = async (cursor: string | undefined, have: T[]) => {
    const seen = new Set(have.map((i) => idRef.current(i)));
    const items = [...have];
    let next = cursor;
    let first = cursor === undefined;
    for (let tries = 0; tries < 4; tries++) {
      const page = await fetchRef.current(first ? undefined : next);
      first = false;
      next = page.next;
      let added = 0;
      for (const it of page.items) {
        const id = idRef.current(it);
        if (seen.has(id)) continue;
        seen.add(id);
        items.push(it);
        added++;
      }
      if (added || !next) return { items, next };
    }
    return { items, next: undefined }; // the server keeps repeating itself — that's the end
  };

  // first page
  useEffect(() => {
    setMoreError(false);
    if (!key) {
      stateRef.current = null;
      setState(null);
      return;
    }
    const hit = fresh(key);
    const forced = force.current;
    force.current = false;
    if (hit && !forced) {
      stateRef.current = hit;
      setState(hit);
      setError(null);
      return;
    }
    let alive = true;
    busy.current = true;
    stateRef.current = null;
    setState(null);
    setError(null);
    setLoading(true);
    collect(undefined, [])
      .then((r) => alive && commit({ key, ...r, at: Date.now() }))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Search failed"))
      .finally(() => {
        if (!alive) return;
        busy.current = false;
        setLoading(false);
      });
    return () => {
      alive = false;
      busy.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  const loadMore = useCallback(() => {
    const s = stateRef.current;
    if (!s?.next || busy.current) return;
    busy.current = true;
    setMore(true);
    setMoreError(false);
    collect(s.next, s.items)
      .then((r) => {
        if (keyRef.current === s.key) commit({ ...s, ...r, at: Date.now() });
      })
      .catch(() => keyRef.current === s.key && setMoreError(true))
      .finally(() => {
        busy.current = false;
        setMore(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Watch a marker at the end of the list; re-armed after every page so a
  // short page (that doesn't fill the screen) keeps pulling the next one.
  const sentinel = useRef<HTMLDivElement | null>(null);
  const count = state?.items.length ?? 0;
  const hasMore = Boolean(state?.next);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || more || moreError) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMore(), {
      root: document.getElementById("ab-scroll"),
      rootMargin: "0px 0px 1000px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [count, hasMore, more, moreError, loadMore]);

  return {
    items: state?.items ?? null,
    loading,
    error,
    more,
    moreError,
    hasMore,
    loadMore,
    retry: () => {
      force.current = true;
      setNonce((n) => n + 1);
    },
    sentinel,
  };
}
