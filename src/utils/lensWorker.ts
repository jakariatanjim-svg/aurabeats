/**
 * Background worker for Liquid Glass lensing: draws a surface's bend map and
 * edge light and encodes them as images, off the page's main thread (that
 * work used to cause the occasional hitch when a new glass size appeared).
 */
import { lensPixels, type LensJob } from "./lensMath";

interface Scope {
  postMessage(message: unknown): void;
  onmessage: ((e: MessageEvent<{ id: number; job: LensJob }>) => void) | null;
}
const scope = self as unknown as Scope;

function asDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

scope.onmessage = async (e) => {
  const { id, job } = e.data;
  try {
    const px = lensPixels(job);
    const cv = new OffscreenCanvas(px.W, px.H);
    const ctx = cv.getContext("2d");
    if (!ctx) throw new Error("no 2d");
    ctx.putImageData(new ImageData(px.bend, px.W, px.H), 0, 0);
    const bend = await asDataUrl(await cv.convertToBlob({ type: "image/png" }));
    ctx.clearRect(0, 0, px.W, px.H);
    ctx.putImageData(new ImageData(px.lit, px.W, px.H), 0, 0);
    const spec = await asDataUrl(await cv.convertToBlob({ type: "image/png" }));
    scope.postMessage({ id, bend, spec, max: px.max });
  } catch {
    scope.postMessage({ id, fail: true });
  }
};
