/**
 * Local-only video library: followed channels, watch history (with resume
 * position) and Watch later. Nothing leaves the device; no account needed.
 */
import { useSyncExternalStore } from "react";
import { storage } from "@/utils/storage";
import type { VideoItem } from "@/services/video/types";
import { undoable } from "@/components/UndoToast";

export interface FollowedChannel {
  id: string;
  name: string;
  avatar?: string;
  addedAt: number;
}

export interface HistoryEntry extends VideoItem {
  watchedAt: number;
  /** seconds */
  position: number;
}

interface State {
  follows: FollowedChannel[];
  history: HistoryEntry[];
  later: VideoItem[];
}

const K = { follows: "video:follows", history: "video:history", later: "video:later" } as const;
const MAX_HISTORY = 300;

let state: State = {
  follows: storage.get<FollowedChannel[]>(K.follows, []),
  history: storage.get<HistoryEntry[]>(K.history, []),
  later: storage.get<VideoItem[]>(K.later, []),
};
const listeners = new Set<() => void>();

function commit(next: Partial<State>, persist = true) {
  state = { ...state, ...next };
  if (persist) {
    if (next.follows) storage.set(K.follows, state.follows);
    if (next.history) storage.set(K.history, state.history);
    if (next.later) storage.set(K.later, state.later);
  }
  listeners.forEach((l) => l());
}

/** Strip transient fields before storing a video. */
const slim = (v: VideoItem): VideoItem => ({
  id: v.id,
  title: v.title,
  author: v.author,
  authorId: v.authorId,
  authorAvatar: v.authorAvatar,
  duration: v.duration,
  views: v.views,
  published: v.published,
  live: v.live,
  thumbnail: v.thumbnail,
});

export const videoLibrary = {
  get: () => state,
  isFollowing: (id?: string) => !!id && state.follows.some((c) => c.id === id),
  toggleFollow(ch: { id: string; name: string; avatar?: string }) {
    if (videoLibrary.isFollowing(ch.id)) commit({ follows: state.follows.filter((c) => c.id !== ch.id) });
    else commit({ follows: [{ ...ch, addedAt: Date.now() }, ...state.follows] });
  },
  /** Record progress; called every few seconds while watching. */
  recordProgress(v: VideoItem, position: number) {
    const rest = state.history.filter((h) => h.id !== v.id);
    commit({ history: [{ ...slim(v), watchedAt: Date.now(), position: Math.floor(position) }, ...rest].slice(0, MAX_HISTORY) });
  },
  positionOf: (id: string) => state.history.find((h) => h.id === id)?.position ?? 0,
  removeHistory: (id: string) => commit({ history: state.history.filter((h) => h.id !== id) }),
  clearHistory: () => {
    const snap = state.history;
    commit({ history: [] });
    if (snap.length) undoable({ message: "Watch history cleared", undo: () => commit({ history: snap }) });
  },
  inLater: (id: string) => state.later.some((v) => v.id === id),
  toggleLater(v: VideoItem) {
    if (videoLibrary.inLater(v.id)) commit({ later: state.later.filter((x) => x.id !== v.id) });
    else commit({ later: [slim(v), ...state.later] });
  },
};

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useVideoLibrary(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
