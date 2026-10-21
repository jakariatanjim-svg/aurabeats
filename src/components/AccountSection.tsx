/**
 * Settings → YouTube account. App: sign in with Google (TV-style code) or
 * stay a guest. Website: guest mode only (see services/ytAccount.ts).
 */
import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, LogOut, RefreshCw, UserRound, CircleUserRound } from "lucide-react";
import { Button, Modal, SectionHeader, Spinner } from "@/components/ui";
import { cn } from "@/utils/cn";
import { APP_DOWNLOAD_URL } from "@/components/video/AdBlockTip";
import { usePlayer } from "@/hooks/usePlayer";
import {
  accountSupported,
  signOut,
  startSignIn,
  syncAccount,
  useYtAccount,
  waitForApproval,
  type DeviceCode,
} from "@/services/ytAccount";

/** Google's multicolour "G" (brand mark for the sign-in button). */
export function GoogleG({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function SignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = usePlayer();
  const [dc, setDc] = useState<DeviceCode | null>(null);
  const [phase, setPhase] = useState<"loading" | "code" | "done" | "error">("loading");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [left, setLeft] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const run = useRef(0);

  useEffect(() => {
    if (!open) return;
    const my = ++run.current;
    const ctrl = new AbortController();
    setPhase("loading");
    setDc(null);
    setErr("");
    setCopied(false);
    (async () => {
      try {
        const code = await startSignIn();
        if (my !== run.current) return;
        setDc(code);
        setPhase("code");
        const ok = await waitForApproval(code, ctrl.signal);
        if (my !== run.current || ctrl.signal.aborted) return;
        if (ok) {
          setPhase("done");
          toast("Signed in to YouTube", "success");
          setTimeout(onClose, 900);
        } else {
          setErr("The code expired. Try again.");
          setPhase("error");
        }
      } catch (e) {
        if (my !== run.current) return;
        setErr(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    })();
    return () => {
      ctrl.abort();
      run.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, attempt]);

  useEffect(() => {
    if (!dc) return;
    const tick = () => setLeft(Math.max(0, Math.round((dc.expiresAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [dc]);

  const copy = async () => {
    if (!dc) return;
    try {
      await navigator.clipboard.writeText(dc.userCode);
      setCopied(true);
    } catch {
      /* clipboard blocked: the code is on screen */
    }
  };
  const openGoogle = async () => {
    await copy();
    if (dc) window.open(dc.verifyUrl, "_blank");
  };

  return (
    <Modal open={open} onClose={onClose} title="Sign in with Google">
      {phase === "loading" && (
        <div className="flex flex-col items-center gap-3 py-8 text-sm text-ink3">
          <Spinner className="h-7 w-7" />
          Getting your code…
        </div>
      )}

      {phase === "code" && dc && (
        <div className="space-y-4">
          <ol className="space-y-1.5 text-[13px] text-ink2">
            <li>
              <b className="text-ink">1.</b> Open <b className="text-ink">{dc.verifyUrl.replace(/^https?:\/\//, "")}</b> and enter this code
            </li>
            <li>
              <b className="text-ink">2.</b> Pick your account and tap <b className="text-ink">Allow</b>
            </li>
          </ol>

          <button
            type="button"
            onClick={copy}
            className="glass-inset group flex w-full items-center justify-center gap-3 rounded-2xl border border-line bg-ink/[0.04] px-4 py-4 transition hover:border-accent"
            data-tip="Copy"
          >
            <span className="font-mono text-[26px] font-black tracking-[0.18em] text-ink">{dc.userCode}</span>
            {copied ? <Check className="h-5 w-5 text-emerald-500" /> : <Copy className="h-5 w-5 text-ink3 group-hover:text-accent" />}
          </button>

          <Button onClick={openGoogle} className="w-full py-2.5">
            <ExternalLink className="h-4 w-4" /> Copy code &amp; open Google
          </Button>

          <div className="flex items-center justify-center gap-2 text-[12px] text-ink3">
            <Spinner className="h-3.5 w-3.5" /> Waiting for approval · {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </div>
          <p className="text-center text-[11px] leading-relaxed text-ink3">
            Google will say “YouTube on TV”. That's this app. Your sign-in stays on this phone only.
          </p>
        </div>
      )}

      {phase === "done" && (
        <div className="flex flex-col items-center gap-3 py-8">
          <span className="flex h-14 w-14 animate-scale-in items-center justify-center rounded-full bg-emerald-500 text-white">
            <Check className="h-7 w-7" />
          </span>
          <p className="text-sm font-bold text-ink">Signed in</p>
        </div>
      )}

      {phase === "error" && (
        <div className="space-y-4 py-2 text-center">
          <p className="text-sm text-rose-500">{err}</p>
          <Button onClick={() => setAttempt((a) => a + 1)} className="mx-auto">
            <RefreshCw className="h-4 w-4" /> Try again
          </Button>
        </div>
      )}
    </Modal>
  );
}

export function AccountSection() {
  const acc = useYtAccount();
  const { toast } = usePlayer();
  const [signing, setSigning] = useState(false);

  return (
    <section>
      <SectionHeader title="YouTube account" icon={<CircleUserRound className="h-4 w-4 text-accent" />} />
      <div className="blur-panel space-y-4 p-4">
        {acc.signedIn ? (
          <>
            <div className="flex items-center gap-3">
              {acc.profile?.photo ? (
                <img src={acc.profile.photo} alt="" referrerPolicy="no-referrer" className="h-12 w-12 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <UserRound className="h-6 w-6" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold text-ink">{acc.profile?.name || "Signed in"}</p>
                <p className="truncate text-[11px] text-ink3">
                  {acc.profile?.handle ? `${acc.profile.handle} · ` : ""}
                  {acc.subs.length} subscriptions · {acc.liked.length} liked · {acc.playlists.length} playlists
                </p>
              </div>
            </div>
            {acc.errors.length > 0 && (
              <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-500">{acc.errors.join(" · ")}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={acc.syncing} onClick={() => void syncAccount()}>
                <RefreshCw className={cn("h-3.5 w-3.5", acc.syncing && "animate-spin")} /> {acc.syncing ? "Syncing…" : "Sync now"}
              </Button>
              <Button
                variant="ghost"
                className="text-rose-500 hover:text-rose-400"
                onClick={async () => {
                  if (!window.confirm("Sign out? Your local follows, likes and history stay.")) return;
                  await signOut();
                  toast("Signed out · guest mode");
                }}
              >
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.07] px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] text-ink2 uppercase">
                <UserRound className="h-3 w-3" /> Guest mode
              </span>
              <p className="mt-2 max-w-md text-[12px] leading-relaxed text-ink3">
                {accountSupported
                  ? "Sign in to bring your YouTube subscriptions, liked videos and playlists into the app."
                  : "Signing in to YouTube works in the Android app. Here, follows and likes are saved in this browser."}
              </p>
            </div>
            {accountSupported ? (
              <button
                type="button"
                onClick={() => setSigning(true)}
                className="focus-ring inline-flex shrink-0 items-center justify-center gap-2.5 rounded-full border border-line bg-white px-4 py-2.5 text-[13px] font-semibold text-[#1f1f1f] shadow-sm transition hover:shadow-md active:scale-[0.98]"
              >
                <GoogleG className="h-[18px] w-[18px]" /> Sign in with Google
              </button>
            ) : (
              <a
                href={APP_DOWNLOAD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-line px-4 py-2.5 text-[13px] font-semibold text-ink transition hover:border-accent hover:text-accent"
              >
                Get the Android app <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        )}
      </div>
      {accountSupported && <SignInDialog open={signing} onClose={() => setSigning(false)} />}
    </section>
  );
}
