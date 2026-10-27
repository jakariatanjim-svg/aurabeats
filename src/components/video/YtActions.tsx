/**
 * Video / channel buttons that act on the signed-in YouTube account, and fall
 * back to the on-device versions (Follow, Watch later) in guest mode.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bookmark, BookmarkCheck, Check, ListPlus, Lock, Plus, ThumbsUp } from "lucide-react";
import { Button, Modal, Spinner } from "@/components/ui";
import { cn } from "@/utils/cn";
import { formatCount } from "@/utils/format";
import { usePlayer } from "@/hooks/usePlayer";
import { useVideoLibrary, videoLibrary } from "@/hooks/useVideoLibrary";
import { dropYtLists } from "@/hooks/useYtPaged";
import type { VideoItem } from "@/services/video/types";
import { useYtSession } from "@/services/yt/session";
import {
  createPlaylist,
  isSubscribed,
  likedNow,
  loadLike,
  saveTargets,
  setInPlaylist,
  setLiked,
  setSubscribed,
  subscribeLikes,
  useYtSubscriptions,
  type SaveTarget,
} from "@/services/yt/library";

const errText = (e: unknown) => (e as Error)?.message || "Couldn't reach YouTube";

/** Follow (guest, on this device) or Subscribe (signed in). */
export function FollowButton({ ch, className }: { ch: { id: string; name: string; avatar?: string }; className?: string }) {
  const session = useYtSession();
  useVideoLibrary();
  const subs = useYtSubscriptions(!!session);
  const { toast } = usePlayer();
  const [busy, setBusy] = useState(false);

  if (!session) {
    const following = videoLibrary.isFollowing(ch.id);
    return (
      <Button variant={following ? "outline" : "solid"} className={className} onClick={() => videoLibrary.toggleFollow(ch)}>
        {following ? "Following" : "Follow"}
      </Button>
    );
  }
  const on = isSubscribed(ch.id);
  const toggle = async () => {
    setBusy(true);
    try {
      await setSubscribed(ch, !on);
      dropYtLists("subs-feed");
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant={on ? "outline" : "solid"} className={className} disabled={busy || (!subs.list && subs.loading)} onClick={() => void toggle()}>
      {busy && <Spinner className="h-3.5 w-3.5" />}
      {on ? "Subscribed" : "Subscribe"}
    </Button>
  );
}

/** Like button (signed in) or the plain like count (guest). */
export function LikeButton({ id, likes }: { id: string; likes?: number }) {
  const session = useYtSession();
  const liked = useSyncExternalStore(subscribeLikes, () => likedNow(id), () => likedNow(id));
  const { toast } = usePlayer();
  // the public count already includes your earlier like: only adjust for changes made here
  const first = useRef<{ id: string; liked: boolean } | null>(null);
  if (liked !== undefined && first.current?.id !== id) first.current = { id, liked };

  useEffect(() => {
    if (session) void loadLike(id).catch(() => undefined);
  }, [session, id]);

  if (!session) {
    if (likes === undefined) return null;
    return (
      <span className="glass-inset inline-flex items-center gap-1.5 rounded-full border border-line bg-ink/[0.03] px-3.5 py-2 text-xs font-semibold text-ink2">
        <ThumbsUp className="h-3.5 w-3.5" /> {formatCount(likes)}
      </span>
    );
  }
  const was = first.current?.id === id && first.current.liked;
  const shown = likes === undefined ? undefined : Math.max(0, likes + (liked ? 1 : 0) - (was ? 1 : 0));
  return (
    <Button
      variant="outline"
      aria-pressed={!!liked}
      className={cn("px-3.5 text-xs", liked && "border-accent/50 text-accent")}
      onClick={() => {
        void setLiked(id, !liked)
          .then(() => dropYtLists("liked"))
          .catch((e) => toast(errText(e), "error"));
      }}
    >
      <ThumbsUp className={cn("h-3.5 w-3.5", liked && "fill-current")} />
      {shown !== undefined ? formatCount(shown) : liked ? "Liked" : "Like"}
    </Button>
  );
}

/** Watch later (guest) or Save → Watch later / playlists (signed in). */
export function SaveButton({ v }: { v: VideoItem }) {
  const session = useYtSession();
  const lib = useVideoLibrary();
  const [open, setOpen] = useState(false);

  if (!session) {
    const saved = lib.later.some((x) => x.id === v.id);
    return (
      <Button variant="outline" className="px-3.5 text-xs" onClick={() => videoLibrary.toggleLater(v)}>
        {saved ? <BookmarkCheck className="h-3.5 w-3.5 text-accent" /> : <Bookmark className="h-3.5 w-3.5" />}
        {saved ? "Saved" : "Watch later"}
      </Button>
    );
  }
  return (
    <>
      <Button variant="outline" className="px-3.5 text-xs" onClick={() => setOpen(true)}>
        <ListPlus className="h-3.5 w-3.5" /> Save
      </Button>
      {open && <SaveSheet videoId={v.id} onClose={() => setOpen(false)} />}
    </>
  );
}

function SaveSheet({ videoId, onClose }: { videoId: string; onClose: () => void }) {
  const { toast } = usePlayer();
  const [targets, setTargets] = useState<SaveTarget[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    saveTargets(videoId).then(setTargets, (e) => setError(errText(e)));
  }, [videoId]);

  const toggle = async (t: SaveTarget) => {
    setBusy(t.id);
    try {
      await setInPlaylist(t.id, videoId, !t.saved);
      setTargets((all) => all?.map((x) => (x.id === t.id ? { ...x, saved: !t.saved } : x)) ?? null);
      dropYtLists(t.id === "WL" ? "later" : `pl:${t.id}`);
      dropYtLists("playlists");
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open onClose={onClose} title="Save to">
      {creating ? (
        <NewPlaylistForm
          videoIds={[videoId]}
          onDone={(ok) => {
            setCreating(false);
            if (ok) onClose();
          }}
        />
      ) : (
        <div className="space-y-3">
          {targets ? (
            <div className="max-h-[50vh] divide-y divide-line overflow-y-auto">
              {targets.map((t) => (
                <button key={t.id} type="button" disabled={busy === t.id} onClick={() => void toggle(t)} className="focus-ring flex w-full items-center gap-3 px-1 py-3 text-left">
                  <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-md border", t.saved ? "border-accent bg-accent text-white" : "border-line")}>
                    {busy === t.id ? <Spinner className="h-3.5 w-3.5 text-current" /> : t.saved && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{t.title}</span>
                  {t.private && <Lock className="h-3.5 w-3.5 shrink-0 text-ink3" aria-label="Private" />}
                </button>
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-rose-400">{error}</p>
          ) : (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          )}
          <Button variant="outline" className="w-full" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New playlist
          </Button>
        </div>
      )}
    </Modal>
  );
}

/** Name + privacy → creates a playlist on the account (optionally with videos). */
export function NewPlaylistForm({ videoIds = [], onDone }: { videoIds?: string[]; onDone: (ok: boolean) => void }) {
  const { toast } = usePlayer();
  const [title, setTitle] = useState("");
  const [privacy, setPrivacy] = useState<"PRIVATE" | "UNLISTED" | "PUBLIC">("PRIVATE");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const name = title.trim();
    if (!name) return;
    setBusy(true);
    try {
      await createPlaylist(name, videoIds, privacy);
      dropYtLists("playlists");
      toast(`Created “${name}”`, "success");
      onDone(true);
    } catch (e) {
      toast(errText(e), "error");
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        autoFocus
        value={title}
        maxLength={150}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Playlist name"
        className="focus-ring w-full rounded-xl border border-line bg-ink/[0.04] px-3.5 py-2.5 text-sm text-ink placeholder:text-ink3"
      />
      <div className="flex gap-2">
        {(["PRIVATE", "UNLISTED", "PUBLIC"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPrivacy(p)}
            className={cn("focus-ring flex-1 rounded-full border px-3 py-2 text-xs font-semibold", privacy === p ? "border-accent bg-accent/12 text-accent" : "border-line text-ink2")}
          >
            {p[0] + p.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onDone(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !title.trim()}>
          {busy && <Spinner className="h-4 w-4 text-current" />} Create
        </Button>
      </div>
    </form>
  );
}
