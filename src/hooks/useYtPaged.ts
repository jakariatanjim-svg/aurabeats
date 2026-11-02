/**
 * Endless lists from the signed-in YouTube account. Pages are kept in memory
 * for the session, so going back to a list is instant (nothing saved).
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { YtPage } from "@/services/yt/parse";
import { ytSession } from "@/services/yt/session";

export interface PagedState<T> {
  items: T[];
  next?: string;
  loading: boolean;
  error: string | null;
  started: boolean;
}

const store = new Map<string, PagedState<unknown>>();
const listeners = new Map<string, Set<() => void>>();
const EMPTY: PagedState<never> = { items: [], loading: false, error: null, started: false };

function put(key: string, s: PagedState<unknown>) {
  store.set(key, s);
  listeners.get(key)?.forEach((f) => f());
}

/** Forget cached lists whose name starts with `prefix` (after an edit). */
export function dropYtLists(prefix: string) {
  for (const k of [...store.keys()]) if (k.split("|")[1]?.startsWith(prefix)) put(k, EMPTY);
}

export function useYtPaged<T, P extends { next?: string } = YtPage>(
  name: string,
  load: (cursor?: string) => Promise<P>,
  pick: (p: P) => T[],
): PagedState<T> & { more: () => void; refresh: () => void; remove: (match: (t: T) => boolean) => void } {
  const key = `${ytSession()?.key ?? "none"}|${name}`;
  const loadRef = useRef({ load, pick });
  loadRef.current = { load, pick };

  const sub = useCallback(
    (f: () => void) => {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key)!.add(f);
      return () => {
        listeners.get(key)?.delete(f);
      };
    },
    [key],
  );
  const get = useCallback(() => (store.get(key) ?? EMPTY) as PagedState<T>, [key]);
  const st = useSyncExternalStore(sub, get, get);

  const fetchPage = useCallback(
    async (reset: boolean) => {
      const cur = (store.get(key) ?? EMPTY) as PagedState<T>;
      if (cur.loading || (!reset && cur.started && !cur.next)) return;
      put(key, { ...cur, loading: true, error: null, started: true });
      try {
        const base = reset ? [] : cur.items;
        const ids = new Set(base.map((x) => (x as { id?: string }).id));
        let cursor = reset ? undefined : cur.next;
        let fresh: T[] = [];
        let next: string | undefined;
        // A page can come back with nothing new (only removed/private videos
        // or rows already shown) while YouTube still has more: follow its
        // token a few times instead of treating that page as the end.
        for (let hop = 0; hop < 4; hop++) {
          const page = await loadRef.current.load(cursor);
          const got = loadRef.current.pick(page);
          fresh = got.filter((x) => {
            const id = (x as { id?: string }).id;
            if (ids.has(id)) return false;
            ids.add(id);
            return true;
          });
          next = page.next && page.next !== cursor ? page.next : undefined;
          if (fresh.length || !next) break;
          cursor = next;
        }
        put(key, { items: [...base, ...fresh], next, loading: false, error: null, started: true });
      } catch (e) {
        const now = (store.get(key) ?? EMPTY) as PagedState<T>;
        put(key, { ...now, loading: false, error: (e as Error)?.message || "Couldn't reach YouTube" });
      }
    },
    [key],
  );

  useEffect(() => {
    if (!st.started) void fetchPage(true);
  }, [st.started, fetchPage]);

  return {
    ...st,
    more: () => void fetchPage(false),
    refresh: () => void fetchPage(true),
    remove: (match) => {
      const cur = get();
      put(key, { ...cur, items: cur.items.filter((x) => !match(x)) });
    },
  };
}
