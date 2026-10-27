/**
 * YouTube accounts (Android app): sign in with youtube.com's own Google page,
 * keep several accounts, switch between them and between an account's
 * channels (Brand accounts).
 *
 * Only names / pictures live here (localStorage "ytacct:*"). The sign-in
 * itself stays inside the app, encrypted (native YtLogin plugin).
 */
import { useSyncExternalStore } from "react";
import { storage } from "@/utils/storage";
import { isNative } from "@/services/video/net";
import { lsKeys, NS } from "@/utils/backup";
import { isWebAccount, onTransportChange, YtLogin, ytCall, ytTransportReady } from "./transport";

export interface YtChannelId {
  /** set for Brand-account channels (sent as X-Goog-PageId) */
  pageId?: string;
  name: string;
  handle?: string;
  photo?: string;
  channelId?: string;
}

export interface YtAccount {
  id: string;
  name: string;
  email?: string;
  handle?: string;
  photo?: string;
  channelId?: string;
  channels: YtChannelId[];
  /** the channel in use ("" = the account's own) */
  pageId: string;
  /** the session ended (signed out elsewhere / expired) */
  needsSignIn?: boolean;
  addedAt: number;
}

interface State {
  accounts: YtAccount[];
  active: string | null;
  busy: boolean;
}

const K_LIST = "ytacct:list";
const K_ACTIVE = "ytacct:active";

let state: State = {
  accounts: storage.get<YtAccount[]>(K_LIST, []),
  active: storage.get<string | null>(K_ACTIVE, null),
  busy: false,
};
const subs = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  if (state.active && !state.accounts.some((a) => a.id === state.active)) state.active = state.accounts[0]?.id ?? null;
  storage.set(K_LIST, state.accounts);
  storage.set(K_ACTIVE, state.active);
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
const getState = () => state;

export function useYtAccounts(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}

export const ytAccounts = {
  get: getState,
  subscribe,
  /** the account in use, if any */
  active(): YtAccount | null {
    return state.accounts.find((a) => a.id === state.active) ?? null;
  },
};

/** Sign-in works in the Android app (the website gets it with the extension later). */
export const ytAccountsSupported = () => ytTransportReady();

/** The old TV sign-in left "account:*" keys behind: remove them once. */
export function dropOldAccountData() {
  for (const full of lsKeys()) if (full.startsWith(`${NS}account:`)) localStorage.removeItem(full);
}

/* ------------------------- reading accounts_list ------------------------- */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;

function text(t: unknown): string {
  if (!isObj(t)) return typeof t === "string" ? t : "";
  if (typeof t.simpleText === "string") return t.simpleText;
  if (Array.isArray(t.runs)) return t.runs.map((r) => (isObj(r) && typeof r.text === "string" ? r.text : "")).join("");
  return "";
}

/** Every object stored under `key`, anywhere in the tree. */
export function findAll(root: unknown, key: string): Obj[] {
  const out: Obj[] = [];
  const stack: unknown[] = [root];
  while (stack.length) {
    const v = stack.pop();
    if (Array.isArray(v)) for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]);
    else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (k === key && isObj(x)) out.push(x);
        stack.push(x);
      }
    }
  }
  return out;
}

const photoOf = (t: unknown): string | undefined => {
  const list = isObj(t) && Array.isArray(t.thumbnails) ? (t.thumbnails as Obj[]) : [];
  const url = list.length && typeof list[list.length - 1].url === "string" ? (list[list.length - 1].url as string) : undefined;
  return url?.startsWith("//") ? `https:${url}` : url;
};

/** Signed out? YouTube says so in its tracking params. */
function loggedOut(r: unknown): boolean {
  const ctx = JSON.stringify(isObj(r) ? (r.responseContext ?? {}) : {});
  return /"key":"logged_in","value":"0"/.test(ctx);
}

interface Profile {
  name: string;
  email?: string;
  channels: (YtChannelId & { selected: boolean })[];
}

function parseAccounts(r: unknown): Profile | null {
  const header = findAll(r, "googleAccountHeaderRenderer")[0];
  const channels = findAll(r, "accountItem").map((it) => {
    const tokens = findAll(it.serviceEndpoint, "supportedTokens")[0] ?? it.serviceEndpoint;
    const page = findAll(tokens, "pageIdToken")[0];
    const cache = findAll(tokens, "offlineCacheKeyToken")[0];
    const key = cache && typeof cache.clientCacheKey === "string" ? cache.clientCacheKey : "";
    return {
      pageId: page && typeof page.pageId === "string" ? page.pageId : undefined,
      name: text(it.accountName) || "Channel",
      handle: text(it.channelHandle) || undefined,
      photo: photoOf(it.accountPhoto),
      channelId: key ? (key.startsWith("UC") ? key : `UC${key}`) : undefined,
      selected: it.isSelected === true,
    };
  });
  if (!channels.length && !header) return null;
  return { name: text(header?.name) || channels[0]?.name || "YouTube account", email: text(header?.email) || undefined, channels };
}

async function readProfile(id: string, pageId?: string): Promise<Profile | "signed-out"> {
  const r = await ytCall(id, "account/accounts_list", {}, pageId || undefined);
  if (loggedOut(r)) return "signed-out";
  return parseAccounts(r) ?? "signed-out";
}

function upsert(acc: YtAccount) {
  const list = state.accounts.some((a) => a.id === acc.id) ? state.accounts.map((a) => (a.id === acc.id ? acc : a)) : [...state.accounts, acc];
  set({ accounts: list });
}

