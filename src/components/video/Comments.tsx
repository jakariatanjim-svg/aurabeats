/**
 * Comments under a video: read (top / newest, replies), write and like when
 * signed in. Phones show a small card that opens a sheet (like the YouTube
 * app); wider screens list them under the description.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, MessageSquare, Send, ThumbsUp, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { usePlayer } from "@/hooks/usePlayer";
import { useYtSession } from "@/services/yt/session";
import { getComments, likeComment, postComment, type CommentsPage, type YtComment } from "@/services/yt/watch";
import { routeToPath } from "@/routes";
import { Avatar } from "./VideoCards";
import { Spinner } from "@/components/ui";
import { useBackHandler } from "@/utils/backStack";

interface Props {
  token?: string;
  count?: string;
  teaser?: { avatar?: string; text: string };
  /** phones: card + sheet */
  sheet: boolean;
}

export function Comments({ token, count, teaser, sheet }: Props) {
  const [open, setOpen] = useState(false);
  if (!token) return null;
  if (!sheet) return <CommentList token={token} count={count} />;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="blur-panel block w-full rounded-2xl p-3 text-left">
        <span className="flex items-center gap-2 text-sm font-bold text-ink">
          Comments <span className="font-medium text-ink3">{count}</span>
        </span>
        {teaser?.text && (
          <span className="mt-2 flex items-center gap-2">
            {teaser.avatar && <img src={teaser.avatar} alt="" className="h-6 w-6 shrink-0 rounded-full" />}
            <span className="line-clamp-2 text-xs text-ink2">{teaser.text}</span>
          </span>
        )}
      </button>
      <CommentsSheet token={token} count={count} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Comments in a sheet from the bottom (phones, Shorts). */
export function CommentsSheet({ token, count, open, onClose, side }: { token: string; count?: string; open: boolean; onClose: () => void; side?: boolean }) {
  useBackHandler(open, onClose);
  if (!open) return null;
  return createPortal(
    <>
      <div className={cn("fixed inset-0 z-[79]", side ? "bg-transparent" : "bg-black/40")} onClick={onClose} />
      <div
        className={cn(
          "fixed z-[80] flex flex-col border-line bg-bg shadow-2xl",
          side ? "top-20 right-6 bottom-6 w-[420px] rounded-3xl border" : "inset-x-0 bottom-0 h-[68dvh] rounded-t-3xl border-t",
        )}
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <span className="text-base font-black text-ink">
            Comments <span className="text-sm font-medium text-ink3">{count}</span>
          </span>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-2 text-ink2 hover:bg-ink/5">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+var(--sa-bottom))]">
          <CommentList token={token} bare />
        </div>
      </div>
    </>,
    document.body,
  );
}

function CommentList({ token, count, bare }: { token: string; count?: string; bare?: boolean }) {
  const session = useYtSession();
  const { toast } = usePlayer();
  const [first, setFirst] = useState(token);
  const [page, setPage] = useState<CommentsPage | null>(null);
  const [items, setItems] = useState<YtComment[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => setFirst(token), [token]);

  // first page (and again on sort change)
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setErr(null);
    setItems([]);
    getComments(first)
      .then((p) => {
        if (!alive) return;
        setPage((old) => ({ ...p, sorts: p.sorts?.length ? p.sorts : old?.sorts }));
        setItems(p.comments);
        setNext(p.next);
      })
      .catch((e) => alive && setErr((e as Error)?.message || "Couldn't load comments"))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [first]);

  const more = () => {
    if (!next || busy) return;
    setBusy(true);
    getComments(next)
      .then((p) => {
        setItems((cur) => {
          const ids = new Set(cur.map((c) => c.id));
          return [...cur, ...p.comments.filter((c) => !ids.has(c.id))];
        });
        setNext(p.next);
      })
      .catch((e) => setErr((e as Error)?.message || "Couldn't load comments"))
      .finally(() => setBusy(false));
  };
  const moreRef = useRef(more);
  moreRef.current = more;

  useEffect(() => {
    const el = end.current;
    if (!el || !next || busy) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && moreRef.current(), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [next, busy, items.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !page?.createParams || posting) return;
    setPosting(true);
    try {
      const c = await postComment(page.createParams, body);
      setItems((cur) => [c ?? { id: `local-${Date.now()}`, author: "You", text: body, published: "now", likes: "", liked: false, replyCount: 0 }, ...cur]);
      setDraft("");
    } catch (e) {
      toast((e as Error)?.message || "Couldn't post the comment", "error");
    } finally {
      setPosting(false);
    }
  };

  return (
    <section className={cn(!bare && "mt-6")}>
      {!bare && (
        <h2 className="mb-3 flex items-center gap-2 text-base font-black text-ink">
          <MessageSquare className="h-4 w-4" /> Comments <span className="text-sm font-medium text-ink3">{page?.count ?? count}</span>
        </h2>
      )}
      {!!page?.sorts?.length && (
        <div className="mb-3 flex gap-2">
          {page.sorts.map((s) => (
            <button
              key={s.title}
              type="button"
              onClick={() => s.token !== first && setFirst(s.token)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold",
                s.token === first || (first === token && s.selected) ? "bg-ink text-bg" : "bg-ink/[0.06] text-ink2 hover:bg-ink/10",
              )}
            >
              {s.title}
            </button>
          ))}
        </div>
      )}
      {session && page?.createParams && (
        <div className="mb-4 flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Add a comment…"
            className="max-h-32 min-h-10 flex-1 resize-none rounded-xl border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <button
            type="button"
            aria-label="Post comment"
            disabled={!draft.trim() || posting}
            onClick={() => void send()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:opacity-40"
          >
            {posting ? <Spinner /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      )}
      <div className="space-y-4">
        {items.map((c) => (
          <CommentRow key={c.id} c={c} canAct={!!session} />
        ))}
      </div>
      {err && !items.length && <p className="py-4 text-xs text-ink3">{err}</p>}
      {!busy && !err && !items.length && <p className="py-4 text-xs text-ink3">No comments.</p>}
      <div ref={end} className="flex justify-center py-4">
        {busy && <Spinner />}
      </div>
    </section>
  );
}

function CommentRow({ c, canAct, reply }: { c: YtComment; canAct: boolean; reply?: boolean }) {
  const { toast } = usePlayer();
  const [liked, setLiked] = useState(c.liked);
  const [long, setLong] = useState(false);
  const [replies, setReplies] = useState<YtComment[] | null>(null);
  const [repliesNext, setRepliesNext] = useState<string | undefined>(c.repliesToken);
  const [loadingReplies, setLoadingReplies] = useState(false);
  const [showReplies, setShowReplies] = useState(false);

  const toggleLike = () => {
    const action = liked ? c.unlikeAction : c.likeAction;
    if (!action) return;
    setLiked(!liked);
    likeComment(action).catch((e) => {
      setLiked(liked);
      toast((e as Error)?.message || "Couldn't like the comment", "error");
    });
  };

  const loadReplies = () => {
    if (showReplies && replies) return setShowReplies(false);
    setShowReplies(true);
    if (replies || !repliesNext) return;
    fetchReplies(repliesNext);
  };
  const fetchReplies = (tok: string) => {
    setLoadingReplies(true);
    getComments(tok)
      .then((p) => {
        setReplies((cur) => [...(cur ?? []), ...p.comments]);
        setRepliesNext(p.next);
      })
      .catch(() => setReplies((cur) => cur ?? []))
      .finally(() => setLoadingReplies(false));
  };

  // the public count already includes an earlier like: adjust plain numbers only
  const likeText = liked === c.liked ? c.likes : /^\d*$/.test(c.likes) ? String(Math.max(0, Number(c.likes || 0) + (liked ? 1 : -1)) || "") : c.likes;

  return (
    <div className="flex gap-3">
      <a href={c.authorId ? routeToPath(`channel:${c.authorId}`) : undefined} data-nav="true" className="shrink-0">
        <Avatar name={c.author} src={c.avatar} channelId={c.authorId} className={reply ? "h-6 w-6" : "h-9 w-9"} />
      </a>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-ink3">
          <span className={cn("font-bold", c.creator ? "rounded-full bg-ink/10 px-2 text-ink" : "text-ink2")}>{c.author}</span>
          <span>{c.published}</span>
        </p>
        <p className={cn("mt-0.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words text-ink", !long && "line-clamp-4")} onClick={() => setLong(true)}>
          {c.text}
        </p>
        <div className="mt-1 flex items-center gap-3 text-xs text-ink3">
          <button
            type="button"
            disabled={!canAct || !(liked ? c.unlikeAction : c.likeAction)}
            onClick={toggleLike}
            aria-pressed={liked}
            className={cn("flex items-center gap-1 rounded-full py-1 pr-1 disabled:cursor-default", liked && "text-accent")}
          >
            <ThumbsUp className={cn("h-3.5 w-3.5", liked && "fill-current")} /> {likeText}
          </button>
        </div>
        {!reply && c.replyCount > 0 && (
          <button type="button" onClick={loadReplies} className="mt-1 flex items-center gap-1 text-xs font-bold text-accent">
            <ChevronDown className={cn("h-3.5 w-3.5 transition", showReplies && "rotate-180")} />
            {c.replyCount} {c.replyCount === 1 ? "reply" : "replies"}
          </button>
        )}
        {showReplies && (
          <div className="mt-3 space-y-3">
            {replies?.map((r) => <CommentRow key={r.id} c={r} canAct={canAct} reply />)}
            {loadingReplies && <Spinner />}
            {!loadingReplies && repliesNext && replies && (
              <button type="button" onClick={() => fetchReplies(repliesNext)} className="text-xs font-bold text-accent">
                Show more replies
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
