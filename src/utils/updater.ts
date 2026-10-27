import { compareVersions, formatVersion, parseVersion, type Version } from "@/utils/version";

/**
 * In-app update plumbing.
 *
 * Releases live in `jakariatanjim-svg/aurabeats`. The repository that used to
 * carry this app was renamed to `discontinued-aurabeats` and archived — it is
 * deliberately not queried here, so an installed build never chases a feed that
 * no longer moves.
 *
 * The rule that keeps the updater honest: a download is only offered when the
 * published version is **strictly newer** than the version baked into the
 * running bundle. Equal means "you are on the latest version" — never
 * "re-patch yourself with the build you already have", which is what the old
 * commit-SHA comparison did as soon as a manual rebuild overwrote a release.
 */

export const GITHUB_REPO = "jakariatanjim-svg/aurabeats";

const LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
/** Asset name the release workflow prefers; a versioned name is also accepted. */
export const APK_ASSET_NAME = "AuraBeats.apk";
/**
 * Matches every name the pipeline has used for the Android package, so renaming
 * the release asset can never break the update check: `AuraBeats.apk`,
 * `AuraBeats-1.4.apk`, `aurabeats.apk`.
 */
const APK_ASSET_PATTERN = /^aurabeats(?:[-_.][\w.-]*)?\.apk$/i;
const APK_CONTENT_TYPE = "application/vnd.android.package-archive";
const APK_FILE_NAME = "AuraBeats-update.apk";

/** Version of the bundle running right now, baked in at build time. */
export const APP_VERSION: string = (() => {
  try {
    return __APP_VERSION__ || "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

/** Commit the running bundle was built from (empty outside a git checkout). */
export const APP_BUILD_SHA: string = (() => {
  try {
    return __APP_BUILD_SHA__ || "";
  } catch {
    return "";
  }
})();

export interface LatestRelease {
  tag: string;
  title: string;
  /** Parsed from the tag (`v1.4`); null for legacy unversioned tags. */
  version: Version | null;
  apkUrl: string | null;
  apkBytes: number;
  /** Short commit stamp from the release notes, used only as a fallback. */
  commitSha: string;
}

export type UpdateStatus =
  /** Release is newer and the APK is attached — offer the download. */
  | "available"
  /** Release is newer but the APK has not been built into it yet. */
  | "preparing"
  /** Installed version is the latest (or newer). Nothing to do. */
  | "current"
  /** Could not decide (release carries no parseable version). */
  | "unknown";

export interface UpdateCheck {
  status: UpdateStatus;
  release: LatestRelease;
}

interface ReleaseAsset {
  name?: string;
  browser_download_url?: string;
  size?: number;
}

function readCommitSha(body: unknown): string {
  if (typeof body !== "string") return "";
  const stamped = body.match(/built from `([0-9a-f]{7,40})`/i) || body.match(/Auto build · ([0-9a-f]{7,40})/i);
  return stamped ? stamped[1] : "";
}

/** Fetches the release GitHub marks as "latest"; null when there is none. */
/** Finds the Android package in a release, tolerating either asset name. */
function findApkAsset(assets: ReleaseAsset[]): ReleaseAsset | undefined {
  return (
    assets.find((asset) => asset?.name === APK_ASSET_NAME) ??
    assets.find((asset) => typeof asset?.name === "string" && APK_ASSET_PATTERN.test(asset.name))
  );
}

export async function fetchLatestRelease(): Promise<LatestRelease | null> {
  const response = await fetch(LATEST_RELEASE_URL, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) return null;

  const data = (await response.json()) as {
    tag_name?: string;
    name?: string;
    body?: string;
    assets?: ReleaseAsset[];
  };

  const assets = Array.isArray(data.assets) ? data.assets : [];
  const apk = findApkAsset(assets);
  const tag = data.tag_name || data.name || "";

  return {
    tag,
    title: data.name || tag,
    version: parseVersion(tag) ?? parseVersion(data.name),
    apkUrl: apk?.browser_download_url || null,
    apkBytes: Number(apk?.size ?? 0),
    commitSha: readCommitSha(data.body),
  };
}

/** Decides what the running build should do about a release. */
export function evaluateRelease(release: LatestRelease): UpdateStatus {
  const installed = parseVersion(APP_VERSION);

  if (installed && release.version) {
    // Strictly newer only. Same version => already up to date.
    if (compareVersions(release.version, installed) <= 0) return "current";
    return release.apkUrl ? "available" : "preparing";
  }

  // Unversioned (legacy) release: fall back to the commit stamp so an identical
  // build is still recognised instead of looping forever.
  if (release.commitSha && APP_BUILD_SHA && release.commitSha.slice(0, 7) === APP_BUILD_SHA.slice(0, 7)) {
    return "current";
  }
  return "unknown";
}

/** One call that fetches the latest release and reaches a verdict. */
export async function checkForUpdate(): Promise<UpdateCheck | null> {
  try {
    const release = await fetchLatestRelease();
    if (!release) return null;
    return { status: evaluateRelease(release), release };
  } catch {
    return null;
  }
}

/** Human-facing version strings, e.g. "v1.4" / "v1.4 (dev build)". */
export function installedVersionLabel(): string {
  const parsed = parseVersion(APP_VERSION);
  return parsed ? `v${formatVersion(parsed)}` : "unknown";
}

export function releaseVersionLabel(release: LatestRelease): string {
  return release.version ? `v${formatVersion(release.version)}` : release.tag || "unknown";
}

/**
 * Downloads the APK inside the app, reporting progress, then hands it straight
 * to the system package installer — no browser hop, no notification shade.
 *
 * Requires the Android side to declare REQUEST_INSTALL_PACKAGES (the APK
 * workflow patches the manifest) and a stable signing key (GitHub Secrets), otherwise
 * Android refuses to install over the running build.
 */
export async function downloadAndInstallApk(
  url: string,
  onProgress?: (fraction: number) => void
): Promise<void> {
  const [{ Filesystem, Directory }, { FileTransfer }, { FileOpener }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/file-transfer"),
    import("@capacitor-community/file-opener"),
  ]);

  // Never hand a half-finished APK from an earlier attempt to the installer.
  await Filesystem.deleteFile({ directory: Directory.Data, path: APK_FILE_NAME }).catch(() => {});
  const target = await Filesystem.getUri({ directory: Directory.Data, path: APK_FILE_NAME });

  const listener = await FileTransfer.addListener("progress", (progress) => {
    if (progress && progress.contentLength > 0) {
      onProgress?.(Math.max(0, Math.min(1, progress.bytes / progress.contentLength)));
    }
  });

  try {
    await FileTransfer.downloadFile({ url, path: target.uri, progress: true });
  } finally {
    await listener.remove().catch(() => {});
  }
  onProgress?.(1);

  await FileOpener.open({ filePath: target.uri, contentType: APK_CONTENT_TYPE });
}
