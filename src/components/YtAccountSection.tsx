/**
 * Settings → YouTube account (Android app, "Advanced users only").
 * Sign in with youtube.com's own Google page, keep several accounts, switch
 * accounts and channels. The website shows nothing yet (extension: step 4).
 */
import { useEffect, useState } from "react";
import { Check, CircleUserRound, RefreshCw, Trash2, TriangleAlert, UserRound } from "lucide-react";
import { Button, SectionHeader, Spinner } from "@/components/ui";
import { cn } from "@/utils/cn";
import { usePlayer } from "@/hooks/usePlayer";
import { confirmAction } from "@/components/Confirm";
import { undoable } from "@/components/UndoToast";
import {
  addAccount,
  checkAccountsOnce,
  hideAccount,
  refreshAccount,
  switchAccount,
  switchChannel,
  useYtAccounts,
  ytAccountsSupported,
  type YtAccount,
} from "@/services/yt/accounts";

/** Google's multicolour "G" (brand mark for the sign-in button). */
function GoogleG({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function Photo({ src, className }: { src?: string; className?: string }) {
  return src ? (
    <img src={src} alt="" referrerPolicy="no-referrer" className={cn("shrink-0 rounded-full object-cover", className)} />
  ) : (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent", className)}>
      <UserRound className="h-1/2 w-1/2" />
    </span>
  );
}

export function YtAccountSection() {
  const { accounts, active, busy } = useYtAccounts();
  const { toast } = usePlayer();
  const [refreshing, setRefreshing] = useState<string | null>(null);

  useEffect(() => checkAccountsOnce(), []);
  if (!ytAccountsSupported()) return null;

  const add = async () => {
    try {
      const acc = await addAccount();
      if (acc) toast(`Signed in as ${acc.name}`, "success");
    } catch (e) {
      toast((e as Error)?.message || "Sign-in failed", "error");
    }
  };

  const refresh = async (a: YtAccount) => {
    setRefreshing(a.id);
    try {
      await refreshAccount(a.id);
    } catch {
      toast("Couldn't reach YouTube", "error");
    } finally {
      setRefreshing(null);
    }
  };

  const remove = async (a: YtAccount) => {
    const ok = await confirmAction({
      title: `Remove ${a.name}?`,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    const h = hideAccount(a.id);
    undoable({ message: `Removed ${a.name}`, undo: h.restore, commit: h.forget });
  };

  return (
    <section>
      <SectionHeader
        title="YouTube account"
        icon={<CircleUserRound className="h-4 w-4 text-accent" />}
        action={
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[10px] font-black tracking-wide text-amber-500 uppercase">
            Advanced users only
          </span>
        }
      />
      <div className="blur-panel divide-y divide-line p-0">
        {accounts.map((a) => (
          <AccountRow
            key={a.id}
            a={a}
            active={a.id === active}
            refreshing={refreshing === a.id}
            onUse={() => switchAccount(a.id)}
            onRefresh={() => void refresh(a)}
            onRemove={() => void remove(a)}
            onSignInAgain={() => void add()}
          />
        ))}
        <div className="flex items-center justify-between gap-3 p-4">
          <p className="min-w-0 text-[12px] text-ink3">{accounts.length ? `${accounts.length} account${accounts.length === 1 ? "" : "s"}` : "Guest mode"}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void add()}
            className="focus-ring inline-flex shrink-0 items-center justify-center gap-2.5 rounded-full border border-line bg-white px-4 py-2.5 text-[13px] font-semibold text-[#1f1f1f] shadow-sm transition hover:shadow-md active:scale-[0.98] disabled:opacity-60"
          >
            {busy ? <Spinner className="h-[18px] w-[18px]" /> : <GoogleG className="h-[18px] w-[18px]" />}
            {accounts.length ? "Add account" : "Sign in with Google"}
          </button>
        </div>
      </div>
    </section>
  );
}

function AccountRow({
  a,
  active,
  refreshing,
  onUse,
  onRefresh,
  onRemove,
  onSignInAgain,
}: {
  a: YtAccount;
  active: boolean;
  refreshing: boolean;
  onUse: () => void;
  onRefresh: () => void;
  onRemove: () => void;
  onSignInAgain: () => void;
}) {
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-3">
        <Photo src={a.photo} className="h-11 w-11" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-[14px] font-bold text-ink">
            <span className="truncate">{a.name}</span>
            {active && <Check className="h-4 w-4 shrink-0 text-accent" aria-label="In use" />}
          </p>
          <p className="truncate text-[12px] text-ink3">{[a.handle, a.email].filter(Boolean).join(" · ") || "YouTube"}</p>
        </div>
        <button type="button" onClick={onRefresh} aria-label="Refresh" className="focus-ring rounded-full p-2 text-ink3 hover:bg-white/10 hover:text-ink">
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </button>
        <button type="button" onClick={onRemove} aria-label="Remove" className="focus-ring rounded-full p-2 text-ink3 hover:bg-red-500/10 hover:text-red-500">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {a.needsSignIn && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-600 dark:text-amber-400">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          <span className="flex-1">Signed out</span>
          <button type="button" onClick={onSignInAgain} className="font-bold underline underline-offset-2">
            Sign in again
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {a.channels.length > 1 && (
          <select
            value={a.pageId}
            onChange={(e) => switchChannel(a.id, e.target.value)}
            aria-label="Channel"
            className="focus-ring min-w-0 flex-1 rounded-full border border-line bg-elev2 px-3 py-2 text-[13px] font-semibold text-ink"
          >
            {a.channels.map((c) => (
              <option key={c.pageId ?? ""} value={c.pageId ?? ""}>
                {c.name}
                {c.handle ? ` (${c.handle})` : ""}
              </option>
            ))}
          </select>
        )}
        {!active && (
          <Button variant="outline" onClick={onUse} className="shrink-0">
            Switch
          </Button>
        )}
      </div>
    </div>
  );
}
