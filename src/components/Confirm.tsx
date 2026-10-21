/**
 * "Are you sure?" for anything that deletes data. One dialog for the whole
 * app, with a "Don't ask again" box; Settings → Danger zone → "Ask before
 * deleting" turns the questions back on. `always` questions (erase
 * everything, replace data) are asked regardless.
 */
import { useSyncExternalStore, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { storage } from "@/utils/storage";
import { cn } from "@/utils/cn";

const SKIP_KEY = "confirm:skip";

interface Ask {
  title: string;
  message?: string;
  confirmLabel?: string;
  /** asked even when "Don't ask again" is on */
  always?: boolean;
  resolve: (ok: boolean) => void;
}

let current: Ask | null = null;
let skip = storage.get<boolean>(SKIP_KEY, false);
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Ask before a destructive action. Resolves true to go ahead. */
export function confirmAction(o: Omit<Ask, "resolve">): Promise<boolean> {
  if (skip && !o.always) return Promise.resolve(true);
  current?.resolve(false);
  return new Promise((resolve) => {
    current = { ...o, resolve };
    emit();
  });
}

/** Settings switch: true = ask before deleting. */
export function useAskBeforeDelete(): [boolean, (on: boolean) => void] {
  const s = useSyncExternalStore(subscribe, () => skip, () => skip);
  return [
    !s,
    (on: boolean) => {
      skip = !on;
      storage.set(SKIP_KEY, skip);
      emit();
    },
  ];
}

/** Mounted once in App. */
export function ConfirmHost() {
  const ask = useSyncExternalStore(subscribe, () => current, () => current);
  const [dontAsk, setDontAsk] = useState(false);

  const done = (ok: boolean) => {
    if (!ask) return;
    if (ok && dontAsk && !ask.always) {
      skip = true;
      storage.set(SKIP_KEY, true);
    }
    current = null;
    setDontAsk(false);
    emit();
    ask.resolve(ok);
  };

  return (
    <Modal open={Boolean(ask)} onClose={() => done(false)} title={ask?.title ?? ""} maxWidth="max-w-sm">
      {ask && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-rose-500/12 text-rose-500">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <p className="text-[13px] leading-relaxed text-ink2">{ask.message ?? "This can't be undone."}</p>
          </div>
          {!ask.always && (
            <label className="flex cursor-pointer items-center gap-2.5 text-[12px] text-ink3 select-none">
              <input
                type="checkbox"
                checked={dontAsk}
                onChange={(e) => setDontAsk(e.target.checked)}
                className="h-4 w-4 accent-[var(--c-accent)]"
              />
              Don't ask again
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => done(false)}>
              Cancel
            </Button>
            <Button onClick={() => done(true)} className={cn("bg-rose-600! shadow-none! hover:brightness-110")}>
              {ask.confirmLabel ?? "Delete"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
