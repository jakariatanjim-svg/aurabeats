import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastMessage } from "@/types";
import { formatBytes } from "@/utils/format";
import {
  checkForUpdate,
  downloadAndInstallApk,
  installedVersionLabel,
  releaseVersionLabel,
  type UpdateCheck,
} from "@/utils/updater";

type Toast = (text: string, tone?: ToastMessage["tone"]) => void;

export interface AppUpdate {
  /** Result of the most recent check; null until one has finished. */
  check: UpdateCheck | null;
  checking: boolean;
  downloading: boolean;
  /** 0..1 while the APK downloads, null when idle. */
  progress: number | null;
  /** Button text for the current state. */
  label: string;
  /** One-line explanation of that state, shown under the button. */
  hint: string;
  /** Quiet re-check — announces a new version, otherwise says nothing. */
  refresh: () => Promise<void>;
  /** Button flow: check, confirm, download in-app, hand over to the installer. */
  runUpdate: () => Promise<void>;
}

/**
 * Native-only update flow.
 *
 * Checks the release feed as soon as the screen mounts (so a new version is
 * noticed without anyone pressing a button) and, once the user confirms,
 * downloads the APK inside the app with live progress before opening Android's
 * package installer. `enabled` keeps everything dormant on the web build, where
 * the service worker handles updates instead.
 *
 * A download is only offered when the published release is strictly newer than
 * the version baked into this bundle — see utils/updater.ts.
 */
export function useAppUpdate(enabled: boolean, toast: Toast): AppUpdate {
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const toastRef = useRef(toast);
  const aliveRef = useRef(true);
  const announcedRef = useRef(false);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const run = useCallback(
    async (announce: boolean): Promise<UpdateCheck | null> => {
      if (!enabled) return null;
      setChecking(true);
      const result = await checkForUpdate();
      if (!aliveRef.current) return result;
      setChecking(false);
      if (!result) return null;
      setCheck(result);
      if (announce && result.status === "available" && !announcedRef.current) {
        announcedRef.current = true;
        toastRef.current(`New version ${releaseVersionLabel(result.release)} is available`, "info");
      }
      return result;
    },
    [enabled]
  );

  const refresh = useCallback(async () => {
    await run(true);
  }, [run]);

  // Notice a new version the moment this screen opens.
  useEffect(() => {
    if (!enabled) return;
    void run(true);
  }, [enabled, run]);

  const runUpdate = useCallback(async () => {
    if (!enabled || downloading) return;

    const result = await run(false);
    if (!aliveRef.current) return;

    if (!result) {
      toastRef.current("Could not reach the release feed", "error");
      return;
    }

    const published = releaseVersionLabel(result.release);
    const installed = installedVersionLabel();

    if (result.status === "current") {
      toastRef.current(`You are on the latest version (${installed})`, "success");
      return;
    }
    if (result.status === "preparing") {
      toastRef.current(`${published} is published but its Android package is not attached yet — try again shortly`, "info");
      return;
    }
    if (!result.release.apkUrl) {
      toastRef.current("No update package found", "info");
      return;
    }

    const question =
      result.status === "unknown"
        ? `Cannot compare versions (installed ${installed}, published ${published}). Download it anyway?`
        : `Update AuraBeats ${installed} → ${published}? It downloads inside the app and opens the installer when it finishes.`;
    if (!window.confirm(question)) return;

    setDownloading(true);
    setProgress(0);
    try {
      await downloadAndInstallApk(result.release.apkUrl, (fraction) => {
        if (aliveRef.current) setProgress(fraction);
      });
      if (aliveRef.current) toastRef.current("Download complete — opening the installer", "success");
    } catch {
      if (!aliveRef.current) return;
      // Last resort on devices where the in-app pipeline is blocked.
      toastRef.current("In-app download failed — opening the browser instead", "error");
      window.open(result.release.apkUrl, "_blank");
    } finally {
      if (aliveRef.current) {
        setDownloading(false);
        setProgress(null);
      }
    }
  }, [downloading, enabled, run]);

  const installed = installedVersionLabel();
  const release = check?.release ?? null;
  const published = release ? releaseVersionLabel(release) : "";

  let label = "Check App Update";
  let hint = `Installed ${installed}. Checks GitHub for a newer release.`;

  if (downloading) {
    label = `Downloading update… ${progress !== null ? `${Math.round(progress * 100)}%` : ""}`;
    hint = "Downloading inside the app — Android's installer opens by itself when it finishes.";
  } else if (checking) {
    label = "Checking for updates…";
    hint = `Installed ${installed}. Talking to the release feed…`;
  } else if (check?.status === "available" && release) {
    const size = formatBytes(release.apkBytes);
    label = `Update to ${published}`;
    hint = `${installed} installed → ${published} available${size ? ` · ${size}` : ""}. Downloads inside the app, then opens the installer.`;
  } else if (check?.status === "preparing" && release) {
    label = `${published} is preparing`;
    hint = `${published} is published but its APK is still being built into the release. Try again in a few minutes.`;
  } else if (check?.status === "current") {
    label = `Up to date · ${installed}`;
    hint = `${installed} is the newest release. Playlists, history and downloads stay untouched.`;
  } else if (check?.status === "unknown" && release) {
    label = "Check App Update";
    hint = `Installed ${installed}, published ${published} — the two could not be compared, but you can still download it.`;
  } else if (!check) {
    hint = `Installed ${installed}. Checks GitHub for a newer release.`;
  }

  return { check, checking, downloading, progress, label, hint, refresh, runUpdate };
}
