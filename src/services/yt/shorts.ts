/**
 * Shorts: an endless list of vertical videos.
 *  - Signed in: YouTube's own Shorts feed for the account.
 *  - Signed out (app / extension): Shorts from the channels you follow and
 *    watch, then YouTube's "more like this" sequence after them.
 *  - Website without the extension: search results for those channels'
 *    Shorts (short vertical videos only).
 */
import { videoLibrary } from "@/hooks/useVideoLibrary";
import { searchVideosOnly } from "@/services/video/api";
import { deviceExtractionAvailable, webAnon } from "@/services/video/innertube";
import { bestImage, findAll, isObj, text, type Obj } from "./parse";
import { call, ytSession } from "./session";

export interface ShortItem {
  id: string;
  title?: string;
  views?: string;
  thumbnail?: string;
  author?: string;
  authorId?: string;
}

const SHORTS_TAB = "EgZzaG9ydHPyBgUKA5oBAA%3D%3D";
const SEEDLESS = "CA8%3D";
const SEEDED = "CAUwAg%3D%3D";

const ask = <T = Obj>(endpoint: string, body: Record<string, unknown>, signedIn: boolean): Promise<T> =>
  signedIn ? call<T>(endpoint, body) : webAnon<T>(endpoint, body);

/** Shorts listed anywhere in an answer (channel tab, shelves). */
export function readShorts(root: unknown): ShortItem[] {
  const out: ShortItem[] = [];
  const seen = new Set<string>();
  const add = (s: ShortItem) => {
    if (/^[\w-]{11}$/.test(s.id) && !seen.has(s.id)) {
      seen.add(s.id);
      out.push(s);
    }
  };
  for (const l of findAll(root, "shortsLockupViewModel")) {
    const id = findAll(l.onTap, "reelWatchEndpoint")[0]?.videoId ?? String(l.entityId ?? "").replace(/^shorts-shelf-item-/, "");
    const meta = isObj(l.overlayMetadata) ? l.overlayMetadata : {};
    add({ id: String(id), title: text(meta.primaryText) || undefined, views: text(meta.secondaryText) || undefined, thumbnail: bestImage(l.thumbnail) });
  }
  for (const r of findAll(root, "reelItemRenderer")) {
    if (typeof r.videoId === "string") add({ id: r.videoId, title: text(r.headline) || undefined, views: text(r.viewCountText) || undefined, thumbnail: bestImage(r.thumbnail) });
  }
  return out;
}

const idsIn = (root: unknown) =>
  findAll(root, "reelWatchEndpoint")
    .map((e) => e.videoId)
    .filter((v): v is string => typeof v === "string");

