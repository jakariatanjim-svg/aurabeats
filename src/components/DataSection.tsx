/**
 * Settings → Your data, and the Danger zone at the very bottom of Settings.
 * Everything AuraBeats keeps lives on this device.
 *
 *  - Your data: counts, backup / restore, storage used, offline songs
 *    (size + delete), leftover download files and data saver (app).
 *  - Danger zone: cached data, reset settings, erase everything, and the
 *    "Ask before deleting" switch for every confirmation in the app.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Database, Download, Eraser, HardDrive, MessageSquareWarning, RotateCcw, ShieldAlert, Signal, Trash2, Upload } from "lucide-react";
import { cn } from "@/utils/cn";
import { formatBytes } from "@/utils/format";
import { storage } from "@/utils/storage";
import { db } from "@/utils/db";
import { usePlayer } from "@/hooks/usePlayer";
import { isNative } from "@/services/video/net";
import { appFileUsage, clearTempFiles } from "@/services/videoDownload";
import { getVideoSettings, setVideoSettings, subscribeVideoSettings } from "@/services/video/settings";
import { SectionHeader } from "@/components/ui";
import { confirmAction, useAskBeforeDelete } from "@/components/Confirm";
import { applyReplace, backupJson, isCacheKey, lsKeys, RAW_CACHES, SETTING_KEYS } from "@/utils/backup";

async function saveBackup(json: string): Promise<string> {
  const name = `aurabeats-backup-${new Date().toISOString().slice(0, 10)}.json`;
  if (isNative) {
    const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
    await Filesystem.writeFile({ path: `AuraBeats/${name}`, data: json, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
    return `Documents/AuraBeats/${name}`;
  }
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return name;
}

export function DataSection() {
  const { toast, favorites, history, playlists, offlineTracks, clearOffline } = usePlayer();
  const vs = useSyncExternalStore(subscribeVideoSettings, getVideoSettings, getVideoSettings);
  const fileRef = useRef<HTMLInputElement>(null);
  const [used, setUsed] = useState<number | null>(null);
  const [offline, setOffline] = useState<{ count: number; bytes: number } | null>(null);
  const [temp, setTemp] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const off = await db.usage().catch(() => null);
    setOffline(off ? { count: off.count, bytes: off.bytes } : null);
    if (isNative) {
      const u = await appFileUsage();
      setTemp(u?.temp ?? null);
      if (u && off) setOffline({ count: off.count, bytes: Math.max(off.bytes, u.offline) });
    } else {
      const est = await navigator.storage?.estimate?.().catch(() => null);
      setUsed(est?.usage ?? null);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh, offlineTracks.length]);

  const exportData = async () => {
    try {
      const where = await saveBackup(backupJson());
      toast(`Backup saved: ${where}`, "success");
    } catch {
      toast("Could not save the backup", "error");
    }
  };

  const importData = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as { app?: string; kind?: string; data?: Record<string, unknown> };
      if (parsed.app !== "AuraBeats" || parsed.kind !== "backup" || !parsed.data || typeof parsed.data !== "object") throw new Error("not a backup");
      const ok = await confirmAction({
        title: "Restore this backup?",
        message: "Your favourites, playlists, history and settings on this device will be replaced by the ones in the file.",
        confirmLabel: "Restore",
      });
      if (!ok) return;
      applyReplace(parsed.data as Record<string, string>);
      window.location.reload();
    } catch {
      toast("That file isn't an AuraBeats backup", "error");
    }
  };

  const deleteOffline = async () => {
    const ok = await confirmAction({
      title: "Delete offline songs?",
      message: `All ${offline?.count ?? ""} songs saved for offline listening will be removed from this ${isNative ? "phone" : "browser"}.`,
    });
    if (ok) await clearOffline().then(refresh);
  };

  const stats = [
    { label: "Favourites", value: favorites.length },
    { label: "Playlists", value: playlists.length },
    { label: "Played", value: history.length },
  ];

  return (
    <section>
      <SectionHeader title="Your data" subtitle="Stored only on this device" icon={<Database className="h-4 w-4 text-accent" />} />
      <div className="blur-panel divide-y divide-line p-0">
        <div className="grid grid-cols-3 gap-2 p-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl border border-line bg-ink/[0.02] p-2.5 text-center">
              <p className="text-lg font-black text-ink tabular-nums">{s.value}</p>
              <p className="text-[10px] tracking-wide text-ink3 uppercase">{s.label}</p>
            </div>
          ))}
        </div>

        <Row icon={<Download className="h-4 w-4" />} title="Back up" hint={isNative ? "Saves a file to Documents/AuraBeats" : "Downloads a file with your library and settings"}>
          <Act onClick={() => void exportData()}>Export</Act>
        </Row>
        <Row icon={<Upload className="h-4 w-4" />} title="Restore" hint="From an AuraBeats backup file">
          <Act onClick={() => fileRef.current?.click()}>Import</Act>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void importData(f);
            }}
          />
        </Row>

        {isNative ? (
          <>
            <Row
              icon={<HardDrive className="h-4 w-4" />}
              title="Offline songs"
              hint={offline ? `${offline.count} saved · ${formatBytes(offline.bytes) || "0 B"}` : "—"}
            >
              <Act
                danger
                disabled={!offline?.count}
                onClick={() => void deleteOffline()}
              >
                Delete
              </Act>
            </Row>
            <Row icon={<Eraser className="h-4 w-4" />} title="Leftover download files" hint={temp !== null ? formatBytes(temp) || "0 B" : "—"}>
              <Act
                disabled={!temp}
                onClick={() =>
                  void clearTempFiles().then(() => {
                    toast("Cleared", "success");
                    void refresh();
                  })
                }
              >
                Clear
              </Act>
            </Row>
            <Row icon={<Signal className="h-4 w-4" />} title="Data saver on mobile data" hint="Videos start at 480p or lower">
              <Switch on={vs.dataSaver} label="Data saver on mobile data" onClick={() => setVideoSettings({ dataSaver: !vs.dataSaver })} />
            </Row>
          </>
        ) : (
          <>
            <Row
              icon={<HardDrive className="h-4 w-4" />}
              title="Saved in this browser"
              hint={`${used !== null ? formatBytes(used) || "0 B" : "—"}${offline?.count ? ` · ${offline.count} offline songs` : ""}`}
            >
              {offline?.count ? (
                <Act
                  danger
                  onClick={() => void deleteOffline()}
                >
                  Delete songs
                </Act>
              ) : null}
            </Row>
          </>
        )}

      </div>
    </section>
  );
}

/** Last thing in Settings: everything that deletes, in one place. */
export function DangerZone() {
  const { toast, clearOffline } = usePlayer();
  const [ask, setAsk] = useAskBeforeDelete();

  const clearCache = async () => {
    const ok = await confirmAction({
      title: "Clear cached data?",
      message: "Saved feeds, lyrics and pictures are removed. They load again when needed; your library stays.",
      confirmLabel: "Clear",
    });
    if (!ok) return;
    for (const k of lsKeys()) if (isCacheKey(k)) localStorage.removeItem(k);
    RAW_CACHES.forEach((k) => localStorage.removeItem(k));
    void caches?.keys?.().then((ks) => ks.forEach((k) => void caches.delete(k))).catch(() => {});
    toast("Cached data cleared", "success");
  };

  const resetSettings = async () => {
    const ok = await confirmAction({
      title: "Reset settings?",
      message: "Theme, colours, player and video settings go back to default. Your library and history stay.",
      confirmLabel: "Reset",
    });
    if (!ok) return;
    SETTING_KEYS.forEach((k) => storage.remove(k));
    window.location.reload();
  };

  const eraseAll = async () => {
    const ok = await confirmAction({
      title: "Erase everything?",
      message: "Library, playlists, history, settings, offline songs and the YouTube sign-in are deleted from this device. This can't be undone.",
      confirmLabel: "Erase everything",
      always: true,
    });
    if (!ok) return;
    await clearOffline().catch(() => {});
    if (isNative) await clearTempFiles();
    storage.clearAll();
    RAW_CACHES.forEach((k) => localStorage.removeItem(k));
    window.location.reload();
  };

  return (
    <section>
      <SectionHeader title="Danger zone" subtitle="Deletes things on this device" icon={<ShieldAlert className="h-4 w-4 text-rose-500" />} />
      <div className="blur-panel divide-y divide-rose-500/15 border-rose-500/30! bg-rose-500/[0.03]! p-0">
        <Row danger icon={<Eraser className="h-4 w-4" />} title="Cached data" hint="Saved feeds and pictures; loads again when needed">
          <Act danger onClick={() => void clearCache()}>
            Clear
          </Act>
        </Row>
        <Row danger icon={<RotateCcw className="h-4 w-4" />} title="Reset settings" hint="Library and history stay">
          <Act danger onClick={() => void resetSettings()}>
            Reset
          </Act>
        </Row>
        <Row danger icon={<Trash2 className="h-4 w-4" />} title="Erase everything" hint="Starts AuraBeats fresh on this device">
          <Act danger onClick={() => void eraseAll()}>
            Erase
          </Act>
        </Row>
        <Row danger icon={<MessageSquareWarning className="h-4 w-4" />} title="Ask before deleting" hint={ask ? "A check appears before anything is deleted" : "Deletes right away (Erase still asks)"}>
          <Switch on={ask} label="Ask before deleting" onClick={() => setAsk(!ask)} />
        </Row>
      </div>
    </section>
  );
}

function Row({ icon, title, hint, children, danger }: { icon: React.ReactNode; title: string; hint?: string; children?: React.ReactNode; danger?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", danger ? "bg-rose-500/12 text-rose-500" : "bg-accent/12 text-accent")}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold text-ink">{title}</p>
        {hint && <p className="truncate text-[11px] text-ink3">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Act({ children, onClick, danger, disabled }: { children: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "focus-ring shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-bold transition active:scale-95 disabled:opacity-40",
        danger ? "border-rose-500/35 text-rose-400 hover:border-rose-500" : "border-line text-ink2 hover:border-accent hover:text-accent",
      )}
    >
      {children}
    </button>
  );
}

export function Switch({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={cn("relative h-6 w-11 shrink-0 rounded-full transition", on ? "bg-emerald-500" : "bg-ink/15")}
    >
      <span className={cn("absolute top-1 left-1 h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition", on ? "translate-x-5" : "translate-x-0")} />
    </button>
  );
}
