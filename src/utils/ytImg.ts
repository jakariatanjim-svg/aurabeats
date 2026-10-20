/**
 * Fast YouTube thumbnails straight from i.ytimg.com (no proxy):
 * a 320px image where the card is small, 480px where it's wide, so phones
 * and grids download a third of the bytes. Non-YouTube images pass through.
 */
const RE = /^https:\/\/i\.ytimg\.com\/vi(?:_webp)?\/([\w-]{11})\//;

export function ytImgProps(src: string | undefined, sizes = "(max-width: 560px) 92vw, 360px"): { src?: string; srcSet?: string; sizes?: string } {
  if (!src) return { src };
  const m = src.match(RE);
  if (!m) return { src };
  const id = m[1];
  return {
    src: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    srcSet: `https://i.ytimg.com/vi/${id}/mqdefault.jpg 320w, https://i.ytimg.com/vi/${id}/hqdefault.jpg 480w`,
    sizes,
  };
}
