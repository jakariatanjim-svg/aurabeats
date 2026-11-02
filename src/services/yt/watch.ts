/**
 * The watch page's extras from YouTube's own `next` answer: the full
 * description, likes, channel line, related videos and comments (read,
 * write, like). Signed in → the account's session (likes and posting work);
 * otherwise an anonymous request from the phone / through the extension.
 */
import type { VideoItem } from "@/services/video/types";
import { deviceExtractionAvailable, webAnon } from "@/services/video/innertube";
import { bestImage, findAll, isObj, parseCount, readPage, text, type Obj } from "./parse";
import { call, ytSession } from "./session";

export const watchExtrasAvailable = () => !!ytSession() || deviceExtractionAvailable();

function next<T = unknown>(body: Record<string, unknown>): Promise<T> {
  return ytSession() ? call<T>("next", body) : webAnon<T>("next", body);
}

export interface WatchExtras {
  title?: string;
  author?: string;
  authorId?: string;
  description?: string;
  viewsText?: string;
  dateText?: string;
  likes?: number;
  subscribers?: string;
  authorAvatar?: string;
  commentCount?: string;
  commentsToken?: string;
  /** first comment for the collapsed comments card (phones) */
  teaser?: { avatar?: string; text: string };
  related: VideoItem[];
}

const cache = new Map<string, Promise<WatchExtras>>();

export function getWatchExtras(id: string): Promise<WatchExtras> {
  const key = `${ytSession()?.key ?? "anon"}|${id}`;
  let p = cache.get(key);
  if (!p) {
    p = next<Obj>({ videoId: id }).then(readWatch);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    if (cache.size > 30) cache.delete(cache.keys().next().value!);
  }
  return p;
}

function readWatch(r: Obj): WatchExtras {
  const results = findAll(r, "twoColumnWatchNextResults")[0] ?? r;
  const primary = findAll(results, "videoPrimaryInfoRenderer")[0] ?? {};
  const secondary = findAll(results, "videoSecondaryInfoRenderer")[0] ?? {};
  const owner = findAll(secondary, "videoOwnerRenderer")[0] ?? {};
  const panels = (r.engagementPanels ?? []) as unknown[];

  let description = text(secondary.attributedDescription) || text(secondary.description);
  if (!description) {
    const body = findAll(panels, "expandableVideoDescriptionBodyRenderer")[0];
    description = text(body?.attributedDescriptionBodyText) || text(body?.descriptionBodyText);
  }

  const viewsBox = findAll(primary, "videoViewCountRenderer")[0];
  const likeBtn = findAll(primary, "likeButtonViewModel")[0];
  const likeTitle = likeBtn ? String(findAll(likeBtn, "buttonViewModel")[0]?.title ?? "") : "";

  // comments: the watch page section, else the comments panel
  const section = findAll(results, "itemSectionRenderer").find((s) => s.sectionIdentifier === "comment-item-section");
  const panel = panels.find((p) => isObj(p) && findAll(p, "engagementPanelSectionListRenderer").some((e) => e.panelIdentifier === "engagement-panel-comments-section"));
  const token = (findAll(section, "continuationCommand")[0]?.token ?? findAll(panel, "continuationCommand")[0]?.token) as string | undefined;
  const header = findAll(panel, "engagementPanelTitleHeaderRenderer")[0];
  const entry = findAll(results, "commentsEntryPointHeaderRenderer")[0];
  const teaserBox = findAll(entry, "commentsEntryPointTeaserRenderer")[0];

  const secondaryResults = findAll(r, "secondaryResults")[0];
  return {
    title: text(primary.title) || undefined,
    author: text(owner.title) || undefined,
    authorId: (findAll(owner.navigationEndpoint, "browseEndpoint")[0]?.browseId as string | undefined) || undefined,
    description: description || undefined,
    viewsText: text(viewsBox?.viewCount) || undefined,
    dateText: text(primary.dateText) || undefined,
    likes: likeTitle && /\d/.test(likeTitle) ? parseCount(likeTitle) : undefined,
    subscribers: text(owner.subscriberCountText) || undefined,
    authorAvatar: bestImage(owner.thumbnail),
    commentCount: text(header?.contextualInfo) || text(entry?.commentCount) || undefined,
    commentsToken: typeof token === "string" ? token : undefined,
    teaser: teaserBox ? { avatar: bestImage(teaserBox.teaserAvatar), text: text(teaserBox.teaserContent) } : undefined,
    related: secondaryResults ? readPage(secondaryResults).videos : [],
  };
}

/* -------------------------------- comments -------------------------------- */

export interface YtComment {
  id: string;
  author: string;
  authorId?: string;
  avatar?: string;
  text: string;
  published: string;
  likes: string;
  liked: boolean;
  creator?: boolean;
  replyCount: number;
  repliesToken?: string;
  likeAction?: string;
  unlikeAction?: string;
}

export interface CommentsPage {
  comments: YtComment[];
  next?: string;
  count?: string;
  /** signed in: params for posting a new comment */
  createParams?: string;
  sorts?: { title: string; token: string; selected: boolean }[];
}

const actionIn = (root: unknown) => {
  const a = findAll(root, "performCommentActionEndpoint")[0]?.action;
  return typeof a === "string" ? a : undefined;
};

