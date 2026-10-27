/**
 * Signed-in YouTube calls (youtube.com's own API, "InnerTube", WEB client).
 *
 * The session never lives in JS. The Android app's YtLogin plugin keeps it
 * (encrypted) and adds it to each call. The website will use the browser
 * extension the same way (step 4), so callers only see ytCall().
 */
import { registerPlugin } from "@capacitor/core";
import { isNative } from "@/services/video/net";

interface YtLoginNative {
  signIn(): Promise<{ account: string }>;
  list(): Promise<{ accounts: string[] }>;
  remove(o: { account: string }): Promise<void>;
  request(o: { account: string; url: string; method: string; body?: string; headers?: Record<string, string>; pageId?: string }): Promise<{ status: number; body: string }>;
}

export const YtLogin = registerPlugin<YtLoginNative>("YtLogin");

/** Where signed-in calls can run right now. */
export const ytTransportReady = () => isNative;

export const WEB_CLIENT = { clientName: "WEB", clientVersion: "2.20261020.01.00", hl: "en", gl: "US" };

export class YtCallError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

export const MUSIC_CLIENT = { clientName: "WEB_REMIX", clientVersion: "1.20261020.01.00", hl: "en", gl: "US" };

async function post<T>(
  host: string,
  client: typeof WEB_CLIENT,
  clientId: string,
  account: string,
  endpoint: string,
  body: Record<string, unknown>,
  pageId?: string,
  query = "",
): Promise<T> {
  if (!ytTransportReady()) throw new YtCallError("YouTube sign-in isn't available here yet");
  const res = await YtLogin.request({
    account,
    url: `https://${host}/youtubei/v1/${endpoint}?prettyPrint=false${query}`,
    method: "POST",
    body: JSON.stringify({ context: { client }, ...body }),
    headers: { "X-Youtube-Client-Name": clientId, "X-Youtube-Client-Version": client.clientVersion },
    pageId,
  });
  let data: unknown;
  try {
    data = JSON.parse(res.body || "{}");
  } catch {
    throw new YtCallError(`YouTube answered ${res.status}`, res.status);
  }
  if (res.status >= 400) {
    const msg = (data as { error?: { message?: string } })?.error?.message;
    throw new YtCallError(msg || `YouTube answered ${res.status}`, res.status);
  }
  return data as T;
}

/** POST youtubei/v1/<endpoint> for an account (and channel). Returns the parsed JSON. */
export function ytCall<T = unknown>(account: string, endpoint: string, body: Record<string, unknown> = {}, pageId?: string): Promise<T> {
  return post<T>("www.youtube.com", WEB_CLIENT, "1", account, endpoint, body, pageId);
}

/** Same on music.youtube.com (YouTube Music's WEB_REMIX client). `query` = extra URL params. */
export function ytMusicCall<T = unknown>(account: string, endpoint: string, body: Record<string, unknown> = {}, pageId?: string, query = ""): Promise<T> {
  return post<T>("music.youtube.com", MUSIC_CLIENT, "67", account, endpoint, body, pageId, query);
}

/** Plain signed-in GET (e.g. the "add to watch history" ping). Returns the status. */
export async function ytPing(account: string, url: string, pageId?: string): Promise<number> {
  if (!ytTransportReady()) throw new YtCallError("YouTube sign-in isn't available here yet");
  const res = await YtLogin.request({ account, url, method: "GET", pageId });
  return res.status;
}
