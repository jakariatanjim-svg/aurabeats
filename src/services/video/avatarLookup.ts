/**
 * Channel pictures for lists that carry none (search results from some
 * servers, the followed-channels feed): looked up once per channel, two at a
 * time, and remembered on this device — so cards show the real picture
 * instead of initials.
 */
import { getChannel } from "./api";
import { avatarFor, rememberAvatar } from "@/utils/img";

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
    p = slot(() => getChannel(channelId))
      .then((c) => {
        if (c.avatar) rememberAvatar(channelId, c.avatar);
        else failed.add(channelId);
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
