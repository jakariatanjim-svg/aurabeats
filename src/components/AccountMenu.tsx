/**
 * Top bar: your YouTube picture. Tap → accounts and channels: switch, add,
 * remove, hide channels you never use. Only when signed in.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Eye, EyeOff, Plus, Settings, Trash2 } from "lucide-react";
import { cn } from "@/utils/cn";
import { storage } from "@/utils/storage";
import { usePlayer } from "@/hooks/usePlayer";
import { confirmAction } from "@/components/Confirm";
import { undoable } from "@/components/UndoToast";
import { Photo } from "@/components/YtAccountSection";
import { BrowserAccountsPicker } from "@/components/BrowserAccountsPicker";
import { isNative } from "@/services/video/net";
import { addAccount, hideAccount, switchAccount, switchChannel, useYtAccounts, ytAccountsSupported, type YtAccount } from "@/services/yt/accounts";
import type { RouteKey } from "@/routes";

const K_HIDDEN = "ytacct:hiddenChannels";
const chKey = (a: YtAccount, pageId?: string) => `${a.id}|${pageId ?? ""}`;

export function AccountMenu({ onNavigate, className }: { onNavigate: (r: RouteKey) => void; className?: string }) {
  const { accounts, active } = useYtAccounts();
  const { toast } = usePlayer();
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [hidden, setHidden] = useState<string[]>(() => storage.get<string[]>(K_HIDDEN, []));
  const [showHidden, setShowHidden] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    setPos({ top: r.bottom + 8, right: Math.max(8, innerWidth - r.right) });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const out = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", out, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", out, true);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  const me = accounts.find((a) => a.id === active) ?? accounts[0];
  if (!ytAccountsSupported() || !me) return null;

  const setHide = (k: string, on: boolean) => {
    const next = on ? [...hidden, k] : hidden.filter((x) => x !== k);
    setHidden(next);
    storage.set(K_HIDDEN, next);
  };
  const add = async () => {
    setOpen(false);
    if (!isNative) return setPicking(true);
    try {
      const acc = await addAccount();
      if (acc) toast(`Signed in as ${acc.name}`, "success");
    } catch (e) {
      toast((e as Error)?.message || "Sign-in failed", "error");
    }
  };
  const remove = async (a: YtAccount) => {
    setOpen(false);
    if (!(await confirmAction({ title: `Remove ${a.name}?`, confirmLabel: "Remove" }))) return;
    const h = hideAccount(a.id);
    undoable({ message: `Removed ${a.name}`, undo: h.restore, commit: h.forget });
  };

  const hiddenCount = accounts.reduce((n, a) => n + a.channels.filter((c) => (c.pageId ?? "") !== a.pageId && hidden.includes(chKey(a, c.pageId))).length, 0);

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label="Your accounts"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn("focus-ring shrink-0 rounded-full ring-2 ring-transparent transition hover:ring-accent/40", open && "ring-accent/60", className)}
      >
        <Photo src={me.photo} className="h-9 w-9" />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            style={{ top: pos.top, right: pos.right }}
            className="blur-panel surface-raised animate-fade-in fixed z-[80] max-h-[min(70vh,560px)] w-[min(320px,calc(100vw-16px))] overflow-y-auto p-2"
          >
            {accounts.map((a) => {
              const on = a.id === me.id;
              const chans = a.channels.filter((c) => (c.pageId ?? "") === a.pageId || showHidden || !hidden.includes(chKey(a, c.pageId)));
              return (
                <div key={a.id} className={cn("rounded-2xl p-1", on && "bg-ink/[0.04]")}>
                  <button
                    type="button"
                    onClick={() => {
                      switchAccount(a.id);
                      if (!on) setOpen(false);
                    }}
                    className="focus-ring flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-ink/[0.05]"
                  >
                    <Photo src={a.photo} className="h-9 w-9" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold text-ink">{a.name}</span>
                      <span className="block truncate text-[11px] text-ink3">{a.email || a.handle || "YouTube"}</span>
                    </span>
                    {on && <Check className="h-4 w-4 shrink-0 text-accent" />}
                  </button>
                  {on && chans.length > 1 && (
                    <div className="mt-1 space-y-0.5 pl-3">
                      {chans.map((c) => {
                        const k = chKey(a, c.pageId);
                        const cur = (c.pageId ?? "") === a.pageId;
                        const isHidden = hidden.includes(k);
                        return (
                          <div key={k} className={cn("flex items-center gap-1 rounded-xl", isHidden && "opacity-60")}>
                            <button
                              type="button"
                              onClick={() => {
                                switchChannel(a.id, c.pageId ?? "");
                                setOpen(false);
                              }}
                              className="focus-ring flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-ink/[0.05]"
                            >
                              <Photo src={c.photo} className="h-6 w-6" />
                              <span className={cn("min-w-0 flex-1 truncate text-[12px] font-semibold", cur ? "text-accent" : "text-ink2")}>{c.name}</span>
                              {cur && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                            </button>
                            {!cur && (
                              <button
                                type="button"
                                aria-label={isHidden ? `Show ${c.name}` : `Hide ${c.name}`}
                                title={isHidden ? "Show" : "Hide"}
                                onClick={() => setHide(k, !isHidden)}
                                className="focus-ring rounded-full p-1.5 text-ink3 hover:bg-ink/[0.06] hover:text-ink"
                              >
                                {isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowHidden((s) => !s)}
                className="focus-ring mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold text-ink3 hover:bg-ink/[0.05]"
              >
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showHidden && "rotate-180")} />
                {showHidden ? "Hide hidden channels" : `Hidden channels (${hiddenCount})`}
              </button>
            )}
            <div className="my-1.5 h-px bg-line" />
            <MenuRow icon={<Plus className="h-4 w-4" />} label="Add account" onClick={() => void add()} />
            <MenuRow icon={<Trash2 className="h-4 w-4" />} label={`Remove ${me.name}`} onClick={() => void remove(me)} danger />
            <MenuRow
              icon={<Settings className="h-4 w-4" />}
              label="Manage accounts"
              onClick={() => {
                setOpen(false);
                onNavigate("settings");
              }}
            />
          </div>,
          document.body,
        )}
      {picking && <BrowserAccountsPicker onClose={() => setPicking(false)} />}
    </>
  );
}

function MenuRow({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "focus-ring flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-semibold",
        danger ? "text-ink2 hover:bg-red-500/10 hover:text-red-500" : "text-ink2 hover:bg-ink/[0.05] hover:text-ink",
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
