/**
 * Channel pictures for lists that carry none (search results from some
 * servers, the followed-channels feed): looked up once per channel, two at a
 * time, and remembered on this device — so cards show the real picture
 * instead of initials.
 *
 * Order: the open servers first (no extension needed); only when they don't
 * give a picture, the channel's own YouTube page through the AuraBeats
 * extension, if it is installed.
 */
import { getChannel } from "./api";
import { avatarFor, rememberAvatar } from "@/utils/img";
import { extensionCanStream, extensionRequest } from "@/services/yt/extension";

/** The picture YouTube puts on the channel page (og:image = the avatar). */
async function viaExtension(channelId: string): Promise<string | undefined> {
  if (!extensionCanStream()) return undefined;
  const r = await extensionRequest({ url: `https://www.youtube.com/channel/${channelId}`, method: "GET", anon: true });
  if (r.status < 200 || r.status >= 300) return undefined;
  const m =
    r.body.match(/<meta property="og:image" content="([^"]+)"/) ??
    r.body.match(/"avatar":\{"thumbnails":\[\{"url":"([^"]+)"/);
  const url = m?.[1].replace(/&amp;/g, "&");
  return url && /^https:\/\/yt3\.(ggpht|googleusercontent)\.com\//.test(url) ? url : undefined;
}

async function find(channelId: string): Promise<string | undefined> {
  const open = await getChannel(channelId).then((c) => c.avatar, () => undefined);
  return open || (await viaExtension(channelId).catch(() => undefined));
}

const pending = new Map<string, Promise<string | undefined>>();
const failed = new Set<string>();
const queue: (() => void)[] = [];
let running = 0;

function slot<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      running++;
      job()
        .then(resolve, reject)
        .finally(() => {
          running--;
          queue.shift()?.();
        });
    };
    if (running < 2) run();
    else queue.push(run);
  });
}

export function lookupAvatar(channelId: string): Promise<string | undefined> {
  const known = avatarFor(channelId);
  if (known) return Promise.resolve(known);
  if (failed.has(channelId) || !/^UC[\w-]{22}$/.test(channelId)) return Promise.resolve(undefined);
  let p = pending.get(channelId);
  if (!p) {
    p = slot(() => find(channelId))
      .then((avatar) => {
        if (avatar) rememberAvatar(channelId, avatar);
        // the extension may connect a moment later: try again then
        else if (extensionCanStream()) failed.add(channelId);
        else pending.delete(channelId);
        return avatarFor(channelId);
      })
      .catch(() => {
        failed.add(channelId);
        return undefined;
      });
    pending.set(channelId, p);
  }
  return p;
}
