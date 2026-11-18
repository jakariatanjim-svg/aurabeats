/**
 * Shorts full screen (computers): the Shorts page tells the app shell, which
 * then folds the side menu to its slim rail (a click opens it again) and
 * hides the top bar, so the Short gets the whole screen.
 */
let on = false;
const subs = new Set<() => void>();

export const shortsFull = {
  get: () => on,
  set(v: boolean) {
    if (v === on) return;
    on = v;
    subs.forEach((f) => f());
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => void subs.delete(f);
  },
};
