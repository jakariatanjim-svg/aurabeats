/**
 * Small navigation memory shared by the shell and the players:
 *  - where each page was scrolled to (back / forward restores it, like YouTube)
 *  - the page a video was opened from (the miniplayer goes back there)
 *  - whether the next "popstate" is really a new page (goPath) and not Back.
 */
const scroll = new Map<string, number>();

export const navMemory = {
  /** the watch page was opened straight from a page (one Back returns there) */
  cameFromPage: false,
  /** last page that wasn't a video (route key) */
  lastPage: "video",
  /** set by goPath: the coming popstate is a forward navigation */
  pushing: false,
  save(loc: string, y: number) {
    scroll.set(loc, y);
    if (scroll.size > 60) scroll.delete(scroll.keys().next().value as string);
  },
  /** Scrolls `el` back to where `loc` was, retrying while the page fills in. */
  restore(loc: string, el: HTMLElement | null) {
    const y = scroll.get(loc) ?? 0;
    if (!el) return;
    let tries = 0;
    const step = () => {
      el.scrollTo({ top: y });
      if (Math.abs(el.scrollTop - y) > 2 && tries++ < 30) window.setTimeout(step, 60);
    };
    requestAnimationFrame(step);
  },
};