/** YouTube's own sequence: from `seed`, or the account's feed when no seed. */
class Sequence {
  private token: string | undefined;
  private started = false;
  constructor(
    private signedIn: boolean,
    private seed?: string,
  ) {}
  get done() {
    return this.started && !this.token;
  }
  async next(): Promise<ShortItem[]> {
    const first: ShortItem[] = [];
    if (!this.started) {
      this.started = true;
      const r = await ask(
        "reel/reel_item_watch",
        this.seed
          ? { playerRequest: { videoId: this.seed }, params: SEEDED, disablePlayerResponse: true }
          : { params: SEEDLESS, inputType: "REEL_WATCH_INPUT_TYPE_SEEDLESS", disablePlayerResponse: true },
        this.signedIn,
      );
      for (const id of idsIn((r as Obj).replacementEndpoint)) first.push({ id });
      const t = (r as Obj).sequenceContinuation;
      this.token = typeof t === "string" ? t : undefined;
      if (!this.token) return first;
    }
    if (!this.token) return first;
    const r = await ask<Obj>("reel/reel_watch_sequence", { sequenceParams: this.token }, this.signedIn);
    const tok = findAll(r.continuationEndpoint, "continuationCommand")[0]?.token ?? r.continuation;
    this.token = typeof tok === "string" && tok !== this.token ? tok : undefined;
    return [...first, ...idsIn(r.entries ?? r).map((id) => ({ id }))];
  }
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Channels to draw from when signed out: followed first, then watched. */
function channels(): { id: string; name: string }[] {
  const lib = videoLibrary.get();
  const out = new Map<string, string>();
  for (const c of lib.follows) out.set(c.id, c.name);
  for (const h of lib.history) if (h.authorId && !out.has(h.authorId)) out.set(h.authorId, h.author);
  return [...out].map(([id, name]) => ({ id, name }));
}

async function channelShorts(id: string, name: string): Promise<ShortItem[]> {
  const r = await webAnon("browse", { browseId: id, params: SHORTS_TAB });
  return readShorts(r).map((s) => ({ ...s, author: s.author || name, authorId: id }));
}

/** Website without the extension: short videos found by search. */
async function searchedShorts(name: string): Promise<ShortItem[]> {
  const list = await searchVideosOnly(`${name} #shorts`).catch(() => []);
  return list
    .filter((v) => v.duration > 0 && v.duration <= 180)
    .map((v) => ({ id: v.id, title: v.title, author: v.author, authorId: v.authorId, thumbnail: v.thumbnail, views: v.views !== undefined ? `${v.views}` : undefined }));
}

/** One endless Shorts source; `more()` returns the next batch ([] = the end). */
export class ShortsSource {
  private seen = new Set<string>();
  private seq: Sequence | null = null;
  private pool: { id: string; name: string }[] | null = null;
  private lastId: string | undefined;
  private failures = 0;
  readonly signedIn = !!ytSession();

  constructor(private start?: ShortItem[]) {}

  private keep(list: ShortItem[]): ShortItem[] {
    const fresh = list.filter((s) => !this.seen.has(s.id));
    fresh.forEach((s) => this.seen.add(s.id));
    if (fresh.length) this.lastId = fresh[fresh.length - 1].id;
    return fresh;
  }

  async more(): Promise<ShortItem[]> {
    if (this.start) {
      const s = this.keep(this.start);
      this.start = undefined;
      if (s.length) return s;
    }
    for (let tries = 0; tries < 4; tries++) {
      try {
        const got = this.keep(await this.batch());
        if (got.length) return got;
      } catch {
        if (++this.failures > 3) return [];
      }
    }
    return [];
  }

  private async batch(): Promise<ShortItem[]> {
    const online = this.signedIn || deviceExtractionAvailable();
    if (this.signedIn && !this.seq) this.seq = new Sequence(true);
    if (this.seq && !this.seq.done) {
      try {
        const got = await this.seq.next();
        if (got.length) return got;
      } catch (e) {
        if (!this.signedIn) throw e;
      }
      // the account's feed failed: fall back to the followed channels
      if (this.signedIn) this.seq = null;
    }
    // followed / watched channels, a few at a time
    this.pool ??= shuffle(channels().slice(0, 30));
    if (this.pool.length) {
      const pick = this.pool.splice(0, online ? 3 : 2);
      const lists = await Promise.all(pick.map((c) => (online ? channelShorts(c.id, c.name) : searchedShorts(c.name)).catch(() => [] as ShortItem[])));
      // interleave so one channel doesn't fill the screen
      const mixed: ShortItem[] = [];
      for (let i = 0; lists.some((l) => l[i]); i++) for (const l of lists) if (l[i]) mixed.push(l[i]);
      return mixed.slice(0, 18);
    }
    // after them: "more like this" from the last one (or YouTube's general feed)
    if (online) {
      this.seq = new Sequence(this.signedIn, this.lastId);
      return this.seq.next();
    }
    return searchedShorts("trending");
  }
}

/* ------------------------- where the viewer starts ------------------------ */

let startWith: { list: ShortItem[]; index: number } | null = null;

/** Opening Shorts from a row: start at `index` of `list`. */
export function openShortsAt(list: ShortItem[], index: number) {
  startWith = { list, index };
}

export function takeShortsStart(): { list: ShortItem[]; index: number } | null {
  const s = startWith;
  startWith = null;
  return s;
}
