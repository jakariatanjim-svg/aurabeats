/**
 * Shorts shelves, like YouTube's: one row of Shorts with a "Show more" arrow
 * that opens more rows (computers), a sideways row on phones. Home shows a
 * shelf at the top and more shelves further down the feed (`part` 1, 2, …),
 * each with different Shorts. A tap opens the Shorts player there.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Clapperboard } from "lucide-react";
import { SectionHeader, Skeleton } from "@/components/ui";
import { ShortsSource, openShortsAt, type ShortItem } from "@/services/yt/shorts";
import { ytSession } from "@/services/yt/session";
import { routeToPath } from "@/routes";
import { cn } from "@/utils/cn";

const PER_SHELF = 18;

/** One growing list per account, shared by all the shelves on the page. */
let pool: { key: string; at: number; src: ShortsSource; list: ShortItem[]; loading: Promise<void> | null; done: boolean } | null = null;

async function shortsFor(part: number): Promise<ShortItem[]> {
  const key = ytSession()?.key ?? "anon";
  if (!pool || pool.key !== key || Date.now() - pool.at > 20 * 60 * 1000) {
    pool = { key, at: Date.now(), src: new ShortsSource(), list: [], loading: null, done: false };
  }
  const p = pool;
  const need = (part + 1) * PER_SHELF;
  for (let tries = 0; p.list.length < need && !p.done && tries < 6; tries++) {
    p.loading ??= p.src
      .more()
      .then((got) => {
        const ids = new Set(p.list.map((s) => s.id));
        const fresh = got.filter((s) => !ids.has(s.id));
        if (!got.length) p.done = true;
        p.list.push(...fresh);
      })
      .catch(() => void (p.done = true))
      .finally(() => (p.loading = null));
    await p.loading;
  }
  return p.list.slice(part * PER_SHELF, need);
}

export function ShortTile({ s, list, index, className }: { s: ShortItem; list: ShortItem[]; index: number; className?: string }) {
  return (
    <a href={routeToPath("video-shorts")} data-nav="true" onClick={() => openShortsAt(list, index)} className={cn("group block min-w-0", className)}>
      <span className="relative block aspect-[9/16] overflow-hidden rounded-2xl bg-ink/[0.06]">
        <img
          src={s.thumbnail ?? `https://i.ytimg.com/vi/${s.id}/oar2.jpg`}
          alt=""
          loading="lazy"
          onError={(e) => {
            const img = e.currentTarget;
            if (!img.src.includes("hqdefault")) img.src = `https://i.ytimg.com/vi/${s.id}/hqdefault.jpg`;
          }}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />
      </span>
      {s.title && <span className="mt-2 line-clamp-2 text-[14px] leading-snug font-semibold text-ink">{s.title}</span>}
      {s.views && <span className="mt-0.5 block text-[12px] text-ink3">{s.views}</span>}
    </a>
  );
}

/** How many tiles fit in one row of the computer grid. */
function useColumns(ref: React.RefObject<HTMLElement | null>) {
  const [cols, setCols] = useState(5);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setCols(Math.max(2, Math.floor((el.clientWidth + 16) / (170 + 16))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cols;
}

/** A Shorts shelf for a ready list (search results, home). */
export function ShortsShelf({ list, title = "Shorts" }: { list: ShortItem[] | null; title?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const cols = useColumns(box);
  const [open, setOpen] = useState(false);
  if (list && !list.length) return null;
  const shown = list ? list.slice(0, open ? cols * 3 : cols) : [];
  const more = !!list && list.length > cols;
  return (
    <section>
      <SectionHeader title={title} icon={<Clapperboard className="h-5 w-5 text-accent" />} />
      {/* phones: a sideways row */}
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:hidden [&::-webkit-scrollbar]:hidden">
        {list
          ? list.map((s, i) => <ShortTile key={s.id} s={s} list={list} index={i} className="w-[42vw] max-w-[190px] shrink-0 snap-start" />)
          : Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="aspect-[9/16] w-[42vw] shrink-0 rounded-2xl!" />)}
      </div>
      {/* computers: one row, "Show more" opens two more */}
      <div ref={box} className="hidden sm:block">
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {list
            ? shown.map((s, i) => <ShortTile key={s.id} s={s} list={list} index={i} className="animate-fade-in" />)
            : Array.from({ length: cols }, (_, i) => <Skeleton key={i} className="aspect-[9/16] rounded-2xl!" />)}
        </div>
        {more && (
          <div className="relative mt-3 flex items-center justify-center">
            <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="relative flex items-center gap-1.5 rounded-full border border-line bg-[var(--shell-bg)] px-6 py-2 text-sm font-semibold text-ink transition hover:bg-ink/[0.06]"
            >
              {open ? "Show less" : "Show more"}
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** Home: shelf number `part` (0 = the top one), each with different Shorts. */
export function ShortsRow({ part = 0 }: { part?: number }) {
  const [list, setList] = useState<ShortItem[] | null>(null);
  useEffect(() => {
    let alive = true;
    shortsFor(part)
      .then((l) => alive && setList(l))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, [part]);
  return <ShortsShelf list={list} />;
}
