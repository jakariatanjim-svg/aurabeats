/**
 * Website: pick which of the browser's Google accounts (signed in to YouTube)
 * to use in AuraBeats — one or several. Read through the extension.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, RefreshCw, UserPlus, UserRound } from "lucide-react";
import { Button, Modal, Spinner } from "@/components/ui";
import { cn } from "@/utils/cn";
import { usePlayer } from "@/hooks/usePlayer";
import { addBrowserAccounts, GOOGLE_ADD, GOOGLE_SIGN_IN, listBrowserAccounts, type BrowserAccount } from "@/services/yt/accounts";

function Pic({ src }: { src?: string }) {
  const [bad, setBad] = useState(false);
  if (src && !bad) return <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBad(true)} className="h-10 w-10 shrink-0 rounded-full object-cover" />;
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
      <UserRound className="h-5 w-5" />
    </span>
  );
}

export function BrowserAccountsPicker({ onClose }: { onClose: () => void }) {
  const { toast } = usePlayer();
  const [list, setList] = useState<BrowserAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  const load = useCallback(() => {
    setList(null);
    setError(null);
    listBrowserAccounts().then(
      (all) => {
        setList(all);
        // nothing added yet: preselect the first one
        setPicked((p) => (p.length ? p.filter((id) => all.some((a) => a.id === id && !a.added)) : all.filter((a) => !a.added).slice(0, 1).map((a) => a.id)));
      },
      (e) => setError((e as Error)?.message || "Couldn't reach YouTube"),
    );
  }, []);
  useEffect(load, [load]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const add = () => {
    const done = addBrowserAccounts(picked);
    if (done.length) toast(done.length === 1 ? `Signed in as ${done[0].name}` : `Added ${done.length} accounts`, "success");
    onClose();
  };
  const signInMore = () => window.open(list?.length ? GOOGLE_ADD : GOOGLE_SIGN_IN, "_blank", "noopener");

  return (
    <Modal open onClose={onClose} title="Choose accounts">
      <div className="space-y-3">
        {error ? (
          <p className="text-sm text-rose-400">{error}</p>
        ) : !list ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : !list.length ? (
          <p className="py-2 text-sm text-ink2">No account is signed in to YouTube in this browser.</p>
        ) : (
          <div className="max-h-[50vh] divide-y divide-line overflow-y-auto">
            {list.map((a) => {
              const on = a.added || picked.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  disabled={a.added}
                  onClick={() => toggle(a.id)}
                  className="focus-ring flex w-full items-center gap-3 px-1 py-2.5 text-left disabled:opacity-60"
                >
                  <Pic src={a.photo} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{a.name}</span>
                    <span className="block truncate text-[12px] text-ink3">
                      {[a.email, a.added ? "Added" : a.channels > 1 ? `${a.channels} channels` : ""].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors", on ? "border-accent bg-accent text-white" : "border-line")}>
                    {on && <Check className="h-3.5 w-3.5" />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="flex-1" onClick={signInMore}>
            <UserPlus className="h-4 w-4" /> {list?.length ? "Another account" : "Sign in"}
          </Button>
          <Button variant="outline" onClick={load} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!picked.length} onClick={add}>
            Add{picked.length > 1 ? ` ${picked.length}` : ""}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
