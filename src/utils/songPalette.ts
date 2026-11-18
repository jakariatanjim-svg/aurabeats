/**
 * A song's colours: three vivid colours read from its artwork (when the
 * picture's server allows reading it), otherwise three colours picked from
 * the song itself, so each song still gets its own.
 */
export type Rgb = [number, number, number];

const cache = new Map<string, Promise<Rgb[]>>();

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function hsl(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? 60 * (((G - B) / d) % 6) : max === G ? 60 * ((B - R) / d + 2) : 60 * ((R - G) / d + 4);
  return [(h + 360) % 360, s, l];
}

function fallback(id: string): Rgb[] {
  const h = hash(id);
  const base = h % 360;
  const step = 35 + (h >> 9) % 60;
  return [hsl(base, 0.85, 0.6), hsl((base + step) % 360, 0.8, 0.58), hsl((base + 360 - step) % 360, 0.75, 0.62)];
}

function read(url: string): Promise<Rgb[] | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 24;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, 24, 24);
        const d = ctx.getImageData(0, 0, 24, 24).data;
        // hue buckets weighted by colourfulness
        const buckets = new Map<number, { w: number; r: number; g: number; b: number }>();
        for (let i = 0; i < d.length; i += 4) {
          const px: Rgb = [d[i], d[i + 1], d[i + 2]];
          const [h, s, l] = toHsl(px);
          if (l < 0.12 || l > 0.92) continue;
          const w = s * s * (1 - Math.abs(l - 0.5));
          const k = Math.round(h / 24);
          const b = buckets.get(k) ?? { w: 0, r: 0, g: 0, b: 0 };
          b.w += w;
          b.r += px[0] * w;
          b.g += px[1] * w;
          b.b += px[2] * w;
          buckets.set(k, b);
        }
        const top = [...buckets.values()].filter((b) => b.w > 0.05).sort((a, b) => b.w - a.w).slice(0, 3);
        if (!top.length) return resolve(null);
        // brighten and saturate a little so the light glows
        const out = top.map((b) => {
          const [h, s, l] = toHsl([b.r / b.w, b.g / b.w, b.b / b.w]);
          return hsl(h, Math.min(1, Math.max(0.55, s * 1.2)), Math.min(0.68, Math.max(0.5, l)));
        });
        while (out.length < 3) {
          const [h, s, l] = toHsl(out[out.length - 1]);
          out.push(hsl((h + 40 * out.length) % 360, s, l));
        }
        resolve(out);
      } catch {
        resolve(null); // the picture's server doesn't allow reading it
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export const songPalette = {
  fallback,
  of(art: string | undefined, id: string): Promise<Rgb[]> {
    const key = art || `id:${id}`;
    let p = cache.get(key);
    if (!p) {
      p = (art ? read(art) : Promise.resolve(null)).then((c) => c ?? fallback(id));
      cache.set(key, p);
      if (cache.size > 200) cache.delete(cache.keys().next().value as string);
    }
    return p;
  },
};
