/** A row of Shorts on Video Home; a tap opens the Shorts player there. */
import { useEffect, useState } from "react";
import { Clapperboard } from "lucide-react";
import { SectionHeader, Skeleton } from "@/components/ui";
import { ShortsSource, openShortsAt, type ShortItem } from "@/services/yt/shorts";
import { ytSession } from "@/services/yt/session";
import { routeToPath } from "@/routes";

let cached: { key: string; at: number; list: Promise<ShortItem[]> } | null = null;

function firstShorts(): Promise<ShortItem[]> {
  const key = ytSession()?.key ?? "anon";
  if (!cached || cached.key !== key || Date.now() - cached.at > 20 * 60 * 1000) {
    const src = new ShortsSource();
    const list = (async () => {
      const out = await src.more();
      if (out.length < 8) out.push(...(await src.more().catch(() => [])));
      return out;
    })();
    list.catch(() => (cached = null));
    cached = { key, at: Date.now(), list };
  }
  return cached.list;
}

export function ShortsRow() {
  const [list, setList] = useState<ShortItem[] | null>(null);
  useEffect(() => {
    let alive = true;
    firstShorts()
      .then((l) => alive && setList(l))
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, []);
  if (list && !list.length) return null;
  return (
    <section>
      <SectionHeader title="Shorts" icon={<Clapperboard className="h-5 w-5 text-accent" />} />
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        {list
          ? list.slice(0, 16).map((s, i) => (
              <a
                key={s.id}
                href={routeToPath("video-shorts")}
                data-nav="true"
                onClick={() => openShortsAt(list, i)}
                className="group w-[42vw] max-w-[190px] shrink-0 snap-start"
              >
                <span className="relative block aspect-[9/16] overflow-hidden rounded-2xl bg-ink/[0.06]">
                  <img
                    src={s.thumbnail ?? `https://i.ytimg.com/vi/${s.id}/oar2.jpg`}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      const img = e.currentTarget;
                      if (!img.src.includes("hqdefault")) img.src = `https://i.ytimg.com/vi/${s.id}/hqdefault.jpg`;
                    }}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2.5 pt-10 text-white">
                    {s.title && <span className="line-clamp-2 text-[13px] leading-snug font-bold">{s.title}</span>}
                    {s.views && <span className="mt-0.5 block text-[11px] text-white/80">{s.views}</span>}
                  </span>
                </span>
              </a>
            ))
          : Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="aspect-[9/16] w-[42vw] max-w-[190px] shrink-0 rounded-2xl!" />)}
      </div>
    </section>
  );
}