/** Reads one comments answer (first page, more, replies, or a posted comment). */
export function readComments(r: unknown): CommentsPage {
  const out: CommentsPage = { comments: [] };
  // newer answers keep the comment data apart, keyed by entity
  const entities = new Map<string, Obj>();
  for (const m of findAll(r, "entityBatchUpdate").flatMap((b) => (Array.isArray(b.mutations) ? b.mutations : []))) {
    if (isObj(m) && typeof m.entityKey === "string" && isObj(m.payload)) {
      const p = Object.values(m.payload)[0];
      if (isObj(p)) entities.set(m.entityKey, p);
    }
  }

  const fromViewModel = (vm: Obj, replies?: Obj): YtComment | null => {
    const c = entities.get(String(vm.commentKey ?? ""));
    if (!c) return null;
    const props = isObj(c.properties) ? c.properties : {};
    const author = isObj(c.author) ? c.author : {};
    const bar = isObj(c.toolbar) ? c.toolbar : {};
    const state = entities.get(String(vm.toolbarStateKey ?? props.toolbarStateKey ?? ""));
    const surface = entities.get(String(vm.toolbarSurfaceKey ?? ""));
    const liked = state?.likeState === "TOOLBAR_LIKE_STATE_LIKED";
    return {
      id: String(props.commentId ?? vm.commentId ?? vm.commentKey),
      author: String(author.displayName ?? ""),
      authorId: typeof author.channelId === "string" ? author.channelId : undefined,
      avatar: typeof author.avatarThumbnailUrl === "string" ? author.avatarThumbnailUrl : bestImage(c.avatar),
      text: text(props.content),
      published: String(props.publishedTime ?? ""),
      likes: String((liked ? bar.likeCountLiked : bar.likeCountNotliked) ?? "").trim(),
      liked,
      creator: author.isCreator === true,
      replyCount: Number(String(bar.replyCount ?? "0").replace(/\D/g, "")) || 0,
      repliesToken: replies ? (findAll(replies, "continuationCommand")[0]?.token as string | undefined) : undefined,
      likeAction: actionIn(surface?.likeCommand),
      unlikeAction: actionIn(surface?.unlikeCommand),
    };
  };

  const fromRenderer = (c: Obj, replies?: Obj): YtComment | null => {
    if (typeof c.commentId !== "string") return null;
    const btn = findAll(c.actionButtons, "toggleButtonRenderer")[0];
    const liked = c.isLiked === true;
    return {
      id: c.commentId,
      author: text(c.authorText),
      authorId: findAll(c.authorEndpoint, "browseEndpoint")[0]?.browseId as string | undefined,
      avatar: bestImage(c.authorThumbnail),
      text: text(c.contentText),
      published: text(c.publishedTimeText),
      likes: text(c.voteCount),
      liked,
      creator: !!c.authorIsChannelOwner,
      replyCount: Number(c.replyCount) || 0,
      repliesToken: replies ? (findAll(replies, "continuationCommand")[0]?.token as string | undefined) : undefined,
      likeAction: actionIn(btn?.defaultServiceEndpoint),
      unlikeAction: actionIn(btn?.toggledServiceEndpoint),
    };
  };

  const take = (item: unknown) => {
    if (!isObj(item)) return;
    const [k, v] = Object.entries(item)[0] ?? [];
    if (!isObj(v)) return;
    if (k === "commentThreadRenderer") {
      const replies = isObj(v.replies) ? v.replies : undefined;
      const vm = findAll(v.commentViewModel, "commentViewModel")[0] ?? (isObj(v.commentViewModel) ? v.commentViewModel : undefined);
      const c = vm ? fromViewModel(vm, replies) : findAll(v.comment, "commentRenderer")[0] ? fromRenderer(findAll(v.comment, "commentRenderer")[0], replies) : null;
      if (c) out.comments.push(c);
    } else if (k === "commentViewModel") {
      const c = fromViewModel(v);
      if (c) out.comments.push(c);
    } else if (k === "commentRenderer") {
      const c = fromRenderer(v);
      if (c) out.comments.push(c);
    } else if (k === "commentsHeaderRenderer") {
      out.count = text(v.countText) || text(v.commentsCount) || undefined;
      const params = findAll(v.createRenderer, "createCommentEndpoint")[0]?.createCommentParams;
      if (typeof params === "string") out.createParams = params;
      const subs = findAll(v.sortMenu, "sortFilterSubMenuRenderer")[0]?.subMenuItems;
      if (Array.isArray(subs)) {
        out.sorts = subs.flatMap((s) => {
          const tok = isObj(s) ? findAll(s.serviceEndpoint, "continuationCommand")[0]?.token : undefined;
          return isObj(s) && typeof tok === "string" ? [{ title: text(s.title), token: tok, selected: s.selected === true }] : [];
        });
      }
    } else if (k === "continuationItemRenderer") {
      const tok = findAll(v, "continuationCommand")[0]?.token;
      if (typeof tok === "string") out.next = tok;
    }
  };

  const lists = [
    ...findAll(r, "reloadContinuationItemsCommand"),
    ...findAll(r, "appendContinuationItemsAction"),
  ].flatMap((a) => (Array.isArray(a.continuationItems) ? a.continuationItems : []));
  if (lists.length) lists.forEach(take);
  else {
    // a posted comment comes back as a single thread
    for (const t of findAll(r, "commentThreadRenderer")) take({ commentThreadRenderer: t });
    if (!out.comments.length) for (const vm of findAll(r, "commentViewModel")) if (vm.commentKey) take({ commentViewModel: vm });
  }
  return out;
}

export async function getComments(token: string): Promise<CommentsPage> {
  return readComments(await next({ continuation: token }));
}

/** Posts a comment (signed in); returns it when YouTube sends it back. */
export async function postComment(createParams: string, body: string): Promise<YtComment | null> {
  const r = await call("comment/create_comment", { createCommentParams: createParams, commentText: body });
  return readComments(r).comments[0] ?? null;
}

export async function likeComment(action: string): Promise<void> {
  await call("comment/perform_comment_action", { actions: [action] });
}