function fromProfile(id: string, p: Profile, prev?: YtAccount): YtAccount {
  const own = p.channels.find((c) => !c.pageId) ?? p.channels[0];
  const pageId = prev?.pageId ?? "";
  const inUse = p.channels.find((c) => (c.pageId ?? "") === pageId) ?? own;
  return {
    id,
    name: p.name,
    email: p.email,
    handle: inUse?.handle,
    photo: inUse?.photo ?? own?.photo,
    channelId: inUse?.channelId,
    channels: p.channels.map(({ selected: _s, ...c }) => c),
    pageId: inUse?.pageId ?? "",
    needsSignIn: false,
    addedAt: prev?.addedAt ?? Date.now(),
  };
}

/* -------------------------------- actions -------------------------------- */

/** Opens Google's sign-in; resolves with the new (or re-signed) account, null if cancelled. */
export async function addAccount(): Promise<YtAccount | null> {
  if (!ytAccountsSupported()) throw new Error("YouTube sign-in works in the Android app (or the website with the AuraBeats extension)");
  if (!isNative) return addWebAccount();
  let id: string;
  try {
    id = (await YtLogin.signIn()).account;
  } catch (e) {
    if (String((e as Error)?.message ?? e).includes("cancelled")) return null;
    throw e;
  }
  set({ busy: true });
  try {
    const p = await readProfile(id);
    if (p === "signed-out") {
      await YtLogin.remove({ account: id }).catch(() => undefined);
      throw new Error("Sign-in didn't finish. Please try again.");
    }
    // the same Google account signed in again: replace the old session
    const same = state.accounts.find((a) => (p.email && a.email === p.email) || (!p.email && a.name === p.name));
    if (same) {
      await YtLogin.remove({ account: same.id }).catch(() => undefined);
      set({ accounts: state.accounts.filter((a) => a.id !== same.id) });
    }
    const acc = fromProfile(id, p, same ? { ...same, id } : undefined);
    upsert(acc);
    set({ active: id });
    return acc;
  } finally {
    set({ busy: false });
  }
}

/** Re-reads names / pictures / channels; marks ended sessions. */
export async function refreshAccount(id: string): Promise<void> {
  const prev = state.accounts.find((a) => a.id === id);
  if (!prev) return;
  try {
    const p = await readProfile(id, prev.pageId);
    if (p === "signed-out") upsert({ ...prev, needsSignIn: true });
    // website: browser sign-ins are numbered, the number can move to another account
    else if (isWebAccount(id) && prev.email && p.email && p.email !== prev.email) upsert({ ...prev, needsSignIn: true });
    else upsert(fromProfile(id, p, prev));
  } catch (e) {
    if (/not signed in/i.test(String((e as Error)?.message))) upsert({ ...prev, needsSignIn: true });
    else throw e;
  }
}

export function switchAccount(id: string) {
  if (state.accounts.some((a) => a.id === id)) set({ active: id });
}

/** Use another channel of the same Google account ("" = its own). */
export function switchChannel(id: string, pageId: string) {
  const acc = state.accounts.find((a) => a.id === id);
  const ch = acc?.channels.find((c) => (c.pageId ?? "") === pageId);
  if (!acc || !ch) return;
  upsert({ ...acc, pageId, handle: ch.handle, photo: ch.photo ?? acc.photo, channelId: ch.channelId });
}

/** Hide now (Undo possible); `forget` deletes the sign-in for good. */
export function hideAccount(id: string): { restore: () => void; forget: () => Promise<void> } {
  const before = state;
  set({ accounts: state.accounts.filter((a) => a.id !== id) });
  return {
    restore: () => set({ accounts: before.accounts, active: before.active }),
    forget: async () => {
      if (!isWebAccount(id)) await YtLogin.remove({ account: id }).catch(() => undefined);
    },
  };
}

/** Check every account once per app start (sessions can end elsewhere). */
let checked = false;
export function checkAccountsOnce() {
  if (checked || !ytAccountsSupported()) return;
  checked = true;
  for (const a of state.accounts) void refreshAccount(a.id).catch(() => undefined);
}

/* ---------------------------- website accounts ---------------------------- */

const GOOGLE_SIGN_IN = "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F";
const GOOGLE_ADD = "https://accounts.google.com/AddSession?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F";

/**
 * Website: accounts are the Google accounts signed in to YouTube in this
 * browser ("web:0", "web:1", …). Adds the next one not added yet; when there
 * is none, opens Google's sign-in in a new tab.
 */
async function addWebAccount(): Promise<YtAccount | null> {
  set({ busy: true });
  try {
    const known = new Set(state.accounts.filter((a) => isWebAccount(a.id)).map((a) => a.email || a.name));
    for (let i = 0; i < 10; i++) {
      const id = `web:${i}`;
      const p = await readProfile(id);
      if (p === "signed-out") {
        window.open(i === 0 ? GOOGLE_SIGN_IN : GOOGLE_ADD, "_blank", "noopener");
        throw new Error(i === 0 ? "Sign in to YouTube in the new tab, then tap Connect again" : "Sign in with another account in the new tab, then tap Add account again");
      }
      const key = p.email || p.name;
      if (known.has(key)) {
        // re-connect an account that had signed out
        const old = state.accounts.find((a) => isWebAccount(a.id) && (a.email || a.name) === key);
        if (old?.needsSignIn) {
          const acc = fromProfile(id, p, { ...old, id });
          set({ accounts: state.accounts.filter((a) => a.id !== old.id) });
          upsert(acc);
          set({ active: id });
          return acc;
        }
        continue;
      }
      const acc = fromProfile(id, p, state.accounts.find((a) => a.id === id));
      upsert(acc);
      set({ active: id });
      return acc;
    }
    return null;
  } finally {
    set({ busy: false });
  }
}

// Website: the extension connects a moment after the page loads.
onTransportChange(() => {
  set({});
  checkAccountsOnce();
});
